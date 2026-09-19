#!/usr/bin/env node
// SPDX-License-Identifier: MPL-2.0
/** Turn a pinned upstream emoji family on disk into a pack manifest plus an admission and coverage report.
 *  Measurement only. Nothing here is downloaded, and nothing is written outside dist/ unless --bundle-out says otherwise.
 *
 *    node scripts/import-emoji-pack.ts <family> [--measure] [--verify] [--out=dir]
 *    node scripts/import-emoji-pack.ts <family> --bundle=<subset|all> [--bundle-out=file]
 *        [--skip-refused] [--withhold=<key,key>] [--withhold-reason=<text>]
 *    <family> is openmoji-color, openmoji-black, twemoji-color, noto-color or all.
 *
 *  --measure renders every admitted glyph and records its ink box; --verify checks
 *  that the canonical markup decodes to the same pixels as the untouched source.
 *  Both run the reference rasteriser in a child process: a native panic inside
 *  resvg (Noto's rainbow flag does this to 2.6.2) then counts as one crashed
 *  glyph in the report instead of ending the whole run.
 *
 *  --bundle writes one EmojiPackBundleV1 file: the exact manifest text whose sha256
 *  is the pack pin, plus every glyph's untouched source SVG keyed by its asset url.
 *  A catalog registers that one file as one asset, so a set is one lazy download with
 *  one integrity check. `--bundle=all` bundles the whole family; a named subset (see
 *  SUBSETS) cuts it down, and takes its own `-starter` pack id so it can never be
 *  confused with the full set. The default destination is dist/, which is never
 *  committed; `--bundle-out` names another, and writing into a shared asset root
 *  (community/emoji-packs) is how a pack reaches every profile. The script prints the
 *  asset index entry to register, with the url that destination is served from.
 *
 *  Two glyphs can leave a bundle, and each leaves a record behind rather than a gap:
 *  --skip-refused drops artwork the engine's static subset will not admit (an upstream
 *  defect) and lists it under `meta.emoji.missing` with the refusal message, and
 *  --withhold drops named canonical keys on purpose, with --withhold-reason as the
 *  reason recorded under `meta.emoji.withheld`. A withhold key that matches no glyph
 *  is an error, so a typo can never pass as a silent full set.
 *
 *  Every printed entry carries a `rights` record (plan 253): the family as one work,
 *  its creators, its source at the pinned revision, and the licence declaration with
 *  the notice file's sha256, asserted by the catalog. The declaration is the upstream
 *  spelling; the canonical identifier beside it comes from the engine's own
 *  normaliser, never from a name match here.
 */
import { fork } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { gzipSync } from 'node:zlib';
import { Resvg } from '@resvg/resvg-js';
import { JSDOM } from 'jsdom';
import { EMOJI_BUNDLE_MAX_BYTES } from '../packages/core/src/emoji-v1.ts';
import type { EmojiGlyphV1, EmojiMeaningV1, EmojiPackBundleV1, EmojiPackManifestV1, EmojiSourceV1 } from '../packages/core/src/emoji-v1.ts';
import type { CreativeWorkRecordV1, RightsEvidenceV1 } from '../packages/core/src/rights-v1.ts';
import { allAssetRoots } from '../packages/node-shell/src/content-roots.ts';
import { readEmojiPack } from '../engine/src/emoji-pack.ts';
import { normaliseLicence } from '../engine/src/rights-profiles.ts';
import { lookupEmojiSequence } from '../engine/src/emoji-sequence.ts';
import { emojiSvgMarkup, prepareEmojiSvg } from '../engine/src/emoji-svg.ts';
import unicodeData from '../engine/src/emoji-data/17.0.json' with { type: 'json' };

import { SPECS, sourceInventory } from './lib/emoji-families.ts';
import type { Spec } from './lib/emoji-families.ts';

const ROOT = resolve(new URL('..', import.meta.url).pathname);

const ARTWORK_MAX_BYTES = 2 * 1024 * 1024;
const NOTICE_MAX_CHARS = 262_144;
const RENDER_PX = 64;
const ALPHA_FLOOR = 8;
const BASELINE_RATIO = 0.85;
const METRICS_NOTE = 'Baseline is provisional at 0.85 of the em box, the value the one-glyph fixtures carry. It is not measured from the artwork.';
const window = new JSDOM('').window;
const parseXml = (source: string): Document => new window.DOMParser().parseFromString(source, 'image/svg+xml');
const digest = (bytes: Uint8Array): string => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const jsonBytes = (value: unknown): Uint8Array => new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);

/** Named subsets a starter pack can be cut to. The value is the Unicode `# group:` header it keeps. */
const SUBSETS: Record<string, string> = { smileys: 'Smileys & Emotion' };
const EMOJI_TEST = `${ROOT}/scripts/data/unicode/17.0/emoji-test.txt`;
const SKIN_TONE = (point: number): boolean => point >= 0x1f3fb && point <= 0x1f3ff;

/**
 * The canonical keys of one Unicode group, read from the pinned emoji-test.txt.
 * Only `fully-qualified` rows count, and a row carrying a skin-tone modifier is
 * skipped: a starter pack is a readable sample, and leaving the tone variants out
 * keeps the protection rule (tones are never recoloured) out of its first run.
 * The key comes from the engine's own lookup, never from the file's own spelling.
 */
