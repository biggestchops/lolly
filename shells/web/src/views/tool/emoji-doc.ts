// SPDX-License-Identifier: MPL-2.0
/**
 * The document's emoji style, shared between the two surfaces that edit it.
 *
 * The tool sidebar's Emoji section owns the state (it seeds it from the link, the
 * saved session and the profile, drives the runtime and writes the two reserved
 * params). The design tool's Document dock has to edit the SAME value, and it
 * cannot reach that section: the editor layouts render no sidebar at all
 * (`chromeless` in views/tool/history.ts), so on `design`, `doc-studio`,
 * `org-chart` and `record` the dock is the only control there is.
 *
 * A module-level holder rather than a value threaded through the view context,
 * for the same reason `setToolEmojiParams` is one: a single tool is mounted at a
 * time, the dock is built before the section is wired, and the dock reads through
 * a live getter on every rebuild. The section clears the holder when it goes.
 */
import type { EmojiStyleV1 } from '@lolly-tools/core/emoji-v1';

export interface EmojiDocumentPort {
  /** The style in force, or null while no set is chosen. */
  value(): EmojiStyleV1 | null;
  /** A new choice, from whichever surface made it. */
  set(next: EmojiStyleV1 | null): void;
}

let port: EmojiDocumentPort | null = null;
const listeners = new Set<() => void>();

/** The section registers itself on mount and clears on teardown. */
export function setEmojiDocumentPort(next: EmojiDocumentPort | null): void {
  port = next;
  notifyEmojiDocument();
}

export function emojiDocumentStyle(): EmojiStyleV1 | null {
  return port?.value() ?? null;
}

export function setEmojiDocumentStyle(next: EmojiStyleV1 | null): void {
  port?.set(next);
}

/**
 * Told whenever the value changes, so a surface that is not the one being
 * operated can redraw. The dock uses it: the seed arrives after the dock is
 * built, and a choice made in the sidebar has to reach the dock's row.
 */
export function onEmojiDocumentChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function notifyEmojiDocument(): void {
  for (const fn of [...listeners]) {
    try { fn(); } catch (e) { console.error(e); }
  }
}
