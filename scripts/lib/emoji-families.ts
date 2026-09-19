// SPDX-License-Identifier: MPL-2.0
/** Pinned upstream emoji sources and their sequence inventories. */
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const SOURCES = `${ROOT}/dist/emoji-sources`;
export interface Spec {
  slug: string; packId: string; family: string; style: string; version: string;
  repo: string; commit: string; root: string; svgDir: string;
  notices: string[]; license: string; licenseUrl: string; creator: string; attribution: string;
  points: (name: string) => string[];
  layout?: 'fluent' | 'blobmoji';
}

const OPENMOJI = {
  repo: 'https://github.com/hfg-gmuend/openmoji', commit: 'f9fc506a3f913be9897ab0181d611d4c910a4104',
  family: 'OpenMoji', version: '17.0.0', root: `${SOURCES}/openmoji`, notices: ['LICENSE.txt'],
  license: 'CC-BY-SA-4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
  creator: 'OpenMoji contributors',
  attribution: 'All emojis designed by OpenMoji, the open-source emoji and icon project. CC BY-SA 4.0.',
  points: (name: string): string[] => name.slice(0, -4).split('-'),
};

export const SPECS: Record<string, Spec> = {
  'openmoji-color': { ...OPENMOJI, slug: 'openmoji-color', packId: 'community/emoji/openmoji/color', style: 'Color', svgDir: 'color/svg' },
  'openmoji-black': { ...OPENMOJI, slug: 'openmoji-black', packId: 'community/emoji/openmoji/black', style: 'Black', svgDir: 'black/svg' },
  'twemoji-color': {
    slug: 'twemoji-color', packId: 'community/emoji/twemoji/color', family: 'Twemoji', style: 'Color', version: '17.0.3',
    repo: 'https://github.com/jdecked/twemoji', commit: 'b6b55fef1e8636b540a6d016a4729ca8cdf2e60b',
    root: `${SOURCES}/twemoji`, svgDir: 'assets/svg', notices: ['LICENSE-GRAPHICS'],
    license: 'CC-BY-4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    creator: 'Twitter, Inc. and other contributors',
    attribution: 'Twemoji graphics by Twitter, Inc. and other contributors, CC BY 4.0.',
    points: (name: string): string[] => name.slice(0, -4).split('-'),
  },
  'noto-color': {
    slug: 'noto-color', packId: 'community/emoji/noto/color', family: 'Noto Emoji', style: 'Color', version: '2.51.0',
    repo: 'https://github.com/googlefonts/noto-emoji', commit: '8998f5dd683424a73e2314a8c1f1e359c19e8742',
    root: `${SOURCES}/noto`, svgDir: 'svg', notices: ['svg/LICENSE'],
    license: 'Apache-2.0', licenseUrl: 'https://www.apache.org/licenses/LICENSE-2.0',
    creator: 'Google, Inc.', attribution: 'Noto Emoji artwork, Copyright 2013 Google, Inc. Apache License 2.0.',
    points: (name: string): string[] => name.slice(0, -4).replace(/^emoji_u/, '').split('_'),
  },
};

for (const [slug, style] of [['flat', 'Flat'], ['color', 'Color'], ['high-contrast', 'High Contrast']] as const) {
  SPECS[`fluent-${slug}`] = {
    slug: `fluent-${slug}`, packId: `community/emoji/fluent/${slug}`, family: 'Fluent Emoji', style,
    version: '2026.8.24', repo: 'https://github.com/microsoft/fluentui-emoji',
    commit: '1ffb34c752ecf5d402f04cfb4b392c77f57c54bc', root: `${SOURCES}/fluent`, svgDir: 'assets',
    notices: ['LICENSE'], license: 'MIT', licenseUrl: 'https://opensource.org/license/mit',
    creator: 'Microsoft Corporation', attribution: 'Fluent Emoji, Copyright (c) Microsoft Corporation. MIT License.',
    points: () => [], layout: 'fluent',
  };
}
SPECS['blobmoji-color'] = {
  slug: 'blobmoji-color', packId: 'community/emoji/blobmoji/color', family: 'Blobmoji', style: 'Color',
  version: '2023.6.25', repo: 'https://github.com/C1710/blobmoji',
  commit: '7dd14d2b0141693485fd26bc35817bd290352a79', root: `${SOURCES}/blobmoji`, svgDir: '.',
  notices: ['LICENSE', 'AUTHORS_Noto', 'CONTRIBUTORS_Blob.md', 'README.md'],
  license: 'Apache-2.0', licenseUrl: 'https://www.apache.org/licenses/LICENSE-2.0',
  creator: 'Google, Inc. and Blobmoji contributors',
  attribution: 'Blobmoji artwork by Google, Inc. and Blobmoji contributors. Apache License 2.0.',
  points: () => [], layout: 'blobmoji',
};

/** Read actual source paths without renaming or modifying upstream artwork. */
export async function sourceInventory(item: Spec): Promise<Map<string, string[]>> {
  const revision = execFileSync('git', ['-C', item.root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (revision !== item.commit) throw new Error(`${item.slug}: expected source revision ${item.commit}, found ${revision}.`);
  const changed = execFileSync('git', ['-C', item.root, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' });
  if (changed.trim()) throw new Error(`${item.slug}: the pinned source checkout has local modifications.`);
  const out = new Map<string, string[]>();
  if (item.layout === 'fluent') {
    const tones = ['Default', 'Light', 'Medium-Light', 'Medium', 'Medium-Dark', 'Dark'];
    for (const folder of await readdir(`${item.root}/assets`, { withFileTypes: true })) {
      if (!folder.isDirectory()) continue;
      const meta = JSON.parse(await readFile(`${item.root}/assets/${folder.name}/metadata.json`, 'utf8')) as { unicode: string; unicodeSkintones?: string[] };
      const variants = meta.unicodeSkintones ?? [meta.unicode];
      for (const [index, sequence] of variants.entries()) {
        const dir = `${folder.name}/${meta.unicodeSkintones ? `${tones[index]}/` : ''}${item.style}`;
        let names: string[];
        try { names = await readdir(`${item.root}/assets/${dir}`); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
        for (const name of names.filter(name => name.endsWith('.svg'))) out.set(`${dir}/${name}`, sequence.split(/\s+/));
      }
    }
  } else if (item.layout === 'blobmoji') {
    const names = new Map<string, string[]>();
    const normal = (value: string) => value.toLowerCase().replace(/[-_.]/g, ' ').replace(/[,*/\\:'"()]/g, '');
    // Both pinned tables are needed: Unicode labels can change between releases.
    for (const path of [`${item.root}/emoji-test.txt`, `${ROOT}/scripts/data/unicode/17.0/emoji-test.txt`]) {
      for (const line of (await readFile(path, 'utf8')).split('\n')) {
        const row = /^([A-Fa-f0-9 ]+)\s*;\s*(?:fully-qualified|component)\s*#\s*\S+\s+E[\d.]+\s+(.+)$/.exec(line);
        if (row) names.set(normal(row[2]!), row[1]!.trim().split(/\s+/));
      }
    }
    for (const dir of ['svg', 'svg15']) {
      for (const file of (await readdir(`${item.root}/${dir}`)).filter(name => name.endsWith('.svg'))) {
        const stem = file.slice(0, -4);
        const points = stem.startsWith('emoji_u') ? stem.slice(7).split('_') : names.get(normal(stem));
        out.set(`${dir}/${file}`, points ?? []);
      }
    }
  } else {
    for (const name of (await readdir(`${item.root}/${item.svgDir}`)).filter(name => name.endsWith('.svg'))) out.set(name, item.points(name));
  }
  return out;
}