async function subsetKeys(group: string): Promise<Set<string>> {
  const keys = new Set<string>();
  let current = '';
  for (const line of (await readFile(EMOJI_TEST, 'utf8')).split('\n')) {
    const header = /^#\s*group:\s*(.+?)\s*$/.exec(line);
    if (header) { current = header[1]!; continue; }
    if (current !== group || !line.includes('; fully-qualified')) continue;
    const points = line.split(';')[0]!.trim().split(/\s+/).map(part => Number.parseInt(part, 16));
    if (!points.length || points.some(point => !Number.isFinite(point)) || points.some(SKIN_TONE)) continue;
    const found = lookupEmojiSequence(String.fromCodePoint(...points));
    if (found) keys.add(found.key);
  }
  if (!keys.size) throw new Error(`No fully-qualified rows for the group "${group}".`);
  return keys;
}

/** The same scan over fewer glyphs, with the default viewBox recounted over what is left. */
function withKept(found: Scan, kept: Scanned[]): Scan {
  const viewBoxes = new Map<string, number>();
  for (const entry of kept) {
    const box = entry.viewBox.join(' ');
    viewBoxes.set(box, (viewBoxes.get(box) ?? 0) + 1);
  }
  return { ...found, kept, viewBoxes };
}

/** The same scan cut down to one set of canonical keys. */
function narrowScan(found: Scan, keys: Set<string>): Scan {
  return withKept(found, found.kept.filter(entry => entry.meaning.kind === 'unicode' && keys.has(entry.meaning.key)));
}

/** The canonical key a glyph is named by: a Unicode sequence key, or a custom symbol's id. */
const meaningKey = (meaning: EmojiMeaningV1): string => (meaning.kind === 'unicode' ? meaning.key : meaning.id);

function sourceRecord(item: Spec, file: string, creator: string): EmojiSourceV1 {
  const host = item.repo.replace('https://github.com/', 'https://raw.githubusercontent.com/');
  return {
    creator, sourceUrl: `${host}/${item.commit}/${[item.svgDir, file].join('/').split('/').filter(part => part !== '.').map(encodeURIComponent).join('/')}`, revision: item.commit,
    license: item.license, licenseUrl: item.licenseUrl, attribution: item.attribution, modifications: [],
  };
}

/** The file name's code points as one string. Null when a segment is not a scalar value. */
function sequenceText(points: readonly string[]): string | null {
  let text = '';
  for (const part of points) {
    if (!/^[0-9a-f]{1,6}$/i.test(part)) return null;
    const point = Number.parseInt(part, 16);
    if (point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) return null;
    text += String.fromCodePoint(point);
  }
  return text || null;
}

const isPrivateUse = (point: number): boolean =>
  (point >= 0xe000 && point <= 0xf8ff) || (point >= 0xf0000 && point <= 0xffffd) || (point >= 0x100000 && point <= 0x10fffd);

/** The root viewBox, or 0 0 width height when only a viewport is stated. Numbers match the engine's canonical form. */
function rootViewBox(source: string): [number, number, number, number] | null {
  const doc = parseXml(source);
  const root = doc.documentElement;
  if (!root || doc.getElementsByTagName('parsererror').length) return null;
  const box = root.getAttribute('viewBox');
  const parts = box
    ? box.trim().split(/[\s,]+/).map(Number)
    : [0, 0, Number.parseFloat(root.getAttribute('width') ?? ''), Number.parseFloat(root.getAttribute('height') ?? '')];
  if (parts.length !== 4 || parts.some(part => !Number.isFinite(part)) || parts[2]! <= 0 || parts[3]! <= 0) return null;
  return [parts[0]!, parts[1]!, parts[2]!, parts[3]!];
}

interface Scanned {
  file: string; meaning: EmojiMeaningV1; label: string; creator: string;
  checksum: string; viewBox: [number, number, number, number]; alias: boolean; scalars: number;
}

interface Scan {
  kept: Scanned[]; files: number; sourceBytes: number; viaAlias: number;
  oversize: string[]; unparsable: string[]; unmapped: string[];
  duplicates: { key: string; kept: string; dropped: string }[];
  viewBoxes: Map<string, number>;
}

/** OpenMoji ships its own additions next to the Unicode set. Only the private-use ones become custom glyphs. */
async function openmojiExtras(item: Spec): Promise<Map<string, { annotation: string; author: string; group: string }>> {
  const out = new Map<string, { annotation: string; author: string; group: string }>();
  if (item.family !== 'OpenMoji') return out;
  const rows = JSON.parse(await readFile(`${item.root}/data/openmoji.json`, 'utf8')) as {
    hexcode: string; annotation: string; openmoji_author: string; group: string;
  }[];
  for (const row of rows) out.set(row.hexcode.toLowerCase(), { annotation: row.annotation, author: row.openmoji_author, group: row.group });
  return out;
}

