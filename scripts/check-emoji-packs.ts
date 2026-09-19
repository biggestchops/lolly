#!/usr/bin/env node
// SPDX-License-Identifier: MPL-2.0
/** Audit local emoji pack snapshots, pinned notices and exact artwork bytes. Never downloads assets.
 *
 *    node scripts/check-emoji-packs.ts [--lock=path/to/packs.lock.json]
 *    node scripts/check-emoji-packs.ts --bundle=path/to/bundle.json [--entry=path/to/assets/index.json]
 *
 *  The bundle form audits one catalog-shipped pack file: it parses, the manifest text's
 *  sha256 is the pin the asset index declares, the engine admits the manifest, every
 *  artwork key is a glyph url whose bytes hash to that glyph's checksum, and the glyph
 *  count is the one the index advertises. That is the whole contract a shell relies on
 *  before it hands a byte of this to a renderer.
 *
 *  A pack may also leave a glyph out: `meta.emoji.missing` records artwork the engine
 *  refused (an upstream defect) and `meta.emoji.withheld` records a glyph left out on
 *  purpose. Both are accepted, and both are checked rather than taken on trust: every
 *  row needs a key and a reason, and a key the entry calls absent must really be absent
 *  from the manifest.
 *
 *  A baked specimen (`meta.emoji.specimen`, written by scripts/emoji-pack-specimens.ts)
 *  is artwork lifted out of a pack so a catalog tile can draw a set without downloading
 *  15 to 20 MB. That is only honest while the two agree, so `checkEmojiPackSpecimen`
 *  refuses a `specimenOf` that is not the bundle's own manifest checksum and a key the
 *  bundle has no glyph for. An entry with no specimen is not an error: the web shell
 *  falls back to loading the pack. The bare run audits every registered entry's specimen
 *  after the lock, and validate-catalog runs the same check beside the bundle audit.
 */
import { readFile, realpath, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EMOJI_BUNDLE_MAX_BYTES } from '../packages/core/src/emoji-v1.ts';
import type { EmojiPackBundleV1, EmojiPackPinV1 } from '../packages/core/src/emoji-v1.ts';
import { readEmojiPack, inspectEmojiPack, verifyEmojiArtwork } from '../engine/src/emoji-pack.ts';
import { sha256Hex } from '../engine/src/bytes.ts';
import data from '../engine/src/emoji-data/17.0.json' with { type: 'json' };

async function localBytes(root: string, name: string): Promise<Uint8Array> {
  if (isAbsolute(name) || /^[a-z]+:/i.test(name)) throw new Error('Pack audit requires relative local file paths.');
  const target = await realpath(resolve(root, name));
  const inside = relative(root, target);
  if (inside === '..' || inside.startsWith('../') || inside.startsWith('..\\') || isAbsolute(inside)) throw new Error('Pack path escapes its local snapshot.');
  if ((await stat(target)).size > EMOJI_BUNDLE_MAX_BYTES) throw new Error('Pack file exceeds the audit byte limit.');
  return readFile(target);
}

/** One glyph the pack does not carry, and the reason the entry gives for it. */
interface EmojiAbsence { key?: unknown; file?: unknown; reason?: unknown }

/** What the asset index says about one pack, before anything downloads it. */
interface EmojiEntryMeta {
  id: string; version: string; checksum: string; glyphs: number;
  family?: string; style?: string; label?: string; coverageComplete?: boolean;
  license?: string; licenseUrl?: string; attribution?: string;
  /** Artwork the engine refused, and glyphs left out on purpose. */
  missing?: unknown; withheld?: unknown;
}

/** The most absences an entry may list. A pack that leaves this many glyphs out is a different pack. */
const MAX_ABSENCES = 1024;

/**
 * One list of absences, checked against what the manifest actually carries. A
 * record that a glyph is absent is only worth keeping if it is true and says
 * why, so a row with no reason, or a row naming a glyph the pack carries, is an
 * error rather than a note.
 */
function countAbsences(rows: unknown, kind: 'missing' | 'withheld', carried: ReadonlySet<string>): number {
  if (rows === undefined) return 0;
  if (!Array.isArray(rows) || rows.length > MAX_ABSENCES) throw new Error(`Index entry's ${kind} must be a list of at most ${MAX_ABSENCES} rows.`);
  for (const row of rows as EmojiAbsence[]) {
    const key = row?.key;
    if (typeof key !== 'string' || !key) throw new Error(`Index entry's ${kind} needs a key on every row.`);
    if (typeof row.reason !== 'string' || !row.reason.trim()) throw new Error(`Index entry lists ${key} as ${kind} with no reason.`);
    if (carried.has(key)) throw new Error(`Index entry lists ${key} as ${kind}, but the manifest carries it.`);
  }
  return rows.length;
}

