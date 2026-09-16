// SPDX-License-Identifier: MPL-2.0
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { loadSharedRegions } from './sync-shared-hooks.ts';

const regions = loadSharedRegions();
const order = JSON.parse(await readFile(new URL('./data/design-renderer-regions.json', import.meta.url), 'utf8')) as string[];
const renderer = order.map(name => {
  const region = regions.get(name);
  if (!region) throw new Error(`Missing Design renderer region: ${name}`);
  return region.content;
}).join('\n\n');
const compiled = await build({
  entryPoints: ['packages/core/src/design-tool-v1.ts'], bundle: true, write: false,
  format: 'iife', globalName: 'LollyDesignRules', platform: 'neutral', target: 'es2022',
  minify: true, legalComments: 'none',
});
const source = `${compiled.outputFiles[0]!.text}\n${renderer}\n`;
const path = 'community/design/assets/rules-renderer.js';
if (process.argv.includes('--check')) {
  if (await readFile(path, 'utf8').catch(() => '') !== source) throw new Error('Run node scripts/build-design-tool-renderer.ts to refresh the shared renderer.');
} else {
  await mkdir('community/design/assets', { recursive: true });
  await writeFile(path, source);
}
