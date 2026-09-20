// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { createTextStory } from '../engine/src/text-story-document.ts';
import { previewTextCleanup, applyTextCleanup } from '../engine/src/text-cleanup.ts';
test('cleanup requires a preview and retains literal text, special spaces, breaks and source styles', () => {
  const source = '"Hello"  world\u00a0\n`"code"  code` and "literal"  x\nhttps://example.com/"quote"\nsoft\u00adhyphen';
  const story = createTextStory('s', source, i => `p${i}`);
  const start = source.indexOf('"literal"'); story.spans = [{ start, end: start+12, literal: true, character: { weight: 700 } }];
  const before = structuredClone(story), proposal = previewTextCleanup(story, { start: 0, end: source.length }, 'en-GB', { quotes: true, spaces: true, discretionary: true });
  assert.deepEqual(story, before); assert.equal(proposal.edits.length, 4);
  const changed = applyTextCleanup(story, proposal);
  assert.equal(changed.source, '“Hello” world\u00a0\n`"code"  code` and "literal"  x\nhttps://example.com/"quote"\nsofthyphen');
  assert.equal(changed.revision, story.revision+1); assert.equal(changed.paragraphs.length, story.paragraphs.length);
  const literal = changed.spans.find(span => span.literal)!; assert.equal(changed.source.slice(literal.start,literal.end), source.slice(start,start+12)); assert.equal(literal.character!.weight, 700);
  assert.throws(() => applyTextCleanup(changed, proposal), /changed/);
});
test('quote language is explicit, narrow nonbreaking French spaces are authored and graphemes stay intact', () => {
  const story = createTextStory('s', '"Bonjour" "\u0301word"', i => `p${i}`);
  const options = { quotes: true, spaces: false, discretionary: false }, range = { start: 0, end: story.source.length };
  assert.equal(previewTextCleanup(story, range, 'und', options).edits.length, 0);
  const french = applyTextCleanup(story, previewTextCleanup(story, range, 'fr', options)); assert.ok(french.source.startsWith('«\u202fBonjour\u202f»'));
  assert.ok(french.source.includes('"\u0301'));
  const bad = previewTextCleanup(story, range, 'de', options); bad.edits.reverse(); assert.throws(() => applyTextCleanup(story, bad), /unsupported edit/);
});
