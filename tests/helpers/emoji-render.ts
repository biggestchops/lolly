// SPDX-License-Identifier: MPL-2.0
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createNodeTextAPI } from '../../packages/node-shell/src/text.ts';
import renderLock from '../fixtures/emoji/render.lock.json' with { type: 'json' };
import { digest, fixture, style } from './emoji-fixtures.ts';
import { parseEmojiXml } from './emoji-xml.ts';
import type { EmojiLineHost, EmojiLineInput } from '../../engine/src/emoji-line.ts';

export const emojiRepo = new URL('../../', import.meta.url);
export { renderLock };
export const nodeEmojiText = createNodeTextAPI({ repoRoot: fileURLToPath(emojiRepo) });

export async function emojiRenderResources() {
  const font = await readFile(new URL(renderLock.font.path, emojiRepo));
  if (digest(font) !== renderLock.font.checksum) throw new Error('Emoji specimen font differs from its pin.');
  for (const [path, checksum] of Object.entries(renderLock.harfbuzzjs.files)) {
    if (digest(await readFile(new URL(path, emojiRepo))) !== checksum) throw new Error(`Emoji specimen shaper differs: ${path}`);
  }
  for (const [path, version] of [['node_modules/harfbuzzjs/package.json', renderLock.harfbuzzjs.version], ['node_modules/@resvg/resvg-js/package.json', renderLock.referenceRaster.version]]) {
    if (JSON.parse(await readFile(new URL(path!, emojiRepo), 'utf8')).version !== version) throw new Error('Emoji specimen renderer version differs.');
  }
  const wasm = await readFile(new URL('node_modules/harfbuzzjs/dist/harfbuzz.wasm', emojiRepo));
  return { font, wasm };
}

export async function emojiLineFixture(name = 'twemoji', text = 'AV 😀 😀 office & <3') {
  const input = await fixture(name);
  const { font } = await emojiRenderResources();
  const options: EmojiLineInput = { text, style: style(input.lock.pin), font: { bytes: font, checksum: renderLock.font.checksum, size: 48 } };
  const host: EmojiLineHost = { text: nodeEmojiText, parseXml: parseEmojiXml, loadArtwork: async () => input.artwork };
  return { ...input, options, host };
}