/** The `meta.emoji` block of the asset index entry that registers this bundle file.
 *  Matched on the file name, not the whole url, because the same bundle is registered
 *  at /catalog/assets/emoji/<file> by a brand catalog and at
 *  /catalog/packs/<root>/<file> by a shared asset root. */
async function indexEntry(indexPath: string, file: string): Promise<EmojiEntryMeta | null> {
  let raw: string;
  try { raw = await readFile(indexPath, 'utf8'); } catch { return null; }
  const index = JSON.parse(raw) as { assets?: { tags?: string[]; formats?: { url?: string }[]; meta?: { emoji?: EmojiEntryMeta } }[] };
  const found = (index.assets ?? []).find(asset =>
    asset.tags?.includes('emoji-pack') && (asset.formats ?? []).some(format => basename(format.url ?? '') === file));
  return found?.meta?.emoji ?? null;
}

/** One bundle file audited against the entry that registers it. Throws on the first
 *  thing that does not hold; returns the summary the CLI prints and validate-catalog
 *  keeps. */
export async function auditBundle(bundlePath: string, entryPath: string | null): Promise<Record<string, unknown>> {
  if ((await stat(bundlePath)).size > EMOJI_BUNDLE_MAX_BYTES) throw new Error('Bundle exceeds the audit byte limit.');
  const file = await readFile(bundlePath);
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(file)); }
  catch { throw new Error('Bundle is not valid UTF-8 JSON.'); }
  const bundle = parsed as EmojiPackBundleV1;
  if (bundle?.schemaVersion !== 1 || bundle.kind !== 'emoji-pack-bundle') throw new Error('Bundle is not an emoji-pack-bundle v1.');
  if (typeof bundle.manifest !== 'string' || !bundle.artwork || typeof bundle.artwork !== 'object' || Array.isArray(bundle.artwork)) {
    throw new Error('Bundle needs a manifest string and an artwork map.');
  }
  const manifestBytes = new TextEncoder().encode(bundle.manifest);
  const checksum = `sha256:${await sha256Hex(manifestBytes)}`;
  // The entry is what a shell trusts before it downloads anything, so audit against it
  // when it is there. Beside the bundle is where a brand catalog keeps it.
  const meta = await indexEntry(entryPath ?? resolve(dirname(bundlePath), '..', 'index.json'), basename(bundlePath));
  if (meta && meta.checksum !== checksum) throw new Error(`Manifest sha256 ${checksum} is not the index entry's ${meta.checksum}.`);
  const pin: EmojiPackPinV1 = meta
    ? { id: meta.id, pin: { version: meta.version }, checksum }
    : (() => {
        const header = JSON.parse(bundle.manifest) as { id: string; version: string };
        return { id: header.id, pin: { version: header.version }, checksum };
      })();
  const result = await readEmojiPack(manifestBytes, pin);
  if (!result.ok) throw new Error(`${result.issue.code}: ${result.issue.message}`);
  const manifest = inspectEmojiPack(result.pack)!;
  const urls = new Set(manifest.glyphs.map(glyph => glyph.asset.url));
  for (const key of Object.keys(bundle.artwork)) {
    if (!urls.has(key)) throw new Error(`Bundle carries artwork "${key}" that no glyph names.`);
  }
  for (const glyph of manifest.glyphs) {
    const svg = bundle.artwork[glyph.asset.url];
    if (typeof svg !== 'string') throw new Error(`Bundle is missing artwork for ${glyph.asset.url}.`);
    const verified = await verifyEmojiArtwork(result.pack, glyph.meaning, new TextEncoder().encode(svg));
    if (!verified.ok) throw new Error(`${glyph.asset.url}: ${verified.issue.code}: ${verified.issue.message}`);
  }
  if (meta && meta.glyphs !== manifest.glyphs.length) throw new Error(`Index entry advertises ${meta.glyphs} glyphs; the manifest has ${manifest.glyphs.length}.`);
  const supported = new Set(manifest.glyphs.flatMap(glyph => (glyph.meaning.kind === 'unicode' ? [glyph.meaning.key] : [])));
  const carried = new Set(manifest.glyphs.map(glyph => (glyph.meaning.kind === 'unicode' ? glyph.meaning.key : glyph.meaning.id)));
  const missing = countAbsences(meta?.missing, 'missing', carried);
  const withheld = countAbsences(meta?.withheld, 'withheld', carried);
  return {
    bundle: bundlePath, id: manifest.id, version: manifest.version, checksum,
    glyphs: manifest.glyphs.length, artwork: Object.keys(bundle.artwork).length,
    bytes: file.byteLength, sourceLicense: manifest.source.license,
    coverageComplete: supported.size === data.entries.length,
    missing, withheld,
    entry: meta ? 'checked' : 'no asset index entry found, so the pin and glyph count were not cross-checked',
  };
}

