// SPDX-License-Identifier: MPL-2.0
/** Ephemeral presence with 20 Hz latest-state coalescing, connection epochs,
 * heartbeats and bounded liveness. Hidden peers expire too; a leave retains a
 * short sequence tombstone so delayed packets cannot resurrect a departed cursor.
 */

// Canonical presence payload - the contract's v1.1 `Presence` (plan 100 section 3).
import { PRESENCE_VERSION } from '@lolly-tools/core/collab-presence-v1';
import type { PresenceFrame, PresenceState } from '@lolly-tools/core/collab-presence-v1';
export type { PresenceFrame, PresenceState } from '@lolly-tools/core/collab-presence-v1';

export interface PresencePeer {
  /** The peer's client id (the frame's `from`). */
  readonly id: string;
  readonly state: PresenceState;
  /** The sequence number of the newest frame applied for this peer. */
  readonly seq: number;
  readonly epoch?: string;
  readonly away: boolean;
  /** Engine-clock ms of the first frame that created this entry - the join order
   *  the collaborator-colour assignment keys off (section 4.4). */
  readonly firstSeen: number;
  /** Engine-clock ms of the newest applied frame - what the TTL measures. */
  readonly lastSeen: number;
}

/** Outbound coalescing window while peers are present (section 4.7). */
export const PRESENCE_THROTTLE_MS = 50;
/** Re-broadcast our own state this often so peers' TTLs never expire us (section 4.7). */
export const PRESENCE_HEARTBEAT_MS = 15_000;
/** Silence after which a peer is presumed crashed (section 4.7). Away peers have the same liveness bound. */
export const PRESENCE_TTL_MS = 30_000;
/** How often the roster is checked for expiries (section 4.7). */
export const PRESENCE_SWEEP_MS = 3_000;

export interface PresenceEngineOptions {
  /** This device's collab client id - stamped on every outbound frame, and the
   *  entry a joiner's handshake snapshot must not echo back (section 4.7). */
  clientId: string;
  /** Hand one frame to the transport. Called at most once per `PRESENCE_THROTTLE_MS`
   *  and never while the roster is empty. Omitted = a sink (the engine still keeps
   *  a roster, which is what an observer-only peer wants). */
  send?(frame: PresenceFrame): void;
  /** Monotonic ms. Injected so tests run on fake time. */
  now?(): number;
  /** One-shot timer returning an opaque handle. Repetition is built on top by
   *  rescheduling, so a Worker-hosted heartbeat (section 11.4) only has to supply these
   *  two functions. */
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(handle: unknown): void;
}

export interface PresenceEngine {
  /** Replace this client's presence. Coalesced and throttled outbound; silent while
   *  alone. */
  setLocal(state: PresenceState): void;
  /** Merge a few fields into the local state (a focus change, a cursor sample).
   *  A no-op before the first `setLocal` - there is nothing to merge into. */
  updateLocal(patch: Partial<PresenceState>): void;
  /** Flag this client's tab hidden/visible (`visibilitychange`, section 11.4). Sends when
   *  the flag actually changes so peers can grey the avatar. */
  setAway(away: boolean): void;
  /** Apply one inbound frame. Returns false when it was dropped as stale/out-of-
   *  order (section 11.5), self-addressed, or a leave for a peer we never had. */
  receive(frame: PresenceFrame): boolean;
  /** Drop a peer outright - the transport's call on channel close or ICE `failed`
   *  (section 11.3, section 11.4). Not the TTL's job. */
  remove(clientId: string): void;
  /** DISCOVERY escape hatch: emit the local state once, NOW, even while the roster
   *  is empty. The occupancy rule ("no traffic while alone") exists so an idle solo
   *  session costs nothing - but in a serverless pair BOTH sides start alone with no
   *  join-ack to seed them, so "alone" is indistinguishable from "undiscovered" and
   *  someone must speak first (plan 100 drill finding, 2026-08-10). The composition
   *  layer calls this while its transport is LIVE and the roster is empty (the
   *  presence lane is lossy, so it repeats on a slow cadence until first contact).
   *  Emits through the same seq/throttle path as every other frame so the peer's
   *  newest-only rule stays coherent; a no-op before the first `setLocal`. */
  announce(): void;
  /** Every peer, in first-seen order. Excludes this client. */
  roster(): PresencePeer[];
  /** This client's presence, or null before the first `setLocal`. */
  self(): PresenceState | null;
  /** The join handshake payload (section 4.7): everything we know - our own state and
   *  every peer - MINUS the joiner's own entry, which echoing back is tldraw's
   *  orphan bug. Each frame carries its origin's newest `seq`, so the receiver's
   *  newest-only rule makes the snapshot idempotent against live frames. */
  snapshot(joinerId?: string): PresenceFrame[];
  /** Subscribe to roster changes (peer joined / updated / went away / left).
   *  Local-only changes do not fire it. Returns a real teardown. */
  subscribe(fn: (peers: readonly PresencePeer[]) => void): () => void;
  /** Broadcast the clean-disconnect `null` frame (when anyone is listening), stop
   *  every timer, drop the roster and the subscribers. Idempotent. */
  destroy(): void;
}

