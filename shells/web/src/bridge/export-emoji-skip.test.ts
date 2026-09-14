// SPDX-License-Identifier: MPL-2.0
/**
 * The vector export walk must skip the clipped span an emoji placement keeps its
 * characters in (plan 252). Without the skip, an SVG or PDF export carries the raw
 * emoji characters as a text run beside the artwork drawn for them, which is the
 * machine's own emoji font arriving in the file by the back door.
 *
 * The walker spells the class rather than importing it, so this test is what stops
 * the two spellings drifting: it reads the engine's constant and the two export
 * sources and checks they still agree.
 *
 * Run directly:  node --test shells/web/src/bridge/export-emoji-skip.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EMOJI_TEXT_CLASS } from '../../../../engine/src/emoji-dom.ts';

const source = (name: string): string => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');

test('both export walks skip the hidden emoji text span', () => {
  assert.equal(EMOJI_TEXT_CLASS, 'lolly-emoji-text', 'the engine names the span this');
  for (const name of ['export-svg-walker.ts', 'export-text.ts']) {
    assert.match(
      source(name),
      new RegExp(`classList\\.contains\\('${EMOJI_TEXT_CLASS}'\\)`),
      `${name} must skip .${EMOJI_TEXT_CLASS}`,
    );
  }
});
