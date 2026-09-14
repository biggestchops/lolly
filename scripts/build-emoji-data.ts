#!/usr/bin/env node
// SPDX-License-Identifier: MPL-2.0
/** Generate the pinned whole-sequence lookup table. Runs offline; --check detects drift. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const source = new URL('./data/unicode/17.0/emoji-test.txt', import.meta.url);
const target = new URL('../engine/src/emoji-data/17.0.json', import.meta.url);
const expectedHash = '1d8a944f88d7952f7ef7c5167fef3c67995bcae24543949710231b03a201acda';
const sourceBytes = await readFile(source);
if (createHash('sha256').update(sourceBytes).digest('hex') !== expectedHash) {
  throw new Error('Pinned Unicode source checksum differs. Review the data update before regenerating.');
}
const sourceText = sourceBytes.toString('utf8');
if (!sourceText.includes('# Version: 17.0')) throw new Error('Unexpected Emoji data version');

const keyOf = (points: string): string => points.trim().split(/\s+/).map(p => Number.parseInt(p, 16).toString(16).padStart(4, '0')).join('-');
const unqualified = (key: string): string => key.split('-').filter(p => p !== 'fe0f').join('-');
const rows: { key: string; label: string; status: string }[] = [];
for (const line of sourceText.split('\n')) {
  if (!line.trim() || line.startsWith('#')) continue;
  const match = /^([0-9A-F ]+)\s*;\s*(fully-qualified|minimally-qualified|unqualified|component)\s*#\s*\S+\s+E[0-9.]+\s+(.+)$/.exec(line);
  if (!match) throw new Error('Unexpected Unicode source row');
  rows.push({ key: keyOf(match[1]!), status: match[2]!, label: match[3]! });
}
const entries = rows.filter(row => row.status === 'fully-qualified' || row.status === 'component')
  .map(row => ({ key: row.key, label: row.label, aliases: [] as string[] }));
const canonical = new Map(entries.map(entry => [unqualified(entry.key), entry]));
if (canonical.size !== entries.length) throw new Error('Ambiguous qualified sequence');
const seen = new Set(entries.map(entry => entry.key));
for (const row of rows) {
  if (row.status === 'fully-qualified' || row.status === 'component') continue;
  const targetEntry = canonical.get(unqualified(row.key));
  if (!targetEntry || targetEntry.label !== row.label || seen.has(row.key)) throw new Error('Invalid qualification alias');
  targetEntry.aliases.push(row.key);
  seen.add(row.key);
}
// Only the exact aliases in emoji-test are accepted. Stripping VS16 is a build-time join,
// never a runtime license to drop selectors, modifiers or unknown parts of a sequence.
entries.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
for (const entry of entries) entry.aliases.sort();
const variationBytes = await readFile(new URL('./data/unicode/17.0/emoji-variation-sequences.txt', import.meta.url));
const variationHash = 'bb3d09ef03f206012c7532dd52dc0a21c9efddba0135ea4cf0d9201b8b9bba7e';
if (createHash('sha256').update(variationBytes).digest('hex') !== variationHash) throw new Error('Unicode variation source checksum differs');
const textVariations: string[] = [];
for (const line of variationBytes.toString('utf8').split('\n')) {
  const match = /^([0-9A-F ]+)\s*;\s*text style;/.exec(line);
  if (match) textVariations.push(keyOf(match[1]!));
}
if (!textVariations.length) throw new Error('Missing Unicode text-presentation variations');
textVariations.sort();
const output = `${JSON.stringify({ version: '17.0', sourceChecksum: `sha256:${expectedHash}`, variationChecksum: `sha256:${variationHash}`, textVariations, entries }, null, 2)}\n`;
const license = await readFile(new URL('./data/unicode/17.0/LICENSE.txt', import.meta.url));
if (createHash('sha256').update(license).digest('hex') !== 'e7a93b009565cfce55919a381437ac4db883e9da2126fa28b91d12732bc53d96') throw new Error('Unicode license checksum differs');
const licenseTarget = new URL('../engine/src/emoji-data/LICENSE.txt', import.meta.url);
if (process.argv.includes('--check')) {
  if (await readFile(target, 'utf8') !== output || !(await readFile(licenseTarget)).equals(license)) throw new Error('Emoji data differs; run node scripts/build-emoji-data.ts');
} else {
  await mkdir(new URL('../engine/src/emoji-data/', import.meta.url), { recursive: true });
  await writeFile(target, output);
  await writeFile(licenseTarget, license);
}
console.log(`Emoji 17.0: ${entries.length} canonical entries, ${rows.length - entries.length} explicit aliases.`);
