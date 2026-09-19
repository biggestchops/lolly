// SPDX-License-Identifier: MPL-2.0
/** Keeps durable encoded bytes separate from the sRGB display representation. */
import type { AssetRef } from '@lolly-tools/core/host-v1';
import { isJxl } from '../../../engine/src/jxl.ts';
import { packPng } from '../../../engine/src/png.ts';
import { runJxl } from './jxl.ts';
export async function prepareJxlAsset(ref: AssetRef, bytes: Uint8Array): Promise<AssetRef> {
  if (!isJxl(bytes)) return ref;
  const decoded = await runJxl({ operation: 'decode', bytes });
  const info = (await runJxl({ operation: 'probe', bytes })).info!;
  const png = packPng(decoded.bytes, { width: decoded.info!.width, height: decoded.info!.height, channels: 4, depth: 8 });
  return { ...ref, type: 'raster', format: 'jxl', original: { url: ref.url, format: 'jxl' }, url: `data:image/png;base64,${Buffer.from(png).toString('base64')}`, width: info.width, height: info.height, meta: { ...ref.meta, jxl: info, displayFormat: 'png', displayDepth: 8, displayColorSpace: 'srgb' } };
}
