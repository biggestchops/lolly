// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { textHyphenator } from '../engine/src/text-hyphenation.ts';
test('pinned language patterns retain offsets, exceptions, minima and bounded work', async () => {
  for (const [language, word, points] of [['en-us', 'hyphenation', [2, 6]], ['en-gb', 'typography', [2, 4]], ['fr', 'composition', [3, 5, 7]], ['de', 'Silbentrennung', [3, 6, 10]], ['es', 'composición', [3, 5, 7]]] as const) {
    const hyphenator = (await textHyphenator(language))!;
    assert.deepEqual(hyphenator.points(word, 2, 2), points);
    assert.ok(hyphenator.points(word, 4, 4).every(at => at >= 4 && at <= word.length-4));
    assert.deepEqual(hyphenator.points('a'.repeat(300), 2, 2), []);
  }
  assert.equal(await textHyphenator('en-au'), null); assert.equal(await textHyphenator('th'), null);
});
