// SPDX-License-Identifier: MPL-2.0
/**
 * Bake each registered emoji pack's five specimen glyphs into its catalog entry.
 *
 * WHY. A pack bundle is 15 to 20 MB. Drawing a five-glyph specimen on a catalog
 * tile used to mean downloading the whole set, so opening the Emoji sets section
 * pulled about 50 MB for artwork nobody had chosen to use yet. The five glyphs are
 * the same five every time, so they are prepared once, here, and travel in the
 * asset index. The bundle then loads only when a document actually uses the set.
 *
 * WHAT IS STORED. `meta.emoji.specimen` maps each glyph's canonical key to the
 * prepared SVG markup for that glyph, and `meta.emoji.specimenOf` records the pack
 * checksum it was prepared from, so a specimen can never outlive the pack it came
 * from. The markup is what the engine's own pass would place: the bytes go through
 * `readEmojiPack` (so a tampered bundle is refused here as it would be on a device)
 * and `prepareEmojiText` (the static SVG subset, the single-ink rewrite that binds a
 * monochrome set's black paints to the surrounding text colour, and the placement id
 * prefix). Nothing is invented and nothing is drawn a second way.
 *
 * The five characters are read out of the shared control's own `EMOJI_SPECIMEN`
 * constant rather than repeated here, so one edit there moves every surface.
 *
 * Idempotent: a second run over an unchanged pack writes the same bytes.
 *
 *   node scripts/emoji-pack-specimens.ts            # report what would change (exit 1 on drift)
 *   node scripts/emoji-pack-specimens.ts --write    # write the specimens into the index
 */
import { readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import type { EmojiPackPinV1, EmojiStyleV1 } from '@lolly-tools/core/emoji-v1';
import { prepareEmojiText } from '../engine/src/emoji-inline.ts';
import type { EmojiTextIO } from '../engine/src/emoji-inline.ts';
import { readEmojiPack } from '../engine/src/emoji-pack.ts';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const PACK_ROOT = resolve(ROOT, 'community/emoji-packs');
const INDEX_FILE = resolve(PACK_ROOT, 'index.json');
const CONTROL_FILE = resolve(ROOT, 'shells/web/src/components/emoji-style-control.ts');

/** The prefix a catalog specimen's placement ids carry, keyed to the pack so two sets
 *  drawn into one page can never mint the same id. The same string
 *  `emojiSpecimenScope` builds in shells/web/src/lib/emoji-specimen.ts, with the DOM
 *  pass's own work-item suffix (`0`, the first text node) on the end. */
export const specimenPrefix = (checksum: string): string =>
  `cat_${checksum.replace(/^sha256:/, '').slice(0, 8)}0`;

/**
 * The five specimen characters, read out of the shared control's source.
 *
 * Read rather than imported: the control pulls its own stylesheet, so importing it
 * outside a bundler needs a CSS stub. Reading the one line keeps this script
 * dependency-free and still fails loudly the moment the constant moves.
 */
export function specimenTextFrom(source: string): string {
  const line = /export const EMOJI_SPECIMEN = '([^']*)'/.exec(source);
  if (!line) throw new Error('EMOJI_SPECIMEN is no longer a single-quoted constant in emoji-style-control.ts.');
  // The constant is written in escapes so that file carries no literal emoji; this
  // turns those escapes back into the characters, and admits nothing else.
  if (!/^(?:\\u\{[0-9A-Fa-f]{1,6}\}|\\u[0-9A-Fa-f]{4})+$/.test(line[1]!)) {
    throw new Error('EMOJI_SPECIMEN carries something other than unicode escapes.');
  }
  return line[1]!.replace(/\\u\{([0-9A-Fa-f]{1,6})\}|\\u([0-9A-Fa-f]{4})/g,
    (_all, braced: string | undefined, plain: string | undefined) => String.fromCodePoint(parseInt(braced ?? plain!, 16)));
}

interface PackEntry {
  id: string;
  formats?: { format?: string; url?: string }[];
  meta?: { emoji?: Record<string, unknown> };
}

/** The bundle file an entry points at, kept inside the pack root: a url is data. */
export function bundleFileFor(url: string): string | null {
  const name = basename(url);
  if (!name || name === '.' || name === '..') return null;
  const file = resolve(PACK_ROOT, name);
  return file.startsWith(`${PACK_ROOT}/`) ? file : null;
}