async function scan(item: Spec): Promise<Scan> {
  const extras = await openmojiExtras(item);
  const dir = `${item.root}/${item.svgDir}`;
  const inventory = await sourceInventory(item);
  const names = [...inventory.keys()].sort();
  const result: Scan = { kept: [], files: names.length, sourceBytes: 0, viaAlias: 0, oversize: [], unparsable: [], unmapped: [], duplicates: [], viewBoxes: new Map() };
  const byMeaning = new Map<string, Scanned>();
  for (const file of names) {
    const bytes = await readFile(`${dir}/${file}`);
    result.sourceBytes += bytes.byteLength;
    if (bytes.byteLength > ARTWORK_MAX_BYTES) { result.oversize.push(file); continue; }
    const viewBox = rootViewBox(bytes.toString('utf8'));
    if (!viewBox) { result.unparsable.push(file); continue; }
    const points = inventory.get(file)!;
    const text = sequenceText(points);
    const sequence = text ? lookupEmojiSequence(text) : null;
    const hex = file.slice(0, -4).toLowerCase();
    const extra = extras.get(hex);
    let entry: Scanned | null = null;
    if (sequence) {
      entry = {
        file, meaning: { kind: 'unicode', key: sequence.key }, label: sequence.label,
        creator: extra ? `${extra.author} (OpenMoji)` : item.creator,
        checksum: digest(bytes), viewBox, alias: sequence.alias, scalars: points.length,
      };
      if (sequence.alias) result.viaAlias++;
    } else if (extra && Array.from(text ?? '').some(char => isPrivateUse(char.codePointAt(0)!))) {
      entry = {
        file, meaning: { kind: 'custom', id: `community/emoji/openmoji/extras/${hex}` }, label: extra.annotation,
        creator: `${extra.author} (OpenMoji)`, checksum: digest(bytes), viewBox, alias: false, scalars: points.length,
      };
    }
    if (!entry) { result.unmapped.push(file); continue; }
    result.viewBoxes.set(viewBox.join(' '), (result.viewBoxes.get(viewBox.join(' ')) ?? 0) + 1);
    const id = entry.meaning.kind === 'unicode' ? entry.meaning.key : entry.meaning.id;
    const prior = byMeaning.get(id);
    if (!prior) { byMeaning.set(id, entry); continue; }
    const winner = prior.alias !== entry.alias ? (prior.alias ? entry : prior) : prior.scalars >= entry.scalars ? prior : entry;
    byMeaning.set(id, winner);
    result.duplicates.push({ key: id, kept: winner.file, dropped: winner === prior ? entry.file : prior.file });
  }
  result.kept = [...byMeaning.values()].sort((a, b) => (a.file < b.file ? -1 : 1));
  return result;
}

function buildManifest(item: Spec, found: Scan, notices: { name: string; text: string }[]): EmojiPackManifestV1 {
  const ranked = [...found.viewBoxes].sort((a, b) => b[1] - a[1]);
  const parts = (ranked[0]?.[0] ?? '0 0 1 1').split(' ').map(Number);
  const metrics = (width: number, height: number) => ({ unitsPerEm: height, advance: width, baseline: height * BASELINE_RATIO });
  const fallback = metrics(parts[2]!, parts[3]!);
  const glyphs: EmojiGlyphV1[] = found.kept.map(entry => {
    const tail = entry.meaning.kind === 'unicode' ? entry.meaning.key : `extras/${entry.meaning.id.split('/').at(-1)}`;
    const own = metrics(entry.viewBox[2], entry.viewBox[3]);
    const glyph: EmojiGlyphV1 = {
      meaning: entry.meaning, label: entry.label,
      asset: {
        source: 'library', id: `${item.packId}/${tail}`, type: 'vector', format: 'svg', url: entry.file,
        pin: { version: item.version, format: 'svg' }, checksum: entry.checksum,
      },
      source: sourceRecord(item, entry.file, entry.creator),
      sourceChecksum: entry.checksum, viewBox: entry.viewBox,
    };
    if (own.unitsPerEm !== fallback.unitsPerEm || own.advance !== fallback.advance) glyph.metrics = own;
    return glyph;
  });
  return {
    schemaVersion: 1, minimumReader: 1, id: item.packId, family: item.family, style: item.style,
    version: item.version, unicodeVersion: '17.0', artwork: 'source-svg-v1', metrics: fallback,
    source: { ...sourceRecord(item, '', item.creator), sourceUrl: `${item.repo}/tree/${item.commit}` },
    notices, glyphs,
  };
}

interface Spread { p10: number; median: number; p90: number }
const quantile = (sorted: number[], at: number): number =>
  sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.round(at * (sorted.length - 1)))]! * 10000) / 10000 : 0;
function spread(values: number[]): Spread {
  const sorted = [...values].sort((a, b) => a - b);
  return { p10: quantile(sorted, 0.1), median: quantile(sorted, 0.5), p90: quantile(sorted, 0.9) };
}

/** The alpha bounding box of one canonical render, as fractions of the em box. */
function inkBox(markup: string): { width: number; height: number; centreX: number; centreY: number } | null {
  const image = new Resvg(markup, { fitTo: { mode: 'width', value: RENDER_PX }, font: { loadSystemFonts: false } }).render();
  const pixels = image.pixels;
  let left = image.width, right = -1, top = image.height, bottom = -1;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (pixels[(y * image.width + x) * 4 + 3]! < ALPHA_FLOOR) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < 0) return null;
  return {
    width: (right + 1 - left) / image.width, height: (bottom + 1 - top) / image.height,
    centreX: (left + right + 1) / 2 / image.width, centreY: (top + bottom + 1) / 2 / image.height,
  };
}

