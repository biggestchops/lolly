#!/usr/bin/env node
// SPDX-License-Identifier: MPL-2.0
/** Build local review specimens and source records; no catalog install or creative export delivery. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Resvg } from '@resvg/resvg-js';
import { compileEmojiLine } from '../engine/src/emoji-line.ts';
import { escapeXml } from '../engine/src/xml-escape.ts';
import { fixtureLocks, digest } from '../tests/helpers/emoji-fixtures.ts';
import { emojiLineFixture, emojiRepo, nodeEmojiText, renderLock } from '../tests/helpers/emoji-render.ts';

const output = new URL('../dist/emoji-specimens/', import.meta.url);
await mkdir(output, { recursive: true });
const rows: string[] = [];
const report: Record<string, unknown> = {};
const labels: Record<string, string> = { openmoji: 'OpenMoji / CC BY-SA 4.0', twemoji: 'Twemoji / CC BY 4.0', noto: 'Noto Emoji / Apache 2.0' };
for (const [index, lock] of fixtureLocks.entries()) {
  const input = await emojiLineFixture(lock.directory);
  const result = await compileEmojiLine(input.options, [input.pack], input.host);
  if (!result.ok) throw new Error(result.message);
  const { master } = result;
  const rendered = new Resvg(master.svg, { font: { loadSystemFonts: false } }).render();
  await writeFile(new URL(`${lock.directory}.svg`, output), master.svg);
  await writeFile(new URL(`${lock.directory}.png`, output), rendered.asPng());
  await writeFile(new URL(`${lock.directory}.json`, output), JSON.stringify({ ...master, svg: undefined }, null, 2) + '\n');
  await writeFile(new URL(`${lock.directory}-notices.json`, output), JSON.stringify(input.manifest.notices, null, 2) + '\n');
  report[lock.directory] = { svg: master.checksum, rgba: digest(rendered.pixels), width: rendered.width, height: rendered.height };
  const label = await nodeEmojiText.toPath({ text: labels[lock.directory]!, fontUrl: `data:font/ttf;base64,${Buffer.from(input.options.font.bytes).toString('base64')}`, fontSize: 20 });
  if (label.notdef || !label.d) throw new Error('Specimen label cannot be outlined.');
  const nested = master.svg.replace('<svg ', `<svg x="32" y="${70 + index * 135}" `)
    .replaceAll('id="emoji-', `id="${lock.directory}-emoji-`).replaceAll('url(#emoji-', `url(#${lock.directory}-emoji-`);
  rows.push(`<path d="${escapeXml(label.d)}" fill="#40505a" transform="translate(32 ${52 + index * 135})"></path>${nested}`);
}
const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="680" height="420" viewBox="0 0 680 420"><rect width="680" height="420" fill="#f8fafb"></rect>${rows.join('')}</svg>`;
await writeFile(new URL('comparison.svg', output), sheet);
await writeFile(new URL('comparison.png', output), new Resvg(sheet, { font: { loadSystemFonts: false } }).render().asPng());
await writeFile(new URL('render-report.json', output), JSON.stringify({ scope: 'developer-specimen', platform: process.platform, architecture: process.arch, inputs: renderLock, specimens: report }, null, 2) + '\n');
await writeFile(new URL('OFL-Outfit.txt', output), await readFile(new URL('shells/web/public/fonts/OFL-Outfit.txt', emojiRepo)));
await writeFile(new URL('README.md', output), `# Emoji rendering specimens

Local development proofs for Plan 252. Each line uses pinned Outfit outlines and one pinned source emoji, repeated with independent gradient ids. PNGs use the installed, checked resvg reference version with system fonts disabled. See render-report.json for input pins, platform and measured output hashes.

The JSON sidecars retain the source census, licence, source URL, attribution, modifications and normalization changes. The notices files retain upstream licence text. OpenMoji is CC BY-SA, Twemoji is CC BY and this Noto SVG is Apache-licensed; these are separate source licences, not a licence declaration for all surrounding work. Outfit's font licence is included separately.

These specimens have no Content Credentials ingredient or attribution-delivery receipt. They do not prove that metadata satisfies a particular publication's obligations. They are not installed community families, a completed sharing workflow, or fabrication-ready geometry. Do not publish them as examples of completed attribution handling.
`);
console.log(`Wrote ${output.pathname}`);
console.log(JSON.stringify(report, null, 2));
