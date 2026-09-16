// SPDX-License-Identifier: MPL-2.0
import type { AssetRef } from '@lolly-tools/core/host-v1';

interface ModelUploadHost {
  assets: {
    get(id: string): Promise<AssetRef>;
    _uploadUserAsset(record: {
      id: string;
      type: 'model';
      format: string;
      blob: Blob;
      version: string;
      meta: Record<string, unknown>;
    }): Promise<void>;
  };
}

/** Store mesh bytes for reusable sessions; other files continue through their importer. */
export async function tryStoreModelUpload(
  host: ModelUploadHost,
  file: File
): Promise<AssetRef | null> {
  if (!/\.(glb|stl)$/i.test(file.name) && file.type !== 'model/gltf-binary') return null;
  if (!file.size || file.size > 32 * 1024 * 1024)
    throw new Error('Use a model between 1 byte and 32 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const format = /\.stl$/i.test(file.name) ? 'stl' : 'glb';
  const view = new DataView(bytes.buffer);
  if (format === 'glb') {
    if (
      bytes.length < 20 ||
      view.getUint32(0, true) !== 0x46546c67 ||
      view.getUint32(4, true) !== 2 ||
      view.getUint32(8, true) !== bytes.length
    )
      throw new Error('Use a valid glTF 2.0 binary (.glb) file.');
  } else {
    const binary = bytes.length >= 84 && 84 + view.getUint32(80, true) * 50 === bytes.length;
    const ascii =
      /^\s*solid\b/i.test(new TextDecoder().decode(bytes.subarray(0, 256))) &&
      /\bfacet\s+normal\b/i.test(new TextDecoder().decode(bytes.subarray(0, 4096)));
    if (!binary && !ascii) throw new Error('Use a binary or ASCII STL mesh.');
  }
  const id = `user/upload/${crypto.randomUUID()}-${file.name.replace(/[^a-z0-9.-]/gi, '_')}`;
  await host.assets._uploadUserAsset({
    id,
    type: 'model',
    format,
    blob: file,
    version: '1.0.0',
    meta: { name: file.name, tags: ['3d'], size: file.size },
  });
  return host.assets.get(id);
}
