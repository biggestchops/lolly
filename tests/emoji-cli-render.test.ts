// SPDX-License-Identifier: MPL-2.0
/**
 * The CLI draws emoji from the chosen pack, browser-free (plans/252).
 *
 * `--emoji=<id>@<version>` and `--emojifx=<treatment>` are reserved params, so this
 * is url mode under the argv transport: the same two strings a share link carries.
 * run.ts hydrates the canvas, calls `runtime.applyEmojiToDom` on it and then exports,
 * so the HTML this test reads back IS the tree every other export path walks.
 *
 * What it pins, over the REAL binary in a child process against a fixture repo:
 *   - a chosen set replaces every emoji cluster with the pack's own vector artwork,
 *     and no bare emoji code point survives outside `data-emoji` and the hidden
 *     `.lolly-emoji-text` span that keeps the characters for copy and search
 *   - two treatments recolour the same drawing: different paints, identical geometry
 *   - no set, and a cluster nothing can resolve, both give the neutral placeholder.
 *     The engine never falls back to the operating system's emoji font
 *   - the same command twice gives byte-identical bytes
 *
 * The fixture borrows the real registered pack (the bundle file and its asset index
 * entry) from the shared emoji-packs root, the way tests/cli-export-golden.ts borrows
 * the platform font, so the test tracks the pack that actually ships. It lays it out
 * the way materializeInto does, under catalog/packs/<root>/, because that is what the
 * entry's url names. It skips by name when that pack is not in the checkout.
 *
 * Run with: node --test tests/emoji-cli-render.test.ts
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile, readFile, copyFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, '..', 'shells', 'cli', 'bin', 'lolly.ts');
const PACK_ID = 'community/emoji/twemoji/color';
const PACK_PIN = 'twemoji/color@17.0.3';
const PACK_ROOT = join(HERE, '..', 'community', 'emoji-packs');
const BUNDLE = join(PACK_ROOT, 'twemoji-color.json');
const PACK_INDEX = join(PACK_ROOT, 'index.json');

// A treatment takes its colours from the brand in force, so the fixture needs a real
// palette as well as the pack. The blank starter brand is the one every public clone
// has, and its neutral ramp is enough to tell two treatments apart.
const STARTER_DIR = join(HERE, '..', 'brands', 'lolly-start', 'catalog', 'assets');
const INDEX = join(STARTER_DIR, 'index.json');
const TOKENS_ID = 'lolly/tokens/brand';
const TOKENS = join(STARTER_DIR, 'lolly', 'tokens', 'brand.json');

const packAvailable = existsSync(BUNDLE) && existsSync(PACK_INDEX) && existsSync(INDEX) && existsSync(TOKENS);
const SKIP_NO_PACK = packAvailable ? false
  : `The shared Twemoji pack is not in this checkout (${BUNDLE}) - nothing to draw from.`;

/** A registered entry, verbatim, so the fixture never carries a stale copy. */
function entry(indexPath: string, id: string): Record<string, unknown> | null {
  if (!existsSync(indexPath)) return null;
  const parsed = JSON.parse(readFileSync(indexPath, 'utf8')) as { assets?: Array<Record<string, unknown>> };
  return (parsed.assets ?? []).find((a) => a.id === id) ?? null;
}

const root = await mkdtemp(join(tmpdir(), 'lolly-emoji-cli-'));
after(() => rm(root, { recursive: true, force: true }));

if (packAvailable) {
  await mkdir(join(root, 'catalog', 'tools'), { recursive: true });
  await mkdir(join(root, 'catalog', 'packs', 'emoji-packs'), { recursive: true });
  await mkdir(join(root, 'catalog', 'assets', 'lolly', 'tokens'), { recursive: true });
  await copyFile(BUNDLE, join(root, 'catalog', 'packs', 'emoji-packs', 'twemoji-color.json'));
  await copyFile(TOKENS, join(root, 'catalog', 'assets', 'lolly', 'tokens', 'brand.json'));
  await writeFile(join(root, 'catalog', 'assets', 'index.json'),
    JSON.stringify({ assets: [entry(PACK_INDEX, PACK_ID), entry(INDEX, TOKENS_ID)] }));
  await writeFile(join(root, 'catalog', 'tools', 'index.json'), JSON.stringify({
    version: '1',
    tools: [{ id: 'emoji-card', name: 'emoji-card', status: 'community', description: 'emoji-card description', category: 'utility', formats: ['html'] }],
  }));
  await mkdir(join(root, 'tools', 'emoji-card'), { recursive: true });
  await writeFile(join(root, 'tools', 'emoji-card', 'tool.json'), JSON.stringify({
    id: 'emoji-card', name: 'emoji-card', version: '1.0.0', engineVersion: '^1.0.0', status: 'community',
    description: 'A line of text on a card',
    render: { width: 480, height: 200, formats: ['html'] },
    inputs: [{ id: 'line', type: 'text', label: 'Line', default: 'hello' }],
  }));
  // An HTML-layout template: the emoji pass walks text nodes, and this is the shape
  // every text-carrying tool has.
  await writeFile(join(root, 'tools', 'emoji-card', 'template.html'),
    '<div class="card"><p class="line">{{line}}</p></div>');
}

