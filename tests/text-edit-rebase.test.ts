// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { createTextStory } from '../engine/src/text-story-document.ts';
import { replaceStoryRange } from '../engine/src/text-edits.ts';
import { defaultTextFrameSettings } from '../engine/src/text-design.ts';
import { rebaseTextEdit } from '../shells/web/src/lib/text-edit-rebase.ts';
import type { TextEditorSnapshot } from '../shells/web/src/lib/text-editor-session.ts';
function fixture(): TextEditorSnapshot {
  return { document: { version: 1, stories: ['a', 'b'].map(id => ({ ...createTextStory(id, `Story ${id}`, () => `${id}-p`), frameIds: [id] })), styles: [], fonts: [] }, frames: ['a', 'b'].map(id => ({ ...defaultTextFrameSettings('fixed'), id, storyId: id, width: 200, height: 120 })) };
}
function edit(value: TextEditorSnapshot, index: number, source: string): void {
  const story = value.document.stories[index]!;
  value.document.stories[index] = replaceStoryRange(story, { start: 0, end: story.source.length }, { source }, { paragraphId: () => 'new' }).story;
}
test('an edit preserves unrelated source, style and frame changes received during composition', () => {
  const base = fixture(), after = structuredClone(base), live = structuredClone(base);
  edit(after, 0, 'Local IME 日本'); edit(live, 1, 'Remote article'); live.frames[1]!.width = 450;
  live.document.styles.push({ id: 'remote', name: 'Remote style', kind: 'paragraph', paragraph: { lineHeight: 1.5 } });
  const merged = rebaseTextEdit(base, after, live);
  assert.equal(merged.document.stories[0]!.source, 'Local IME 日本'); assert.equal(merged.document.stories[1]!.source, 'Remote article');
  assert.equal(merged.frames[1]!.width, 450); assert.deepEqual(merged.document.styles, live.document.styles);
  assert.equal(base.document.stories[0]!.source, 'Story a'); assert.equal(live.document.stories[0]!.source, 'Story a');
});
test('conflicting source, deleted frames and style definitions refuse to overwrite the incoming version', () => {
  for (const kind of ['source', 'frame', 'style']) {
    const base = fixture(); base.document.styles.push({ id: 'body', kind: 'paragraph', name: 'Body', paragraph: { lineHeight: 1.2 } });
    const after = structuredClone(base), live = structuredClone(base);
    if (kind === 'source') { edit(after, 0, 'Local'); edit(live, 0, 'Remote'); }
    if (kind === 'frame') { after.frames[0]!.width = 300; live.frames.shift(); }
    if (kind === 'style') { after.document.styles[0]!.name = 'Local'; live.document.styles[0]!.name = 'Remote'; }
    const saved = structuredClone(live); assert.throws(() => rebaseTextEdit(base, after, live), /Previous text/); assert.deepEqual(live, saved);
  }
});
