// SPDX-License-Identifier: MPL-2.0
/** Regenerate the offline Thai word list from a content-pinned ICU source. */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const source = JSON.parse(await readFile('scripts/data/text-thai/source.json', 'utf8'));
const bytes = await readFile('scripts/data/text-thai/thaidict.txt');
if (bytes.length !== source.bytes || createHash('sha256').update(bytes).digest('hex') !== source.sha256) throw new Error('Thai dictionary source changed.');
const words = [...new Set(bytes.toString('utf8').split('\n').map(line => line.split('#')[0]!.trim()).filter(Boolean))].sort();
if (words.some(word => word.length > 128 || !/^[\u0e00-\u0e7f]+$/u.test(word))) throw new Error('The dictionary contains an unsupported word.');
const content = `${JSON.stringify({source,words})}\n`, path = 'engine/src/text-thai-data.json';
if (process.argv.includes('--check')) {
  if (await readFile(path, 'utf8') !== content) throw new Error('Regenerate the Thai text dictionary.');
} else await writeFile(path, content);
console.log(`Thai dictionary: ${words.length} words, ${Buffer.byteLength(content)} bytes`);
