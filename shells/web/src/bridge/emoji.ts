// SPDX-License-Identifier: MPL-2.0
/** The web host's pinned emoji packs: one catalog bundle asset in, exact manifest and artwork bytes out. */
import type { AssetsAPI, EmojiAPI } from '@lolly-tools/core/host-v1';
import type { EmojiGlyphV1, EmojiPackBundleV1, EmojiPackPinV1, EmojiSetInfoV1 } from '@lolly-tools/core/emoji-v1';
import { sha256Hex } from '../../../../engine/src/bytes.ts';

/** The catalog tag that makes an asset an emoji pack. Nothing else is listed as a set. */
export const EMOJI_PACK_TAG = 'emoji-pack';

/** A bundle is a manifest plus every glyph's artwork, so it carries its own ceiling. */
const BUNDLE_MAX_BYTES = 32 * 1024 * 1024;

/** What an asset index entry states about a pack before anything downloads it. */
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

/** The assets surface this module needs. Narrow on purpose, so a test can stand in for it. */
export type EmojiAssets = Pick<AssetsAPI, 'query' | 'get' | 'bytes'>;

const pinKey = (pin: EmojiPackPinV1): string => JSON.stringify([pin.id, pin.pin?.version, pin.checksum]);

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

interface Entry {
  assetId: string;
  meta: EmojiEntryMeta;
  bytes?: number;
}

export function createEmojiAPI(assets: EmojiAssets): EmojiAPI {
  // Parsed bundles, keyed by pin. A refusal caches as null so a bad pack is not
  // re-fetched on every glyph of a paragraph.
  const bundles = new Map<string, Promise<EmojiPackBundleV1 | null>>();

  async function entries(): Promise<Entry[]> {
    const refs = await assets.query({ tags: [EMOJI_PACK_TAG] });
    const found: Entry[] = [];
    for (const ref of refs) {
      const meta = readEntryMeta((ref.meta as { emoji?: unknown } | undefined)?.emoji);
      if (!meta) continue;
      const size = (ref.meta as { size?: unknown } | undefined)?.size;
      found.push({ assetId: ref.id, meta, bytes: typeof size === 'number' ? size : undefined });
    }
    return found;
  }

  /** The entry a pin names exactly. Id, version and checksum must all agree; a host
   *  holding a different release of the same set answers nothing, never a substitute. */
  async function entryFor(pin: EmojiPackPinV1): Promise<Entry | null> {
    if (!pin?.id || !pin.pin?.version || !pin.checksum) return null;
    const found = await entries();
    return found.find((entry) =>
      entry.meta.id === pin.id && entry.meta.version === pin.pin.version && entry.meta.checksum === pin.checksum) ?? null;
  }

  async function fetchBundle(pin: EmojiPackPinV1): Promise<EmojiPackBundleV1 | null> {
    const entry = await entryFor(pin);
    if (!entry) return null;
    // `bytes` is optional on the contract, so a host without a byte reader simply
    // has no packs. That is never a reason to reach for anything else.
    if (!assets.bytes) return null;
    // Refused BEFORE the download, because that is the only moment the ceiling
    // means anything: `bytes()` materialises the whole file, then the decode and
    // the parse each copy it again.
    if (entry.bytes !== undefined && entry.bytes > BUNDLE_MAX_BYTES) return null;
    // The catalog checksum is checked by the asset bridge as it fetches an on-demand
    // file. What is checked below is the thing the pin actually promises: that the
    // manifest text inside the bundle hashes to it.
    const ref = await assets.get(entry.assetId, { format: 'json' });
    const bytes = await assets.bytes(ref);
    if (!bytes.byteLength || bytes.byteLength > BUNDLE_MAX_BYTES) return null;
    let parsed: unknown;
    try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { return null; }
    const bundle = parsed as EmojiPackBundleV1;
    if (bundle?.schemaVersion !== 1 || bundle.kind !== 'emoji-pack-bundle') return null;
    if (typeof bundle.manifest !== 'string' || !bundle.artwork || typeof bundle.artwork !== 'object' || Array.isArray(bundle.artwork)) return null;
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
      return found.map((entry) => ({
        pin: { id: entry.meta.id, pin: { version: entry.meta.version }, checksum: entry.meta.checksum },
        family: entry.meta.family,
        style: entry.meta.style,
        label: entry.meta.label,
        license: entry.meta.license,
        licenseUrl: entry.meta.licenseUrl,
        attribution: entry.meta.attribution,
        glyphs: entry.meta.glyphs,
        coverageComplete: entry.meta.coverageComplete === true,
        ...(entry.bytes !== undefined ? { bytes: entry.bytes } : {}),
      }));
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

    parseXml(source: string): unknown {
      return new DOMParser().parseFromString(source, 'image/svg+xml');
    },
  };
}
