// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseParagraphBreaks, paragraphLineFit, type TextLineGraph } from '../engine/src/text-line-policy.ts';
test('justified candidates admit bounded compression and Best prices spacing deviation', () => {
  const graph: TextLineGraph = { candidates: [0, 1, 2, 3].map(at => ({ at, hyphen: false, hyphenWidth: 0 })),
    settings: { composition: 'best', align: 'justify', wordSpacing: { min: .5, ideal: 1, max: 2 } },
    width: () => 100, measure: (a,b) => ({ '0:1': 95, '0:2': 103, '0:3': 155, '1:2': 8, '1:3': 60, '2:3': 52 } as Record<string,number>)[`${a}:${b}`]!,
    spaces: (a,b) => a === 0 && b === 2 ? 10 : 1, words: (a,b) => b-a };
  assert.equal(paragraphLineFit(graph, 0, 2, 100).fits, true);
  assert.equal(paragraphLineFit(graph, 0, 2, 97).fits, false);
  assert.deepEqual(chooseParagraphBreaks(graph, [1,3]).ends, [2,3]);
  graph.settings.wordSpacing!.min = 1;
  assert.deepEqual(chooseParagraphBreaks(graph, [1,3]).ends, [1,3]);
});
test('pathological break graphs have a deterministic finite fallback', () => {
  const graph: TextLineGraph = { candidates: Array.from({ length: 2049 }, (_,at) => ({ at, hyphen: false, hyphenWidth: 0 })),
    settings: { composition: 'best' }, width: () => 100, measure: (a,b) => b-a, words: (a,b) => b-a };
  assert.deepEqual(chooseParagraphBreaks(graph, [100,2048]), { ends: [100,2048], limited: true });
});