interface Ink {
  renderPx: number; alphaFloor: number; rendered: number; empty: number; blank: string[]; renderFailed: number;
  widthEm: Spread; heightEm: Spread; centreX: Spread; centreY: Spread;
}
/** Decoded pixel equality between the untouched source and its canonical markup, at one size. */
interface Fidelity { renderPx: number; equal: number; different: number; differing: string[]; renderFailed: number }
/** Glyphs whose rendering brought the reference rasteriser down (a native panic, not an error). */
interface RasterRun { isolated: true; crashes: number; crashed: string[] }
interface Admission {
  admitted: number; rejected: number; reasons: { message: string; count: number; examples: string[] }[];
  ink: Ink | { measured: false };
  fidelity: Fidelity | { verified: false };
  raster: RasterRun | { rendered: false };
}

function samePixels(source: Buffer, markup: string): boolean {
  const options = { fitTo: { mode: 'width' as const, value: RENDER_PX }, font: { loadSystemFonts: false } };
  const original = new Resvg(source, options).render();
  const canonical = new Resvg(markup, options).render();
  return original.width === canonical.width && original.height === canonical.height && Buffer.from(original.pixels).equals(Buffer.from(canonical.pixels));
}

interface RasterJob { file: string; markup: string; measure: boolean; verify: boolean }
interface RasterReply { id: number; ink?: ReturnType<typeof inkBox>; equal?: boolean; error?: string; crashed?: boolean }

/** The child side: one JSON job per stdin line, one JSON reply per stdout line. */
async function rasterWorker(): Promise<void> {
  for await (const line of createInterface({ input: process.stdin })) {
    const job = JSON.parse(line) as RasterJob & { id: number };
    const reply: RasterReply = { id: job.id };
    try {
      if (job.measure) reply.ink = inkBox(job.markup);
      if (job.verify) reply.equal = samePixels(await readFile(job.file), job.markup);
    } catch (error) { reply.error = error instanceof Error ? error.message : String(error); }
    process.stdout.write(`${JSON.stringify(reply)}\n`);
  }
}

/** The parent side: one worker at a time, respawned after a crash, with the crashed job reported as such. */
class RasterPool {
  private child: ChildProcess | null = null;
  private pending: { id: number; resolve: (reply: RasterReply) => void } | null = null;
  private next = 0;
  private spawn(): ChildProcess {
    const child = fork(process.argv[1]!, ['--raster-worker'], { stdio: ['pipe', 'pipe', 'ignore', 'ipc'] });
    createInterface({ input: child.stdout! }).on('line', (line) => {
      const reply = JSON.parse(line) as RasterReply;
      if (this.pending?.id !== reply.id) return;
      const { resolve } = this.pending;
      this.pending = null;
      resolve(reply);
    });
    child.on('exit', () => {
      if (this.child === child) this.child = null;
      const pending = this.pending;
      this.pending = null;
      pending?.resolve({ id: pending.id, crashed: true });
    });
    return child;
  }
  run(job: RasterJob): Promise<RasterReply> {
    this.child ??= this.spawn();
    const id = this.next++;
    return new Promise((resolve) => {
      this.pending = { id, resolve };
      this.child!.stdin!.write(`${JSON.stringify({ id, ...job })}\n`);
    });
  }
  close(): void {
    this.child?.stdin?.end();
    this.child?.kill();
    this.child = null;
  }
}

async function admitArtwork(item: Spec, pack: Awaited<ReturnType<typeof readEmojiPack>>, found: Scan, measure: boolean, verify: boolean): Promise<Admission> {
  if (!pack.ok) throw new Error(pack.issue.message);
  const counts = new Map<string, number>();
  const examples = new Map<string, string[]>();
  const widths: number[] = [], heights: number[] = [], centresX: number[] = [], centresY: number[] = [], blank: string[] = [], differing: string[] = [], crashed: string[] = [];
  let admitted = 0, rendered = 0, empty = 0, renderFailed = 0, done = 0, equal = 0, different = 0, compareFailed = 0;
  const pool = measure || verify ? new RasterPool() : null;
  for (const entry of found.kept) {
    const file = `${item.root}/${item.svgDir}/${entry.file}`;
    const bytes = await readFile(file);
    const prepared = await prepareEmojiSvg(pack.pack, entry.meaning, bytes, parseXml);
    if (!prepared.ok) {
      counts.set(prepared.message, (counts.get(prepared.message) ?? 0) + 1);
      const seen = examples.get(prepared.message) ?? [];
      if (seen.length < 5) seen.push(entry.file);
      examples.set(prepared.message, seen);
    } else {
      admitted++;
      if (pool) {
        const reply = await pool.run({ file, markup: emojiSvgMarkup(prepared.svg), measure, verify });
        if (reply.crashed) crashed.push(entry.file);
        else if (reply.error !== undefined) { if (measure) renderFailed++; if (verify) compareFailed++; }
        else {
          if (measure) {
            const box = reply.ink;
            if (!box) { empty++; if (blank.length < 5) blank.push(entry.file); }
            else { rendered++; widths.push(box.width); heights.push(box.height); centresX.push(box.centreX); centresY.push(box.centreY); }
          }
          if (verify) {
            if (reply.equal) equal++;
            else { different++; if (differing.length < 10) differing.push(entry.file); }
          }
        }
      }
    }
    if (++done % 500 === 0) process.stderr.write(`  ${item.slug}: ${done}/${found.kept.length}\n`);
  }
  pool?.close();
  return {
    admitted, rejected: found.kept.length - admitted,
    reasons: [...counts]
      .map(([message, count]) => ({ message, count, examples: examples.get(message) ?? [] }))
      .sort((a, b) => b.count - a.count),
    ink: measure
      ? {
          renderPx: RENDER_PX, alphaFloor: ALPHA_FLOOR, rendered, empty, blank, renderFailed,
          widthEm: spread(widths), heightEm: spread(heights), centreX: spread(centresX), centreY: spread(centresY),
        }
      : { measured: false },
    fidelity: verify ? { renderPx: RENDER_PX, equal, different, differing, renderFailed: compareFailed } : { verified: false },
    raster: pool ? { isolated: true, crashes: crashed.length, crashed } : { rendered: false },
  };
}

