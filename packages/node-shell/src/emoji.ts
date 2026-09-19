// SPDX-License-Identifier: MPL-2.0
/** The Node host's pinned emoji packs: catalog bundle files on disk in, exact manifest and artwork bytes out. */
import { readFile, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import type { EmojiAPI } from '@lolly-tools/core/host-v1';
import { EMOJI_BUNDLE_MAX_BYTES } from '@lolly-tools/core/emoji-v1';
import type { EmojiGlyphV1, EmojiPackBundleV1, EmojiPackPinV1, EmojiSetInfoV1 } from '@lolly-tools/core/emoji-v1';
import { contentUrlFile, readAssetIndex } from './content-roots.ts';

/** The catalog tag that makes an asset an emoji pack. Nothing else is listed as a set. */
export const EMOJI_PACK_TAG = 'emoji-pack';

/** A bundle is a manifest plus every glyph's artwork, so it carries its own ceiling. */
const BUNDLE_MAX_BYTES = EMOJI_BUNDLE_MAX_BYTES;
const inflateBundle = promisify(gunzip);

/** Server packages may hold the same bundle compressed, with both reads bounded. */
async function bundleText(file: string): Promise<string | null> {
  try {
    if ((await stat(file)).size > BUNDLE_MAX_BYTES) return null;
    return await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return null;
  }
  try {
    const compressed = `${file}.gz`;
    if ((await stat(compressed)).size > BUNDLE_MAX_BYTES) return null;
    const bytes = await inflateBundle(await readFile(compressed), { maxOutputLength: BUNDLE_MAX_BYTES });
    return bytes.toString('utf8');
  } catch { return null; }
}

/** What an asset index entry states about a pack before anything reads its bytes. */
interface EmojiEntryMeta {
  id: string;
  version: string;
  checksum: string;
  family: string;
  style: string;
  label: string;
  glyphs: number;
  coverageComplete?: boolean;
  license: string;
  licenseUrl: string;
  attribution: string;
}

interface CatalogAsset {
  id: string;
  tags?: string[];
  formats?: { format?: string; url?: string; size?: number }[];
  meta?: { emoji?: unknown };
}

export interface NodeEmojiOptions {
  /** The catalog whose assets index lists the packs. Defaults to the active profile's. */
  catalogDir?: string;
  /**
   * A non-networked XML parser. Defaults to jsdom's DOMParser, imported once here.
   * A shell that already owns a window (the CLI does) can hand its own in instead, so
   * one process never builds two DOM implementations.
   */
  parseXml?: (source: string) => unknown;
}

/** True only for a complete `meta.emoji` block. A half-written entry is not offered as a set. */
function readEntryMeta(value: unknown): EmojiEntryMeta | null {
  if (!value || typeof value !== 'object') return null;
  const meta = value as Record<string, unknown>;
  const strings = ['id', 'version', 'checksum', 'family', 'style', 'label', 'license', 'licenseUrl', 'attribution'];
  if (strings.some((name) => typeof meta[name] !== 'string' || !(meta[name] as string))) return null;
  if (typeof meta.glyphs !== 'number' || !Number.isInteger(meta.glyphs) || meta.glyphs < 1) return null;
  if (!/^sha256:[0-9a-f]{64}$/.test(meta.checksum as string)) return null;
  return meta as unknown as EmojiEntryMeta;
}

const pinKey = (pin: EmojiPackPinV1): string => JSON.stringify([pin.id, pin.pin?.version, pin.checksum]);

/**
 * A file inside the given catalog directory, or null. The relative part comes off
 * an index entry, so it is data: a `..` in it must not be able to name a file
 * outside the catalog the caller pointed at.
 */
function insideCatalog(catalogDir: string, relative: string): string | null {
  const root = resolve(catalogDir);
  const file = resolve(root, relative);
  return file === root || file.startsWith(root + sep) ? file : null;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** jsdom's DOMParser, loaded once. Node has no built-in XML parser, and the engine
 *  insists the host supply one that performs no network access. */
async function jsdomParser(): Promise<(source: string) => unknown> {
  let JSDOM: typeof import('jsdom').JSDOM;
  try { ({ JSDOM } = await import('jsdom')); }
  catch { throw new Error('Emoji packs need an XML parser: install jsdom, or pass parseXml.'); }
  const parser = new (new JSDOM('').window.DOMParser)();
  return (source: string) => parser.parseFromString(source, 'image/svg+xml');
}

/**
 * Read the packs this profile's catalog mounts. The host owns storage and transport
 * only: which sets exist, the exact bytes of a manifest and of each glyph's source
 * SVG, and an XML parser. What to draw is the engine's decision on every shell.
 */
export async function createNodeEmojiAPI(options: NodeEmojiOptions = {}): Promise<EmojiAPI> {
  const parseXml = options.parseXml ?? (await jsdomParser());
  const catalogDir = options.catalogDir;
  // With no catalogDir this is the MERGED index: the active profile's brand entries
  // plus every shared asset root's, so a pack mounted once outside the brands is
  // listed on every profile (plan 252). An explicit catalogDir still reads that one
  // directory's file and nothing else, which is what the containment test relies on.
  const loadIndex = async (): Promise<{ assets?: CatalogAsset[] }> => (catalogDir
    ? JSON.parse(await readFile(`${catalogDir.replace(/\/+$/, '')}/assets/index.json`, 'utf8')) as { assets?: CatalogAsset[] }
    : readAssetIndex() as { assets?: CatalogAsset[] });
  const bundles = new Map<string, Promise<EmojiPackBundleV1 | null>>();
  let listed: { asset: CatalogAsset; meta: EmojiEntryMeta }[] | null = null;

  async function entries(): Promise<{ asset: CatalogAsset; meta: EmojiEntryMeta }[]> {
    if (listed) return listed;
    let index: { assets?: CatalogAsset[] };
    try { index = await loadIndex(); }
    catch {
      listed = [];
      return listed;
    }
    const found: { asset: CatalogAsset; meta: EmojiEntryMeta }[] = [];
    for (const asset of index.assets ?? []) {
      if (!asset?.tags?.includes(EMOJI_PACK_TAG)) continue;
      const meta = readEntryMeta(asset.meta?.emoji);
      if (meta) found.push({ asset, meta });
    }
    listed = found;
    return listed;
  }

  /** The entry a pin names exactly. Id, version and checksum must all agree; a host
   *  holding a different release of the same set answers nothing, never a substitute. */
  async function entryFor(pin: EmojiPackPinV1): Promise<{ asset: CatalogAsset; meta: EmojiEntryMeta } | null> {
    if (!pin?.id || !pin.pin?.version || !pin.checksum) return null;
    const found = await entries();
    return found.find((entry) =>
      entry.meta.id === pin.id && entry.meta.version === pin.pin.version && entry.meta.checksum === pin.checksum) ?? null;
  }

  async function fetchBundle(pin: EmojiPackPinV1): Promise<EmojiPackBundleV1 | null> {
    const entry = await entryFor(pin);
    const url = entry?.asset.formats?.find((format) => format.format === 'json')?.url;
    if (!url) return null;
    const file = options.catalogDir
      ? insideCatalog(options.catalogDir, url.replace(/^\/catalog\//, ''))
      : contentUrlFile(url) ?? contentUrlFile(`${url}.gz`)?.slice(0, -3);
    if (!file) return null;
    let parsed: unknown;
    try {
      const text = await bundleText(file);
      if (text === null) return null;
      parsed = JSON.parse(text);
    }
    catch { return null; }
    const bundle = parsed as EmojiPackBundleV1;
    if (bundle?.schemaVersion !== 1 || bundle.kind !== 'emoji-pack-bundle') return null;
    if (typeof bundle.manifest !== 'string' || !bundle.artwork || typeof bundle.artwork !== 'object' || Array.isArray(bundle.artwork)) return null;
    // What the pin actually promises: the manifest text inside this file hashes to it.
    if (`sha256:${await sha256Hex(new TextEncoder().encode(bundle.manifest))}` !== pin.checksum) return null;
    // A glyph url is looked up by name on an object straight out of JSON.parse, so
    // the prototype goes: an own-property read is what the repo does everywhere
    // else it keys into parsed data, and there is no reason for this one to differ.
    Object.setPrototypeOf(bundle.artwork, null);
    return bundle;
  }

  function bundleFor(pin: EmojiPackPinV1): Promise<EmojiPackBundleV1 | null> {
    const key = pinKey(pin);
    let hit = bundles.get(key);
    if (!hit) {
      hit = fetchBundle(pin).catch(() => null);
      bundles.set(key, hit);
    }
    return hit;
  }

  return {
    async sets(): Promise<EmojiSetInfoV1[]> {
      const found = await entries();
      return found.map(({ asset, meta }) => {
        const size = asset.formats?.find((format) => format.format === 'json')?.size;
        return {
          pin: { id: meta.id, pin: { version: meta.version }, checksum: meta.checksum },
          family: meta.family,
          style: meta.style,
          label: meta.label,
          license: meta.license,
          licenseUrl: meta.licenseUrl,
          attribution: meta.attribution,
          glyphs: meta.glyphs,
          coverageComplete: meta.coverageComplete === true,
          ...(typeof size === 'number' ? { bytes: size } : {}),
        };
      });
    },

    async manifest(pin: EmojiPackPinV1): Promise<Uint8Array | null> {
      const bundle = await bundleFor(pin);
      return bundle ? new TextEncoder().encode(bundle.manifest) : null;
    },

    async artwork(pin: EmojiPackPinV1, asset: EmojiGlyphV1['asset']): Promise<Uint8Array | null> {
      const bundle = await bundleFor(pin);
      const key = asset?.url ?? '';
      const svg = bundle && Object.hasOwn(bundle.artwork, key) ? bundle.artwork[key] : null;
      return typeof svg === 'string' ? new TextEncoder().encode(svg) : null;
    },

    parseXml,
  };
}
