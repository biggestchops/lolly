// SPDX-License-Identifier: MPL-2.0
// Tests for the pure helpers in lib/drop-router.ts: the share-chunk assembly
// step, and the two design-system sniffs (plan 97 section 8) that decide whether the
// chooser offers "Use as the design system". Everything else in the module is
// DOM/navigation and belongs to a browser.
//
// Tests for the pure share-chunk assembly helper in lib/drop-router.ts - the
// decode/concat step between the Android `LollyShare` JS interface's base64
// chunks and the File handed to the drop chooser. The interface itself (poll/
// consumed, warm-share events) only exists inside the Android WebView, so the
// pure part is what a node test can pin down.
// The tests tsconfig includes only *.test.ts + jsdom.d.ts; drop-router's lazy
// `import('../views/picker.ts')` pulls bridge/export.ts (and its vendor
// modules) into this program, so their ambient declarations must come along.
/// <reference path="../vendor.d.ts" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import {
  assembleShareChunks,
  looksLikeTokenDoc,
  zipListsDesignSystemParts,
  dropChooserChoices,
  dropChooserMessage,
} from './drop-router.ts';
import type { Sniff, ChooserContext } from './drop-router.ts';

const b64 = (s: string): string => Buffer.from(s, 'latin1').toString('base64');

test('assembleShareChunks: concatenates chunks in order', () => {
  const chunks = [b64('hello '), b64('shared '), b64('world')];
  const out = assembleShareChunks(chunks.length, (i) => chunks[i]!);
  assert.equal(Buffer.from(out).toString('latin1'), 'hello shared world');
});

test('assembleShareChunks: zero chunks → empty buffer, reader never called', () => {
  const out = assembleShareChunks(0, () => { throw new Error('must not read'); });
  assert.equal(out.length, 0);
});

test('assembleShareChunks: binary bytes survive the round-trip', () => {
  const bytes = Uint8Array.from({ length: 4096 }, (_, i) => (i * 7 + 13) % 256);
  const chunk = Buffer.from(bytes).toString('base64');
  assert.deepEqual(assembleShareChunks(1, () => chunk), bytes);
});

test('assembleShareChunks: tolerates android Base64.DEFAULT line wraps', () => {
  // android.util.Base64.DEFAULT inserts "\n" every 76 chars (and a trailing one).
  const wrapped = `${Buffer.from('wrapped-payload-bytes').toString('base64').replace(/(.{8})/g, '$1\n')}\n`;
  assert.equal(Buffer.from(assembleShareChunks(1, () => wrapped)).toString(), 'wrapped-payload-bytes');
});

test("assembleShareChunks: '' chunk (the bridge's out-of-range answer) adds nothing", () => {
  const out = assembleShareChunks(2, (i) => (i === 0 ? b64('data') : ''));
  assert.equal(Buffer.from(out).toString(), 'data');
});

test('assembleShareChunks: uneven chunk sizes keep byte offsets exact', () => {
  const parts = ['a', 'bb', 'ccc', '', 'ddddd'];
  const out = assembleShareChunks(parts.length, (i) => b64(parts[i]!));
  assert.equal(Buffer.from(out).toString('latin1'), parts.join(''));
});

// ── design-system sniffs (plan 97 section 8) ────────────────────────────────────────

test('looksLikeTokenDoc: Tokens-Studio container keys are enough on their own', () => {
  assert.equal(looksLikeTokenDoc({ $themes: [], $metadata: { tokenSetOrder: ['core'] } }), true);
  assert.equal(looksLikeTokenDoc({ $metadata: { tokenSetOrder: [] } }), true);
});

test('looksLikeTokenDoc: a nested DTCG $value leaf', () => {
  const doc = { color: { brand: { primary: { $value: '#0c322c', $type: 'color' } } } };
  assert.equal(looksLikeTokenDoc(doc), true);
});

test('looksLikeTokenDoc: the legacy Tokens-Studio { value, type } leaf', () => {
  assert.equal(looksLikeTokenDoc({ colors: { red: { value: '#f00', type: 'color' } } }), true);
  // `value` without a string `type` is just data, not a token.
  assert.equal(looksLikeTokenDoc({ settings: { volume: { value: 3 } } }), false);
});

test('looksLikeTokenDoc: a Lottie-shaped document is not a token document', () => {
  // The case coerceTokensDoc alone answers wrongly: it accepts ANY JSON object.
  const lottie = { v: '5.7.4', fr: 30, w: 512, h: 512, layers: [{ ty: 4, nm: 'shape' }] };
  assert.equal(looksLikeTokenDoc(lottie), false);
});

