// SPDX-License-Identifier: MPL-2.0
/**
 * The saved emoji preference - which set and brand treatment new work starts from.
 *
 * Same shape as lib/a11y-prefs.ts: the profile is the canonical store and this
 * module is the one place that reads and writes it. There the resemblance stops.
 * An accessibility pref is a live switch on the app chrome; this one is a SEED.
 * It decides what a fresh open starts with and nothing else: a document, a saved
 * session or a link that already names a set keeps the set it names, so turning
 * this on never restyles work that is already made. That is also why there is no
 * localStorage mirror and no attribute on the document - nothing here has to be
 * applied before the first paint.
 *
 * The preference stores no colours. A treatment resolves its palette from the
 * brand in force when it is applied, and the document then pins what it resolved,
 * so the same preference draws in whatever brand you open it under.
 */
import type { EmojiPackPinV1, EmojiPreferenceV1, EmojiStyleV1, EmojiTreatmentModeV1 } from '@lolly-tools/core/emoji-v1';

/** The two reserved URL params, as a link, a session stamp or an argv pair carries them. */
export interface EmojiParamPair {
  emoji: string;
  emojifx: string;
  emojistyle?: string;
}

/** The host slice this module persists through - the same weak shape a11y-prefs.ts uses. */
export interface EmojiPrefsHost {
  profile: {
    get(): Promise<object>;
    set?(profile: object): Promise<unknown>;
  };
}

const MODES: EmojiTreatmentModeV1[] = ['original', 'influence', 'snap', 'mono', 'duotone'];

/** A pin off an untrusted record, or null. Total: junk reads as absent, never throws. */
function readPin(value: unknown): EmojiPackPinV1 | null {
  if (!value || typeof value !== 'object') return null;
  const pin = value as { id?: unknown; pin?: { version?: unknown }; checksum?: unknown };
  const version = pin.pin?.version;
  if (typeof pin.id !== 'string' || !pin.id) return null;
  if (typeof version !== 'string' || !version) return null;
  if (typeof pin.checksum !== 'string' || !pin.checksum) return null;
  return { id: pin.id, pin: { version }, checksum: pin.checksum };
}

/**
 * The preference held in a stored profile, or null when it holds none or holds
 * junk. Total over a profile written by an older or newer build.
 */
export function readEmojiPreference(value: unknown): EmojiPreferenceV1 | null {
  if (!value || typeof value !== 'object') return null;
  const pref = value as { pin?: unknown; mode?: unknown; strengthBps?: unknown };
  const pin = readPin(pref.pin);
  if (!pin) return null;
  const mode = MODES.find(m => m === pref.mode);
  if (!mode) return null;
  const raw = pref.strengthBps;
  const read = typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 10000 ? raw : 10000;
  // An influence strength is written into the `emojifx` param, and the parser only
  // admits 1 to 9999 there (0 is `original` and 10000 is `snap`, each with its own
  // word). Clamping here is what keeps the reader and the writer in step: without
  // it a profile from an older build, or a hand-edited one, serialised to a param
  // the parser refuses and the treatment silently fell back to the plain artwork.
  const strengthBps = mode === 'influence' ? Math.min(9999, Math.max(1, read)) : read;
  return { pin, mode, strengthBps };
}

/** The preference on the profile in force, or null when none is saved. */
export async function currentEmojiPreference(host: EmojiPrefsHost): Promise<EmojiPreferenceV1 | null> {
  try {
    const profile = await host.profile.get() as { emoji?: unknown };
    return readEmojiPreference(profile?.emoji);
  } catch { return null; }
}

/** Save a preference, or clear it with null. Best effort, like every other pref write. */
export async function setEmojiPreference(host: EmojiPrefsHost, pref: EmojiPreferenceV1 | null): Promise<void> {
  try {
    const profile = await host.profile.get() as Record<string, unknown>;
    const next = { ...profile };
    if (pref) next.emoji = pref;
    else delete next.emoji;
    await host.profile.set?.(next);
  } catch { /* the preference is a seed - failing to save it never blocks the work */ }
}

/** The preference a chosen style amounts to: the set and the treatment, without the palette. */
export function emojiPreferenceFromStyle(style: EmojiStyleV1 | null): EmojiPreferenceV1 | null {
  if (!style) return null;
  return { pin: structuredClone(style.primary), mode: style.treatment.mode, strengthBps: style.treatment.strengthBps };
}

/**
 * A preference as the two reserved params, so a seed resolves through the exact
 * parser a link and the CLI go through. The checksum is deliberately dropped: a
 * set's bytes belong to the device holding them, and the host's own listing is
 * what pins them again.
 */
export function emojiPreferenceParams(pref: EmojiPreferenceV1 | null): EmojiParamPair | null {
  if (!pref) return null;
  const fx = pref.mode === 'influence' ? `influence:${pref.strengthBps}` : pref.mode;
  return { emoji: `${pref.pin.id}@${pref.pin.pin.version}`, emojifx: fx };
}

/** One param source, as the reserved params arrive from it. Blank strings read as absent. */
function usable(pair: EmojiParamPair | null | undefined): EmojiParamPair | null {
  if (!pair) return null;
  const emoji = typeof pair.emoji === 'string' ? pair.emoji.trim() : '';
  if (!emoji) return null;
  return { emoji, emojifx: typeof pair.emojifx === 'string' ? pair.emojifx.trim() : '', ...(pair.emojistyle ? { emojistyle: pair.emojistyle } : {}) };
}

/**
 * Which set a freshly mounted tool starts from, in the documented order: the
 * link wins, then the saved session, then the person's preference, then nothing.
 *
 * The order is the whole point. A link names a document, so it must beat a
 * device preference or the recipient would see different artwork from the
 * sender. A saved session names one too, which is why reopening old work never
 * silently redraws it in today's preference.
 */
export function emojiSeedParams(sources: {
  url?: EmojiParamPair | null;
  session?: EmojiParamPair | null;
  preference?: EmojiPreferenceV1 | null;
}): EmojiParamPair | null {
  return usable(sources.url)
    ?? usable(sources.session)
    ?? usable(emojiPreferenceParams(sources.preference ?? null));
}

/**
 * Write the chosen set and treatment into a query as the two reserved params,
 * or clear both when nothing is chosen. The address bar and the copied link both
 * go through this, so a recipient always opens the artwork the sender was
 * looking at.
 */
export function writeEmojiParams(params: URLSearchParams, pair: EmojiParamPair | null): void {
  const chosen = usable(pair);
  params.delete('emojistyle');
  if (chosen?.emojistyle) params.set('emojistyle', chosen.emojistyle);
  if (!chosen) {
    params.delete('emoji');
    params.delete('emojifx');
    return;
  }
  params.set('emoji', chosen.emoji);
  if (chosen.emojifx) params.set('emojifx', chosen.emojifx);
  else params.delete('emojifx');
}