const scalarsOf = (key: string): number[] => key.split('-').map(part => Number.parseInt(part, 16));
const hasSkinTone = (points: number[]): boolean => points.some(point => point >= 0x1f3fb && point <= 0x1f3ff);
const isRegionalFlag = (points: number[]): boolean => points.length === 2 && points.every(point => point >= 0x1f1e6 && point <= 0x1f1ff);
const hasTag = (points: number[]): boolean => points.some(point => point >= 0xe0020 && point <= 0xe007f);
const hasKeycap = (points: number[]): boolean => points.includes(0x20e3);
const hasZwj = (points: number[]): boolean => points.includes(0x200d);

function coverage(found: Scan) {
  const supported = new Set(found.kept.flatMap(entry => (entry.meaning.kind === 'unicode' ? [entry.meaning.key] : [])));
  const missing = unicodeData.entries.filter(entry => !supported.has(entry.key)).map(entry => ({ key: entry.key, label: entry.label }));
  const bucket = (test: (points: number[]) => boolean): { supported: number; total: number } => {
    const all = unicodeData.entries.filter(entry => test(scalarsOf(entry.key)));
    return { supported: all.filter(entry => supported.has(entry.key)).length, total: all.length };
  };
  return {
    counts: {
      repertoire: unicodeData.entries.length, supported: supported.size, missing: missing.length,
      viaAlias: found.viaAlias, custom: found.kept.length - supported.size, unmapped: found.unmapped.length,
      skinTone: bucket(hasSkinTone), regionalFlag: bucket(isRegionalFlag), tagFlag: bucket(hasTag),
      keycap: bucket(hasKeycap), zwj: bucket(hasZwj),
    },
    missing,
  };
}

async function importFamily(item: Spec, measure: boolean, verify: boolean, outRoot: string) {
  const out = `${outRoot}/${item.slug}`;
  await mkdir(out, { recursive: true });
  const notices = await readNotices(item);
  const noticeReport = notices.map(notice => ({ name: notice.name, bytes: notice.bytes, checksum: notice.checksum }));
  const found = await scan(item);
  const manifest = buildManifest(item, found, notices.map(({ name, text }) => ({ name, text })));
  const bytes = jsonBytes(manifest);
  await writeFile(`${out}/manifest.json`, bytes);
  const pin = { id: manifest.id, pin: { version: manifest.version }, checksum: digest(bytes) };
  const pack = await readEmojiPack(bytes, pin);
  if (!pack.ok) {
    console.error(`${item.slug}: manifest was refused: ${pack.issue.code}: ${pack.issue.message}`);
    process.exitCode = 1;
    throw new Error(`${item.slug}: admission failed`);
  }
  await writeFile(`${out}/pack.lock.json`, jsonBytes({ directory: item.slug, pin, upstream: { repo: item.repo, commit: item.commit, svgDir: item.svgDir } }));
  const admission = await admitArtwork(item, pack, found, measure, verify);
  const counted = coverage(found);
  await writeFile(`${out}/missing.json`, jsonBytes(counted.missing));
  const ranked = [...found.viewBoxes].sort((a, b) => b[1] - a[1]);
  const report = {
    family: item.family, style: item.style, slug: item.slug, packId: item.packId, version: item.version,
    unicodeVersion: '17.0', upstream: { repo: item.repo, commit: item.commit, svgDir: item.svgDir },
    files: { total: found.files, mapped: found.kept.length, oversizeSkipped: found.oversize, unparsable: found.unparsable, unmapped: found.unmapped },
    licence: { license: item.license, licenseUrl: item.licenseUrl, notices: noticeReport },
    bytes: { source: found.sourceBytes, manifest: bytes.byteLength },
    duplicates: found.duplicates,
    viewBox: { default: manifest.metrics, variants: ranked.map(([box, count]) => ({ viewBox: box, count })), perGlyphMetrics: manifest.glyphs.filter(glyph => glyph.metrics).length },
    metricsNote: METRICS_NOTE,
    coverage: counted.counts,
    admission: { admitted: admission.admitted, rejected: admission.rejected, reasons: admission.reasons },
    ink: admission.ink,
    fidelity: admission.fidelity,
    raster: admission.raster,
    manifest: { path: `${out}/manifest.json`, checksum: pin.checksum, admitted: true },
  };
  await writeFile(`${out}/report.json`, jsonBytes(report));
  return report;
}

