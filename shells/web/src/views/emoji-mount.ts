// SPDX-License-Identifier: MPL-2.0
/**
 * Post-paint emoji pass for the web shell (plan 252).
 *
 * The work itself belongs to the runtime, which owns the chosen set, the admitted
 * packs and the prepared artwork, and runs the same code on the CLI and the
 * desktop app so one piece of text draws the same bytes everywhere. This module
 * is only the shell's half: call the pass after a paint, drop the result if a
 * newer render has started, and never let a failure take the canvas down.
 *
 * Modelled on views/glyph-split-mount.ts - an async post-paint walk with an
 * `isCurrent()` stale-render guard. Idempotence is the runtime's: a tree that
 * already carries this set's artwork is walked and left exactly as it is, so a
 * repeat call after a partial repaint costs a walk and changes nothing.
 *
 * Nothing here is progressive enhancement in the usual sense. A shell that cannot
 * load packs, a set nobody chose and a glyph a set does not carry all end at the
 * engine's neutral placeholder. The one thing that never happens is a fall back
 * to whatever emoji font the machine happens to have.
 */

/** The slice of the runtime this module drives. Kept structural so a caller can
 *  pass a test double without building a whole mount. */
export interface EmojiRuntime {
  applyEmojiToDom(node: unknown): Promise<{ present: boolean; replaced: number; unresolved: number }>;
}

/** Set once a pass has reported placements, so an edit can revert without waiting. */
let revert: ((root: unknown) => number) | null = null;

/**
 * Load the engine's revert while the pass that made the placements is still
 * finishing. The module is already in the registry by then (the runtime imported
 * it to do the pass), so this resolves in a microtask and never blocks a paint.
 */
async function loadRevert(): Promise<void> {
  if (revert) return;
  const mod = await import('../../../../engine/src/emoji-dom.ts');
  revert = mod.revertEmojiDom as unknown as (root: unknown) => number;
}

/**
 * Draw every emoji under `rootEl` from the chosen set. Fire and forget: an export
 * needs no separate wait, because the runtime serialises its passes and
 * `runtime.export` queues its own pass behind this one.
 */
export async function mountEmoji(
  rootEl: Element,
  { isCurrent = () => true, runtime }: { isCurrent?: () => boolean; runtime: EmojiRuntime },
): Promise<void> {
  if (!isCurrent()) return;
  const result = await runtime.applyEmojiToDom(rootEl);
  if (result.replaced || result.unresolved) await loadRevert();
}

/**
 * Put the characters back under `el` so the caret, selection and input
 * composition work on plain text. Synchronous on purpose: it runs as a text box
 * becomes editable, before the caller captures the markup it will restore on
 * cancel. Returns 0 when nothing was ever drawn, which is the honest answer -
 * only the pass creates these placements, and the pass loads the revert.
 */
export function revertEmojiIn(el: Element): number {
  if (!revert) return 0;
  try { return revert(el); } catch (e) {
    console.warn(`emoji revert: ${(e as Error)?.message ?? e}`);
    return 0;
  }
}