test('looksLikeTokenDoc: arrays and primitives are refused outright', () => {
  assert.equal(looksLikeTokenDoc([{ $value: '#f00' }]), false);
  assert.equal(looksLikeTokenDoc('#f00'), false);
  assert.equal(looksLikeTokenDoc(null), false);
});

test('looksLikeTokenDoc: an INHERITED value/type never stands in for a token leaf', () => {
  assert.equal(looksLikeTokenDoc({ a: { b: {} } }), false);
  const inherited = { tokens: Object.create({ $value: '#f00', value: '#f00', type: 'color' }) as object };
  assert.equal(looksLikeTokenDoc(inherited), false);
});

test('looksLikeTokenDoc: a set literally named __proto__ is still a set', () => {
  // JSON.parse makes "__proto__" an OWN enumerable key, and the engine's
  // assembleTokenSetFiles already treats such a set as real - the sniff agrees.
  assert.equal(looksLikeTokenDoc(JSON.parse('{"__proto__":{"red":{"$value":"#f00"}}}')), true);
});

test('looksLikeTokenDoc: the walk is bounded, so a deep leaf past the budget is missed', () => {
  // Documented behaviour, not an accident: the budget is what keeps the sniff
  // affordable on a huge unrelated JSON drop.
  let deep: Record<string, unknown> = { $value: '#f00' };
  for (let i = 0; i < 20; i++) deep = { nest: deep };
  assert.equal(looksLikeTokenDoc(deep), false);
  assert.equal(looksLikeTokenDoc(deep, 4000, 32), true);
});

test('zipListsDesignSystemParts: a Lolly pack names manifest.json + tokens.json', () => {
  // Local file headers keep entry names in the clear even when bodies deflate.
  const head = 'PK\u0000manifest.json{binary}PK\u0000tokens.json';
  assert.equal(zipListsDesignSystemParts(head), true);
});

test('zipListsDesignSystemParts: a loose token-set export needs only its metadata files', () => {
  assert.equal(zipListsDesignSystemParts('PK$metadata.json'), true);
  assert.equal(zipListsDesignSystemParts('PK$themes.json'), true);
});

// ── what the chooser offers, and what it says ────────────────────────────────

const NOTHING: Sniff = {
  design: false, pdf: false, pptx: false, media: false,
  c2pa: false, layers: false, archive: false, designSystem: false, lolly: false,
  textDoc: false,
};
const sniff = (over: Partial<Sniff>): Sniff => ({ ...NOTHING, ...over });
const ctx = (over: Partial<ChooserContext> = {}): ChooserContext => ({
  single: true, count: 1, allIngestable: false, has: () => true, ...over,
});
const leader = (list: ReturnType<typeof dropChooserChoices>): string | undefined =>
  list.find((c) => c.primary)?.id;

test('a plain zip still leads with unpack', () => {
  const s = sniff({ archive: true, design: true });
  const list = dropChooserChoices(s, ctx());
  assert.equal(list[0]?.id, 'unpack');
  assert.equal(leader(list), 'unpack');
  assert.equal(dropChooserMessage(s, 'photos.zip', ctx()), '“photos.zip” is an archive.');
});

test('a design-system pack zip leads with the studio, and unpack stays underneath', () => {
  // Unpacking a pack shreds it into loose library assets - the opposite of
  // installing it - so the route the sniff positively identified goes first.
  const s = sniff({ archive: true, design: true, designSystem: true });
  const list = dropChooserChoices(s, ctx());
  assert.equal(list[0]?.id, 'design-system');
  assert.equal(leader(list), 'design-system');
  assert.equal(list.filter((c) => c.primary).length, 1, 'exactly one route leads');
  const unpack = list.find((c) => c.id === 'unpack');
  assert.ok(unpack, 'unpack is still offered');
  assert.ok(!unpack.primary);
  // …and the studio door is offered exactly once, not once per branch.
  assert.equal(list.filter((c) => c.id === 'design-system').length, 1);
});

test('a design-system pack zip is named, never announced as just "an archive"', () => {
  const s = sniff({ archive: true, design: true, designSystem: true });
  assert.equal(
    dropChooserMessage(s, 'pack.zip', ctx()),
    '“pack.zip” can open in Design or install as the design system.',
  );
  // With no Layout Studio in the build there is one door, and it is still named.
  assert.equal(
    dropChooserMessage(s, 'pack.zip', ctx({ has: () => false })),
    '“pack.zip” looks like a design system.',
  );
});