/**
 * The url the printed asset entry should carry. A bundle written into a SHARED asset
 * root (a directory a profile's `assets` list mounts) is served from that root's own
 * namespace on every profile, so its entry names /catalog/packs/<root>/<file>. A
 * bundle written inside a brand catalog keeps the catalog-relative url it always had.
 */
function entryUrl(outPath: string): string {
  const file = outPath.split('/').at(-1)!;
  for (const root of allAssetRoots({ root: ROOT })) {
    if (outPath === `${root.dir}/${file}`) return `/catalog/packs/${root.name}/${file}`;
  }
  return `/catalog/assets/emoji/${file}`;
}

/** One notice file as it travels: its name, its text, its byte length and the sha256 of its bytes. */
interface NoticeFile { name: string; text: string; bytes: number; checksum: string }

/**
 * A notice short enough to travel verbatim in an asset index entry, which every
 * client reads at boot. An Apache NOTICE is; a 20 KB CC legal code is not, so its
 * entry keeps the sha256 and the public url and the verbatim text travels in the
 * bundle's own manifest, where the pack is read from anyway.
 */
const NOTICE_INLINE_MAX_CHARS = 4096;

async function readNotices(item: Spec): Promise<NoticeFile[]> {
  const out: NoticeFile[] = [];
  for (const name of item.notices) {
    const bytes = await readFile(`${item.root}/${name}`);
    const text = bytes.toString('utf8');
    if (text.length > NOTICE_MAX_CHARS) throw new Error(`Notice ${name} exceeds the manifest limit.`);
    out.push({ name, text, bytes: bytes.byteLength, checksum: digest(bytes) });
  }
  return out;
}

/** The copyright line a notice states, when it states one. Never inferred from a repository or a family name. */
function noticeCopyright(notices: readonly NoticeFile[]): string | null {
  for (const notice of notices) {
    const first = notice.text.split('\n').map(line => line.trim()).find(line => /^copyright\b/i.test(line)) ?? '';
    if (/^copyright\b/i.test(first) && first.length <= 1024) return first;
  }
  return null;
}

/**
 * The family as one creative work, for the `rights` record on the index entry
 * (plan 253). The declaration is the upstream spelling; the canonical identifier
 * beside it comes from the engine's normaliser, so nothing here decides what a
 * licence is. The catalog is the asserting party because the catalog is who read
 * the upstream notice: the artwork carries no credential of its own.
 */
function rightsRecord(item: Spec, manifest: EmojiPackManifestV1, notices: readonly NoticeFile[]): { works: CreativeWorkRecordV1[] } {
  const normalised = normaliseLicence(item.license);
  const copyright = noticeCopyright(notices);
  const inline = notices.filter(notice => notice.text.length <= NOTICE_INLINE_MAX_CHARS).map(notice => notice.text);
  const evidence: RightsEvidenceV1 = {
    declaration: item.license,
    ...(normalised.id ? { expression: normalised.id } : {}),
    ...(normalised.version ? { version: normalised.version } : {}),
    url: item.licenseUrl,
    ...(notices[0] ? { textHash: notices[0].checksum } : {}),
    ...(copyright ? { copyright } : {}),
    ...(inline.length ? { notices: inline } : {}),
    assertedBy: 'catalog',
    evidence: 'notice-file',
    status: normalised.id ? 'parsed' : 'unparsed',
  };
  return {
    works: [{
      id: manifest.id,
      title: `${manifest.family} ${manifest.style} ${manifest.version}`,
      creators: [{ name: item.creator, role: 'creator' }],
      sourceUrl: `${item.repo}/tree/${item.commit}`,
      revision: item.commit,
      rights: [evidence],
    }],
  };
}

/** One glyph that is not in the bundle, and why. */
interface Absence { key: string; file: string; reason: string }

/** A manifest built over one set of glyphs and admitted by the engine. */
async function admitManifest(item: Spec, found: Scan, notices: readonly NoticeFile[]) {
  const manifest = buildManifest(item, found, notices.map(notice => ({ name: notice.name, text: notice.text })));
  // The manifest text is the pin: the sha256 below is what the index entry
  // advertises and what a host recomputes before it trusts a byte of the pack.
  const text = `${JSON.stringify(manifest)}\n`;
  const bytes = new TextEncoder().encode(text);
  const pin = { id: manifest.id, pin: { version: manifest.version }, checksum: digest(bytes) };
  const pack = await readEmojiPack(bytes, pin);
  if (!pack.ok) throw new Error(`${item.slug}: manifest was refused: ${pack.issue.code}: ${pack.issue.message}`);
  return { manifest, text, pin, pack: pack.pack };
}

