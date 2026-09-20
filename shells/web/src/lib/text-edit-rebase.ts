// SPDX-License-Identifier: MPL-2.0
/** Apply only the editor's changed records, preserving unrelated incoming edits. */
import type { TextDocumentV1, TextFrameV1 } from '@lolly-tools/core';
type Snapshot = { document: TextDocumentV1; frames: TextFrameV1[] };
function merge<T extends { id: string }>(before: T[], after: T[], live: T[]): T[] {
  const base = new Map(before.map(item => [item.id, item])), next = new Map(after.map(item => [item.id, item])), current = new Map(live.map(item => [item.id, item]));
  for (const id of new Set([...base.keys(), ...next.keys()])) {
    const previous = JSON.stringify(base.get(id)), wanted = JSON.stringify(next.get(id));
    if (previous === wanted) continue;
    const actual = JSON.stringify(current.get(id));
    if (actual !== previous && actual !== wanted) throw new Error('This story changed elsewhere. Your draft is available in Previous text.');
    if (next.has(id)) current.set(id, next.get(id)!); else current.delete(id);
  }
  return [...current.values()];
}
export function rebaseTextEdit(before: Snapshot, after: Snapshot, live: Snapshot): Snapshot {
  return { document: { ...live.document, stories: merge(before.document.stories, after.document.stories, live.document.stories), styles: merge(before.document.styles, after.document.styles, live.document.styles), fonts: merge(before.document.fonts, after.document.fonts, live.document.fonts) }, frames: merge(before.frames, after.frames, live.frames) };
}
