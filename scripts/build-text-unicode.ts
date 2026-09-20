#!/usr/bin/env node
// SPDX-License-Identifier: MPL-2.0
/** Build Unicode 17 script and bidi property tables from hash-pinned local inputs. */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const sourceRoot = new URL('scripts/data/unicode/17.0/', root);
interface Source { file: string; url: string; bytes: number; sha256: string }
const sources = JSON.parse(await readFile(new URL('text-sources.json', sourceRoot), 'utf8')) as Source[];
const inputs = new Map<string, string>();
for (const source of sources) {
  const bytes = await readFile(new URL(source.file, sourceRoot));
  if (bytes.length !== source.bytes || createHash('sha256').update(bytes).digest('hex') !== source.sha256) throw new Error(`Unicode source hash mismatch: ${source.file}`);
  inputs.set(source.file, bytes.toString('utf8'));
}
const scriptAliases = new Map<string, string>(), bidiAliases = new Map<string, string>();
for (const line of inputs.get('PropertyValueAliases.txt')!.split('\n')) {
  const values = line.split('#')[0]!.split(';').map(value => value.trim());
  const aliases = values[0] === 'sc' ? scriptAliases : values[0] === 'bc' ? bidiAliases : null;
  if (aliases && values.length >= 3) for (const value of values.slice(1)) aliases.set(value, values[1]!);
}
function table(file: string, fallback: string, aliases: Map<string, string>) {
  const values = [fallback], indices = new Map([[fallback, 0]]), points = new Uint16Array(0x110000);
  function assign(first: string, last: string | undefined, label: string): void {
    const value = aliases.get(label);
    if (!value) throw new Error(`Unknown Unicode property: ${label}`);
    let index = indices.get(value);
    if (index === undefined) { index = values.length; indices.set(value, index); values.push(value); }
    points.fill(index, parseInt(first, 16), parseInt(last ?? first, 16) + 1);
  }
  const lines = inputs.get(file)!.split('\n');
  for (const line of lines) {
    const match = /@missing:\s*([0-9A-F]+)(?:\.\.([0-9A-F]+))?\s*;\s*([^\s#]+)/u.exec(line);
    if (match) assign(match[1]!, match[2], match[3]!);
  }
  for (const line of lines) {
    const match = /^([0-9A-F]+)(?:\.\.([0-9A-F]+))?\s*;\s*([^\s#]+)/u.exec(line);
    if (match) assign(match[1]!, match[2], match[3]!);
  }
  const ranges: number[] = []; let start = 0, previous = points[0]!;
  for (let i = 1; i < points.length; i++) if (points[i] !== previous) { ranges.push(start, i - 1, previous); start = i; previous = points[i]!; }
  ranges.push(start, points.length - 1, previous);
  return { values, ranges };
}
const extensions: Array<[number, number, string[]]> = [];
for (const line of inputs.get('ScriptExtensions.txt')!.split('\n')) {
  const match = /^([0-9A-F]+)(?:\.\.([0-9A-F]+))?\s*;\s*([^#]+)/u.exec(line);
  if (match) extensions.push([parseInt(match[1]!, 16), parseInt(match[2] ?? match[1]!, 16), match[3]!.trim().split(/\s+/u)]);
}
extensions.sort((a, b) => a[0] - b[0]);
const data = { unicode: '17.0.0', scripts: table('Scripts.txt', 'Zzzz', scriptAliases), bidi: table('DerivedBidiClass.txt', 'L', bidiAliases), extensions, sources };
const output = new URL('engine/src/text-unicode-data.json', root), content = `${JSON.stringify(data)}\n`;
if (process.argv.includes('--check')) {
  if (await readFile(output, 'utf8') !== content) throw new Error('Unicode text tables have drifted; run node scripts/build-text-unicode.ts.');
} else await writeFile(output, content);
console.log(`Unicode 17 text properties: ${Buffer.byteLength(content)} bytes (${fileURLToPath(output)})`);