interface BundleOptions {
  subset: string;
  outPath: string;
  /** Leave artwork the static subset refuses out of the bundle, and record why. */
  skipRefused: boolean;
  /** Canonical keys left out on purpose. */
  withhold: string[];
  withholdReason: string;
}

/**
 * One EmojiPackBundleV1 file: the exact manifest text plus every glyph's untouched
 * source SVG. Each glyph goes through the engine's static subset first, so a bundle
 * can never carry artwork the renderer would refuse, and its text is checked back to
 * the original bytes, so the sha256 a host recomputes from the bundle is the checksum
 * the manifest pins.
 *
 * Admission runs twice on purpose. The first pass is over a provisional manifest,
 * because a glyph can only be prepared against a pack that names it; the second is
 * over the manifest the bundle actually ships, so what is pinned and what is carried
 * are one pass over one set of glyphs.
 */
async function bundleFamily(item: Spec, options: BundleOptions): Promise<string> {
  const notices = await readNotices(item);
  const group = options.subset === 'all' ? null : SUBSETS[options.subset];
  if (options.subset !== 'all' && !group) throw new Error(`Unknown subset "${options.subset}". Known: ${Object.keys(SUBSETS).join(', ')}, all.`);
  const scanned = await scan(item);
  const found = group ? narrowScan(scanned, await subsetKeys(group)) : scanned;
  if (!found.kept.length) throw new Error(`${item.slug}: the subset matched no artwork in this family.`);
  // A cut-down pack is a different pack, so it takes its own id and style. Nothing can
  // then mistake 171 glyphs for the complete family under the same pin.
  const spec = group ? { ...item, packId: `${item.packId}-starter`, style: `${item.style} (starter)` } : item;

  // Withheld glyphs go first, so the manifest never pins artwork the bundle does not
  // carry. A key nobody carries is a typo, and a typo must not pass as a full set.
  const wanted = new Set(options.withhold);
  const withheld: Absence[] = [];
  const offered: Scanned[] = [];
  for (const entry of found.kept) {
    const key = meaningKey(entry.meaning);
    if (wanted.has(key)) withheld.push({ key, file: entry.file, reason: options.withholdReason });
    else offered.push(entry);
  }
  const unmatched = [...wanted].filter(key => !withheld.some(row => row.key === key));
  if (unmatched.length) throw new Error(`${item.slug}: nothing to withhold for ${unmatched.join(', ')}.`);

  const trial = await admitManifest(spec, withKept(found, offered), notices);
  const missing: Absence[] = [];
  const survivors: Scanned[] = [];
  for (const entry of offered) {
    const source = await readFile(`${item.root}/${item.svgDir}/${entry.file}`);
    const prepared = await prepareEmojiSvg(trial.pack, entry.meaning, source, parseXml);
    if (prepared.ok) { survivors.push(entry); continue; }
    if (!options.skipRefused) throw new Error(`${item.slug}: ${entry.file} was refused: ${prepared.message}`);
    missing.push({ key: meaningKey(entry.meaning), file: entry.file, reason: prepared.message });
  }
  if (!survivors.length) throw new Error(`${item.slug}: nothing was admitted.`);

  const { manifest, text, pin, pack } = await admitManifest(spec, withKept(found, survivors), notices);
  const artwork: Record<string, string> = {};
  for (const glyph of manifest.glyphs) {
    const source = await readFile(`${item.root}/${item.svgDir}/${glyph.asset.url}`);
    const prepared = await prepareEmojiSvg(pack, glyph.meaning, source, parseXml);
    if (!prepared.ok) throw new Error(`${item.slug}: ${glyph.asset.url} was refused: ${prepared.message}`);
    const svg = source.toString('utf8');
    if (!Buffer.from(svg, 'utf8').equals(source)) throw new Error(`${item.slug}: ${glyph.asset.url} is not UTF-8 text.`);
    artwork[glyph.asset.url] = svg;
  }
  const bundle: EmojiPackBundleV1 = { schemaVersion: 1, kind: 'emoji-pack-bundle', manifest: text, artwork };
  const file = new TextEncoder().encode(`${JSON.stringify(bundle)}\n`);
  await mkdir(resolve(options.outPath, '..'), { recursive: true });
  await writeFile(options.outPath, file);
  const supported = new Set(manifest.glyphs.flatMap(glyph => (glyph.meaning.kind === 'unicode' ? [glyph.meaning.key] : [])));
  const url = entryUrl(options.outPath);
  const entry = {
    id: manifest.id,
    name: `${manifest.family} ${manifest.style}`,
    type: 'data',
    version: manifest.version,
    tier: 'on-demand',
    tags: ['emoji-pack', 'emoji', manifest.family.toLowerCase()],
    license: item.license,
    attribution: item.attribution,
    rights: rightsRecord(item, manifest, notices),
    formats: [{ format: 'json', url }],
    meta: {
      emoji: {
        id: manifest.id,
        version: manifest.version,
        checksum: pin.checksum,
        family: manifest.family,
        style: manifest.style,
        label: `${manifest.family} ${manifest.style}`,
        glyphs: manifest.glyphs.length,
        coverageComplete: supported.size === unicodeData.entries.length,
        license: item.license,
        licenseUrl: item.licenseUrl,
        attribution: item.attribution,
        ...(missing.length ? { missing } : {}),
        ...(withheld.length ? { withheld } : {}),
      },
    },
  };
  const gzip = gzipSync(file).byteLength;
  console.log(`${manifest.id} ${manifest.version}: ${manifest.glyphs.length} glyphs, ${file.byteLength} bytes raw, ${gzip} bytes gzip at ${options.outPath}`);
  if (missing.length) console.log(`Refused by the static subset and left out: ${missing.length} (${missing.slice(0, 5).map(row => row.file).join(', ')})`);
  if (withheld.length) console.log(`Withheld on purpose: ${withheld.length} (${withheld.map(row => row.key).join(', ')})`);
  if (file.byteLength > EMOJI_BUNDLE_MAX_BYTES) {
    console.log(`This bundle is over the ${EMOJI_BUNDLE_MAX_BYTES} byte ceiling a host will read, so it cannot be registered as it stands.`);
  }
  console.log('Register this asset index entry, then run build:catalog to fill checksum, size and the added date:');
  console.log(JSON.stringify(entry, null, 2));
  return options.outPath;
}