test('a .penpot keeps its pair: Layout Studio leads, the studio sits beside it', () => {
  // `archive` is false for a .penpot (PURE_DESIGN_EXT_RE excludes it), so this
  // path is untouched by the pack-zip rule above.
  const list = dropChooserChoices(sniff({ design: true, designSystem: true }), ctx());
  assert.deepEqual(list.map((c) => c.id), ['design', 'design-rules', 'design-system', 'sequence', 'exports']);
  assert.equal(leader(list), 'design');
});

test('a token .json offers the studio alone, and leads with it', () => {
  const list = dropChooserChoices(sniff({ designSystem: true }), ctx());
  assert.deepEqual(list.map((c) => c.id), ['design-system', 'verify']);
  assert.equal(leader(list), 'design-system');
});

test('a PDF offers the studio beside its own routes, and never leads with it', () => {
  // Plan 97 M5: a guidelines PDF is design-system material (colours, marks,
  // embedded faces), but a PDF's first meaning is still a document - the sniff
  // cannot tell guidelines from an invoice, so Layout Studio keeps the lead and
  // the studio door sits with the other "what is inside this document" routes,
  // above the transform utility.
  const s = sniff({ pdf: true });
  const list = dropChooserChoices(s, ctx());
  assert.deepEqual(list.map((c) => c.id), ['design', 'design-rules', 'sequence', 'library', 'design-system', 'compress']);
  assert.equal(leader(list), 'design');
  // …and the sentence still names the file for what it is.
  assert.equal(dropChooserMessage(s, 'guidelines.pdf', ctx()), '“guidelines.pdf” is a PDF or Illustrator document.');
});

test('a PDF in a build with no other PDF tools still reaches the studio', () => {
  const list = dropChooserChoices(sniff({ pdf: true }), ctx({ has: () => false }));
  assert.deepEqual(list.map((c) => c.id), ['library', 'design-system']);
});

test('the studio door is offered once even if a file sniffs as both PDF and tokens', () => {
  // sniffFile never reports both (designSystem is computed `!pdf`), so this pins
  // the defensive guard in the PDF branch rather than a reachable state.
  const list = dropChooserChoices(sniff({ pdf: true, designSystem: true }), ctx());
  assert.equal(list.filter((c) => c.id === 'design-system').length, 1);
  assert.equal(leader(list), 'design');
});

test('zipListsDesignSystemParts: a manifest alone is not a design system', () => {
  // Plenty of zips carry a manifest.json (extensions, web apps); without the
  // token half they keep the plain unpack/Layout Studio routes only.
  assert.equal(zipListsDesignSystemParts('PKmanifest.json'), false);
  assert.equal(zipListsDesignSystemParts('PKphoto.jpg\u0000notes.txt'), false);
});

// A plain-text / markdown / code document ingests to the library as a type:'text'
// asset. Before this, only media offered "Add to your library", so a dragged .txt
// looked unsupported (only a verify route, or nothing).
test('a text document offers "Add to your library" AND the verify/AI-signals route', () => {
  const base: Sniff = {
    design: false, pdf: false, pptx: false, media: false, c2pa: false,
    layers: false, archive: false, designSystem: false, lolly: false, textDoc: false,
  };
  const ctx: ChooserContext = { single: true, count: 1, allIngestable: true, has: () => false };
  const ids = dropChooserChoices({ ...base, textDoc: true }, ctx).map((c) => c.id);
  assert.ok(ids.includes('library'), 'a .txt/.md drop must offer the library route');
  assert.ok(ids.includes('verify'), 'and the verify / AI-signals route');
  // A plain-text doc is NOT "unknown", so it should not read as an unsupported file.
  assert.ok(!ids.includes('design') && !ids.includes('unpack'));
});

test('isBrandPackParts: routes by manifest format, exactly', async () => {
  const { isBrandPackParts } = await import('./drop-router.ts');
  assert.ok(isBrandPackParts({ format: 'lolly-brand' }));
  assert.ok(!isBrandPackParts({ format: 'lolly-session' }), 'a saved session stays on the session path');
  assert.ok(!isBrandPackParts({}));
  assert.ok(!isBrandPackParts(null));
});

