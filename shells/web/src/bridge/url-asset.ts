// SPDX-License-Identifier: MPL-2.0
/** Resolve external media only when a tool asks for it. */
import type { AssetRef } from '@lolly-tools/core/host-v1';

/** MIME → the AssetRef type vocabulary. SVG is vector; other images raster. */
function urlAssetType(mime: string): { type: AssetRef['type']; format: string } | null {
  const m = mime.toLowerCase().split(';')[0]!.trim();
  if (m === 'image/svg+xml') return { type: 'vector', format: 'svg' };
  if (m.startsWith('image/')) return { type: 'raster', format: m.slice(6).replace('jpeg', 'jpg') };
  if (m.startsWith('video/')) return { type: 'video', format: m.slice(6) };
  if (m.startsWith('audio/')) return { type: 'audio', format: m.slice(6).replace('mpeg', 'mp3') };
  return null;
}

/** Direct-URL assets (see get()): one object URL per remote id for the page's
 *  lifetime, so re-resolves (every input edit re-runs resolveAssetRefs) don't
 *  refetch or leak a new blob URL each time. */
const urlAssetCache = new Map<string, AssetRef>();
const URL_ASSET_TIMEOUT_MS = 20_000;
const URL_ASSET_MAX_BYTES = 64 * 1024 * 1024;   // a poster-sized fetch, not a runaway

export async function resolveUrlAsset(id: string): Promise<AssetRef> {
  const hit = urlAssetCache.get(id);
  if (hit) return hit;
  let ref: AssetRef;
  if (/^data:/i.test(id)) {
    // Inline bytes: the id IS the url (the CSP admits data: in img-src), no
    // fetch and no object URL to manage. Type straight off the data: MIME.
    const mime = /^data:([^;,]+)/i.exec(id)?.[1] ?? '';
    const kind = urlAssetType(mime);
    if (!kind) throw new Error(`Unsupported data: asset type: ${mime || 'unknown'}`);
    ref = { source: 'remote', id, type: kind.type, format: kind.format, url: id };
  } else {
    const res = await fetch(id, { signal: AbortSignal.timeout(URL_ASSET_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`URL asset fetch failed (${res.status}): ${id}`);
    const blob = await res.blob();
    if (blob.size > URL_ASSET_MAX_BYTES) throw new Error(`URL asset too large (${Math.round(blob.size / 1048576)} MB): ${id}`);
    // Content-type first; a served-as-octet-stream file falls back to its extension.
    const ext = /\.([a-z0-9]{2,5})(?:[?#]|$)/i.exec(id)?.[1]?.toLowerCase();
    const isJxl = (await import('../../../../engine/src/jxl.ts')).isJxl(new Uint8Array(await blob.slice(0, 12).arrayBuffer()));
    const kind = (isJxl ? { type: 'raster' as const, format: 'jxl' } : urlAssetType(blob.type))
      ?? (ext ? urlAssetType(ext === 'svg' ? 'image/svg+xml' : ext === 'mp3' ? 'audio/mpeg' : ext === 'mp4' || ext === 'webm' ? `video/${ext}` : `image/${ext}`) : null);
    if (!kind) throw new Error(`Unsupported URL asset type (${blob.type || 'unknown'}): ${id}`);
    ref = { source: 'remote', id, type: kind.type, format: kind.format, url: URL.createObjectURL(blob) };
  }
  if (ref.format === 'jxl') {
    const source = await fetch(ref.url).then(response => response.blob());
    ref = await (await import('./jxl.ts')).jxlAssetRef(ref, source);
  }
  urlAssetCache.set(id, ref);
  return ref;
}