function summarise(report: Awaited<ReturnType<typeof importFamily>>): string {
  const { files, coverage: cover, admission: admit, ink, fidelity, raster } = report;
  const note = 'widthEm' in ink
    ? ` Ink fills ${ink.widthEm.median} of the em box across and ${ink.heightEm.median} down at the median, centred at ${ink.centreY.median} vertically.`
    : ' Ink was not measured on this run.';
  const pixels = 'equal' in fidelity
    ? ` Canonical markup matched the source pixels for ${fidelity.equal} admitted glyphs at ${fidelity.renderPx} px; ${fidelity.different} differed and ${fidelity.renderFailed} could not be compared.`
    : ' Pixel fidelity was not verified on this run.';
  const crashes = 'crashes' in raster && raster.crashes
    ? ` The reference rasteriser crashed on ${raster.crashes} glyph${raster.crashes === 1 ? '' : 's'} (${raster.crashed.slice(0, 3).join(', ')}); those carry no raster claim.`
    : '';
  const top = admit.reasons.length ? ` (top reason: ${admit.reasons[0]!.message} x${admit.reasons[0]!.count})` : '';
  return `${report.family} ${report.style}: ${files.total} source files, ${files.mapped} kept (${cover.supported} of ${cover.repertoire} Unicode 17 keys, ${cover.missing} missing, ${cover.custom} custom, ${files.unmapped.length} unmapped). ` +
    `Flags ${cover.regionalFlag.supported}/${cover.regionalFlag.total}, skin tones ${cover.skinTone.supported}/${cover.skinTone.total}. ` +
    `Admission took ${admit.admitted} and refused ${admit.rejected}${top}.${note}${pixels}${crashes}`;
}

const args = process.argv.slice(2);
if (args.includes('--raster-worker')) {
  await rasterWorker();
  process.exit(0);
}
const measureRun = args.includes('--measure');
const verifyRun = args.includes('--verify');
const outFlag = args.find(arg => arg.startsWith('--out='));
const outRoot = outFlag ? resolve(outFlag.slice('--out='.length)) : `${ROOT}/dist/emoji-packs`;
const bundleFlag = args.find(arg => arg.startsWith('--bundle='));
const bundleOutFlag = args.find(arg => arg.startsWith('--bundle-out='));
const skipRefused = args.includes('--skip-refused');
const withholdFlag = args.find(arg => arg.startsWith('--withhold='));
const withholdReasonFlag = args.find(arg => arg.startsWith('--withhold-reason='));
const withhold = withholdFlag ? withholdFlag.slice('--withhold='.length).split(',').map(key => key.trim()).filter(Boolean) : [];
const withholdReason = withholdReasonFlag ? withholdReasonFlag.slice('--withhold-reason='.length).trim() : '';
if (withhold.length && !withholdReason) throw new Error('--withhold needs --withhold-reason=<text>: a glyph left out on purpose records why.');
const named = args.find(arg => !arg.startsWith('--'));
if (!named || (named !== 'all' && !SPECS[named])) {
  throw new Error(`Usage: node scripts/import-emoji-pack.ts <${Object.keys(SPECS).join('|')}|all> [--measure] [--verify] [--out=dir] [--bundle=<${Object.keys(SUBSETS).join('|')}|all>] [--bundle-out=file] [--skip-refused] [--withhold=<key,key> --withhold-reason=<text>]`);
}
if (bundleFlag && named === 'all') throw new Error('Bundle one family at a time, not all.');
for (const slug of named === 'all' ? Object.keys(SPECS) : [named]) {
  const item = SPECS[slug]!;
  if (bundleFlag) {
    const subset = bundleFlag.slice('--bundle='.length);
    const out = bundleOutFlag ? resolve(bundleOutFlag.slice('--bundle-out='.length)) : `${outRoot}/${item.slug}/bundle.json`;
    await bundleFamily(item, { subset, outPath: out, skipRefused, withhold, withholdReason });
    continue;
  }
  console.log(summarise(await importFamily(item, measureRun, verifyRun, outRoot)));
}
