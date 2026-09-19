// SPDX-License-Identifier: MPL-2.0
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadGlossary, translateBatch } from './translate.ts';

const manifest = JSON.parse(readFileSync('community/agenda/tool.json', 'utf8'));
const source: Record<string, string> = {
  name: manifest.name,
  description: manifest.description,
  a11yLabel: manifest.a11yLabel,
};
for (const input of manifest.inputs) {
  for (const field of ['label', 'help', 'notice', 'placeholder', 'section'])
    if (input[field]) source[`inputs.${input.id}.${field}`] = input[field];
  for (const option of input.options ?? [])
    source[`inputs.${input.id}.options.${option.value}`] = option.label;
  if (input.tableEditor) {
    source[`inputs.${input.id}.tableEditor.title`] = input.tableEditor.title;
    for (const field of input.tableEditor.fields)
      source[`inputs.${input.id}.tableEditor.fields.${field.key}.label`] = field.label;
  }
}
source['guide.title'] = manifest.guide.title;
for (const track of manifest.guide.tracks) {
  source[`guide.tracks.${track.id}.label`] = track.label;
  track.steps.forEach((text: string, i: number) => {
    source[`guide.tracks.${track.id}.steps.${i}`] = text;
  });
}
const portable: string[] = JSON.parse(readFileSync('community/agenda/strings.json', 'utf8'));
const workbench = readFileSync('shells/web/src/views/table-workbench.ts', 'utf8');
const chrome = [
  ...new Set(
    [...workbench.matchAll(/(?:button\([^,]+,\s*|t\()'([^']+)'/g)]
      .map((m) => m[1]!)
      .concat([
        'Move up',
        'Move down',
        'Minutes',
        'Days',
        'picker',
        'rows',
        'columns',
        'days',
        'Required',
      ])
  ),
];
portable.forEach((text) => {
  source[`portable:${text}`] = text;
});
chrome.forEach((text) => {
  source[`chrome:${text}`] = text;
});
const langs = [
  'es',
  'de',
  'fr',
  'zh',
  'ja',
  'vi',
  'pt',
  'zh-hant',
  'cs',
  'nl',
  'tl',
  'sv',
  'ms',
  'ro',
  'hi',
  'bn',
  'ur',
  'id',
  'ar',
  'it',
  'no',
  'ko',
  'bg',
  'tr',
  'uk',
  'pl',
] as const;
// Include newly introduced Design inspector controls without retranslating existing copy.
const localeSources = langs.map((lang) =>
  JSON.parse(readFileSync(`shells/web/src/locales/${lang}.json`, 'utf8'))
);
for (const path of [
  'shells/web/src/views/design-inspector.ts',
  'shells/web/src/views/design-inspector-float.ts',
  'shells/web/src/views/design-topbar.ts',
  'shells/web/src/views/free-canvas/context-bar.ts',
  'shells/web/src/views/free-canvas/text-edit.ts',
]) {
  const code = readFileSync(path, 'utf8');
  for (const match of code.matchAll(/\bt\(\s*'([^']+)'/g)) {
    const text = match[1]!;
    if (localeSources.some((locale) => !locale[text])) source[`chrome:${text}`] = text;
  }
}
const cachePath = 'scripts/i18n/cache.json';
const allCache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {};
allCache.agenda ??= {};
const cache: Record<string, Record<string, string>> = allCache.agenda;
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const offline = process.argv.includes('--offline');
const client = offline ? null : new Anthropic();
const glossary = loadGlossary();
const previousPortable = JSON.parse(
  readFileSync('community/_shared/agenda-i18n.js', 'utf8').match(/var AG_TEXT = (.*);\n/)?.[1] ??
    '{}'
);
const overrides: Record<string, Record<string, string>> = JSON.parse(
  readFileSync('scripts/i18n/overrides.agenda.json', 'utf8')
);
const dictionaries: Record<string, Record<string, string>> = {};
mkdirSync('community/agenda/i18n', { recursive: true });
for (const lang of langs) {
  cache[lang] ??= {};
  const previousManifest = JSON.parse(readFileSync(`community/agenda/i18n/${lang}.json`, 'utf8'));
  const previousChrome = JSON.parse(readFileSync(`shells/web/src/locales/${lang}.json`, 'utf8'));
  for (const [key, text] of Object.entries(source)) {
    const previous = key.startsWith('portable:')
      ? previousPortable[lang]?.[text]
      : key.startsWith('chrome:')
        ? previousChrome[text]
        : previousManifest[key];
    if (previous && !cache[lang]![hash(text)]) cache[lang]![hash(text)] = previous;
  }
  const unique = [...new Set(Object.values(source))];
  const pending = unique.filter((text) => !overrides[lang]?.[text] && !cache[lang]![hash(text)]);
  if (offline && pending.length)
    throw new Error(
      `Add reviewed ${lang} translations to overrides.agenda.json: ${pending.join(' | ')}`
    );
  for (let i = 0; i < pending.length; i += 40) {
    const batch = pending.slice(i, i + 40).map((text, id) => ({ id, text }));
    const result = await translateBatch(
      client!,
      lang,
      batch,
      'Event programme and creative design editor. Keep placeholders, HTML and technical identifiers unchanged. Short, clear interface language.',
      glossary,
      { maxTokens: 8192 }
    );
    for (const item of batch) {
      const translated = result.get(item.id);
      if (!translated) throw new Error(`Missing translation for ${lang}: ${item.text}`);
      cache[lang]![hash(item.text)] = translated;
    }
    writeFileSync(cachePath, JSON.stringify(allCache));
  }
  const overlay: Record<string, string> = {},
    dict: Record<string, string> = {};
  const spaPath = `shells/web/src/locales/${lang}.json`,
    spa = JSON.parse(readFileSync(spaPath, 'utf8'));
  for (const [key, text] of Object.entries(source)) {
    const translated = overrides[lang]?.[text] ?? cache[lang]![hash(text)]!;
    if (key.startsWith('portable:')) dict[text] = translated;
    else if (key.startsWith('chrome:')) spa[text] = translated;
    else overlay[key] = translated;
  }
  writeFileSync(`community/agenda/i18n/${lang}.json`, JSON.stringify(overlay, null, 2) + '\n');
  writeFileSync(spaPath, JSON.stringify(spa, null, 2) + '\n');
  dictionaries[lang] = dict;
  console.log(`${lang}: ${unique.length} strings complete`);
}
writeFileSync(
  'community/_shared/agenda-i18n.js',
  '// SPDX-License-Identifier: MPL-2.0\n// === lolly:shared agenda-i18n - canonical source; edit here and run pnpm run sync:shared ===\nvar AG_TEXT = ' +
    JSON.stringify(dictionaries) +
    ';\nfunction agText(text, lang) { return AG_TEXT[lang] && AG_TEXT[lang][text] || text; }\n// === /lolly:shared agenda-i18n ===\n'
);
