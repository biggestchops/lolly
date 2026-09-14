#!/usr/bin/env node
// SPDX-License-Identifier: MPL-2.0
/** Generate pinned grapheme properties and conservative bidi guards offline. */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const pins = {
  'GraphemeBreakProperty.txt': 'd6b51d1d2ae5c33b451b7ed994b48f1f4dc62b2272a5831e7fd418514a6bae89',
  'GraphemeBreakTest.txt': 'e2d134d2c52919bace503ebb6a551c1855fe1a1faec18478c78fff254a1793ec',
  'DerivedCoreProperties.txt': '24c7fed1195c482faaefd5c1e7eb821c5ee1fb6de07ecdbaa64b56a99da22c08',
  'emoji-data.txt': '2cb2bb9455cda83e8481541ecf5b6dfda66a3bb89efa3fa7c5297eccf607b72b',
  'DerivedBidiClass.txt': '4867b4b7f0731ed1bfcd34cc6251211ff1542541fce0734b6fbda139ee80b3a4',
};
const texts: Record<string, string> = {};
for (const [name, hash] of Object.entries(pins)) {
  const bytes = await readFile(new URL(`./data/unicode/17.0/${name}`, import.meta.url));
  if (createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error(`Pinned Unicode source differs: ${name}`);
  texts[name] = bytes.toString('utf8');
}
type Range = [number, number, string];
function ranges(name: string, select: (parts: string[]) => string | undefined): Range[] {
  const out: Range[] = [];
  for (const line of texts[name]!.split('\n')) {
    const parts = line.split('#')[0]!.trim().split(';').map(part => part.trim());
    if (!parts[0]) continue;
    const property = select(parts);
    if (!property) continue;
    const [lo, hi = lo] = parts[0]!.split('..').map(point => Number.parseInt(point, 16));
    if (lo === undefined || hi === undefined || !Number.isInteger(lo) || !Number.isInteger(hi)) throw new Error('Invalid Unicode range');
    out.push([lo, hi, property]);
  }
  out.sort((a, b) => a[0] - b[0]);
  const merged: Range[] = [];
  for (const row of out) {
    const previous = merged.at(-1);
    if (previous && previous[1] >= row[0]) throw new Error(`Overlapping Unicode ranges in ${name}`);
    if (previous && previous[1] + 1 === row[0] && previous[2] === row[2]) previous[1] = row[1];
    else merged.push([...row]);
  }
  return merged;
}
function bidiGuard(): Range[] {
  const guarded = new Set(['R', 'AL', 'AN', 'RLE', 'LRE', 'RLO', 'LRO', 'PDF', 'RLI', 'LRI', 'FSI', 'PDI', 'B', 'S']);
  const points = new Uint8Array(0x110000);
  // UCD defaults assign RTL classes to some unassigned code points. Apply those
  // first, then explicit rows, so a font's unusual coverage cannot bypass the guard.
  for (const line of texts['DerivedBidiClass.txt']!.split('\n')) {
    const match = /^# @missing: ([0-9A-F]+)\.\.([0-9A-F]+); ([A-Za-z_]+)$/.exec(line);
    if (!match) continue;
    const value = match[3]!;
    if (!['Left_To_Right', 'Right_To_Left', 'Arabic_Letter', 'European_Terminator'].includes(value)) throw new Error('Unsupported bidi default.');
    points.fill(['Right_To_Left', 'Arabic_Letter'].includes(value) ? 1 : 0, Number.parseInt(match[1]!, 16), Number.parseInt(match[2]!, 16) + 1);
  }
  for (const [start, end, value] of ranges('DerivedBidiClass.txt', parts => parts[1])) points.fill(guarded.has(value) ? 1 : 0, start, end + 1);
  const result: Range[] = [];
  for (let start = 0; start < points.length; start++) {
    if (!points[start]) continue;
    let end = start;
    while (points[end + 1]) end++;
    result.push([start, end, 'Bidi']); start = end;
  }
  return result;
}
const data = {
  version: '17.0', algorithm: 'uax29-47', sources: pins,
  grapheme: ranges('GraphemeBreakProperty.txt', parts => parts[1]),
  conjunct: ranges('DerivedCoreProperties.txt', parts => parts[1] === 'InCB' ? parts[2] : undefined),
  pictographic: ranges('emoji-data.txt', parts => parts[1] === 'Extended_Pictographic' ? 'EP' : undefined),
  emoji: ranges('emoji-data.txt', parts => parts[1] === 'Emoji' ? 'Emoji' : undefined),
  // The first line compiler refuses these classes. This is a guard, not UAX #9.
  bidi: bidiGuard(),
};
const target = new URL('../engine/src/emoji-data/text-17.0.json', import.meta.url);
const output = `${JSON.stringify(data)}\n`;
if (process.argv.includes('--check')) {
  if (await readFile(target, 'utf8') !== output) throw new Error('Emoji text data differs; run node scripts/build-emoji-text-data.ts');
} else await writeFile(target, output);
console.log(`Emoji text 17.0: ${data.grapheme.length} grapheme ranges, ${data.conjunct.length} conjunct ranges.`);