interface LockedPack {
  directory: string;
  pin: EmojiPackPinV1;
  files: Record<string, { url: string; checksum: string }>;
}

/** The snapshot form: every locked upstream clone, its notices and its artwork bytes. */
async function auditLock(lockPath: string): Promise<void> {
  const base = await realpath(dirname(lockPath));
  const locks: unknown = JSON.parse(new TextDecoder().decode(await localBytes(base, relative(base, lockPath))));
  if (!Array.isArray(locks) || !locks.length || locks.length > 64) throw new Error('Lock must list 1 to 64 local packs.');
  for (const lock of locks as LockedPack[]) {
    if (!lock || typeof lock.directory !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(lock.directory)) throw new Error('Invalid locked pack directory.');
    const root = await realpath(resolve(base, lock.directory));
    if (dirname(root) !== base) throw new Error('Pack directory escapes the lock directory.');
    const result = await readEmojiPack(await localBytes(root, 'manifest.json'), lock.pin);
    if (!result.ok) throw new Error(`${lock.directory}: ${result.issue.code}: ${result.issue.message}`);
    const manifest = inspectEmojiPack(result.pack)!;
    if (!lock.files || typeof lock.files !== 'object' || Array.isArray(lock.files) || Object.keys(lock.files).length > 20064) throw new Error('Invalid locked source files.');
    for (const [name, file] of Object.entries(lock.files)) {
      if (`sha256:${await sha256Hex(await localBytes(root, name))}` !== file.checksum) throw new Error(`${lock.directory}: source file checksum differs: ${name}`);
    }
    for (const glyph of manifest.glyphs) {
      const verified = await verifyEmojiArtwork(result.pack, glyph.meaning, await localBytes(root, glyph.asset.url));
      if (!verified.ok) throw new Error(`${lock.directory}: ${verified.issue.code}: ${verified.issue.message}`);
    }
    const supported = new Set(manifest.glyphs.flatMap(glyph => glyph.meaning.kind === 'unicode' ? [glyph.meaning.key] : []));
    console.log(JSON.stringify({ id: manifest.id, version: manifest.version, unicodeVersion: data.version, supported: supported.size, repertoire: data.entries.length, missing: data.entries.filter(entry => !supported.has(entry.key)).length, custom: manifest.glyphs.length - supported.size, sourceLicense: manifest.source.license, artwork: manifest.artwork, coverageComplete: supported.size === data.entries.length }));
  }
}

/** What the bundle on disk actually says, for the specimen check. */
export interface EmojiPackFacts {
  /** sha256 of the bundle's manifest text, in `sha256:<hex>` form. */
  manifestChecksum: string;
  /** Every meaning key the bundle's manifest carries a glyph for. */
  glyphKeys: ReadonlySet<string>;
}

/** The meaning key one manifest glyph answers to: a Unicode sequence, or a pack's own symbol id. */
export function glyphKeyOf(glyph: unknown): string | null {
  const meaning = (glyph as { meaning?: { kind?: string; key?: string; id?: string } } | null)?.meaning;
  if (!meaning || typeof meaning !== 'object') return null;
  if (meaning.kind === 'unicode' && typeof meaning.key === 'string') return meaning.key;
  if (meaning.kind === 'custom' && typeof meaning.id === 'string') return meaning.id;
  return null;
}

/**
 * Every reason this entry's baked specimen may not ship, in plain sentences. An
 * empty list means the entry is either specimen-free or agrees with its bundle.
 */