interface Run { stdout: string; stderr: string; code: number }

function cli(args: string[]): Promise<Run> {
  return new Promise((done) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      cwd: root,
      env: {
        ...process.env,
        LOLLY_ROOT: root,
        // No browser tier: every assertion here is about the browser-free path.
        LOLLY_WEB_DIST: join(root, 'no-such-dist'),
        NO_COLOR: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '', err = '';
    child.stdout!.on('data', (c: Buffer) => { out += c.toString('utf8'); });
    child.stderr!.on('data', (c: Buffer) => { err += c.toString('utf8'); });
    child.on('close', (code) => done({ stdout: out, stderr: err, code: code ?? -1 }));
  });
}

/** One render, returned as the exported markup. */
async function render(name: string, line: string, flags: string[]): Promise<string> {
  const output = join(root, `${name}.html`);
  const r = await cli(['emoji-card', `--line=${line}`, ...flags, '--export=html', '--no-provenance', `--output=${output}`]);
  assert.equal(r.code, 0, `render ${name} failed: ${r.stderr}`);
  return await readFile(output, 'utf8');
}

/** Every emoji placement, matched by its own class and never by the inner text span. */
function placements(html: string): Array<{ cls: string; markup: string }> {
  const out: Array<{ cls: string; markup: string }> = [];
  for (const open of html.matchAll(/<span class="(lolly-emoji(?:\s[^"]*)?)"/g)) {
    const tag = /<\/?span\b[^>]*>/g;
    tag.lastIndex = open.index;
    let depth = 0;
    let end = html.length;
    for (;;) {
      const t = tag.exec(html);
      if (!t) break;
      depth += t[0].startsWith('</') ? -1 : 1;
      if (depth === 0) { end = t.index + t[0].length; break; }
    }
    out.push({ cls: open[1]!, markup: html.slice(open.index, end) });
  }
  return out;
}

/** Emoji code points a document draws as text, outside the two places they belong. */
function bareEmoji(html: string): string[] {
  const stripped = html
    .replace(/data-emoji="[^"]*"/g, '')
    .replace(/aria-label="[^"]*"/g, '')
    .replace(/<span class="lolly-emoji-text"[^>]*>[\s\S]*?<\/span>/g, '');
  const found: string[] = [];
  for (const ch of stripped) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0x1f000 || cp === 0x2764 || cp === 0xfe0f || cp === 0x200d || cp === 0x20e3) found.push(`U+${cp.toString(16)}`);
  }
  return found;
}

/** The drawing with every paint removed, so two treatments can be compared by shape. */
const geometry = (html: string): string => html
  .replace(/\s(?:fill|stroke|stop-color|color)="[^"]*"/g, '')
  .replace(/data-emoji-sum="[^"]*"/g, '');

const paints = (html: string): string[] =>
  [...new Set([...html.matchAll(/(?:fill|stop-color)="(#[0-9a-fA-F]{3,8})"/g)].map((m) => m[1]!.toLowerCase()))].sort();

const sha = (text: string): string => createHash('sha256').update(text).digest('hex');

// Two glyphs the pack carries, and one joined sequence nothing can resolve: the
// registered pack covers every canonical Unicode 17 entry, so the unresolvable case
// is now a cluster the pinned data does not know rather than a gap in the artwork.
const IN_PACK = 'Field notes \u{1f600} and thanks \u{2764}\u{fe0f}';
const UNRESOLVABLE = 'Ship it \u{1f600}\u{200d}\u{1f680} today';