const sha256Hex = async (bytes: Uint8Array): Promise<string> =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource)),
    (byte) => byte.toString(16).padStart(2, '0')).join('');

const styleFor = (pin: EmojiPackPinV1): EmojiStyleV1 => ({
  schemaVersion: 1, primary: pin, fallbacks: [], metricsPolicy: 'inline-em-v1',
  treatment: { mode: 'original', strengthBps: 0 },
});

/** The prepared artwork for one pack's specimen characters, in the order they are written. */
export async function prepareSpecimen(
  bundle: { manifest: string; artwork: Record<string, string> },
  pin: EmojiPackPinV1,
  text: string,
  parseXml: (source: string) => Document,
): Promise<Record<string, string>> {
  const encoder = new TextEncoder();
  const read = await readEmojiPack(encoder.encode(bundle.manifest), pin);
  if (!read.ok) throw new Error(`${pin.id}: ${read.issue.message}`);
  const io: EmojiTextIO = {
    async loadArtwork(_pin, asset) {
      const svg = Object.hasOwn(bundle.artwork, asset.url) ? bundle.artwork[asset.url] : undefined;
      if (typeof svg !== 'string') throw new Error(`artwork missing: ${asset.id}`);
      return encoder.encode(svg);
    },
    parseXml,
  };
  const prepared = await prepareEmojiText(text, styleFor(pin), [read.pack], io, { prefix: specimenPrefix(pin.checksum) });
  const out: Record<string, string> = {};
  for (const segment of prepared.segments) {
    if (segment.kind !== 'emoji') continue;
    out[segment.key] = segment.markup;
  }
  const wanted = prepared.segments.filter((segment) => segment.kind !== 'text').length;
  if (Object.keys(out).length !== wanted) throw new Error(`${pin.id}: a specimen glyph could not be prepared.`);
  return out;
}

async function main(): Promise<void> {
  const write = process.argv.includes('--write');
  const text = specimenTextFrom(await readFile(CONTROL_FILE, 'utf8'));
  const raw = await readFile(INDEX_FILE, 'utf8');
  const index = JSON.parse(raw) as { assets: PackEntry[] };
  const { DOMParser } = new JSDOM('').window;
  const parseXml = (source: string): Document => new DOMParser().parseFromString(source, 'image/svg+xml') as unknown as Document;

  let changed = 0;
  for (const entry of index.assets) {
    const meta = entry.meta?.emoji;
    if (!meta || typeof meta.checksum !== 'string' || typeof meta.version !== 'string') continue;
    const url = entry.formats?.find((format) => format.format === 'json')?.url ?? '';
    const file = bundleFileFor(url);
    if (!file) throw new Error(`${entry.id}: no bundle file for ${url || '(no url)'}`);
    const bundle = JSON.parse(await readFile(file, 'utf8')) as { manifest: string; artwork: Record<string, string> };
    const checksum = `sha256:${await sha256Hex(new TextEncoder().encode(bundle.manifest))}`;
    if (checksum !== meta.checksum) throw new Error(`${entry.id}: the bundle's manifest hashes to ${checksum}, the entry pins ${String(meta.checksum)}`);
    const pin: EmojiPackPinV1 = { id: entry.id, pin: { version: meta.version }, checksum };
    const specimen = await prepareSpecimen(bundle, pin, text, parseXml);
    const same = meta.specimenOf === checksum && JSON.stringify(meta.specimen) === JSON.stringify(specimen);
    const bytes = JSON.stringify(specimen).length;
    console.log(`${entry.id}: ${Object.keys(specimen).length} glyphs, ${bytes} bytes${same ? ' (unchanged)' : ''}`);
    if (same) continue;
    changed++;
    meta.specimen = specimen;
    meta.specimenOf = checksum;
  }

  if (!changed) { console.log('Specimens are up to date.'); return; }
  if (!write) {
    console.error(`${changed} entr${changed === 1 ? 'y' : 'ies'} would change. Re-run with --write.`);
    process.exitCode = 1;
    return;
  }
  const next = `${JSON.stringify(index, null, 2)}\n`;
  await writeFile(INDEX_FILE, next, 'utf8');
  console.log(`Wrote ${changed} specimen${changed === 1 ? '' : 's'} (${raw.length} to ${next.length} bytes).`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
