// SPDX-License-Identifier: MPL-2.0
/** Compile checked-in TeX pattern data; generation never reads a moving network source. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const revision = '5684c0f51c0b81133db2efbe60a408b4155a3ff5';
const destination = new URL('../engine/src/text-hyphen-data/', import.meta.url);
await mkdir(destination, { recursive: true });
for (const language of ['en-us', 'en-gb', 'fr', 'es', 'de-1996']) {
  const raw = await readFile(new URL(`data/hyphenation/${language}.tex`, import.meta.url), 'utf8');
  const clean = raw.replace(/%[^\n]*/g, '');
  const groups = (name: string): string[] => [...clean.matchAll(new RegExp('\\\\' + name + '\\s*\\{([^{}]*)\\}', 'g'))].flatMap(match => match[1]!.trim().split(/\s+/).filter(Boolean));
  const patterns = groups('patterns'), exceptions = groups('hyphenation');
  if (!patterns.length || patterns.some(pattern => !/^[\p{L}\p{M}\d.'’]+$/u.test(pattern)) || exceptions.some(word => !/^[\p{L}\p{M}'’-]+$/u.test(word))) throw new Error(`Unsupported pattern syntax: ${language}`);
  const header = raw.slice(0, raw.indexOf('\\patterns{')).split('\n').filter(line => line.startsWith('%')).map(line => line.replace(/^% ?/, '')).join('\n');
  const source = `https://github.com/hyphenation/tex-hyphen/blob/${revision}/hyph-utf8/tex/generic/hyph-utf8/patterns/tex/hyph-${language}.tex`;
  const min = [...header.matchAll(/(?:left|right):\s*(\d+)/g)].map(match => Number(match[1]));
  const data = { language, source, sha256: createHash('sha256').update(raw).digest('hex'), notice: header, left: min[0] ?? 2, right: min[1] ?? 2, patterns: patterns.join(' '), exceptions };
  await writeFile(new URL(`${language}.json`, destination), JSON.stringify(data) + '\n');
  console.log(`${language}: ${patterns.length} patterns, ${exceptions.length} exceptions`);
}