test('a chosen set draws every emoji from the pack, not from the system font', { skip: SKIP_NO_PACK }, async () => {
  const html = await render('chosen', IN_PACK, [`--emoji=${PACK_PIN}`]);
  const drawn = placements(html);
  assert.equal(drawn.length, 2, `expected two placements, got ${drawn.length}`);
  for (const p of drawn) {
    assert.ok(!p.cls.includes('lolly-emoji--unset'), 'a carried glyph must not fall back to the placeholder');
    assert.match(p.markup, /<svg[^>]*>/, 'the placement carries inline artwork');
    assert.match(p.markup, /<(?:path|circle|ellipse|rect|polygon)/, 'the artwork carries real geometry');
    assert.match(p.markup, /data-emoji="/);
    assert.match(p.markup, /data-emoji-key="/);
    assert.match(p.markup, /data-emoji-sum="sha256|data-emoji-sum="[0-9a-f]{16}"/);
    assert.match(p.markup, /aria-label="/);
    assert.match(p.markup, /<span class="lolly-emoji-text"/, 'the characters stay for copy and search');
  }
  assert.deepEqual(bareEmoji(html), [], 'no bare emoji code point outside data-emoji and the hidden text');
});

test('two treatments recolour one drawing: different paints, identical geometry', { skip: SKIP_NO_PACK }, async () => {
  const snap = await render('snap', IN_PACK, [`--emoji=${PACK_PIN}`, '--emojifx=snap']);
  const mono = await render('mono', IN_PACK, [`--emoji=${PACK_PIN}`, '--emojifx=mono']);
  const plain = await render('plain', IN_PACK, [`--emoji=${PACK_PIN}`, '--emojifx=original']);
  assert.notDeepEqual(paints(snap), paints(mono), 'snap and mono must not land on the same paints');
  assert.notDeepEqual(paints(plain), paints(snap), 'a treatment must change the pack\'s own colours');
  assert.equal(geometry(snap), geometry(mono), 'a treatment recolours, it never moves a point');
  assert.equal(geometry(plain), geometry(snap));
});

test('no set chosen gives the neutral placeholder, never an operating-system glyph', { skip: SKIP_NO_PACK }, async () => {
  const html = await render('unset', IN_PACK, []);
  const drawn = placements(html);
  assert.equal(drawn.length, 2);
  for (const p of drawn) {
    assert.ok(p.cls.includes('lolly-emoji--unset'), 'every cluster is the unset placeholder');
    assert.match(p.markup, /aria-label="[^"]*\(no emoji set chosen\)"/);
    assert.match(p.markup, /<rect[^>]*rx="3\.4"/, 'the placeholder is the rounded square');
    assert.match(p.markup, /<circle[^>]*r="1\.6"/, 'with its centred dot');
    assert.doesNotMatch(p.markup, /<path/, 'a placeholder carries no glyph outline');
  }
  assert.deepEqual(bareEmoji(html), [], 'the characters are never painted as text');
});

test('a cluster nothing can resolve is the placeholder, with a reason', { skip: SKIP_NO_PACK }, async () => {
  const html = await render('missing', UNRESOLVABLE, [`--emoji=${PACK_PIN}`]);
  const drawn = placements(html);
  assert.equal(drawn.length, 1);
  assert.ok(drawn[0]!.cls.includes('lolly-emoji--unset'));
  assert.match(drawn[0]!.markup, /data-emoji-why="unsupported-sequence"/, 'the placement records why it is unresolved');
  assert.deepEqual(bareEmoji(html), []);
});

test('the same command twice gives byte-identical bytes', { skip: SKIP_NO_PACK }, async () => {
  const first = await render('repeat-a', IN_PACK, [`--emoji=${PACK_PIN}`, '--emojifx=mono']);
  const second = await render('repeat-b', IN_PACK, [`--emoji=${PACK_PIN}`, '--emojifx=mono']);
  assert.equal(sha(first), sha(second), 'the treated artwork is deterministic');
});

test('a treatment named with no set is reported, not silently ignored', { skip: SKIP_NO_PACK }, async () => {
  const r = await cli(['emoji-card', `--line=${IN_PACK}`, '--emojifx=mono', '--export=html', '--no-provenance',
    `--output=${join(root, 'fx-only.html')}`]);
  assert.equal(r.code, 0);
  assert.match(r.stderr, /--emojifx=mono names a treatment but no set/);
});