// Office files: one sheet, every route (plans/139 WP3 follow-up). The deck ingest's
// own slides-vs-content chooser is suppressed on this path (chooser: false), so a
// dropped .pptx never shows two dialogs in a row. Since 2026-09-02 a deck is a design
// document first: the Design doors (edit as artboards / make a video) lead exactly as
// they do for a PDF, and the pictures + content routes follow.
test('a deck offers Design first, then its slides AND content extraction, in the same sheet', () => {
  const list = dropChooserChoices(sniff({ pptx: true }), ctx());
  assert.deepEqual(list.map((c) => c.id).slice(0, 3), ['design', 'design-rules', 'sequence']);
  assert.deepEqual(list.map((c) => c.id).slice(3, 5), ['library', 'extract']);
  assert.equal(leader(list), 'design', 'a deck edits like a PDF does');
});

// ── a zipped tool folder (the sideload route) ────────────────────────────────

const MANIFEST = {
  id: 'my-tool', name: 'My Tool', description: 'A tool.', version: '1.0.0',
  engineVersion: '^1.0.0', category: 'utility', status: 'community',
  inputs: [], render: { width: 512, height: 512, formats: ['svg'] },
};
const toolZip = (files: Record<string, string>): Uint8Array =>
  zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));

test('a tool zip leads with Install this tool, and unpack stays underneath', () => {
  // A tool zip sniffs as an archive too (PK magic); unpacking one scatters a
  // template and a hooks file into the asset library, so the install door leads.
  const s = sniff({ tool: true, archive: true, design: true });
  const list = dropChooserChoices(s, ctx());
  assert.equal(list[0]?.id, 'install-tool');
  assert.equal(leader(list), 'install-tool');
  assert.equal(list.filter((c) => c.primary).length, 1, 'exactly one route leads');
  assert.ok(!list.find((c) => c.id === 'unpack')?.primary, 'unpack is still offered, underneath');
  assert.equal(dropChooserMessage(s, 'my-tool.zip', ctx()), '“my-tool.zip” looks like a Lolly tool folder.');
});

test('readToolZip: tool.json at the archive root', async () => {
  const { readToolZip } = await import('./drop-router.ts');
  const out = await readToolZip(toolZip({
    'tool.json': JSON.stringify(MANIFEST),
    'template.html': '<p>{{x}}</p>',
    'assets/logo.svg': '<svg/>',
  }));
  assert.equal(out.manifest.id, 'my-tool');
  assert.deepEqual(Object.keys(out.files).sort(), ['assets/logo.svg', 'template.html', 'tool.json']);
});

test('readToolZip: the "zip the folder" shape, prefix stripped', async () => {
  const { readToolZip } = await import('./drop-router.ts');
  const out = await readToolZip(toolZip({
    'my-tool/tool.json': JSON.stringify(MANIFEST),
    'my-tool/hooks.js': 'return {};',
    // A macOS-made zip carries these beside every real file; unfiltered they would
    // read as a second top-level folder and sink the whole archive.
    '__MACOSX/my-tool/._tool.json': 'x',
    'my-tool/.DS_Store': 'x',
  }));
  assert.deepEqual(Object.keys(out.files).sort(), ['hooks.js', 'tool.json']);
});

test('readToolZip: two top-level folders, or no tool.json, is not a tool folder', async () => {
  const { readToolZip } = await import('./drop-router.ts');
  await assert.rejects(
    readToolZip(toolZip({ 'a/tool.json': JSON.stringify(MANIFEST), 'b/tool.json': JSON.stringify(MANIFEST) })),
    /isn’t a tool folder/,
  );
  await assert.rejects(
    readToolZip(toolZip({ 'notes.txt': 'hello', 'pics/cat.png': 'x' })),
    /isn’t a tool folder/,
  );
});

test('readToolZip: a traversing or absolute path refuses the whole archive', async () => {
  const { readToolZip } = await import('./drop-router.ts');
  await assert.rejects(
    readToolZip(toolZip({ 'tool.json': JSON.stringify(MANIFEST), '../evil.js': 'x' })),
    /unsafe file path/,
  );
  await assert.rejects(
    readToolZip(toolZip({ 'tool.json': JSON.stringify(MANIFEST), '/etc/passwd': 'x' })),
    /unsafe file path/,
  );
});