export function checkEmojiPackSpecimen(meta: Record<string, unknown> | null | undefined, facts: EmojiPackFacts): string[] {
  const issues: string[] = [];
  if (!meta || typeof meta !== 'object') return ['meta.emoji is missing.'];
  const specimen = meta.specimen;
  const specimenOf = meta.specimenOf;
  if (specimen === undefined && specimenOf === undefined) return issues;   // no specimen is not a defect
  if (specimenOf !== facts.manifestChecksum) {
    issues.push(`meta.emoji.specimenOf is ${specimenOf === undefined ? 'missing' : String(specimenOf)}, but the bundle's manifest hashes to ${facts.manifestChecksum}. Re-run scripts/emoji-pack-specimens.ts --write.`);
  }
  if (typeof meta.checksum === 'string' && meta.checksum !== facts.manifestChecksum) {
    issues.push(`meta.emoji.checksum is ${meta.checksum}, but the bundle's manifest hashes to ${facts.manifestChecksum}.`);
  }
  if (!specimen || typeof specimen !== 'object' || Array.isArray(specimen)) {
    issues.push('meta.emoji.specimen is not an object of glyph key to markup.');
    return issues;
  }
  const entries = Object.entries(specimen as Record<string, unknown>);
  if (!entries.length) issues.push('meta.emoji.specimen is empty.');
  for (const [key, markup] of entries) {
    if (!facts.glyphKeys.has(key)) issues.push(`meta.emoji.specimen carries "${key}", which this bundle has no glyph for.`);
    if (typeof markup !== 'string' || !markup.startsWith('<svg')) issues.push(`meta.emoji.specimen["${key}"] is not SVG markup.`);
  }
  return issues;
}

/** Read one bundle and say what it really holds, for the specimen check. Same byte limit as the audit. */
export async function readPackFacts(bundlePath: string): Promise<EmojiPackFacts> {
  if ((await stat(bundlePath)).size > EMOJI_BUNDLE_MAX_BYTES) throw new Error('Bundle exceeds the audit byte limit.');
  const bundle = JSON.parse(await readFile(bundlePath, 'utf8')) as { manifest?: string };
  if (typeof bundle.manifest !== 'string') throw new Error(`${basename(bundlePath)} carries no manifest.`);
  const manifest = JSON.parse(bundle.manifest) as { glyphs?: unknown[] };
  const glyphKeys = new Set<string>();
  for (const glyph of manifest.glyphs ?? []) {
    const key = glyphKeyOf(glyph);
    if (key) glyphKeys.add(key);
  }
  return { manifestChecksum: `sha256:${await sha256Hex(new TextEncoder().encode(bundle.manifest))}`, glyphKeys };
}

/** Every registered entry's baked specimen, against the bundle beside the index. */
async function auditRegisteredSpecimens(indexPath: string): Promise<string[]> {
  const root = dirname(indexPath);
  const index = JSON.parse(await readFile(indexPath, 'utf8')) as {
    assets?: { id: string; tags?: string[]; formats?: { url?: string }[]; meta?: { emoji?: Record<string, unknown> } }[];
  };
  const lines: string[] = [];
  for (const entry of index.assets ?? []) {
    if (!entry.tags?.includes('emoji-pack') || !entry.meta?.emoji) continue;
    const name = basename(entry.formats?.[0]?.url ?? '');
    if (!name) throw new Error(`${entry.id}: no bundle url.`);
    const issues = checkEmojiPackSpecimen(entry.meta.emoji, await readPackFacts(resolve(root, name)));
    if (issues.length) throw new Error(`${entry.id}: ${issues.join(' ')}`);
    const specimen = entry.meta.emoji.specimen;
    const drawn = specimen && typeof specimen === 'object' ? Object.keys(specimen as object).length : 0;
    lines.push(`${entry.id}: ${drawn} specimen glyph(s) agree with ${name}.`);
  }
  return lines;
}

// Run the audit only as a command. validate-catalog.ts imports auditBundle to run the
// bundle half over every emoji-pack entry it finds, and must not audit the pinned
// snapshots as a side effect of that import.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const bundleArg = args.find(arg => arg.startsWith('--bundle='));
  const entryArg = args.find(arg => arg.startsWith('--entry='));
  if (bundleArg) {
    const report = await auditBundle(
      resolve(bundleArg.slice('--bundle='.length)),
      entryArg ? resolve(entryArg.slice('--entry='.length)) : null,
    );
    console.log(JSON.stringify(report));
    process.exit(0);
  }
  if (args.length > 1 || (args[0] && !args[0].startsWith('--lock='))) throw new Error('Usage: node scripts/check-emoji-packs.ts [--lock=path/to/packs.lock.json] [--bundle=path/to/bundle.json [--entry=path/to/assets/index.json]]');
  await auditLock(args[0] ? resolve(args[0].slice('--lock='.length)) : fileURLToPath(new URL('../tests/fixtures/emoji/packs.lock.json', import.meta.url)));
  // The shared pack root is absent on a checkout that has not generated the packs;
  // that is not a failure, the lock audit above is the whole answer there.
  const registered = fileURLToPath(new URL('../community/emoji-packs/index.json', import.meta.url));
  const hasRegistered = await stat(registered).then(() => true, () => false);
  if (hasRegistered) for (const line of await auditRegisteredSpecimens(registered)) console.log(line);
}