/** Mutable twin of `PresencePeer` - copied out, never handed to a caller. */
interface PeerRecord {
  id: string;
  state: PresenceState;
  seq: number;
  epoch?: string;
  away: boolean;
  firstSeen: number;
  lastSeen: number;
}

function defaultNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

export function createPresenceEngine(opts: PresenceEngineOptions): PresenceEngine {
  const { clientId } = opts;
  const epoch = globalThis.crypto.randomUUID();
  const send = opts.send;
  const now = opts.now || defaultNow;
  const setTimer = opts.setTimer || ((fn: () => void, ms: number): unknown => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer
    || ((handle: unknown): void => { clearTimeout(handle as ReturnType<typeof setTimeout>); });

  /** Insertion-ordered, so `roster()` is join order (section 4.4). */
  const peers = new Map<string, PeerRecord>();
  const clocks = new Map<string, { epoch?: string; seq: number; at: number; retired: string[] }>();
  const subscribers = new Set<(peers: readonly PresencePeer[]) => void>();

  let local: PresenceState | null = null;
  let away = false;
  let seq = 0;
  let lastSentAt = Number.NEGATIVE_INFINITY;
  /** The armed trailing flush, or null when the window is clear. */
  let trailing: unknown = null;
  let stopHeartbeat: (() => void) | null = null;
  let stopSweep: (() => void) | null = null;
  let destroyed = false;

  // ── timers ──────────────────────────────────────────────────────────────────

  /** A repeating timer built from one-shots. Returns its canceller; `fn` may cancel
   *  it re-entrantly (the last eviction stopping the lifecycle does exactly that),
   *  which is why the reschedule re-checks.
   *
   *  The reschedule is in a `finally` because a tick that throws must not be the END
   *  of the chain: the sweep dispatches subscribers and the heartbeat calls into the
   *  transport, so one throwing consumer would otherwise silently disable TTL
   *  eviction for the life of the engine - and `syncLifecycle`'s `||=` can never
   *  re-arm a canceller that is still non-null. The throw still reaches the host and
   *  is reported; it just no longer takes presence down with it. */
  function repeat(ms: number, fn: () => void): () => void {
    let handle: unknown = null;
    let stopped = false;
    const tick = (): void => {
      if (stopped) return;
      handle = null;
      try {
        fn();
      } finally {
        if (!stopped) handle = setTimer(tick, ms);
      }
    };
    handle = setTimer(tick, ms);
    return () => {
      stopped = true;
      if (handle !== null) { clearTimer(handle); handle = null; }
    };
  }

  /** Occupancy scaling (section 4.7): the heartbeat and the sweep exist only while someone
   *  is here to hear them. Alone, this engine schedules nothing at all. */
  function syncLifecycle(): void {
    if (destroyed || peers.size === 0) {
      // The trailing flush belongs to the roster too. Every path that can empty the
      // roster comes through here (a `remove()`, a `null` leave frame, an eviction),
      // and an armed trailing timer that outlived the last peer would fire a frame
      // into an empty room - traffic while alone, which is the one thing this engine
      // promises never to produce.
      if (trailing !== null) { clearTimer(trailing); trailing = null; }
      stopHeartbeat?.();
      stopSweep?.();
      stopHeartbeat = null;
      stopSweep = null;
      return;
    }
    stopHeartbeat ||= repeat(PRESENCE_HEARTBEAT_MS, () => { if (local) scheduleSend(); });
    stopSweep ||= repeat(PRESENCE_SWEEP_MS, sweep);
  }

  // ── outbound ────────────────────────────────────────────────────────────────

  function emit(state: PresenceState | null): void {
    if (trailing !== null) { clearTimer(trailing); trailing = null; }
    lastSentAt = now();
    seq += 1;
    try {
      send?.({ v: PRESENCE_VERSION, from: clientId, epoch, seq, state, away });
    } catch {
      // The lane is lossy by construction (`maxRetransmits: 0`), so a frame the
      // transport refused - a channel that closed between the arm and the flush - is
      // exactly the case the next heartbeat covers. Swallowing it here keeps a
      // closed channel from killing the heartbeat that would otherwise notice.
    }
  }

  /** Leading edge + trailing flush, at most one frame per window - and nothing at
   *  all while alone, which is the whole of the occupancy rule on the send side. */
  function scheduleSend(): void {
    if (destroyed || !local || peers.size === 0) return;
    if (trailing !== null) return;
    const since = now() - lastSentAt;
    if (since >= PRESENCE_THROTTLE_MS) { emit(local); return; }
    trailing = setTimer(() => {
      trailing = null;
      // Re-checked, not assumed: `syncLifecycle` disarms this timer when the roster
      // empties, and an injected timer that fires anyway must still not break the
      // "nothing while alone" rule.
      if (local && !destroyed && peers.size > 0) emit(local);
    }, PRESENCE_THROTTLE_MS - since);
  }

  // ── roster ──────────────────────────────────────────────────────────────────

  /** A subscriber's failure is its own. One throwing roster listener must not skip
   *  the listeners after it, must not rethrow into the transport that called
   *  `receive()`, and above all must not kill the sweep it was dispatched from. */
  function notify(): void {
    if (subscribers.size === 0) return;
    const snap = roster();
    for (const fn of [...subscribers]) {
      try {
        fn(snap);
      } catch {
        /* not ours to handle; the roster is already committed */
      }
    }
  }

  /** Copied twice over: the record so a caller cannot re-seat a peer, and the state
   *  so a caller cannot write through to the store (and to every later subscriber).
   *  One level is enough - `Presence`'s nested `cursor`/`viewport`/`selection` are
   *  `readonly` in the contract, so reaching them needs a cast. */
  function roster(): PresencePeer[] {
    return [...peers.values()].map((p) => ({ ...p, state: { ...p.state } }));
  }

  /** Evict the silent, never the away (section 11.4). */
  function sweep(): void {
    const t = now();
    let changed = false;
    for (const [id, clock] of clocks) if (t - clock.at >= PRESENCE_TTL_MS) clocks.delete(id);
    for (const [id, peer] of peers) {

      if (t - peer.lastSeen >= PRESENCE_TTL_MS) { peers.delete(id); changed = true; }
    }
    if (!changed) return;
    syncLifecycle();
    notify();
  }

  function receive(frame: PresenceFrame): boolean {
    // Our own frame looped back by a relay: never our own roster entry.
    if (destroyed || frame.from === clientId || !Number.isSafeInteger(frame.seq) || frame.seq < 0 || frame.v !== undefined && frame.v !== PRESENCE_VERSION) return false;
    const t = now();
    const existing = peers.get(frame.from);
    // Retain recent leave/epoch clocks so delayed lossy samples cannot resurrect a
    // departed cursor. Legacy senders may restart their sequence after one TTL.
    const prior = clocks.get(frame.from);
    if (prior && t - prior.at < PRESENCE_TTL_MS && ((frame.epoch === prior.epoch && frame.seq <= prior.seq)
      || frame.epoch !== undefined && prior.retired.includes(frame.epoch))) return false;
    const retired = prior?.retired ?? [];
    if (prior?.epoch && prior.epoch !== frame.epoch) retired.push(prior.epoch);
    clocks.set(frame.from, { epoch: frame.epoch, seq: frame.seq, at: t, retired: retired.slice(-8) });
    if (clocks.size > 512) clocks.delete(clocks.keys().next().value!);

    if (frame.state === null) {
      if (!existing) return false;
      peers.delete(frame.from);
      syncLifecycle();
      notify();
      return true;
    }

    const wasEmpty = peers.size === 0;
    peers.set(frame.from, {
      id: frame.from,
      state: frame.state,
      seq: frame.seq,
      epoch: frame.epoch,
      away: frame.away === true,
      firstSeen: existing ? existing.firstSeen : t,
      lastSeen: t,
    });
    if (wasEmpty) {
      // First company: start the lifecycle, and announce ourselves - a client that
      // has been dutifully silent is otherwise invisible to the peer that just
      // arrived (section 4.7).
      syncLifecycle();
      scheduleSend();
    }
    notify();
    return true;
  }

  return {
    setLocal(state: PresenceState): void {
      if (destroyed) return;
      local = state;
      scheduleSend();
    },

    updateLocal(patch: Partial<PresenceState>): void {
      if (destroyed || !local) return;
      local = { ...local, ...patch };
      scheduleSend();
    },

    setAway(next: boolean): void {
      if (destroyed || away === next) return;
      away = next;
      scheduleSend();
    },

    announce(): void {
      if (destroyed || !local) return;
      // The one deliberate exception to the occupancy rule (see the interface doc):
      // emit through the SAME throttle/seq path as every other frame - bypassing the
      // roster gate, not the rate gate - so the peer's newest-only rule stays
      // coherent when the engine's ordinary sends begin.
      if (trailing !== null) return;
      const since = now() - lastSentAt;
      if (since >= PRESENCE_THROTTLE_MS) { emit(local); return; }
      trailing = setTimer(() => {
        trailing = null;
        if (local && !destroyed) emit(local);
      }, PRESENCE_THROTTLE_MS - since);
    },

    receive,
    remove(id: string): void {
      if (!peers.delete(id)) return;
      syncLifecycle();
      notify();
    },
    roster,
    self(): PresenceState | null {
      return local;
    },

    snapshot(joinerId?: string): PresenceFrame[] {
      const out: PresenceFrame[] = [];
      if (local && clientId !== joinerId) {
        out.push({ v: PRESENCE_VERSION, from: clientId, epoch, seq, state: local, away });
      }
      for (const peer of peers.values()) {
        if (peer.id === joinerId) continue;
        out.push({ v: PRESENCE_VERSION, from: peer.id, epoch: peer.epoch, seq: peer.seq, state: peer.state, away: peer.away });
      }
      return out;
    },

    subscribe(fn: (peers: readonly PresencePeer[]) => void): () => void {
      subscribers.add(fn);
      return () => { subscribers.delete(fn); };
    },

    destroy(): void {
      if (destroyed) return;
      // The clean-disconnect frame (section 4.7) - only when there is someone to tell, and
      // never through the throttle: it is the last thing we say.
      if (peers.size > 0) emit(null);
      destroyed = true;
      if (trailing !== null) { clearTimer(trailing); trailing = null; }
      peers.clear();
      syncLifecycle();
      subscribers.clear();
      local = null;
    },
  };
}