test('readToolZip: an engineVersion this build refuses is refused in the loader’s words', async () => {
  const { readToolZip } = await import('./drop-router.ts');
  const { ENGINE_VERSION } = await import('@lolly/engine');
  await assert.rejects(
    readToolZip(toolZip({ 'tool.json': JSON.stringify({ ...MANIFEST, engineVersion: '^99.0.0' }) })),
    new RegExp(`"my-tool" requires engine \\^99\\.0\\.0, but this build implements ${ENGINE_VERSION.replace(/\./g, '\\.')} - refusing to load`),
  );
});

test('readToolZip: a manifest the schema rejects never reaches the installer', async () => {
  const { readToolZip } = await import('./drop-router.ts');
  const { id: _drop, ...noId } = MANIFEST;
  await assert.rejects(readToolZip(toolZip({ 'tool.json': JSON.stringify(noId) })), /failed validation/);
});

test('a Word document leads with content extraction and never reaches Design', () => {
  const s = sniff({ docx: true });
  const list = dropChooserChoices(s, ctx());
  assert.equal(leader(list), 'extract');
  assert.ok(!list.some((c) => c.id === 'design'), 'a .docx is a zip, but Design cannot open one');
  assert.equal(dropChooserMessage(s, 'report.docx', ctx()), '“report.docx” is a Word document.');
});

// ── the chooser's doors for a deck ─────────────────────────────────────────────

const deckSniff = (o: Partial<Sniff> = {}): Sniff => ({
  design: false, pdf: false, pptx: false, media: false, c2pa: false, layers: false, archive: false,
  textDoc: false, designSystem: false, lolly: false, ...o,
});
const deckCtx = (tools: string[]): ChooserContext => ({ single: true, count: 1, allIngestable: true, has: (id) => tools.includes(id) });

test('a .pptx gets the Design doors a PDF gets - edit as artboards, or make a video - and Design leads', () => {
  const choices = dropChooserChoices(deckSniff({ pptx: true }), deckCtx(['design']));
  const ids = choices.map((c) => c.id);
  assert.ok(ids.includes('design'), 'Edit in Design');
  assert.ok(ids.includes('sequence'), 'Make a video from its frames');
  assert.ok(ids.includes('library'), 'the slides-as-pictures route is still there');
  assert.deepEqual(choices.filter((c) => c.primary).map((c) => c.id), ['design'], 'exactly one primary, and it is Design');
  assert.match(dropChooserMessage(deckSniff({ pptx: true }), 'deck.pptx', deckCtx(['design'])), /PowerPoint deck/);
});

test('without Design in the build, a deck’s library route leads as it always did', () => {
  const choices = dropChooserChoices(deckSniff({ pptx: true }), deckCtx([]));
  assert.equal(choices.some((c) => c.id === 'design'), false);
  assert.deepEqual(choices.filter((c) => c.primary).map((c) => c.id), ['library']);
});


// ── the data route (plans/87): a table of data charts itself ──────────────────
const NO_SNIFF: Sniff = {
  design: false, pdf: false, pptx: false, media: false, c2pa: false, layers: false,
  archive: false, textDoc: false, designSystem: false, lolly: false,
};
const oneFile = (has: (id: string) => boolean): ChooserContext => ({ single: true, count: 1, allIngestable: false, has });

test('a data file leads with Spreadsheet, keeps Chart as an option, and never offers a credentials check', () => {
  const choices = dropChooserChoices({ ...NO_SNIFF, data: true }, oneFile((id) => id === 'chart'));
  assert.deepEqual(choices.map((c) => c.id), ['spreadsheet', 'chart']);
  assert.equal(choices[0]!.primary, true);
  assert.equal(dropChooserMessage({ ...NO_SNIFF, data: true }, 'sales.csv', oneFile(() => true)), '“sales.csv” is a table of data.');
});

test('a data file in a build without Chart still opens in the on-device spreadsheet', () => {
  const choices = dropChooserChoices({ ...NO_SNIFF, data: true }, oneFile(() => false));
  assert.deepEqual(choices.map((c) => c.id), ['spreadsheet']);
  assert.equal(choices[0]!.primary, true);
});

test('a multi-file drop keeps the batch routes only - the chart route is a single-file journey', () => {
  const choices = dropChooserChoices({ ...NO_SNIFF, data: true }, { single: false, count: 2, allIngestable: false, has: () => true });
  assert.ok(!choices.some((c) => c.id === 'spreadsheet'));
  assert.ok(!choices.some((c) => c.id === 'chart'));
});
