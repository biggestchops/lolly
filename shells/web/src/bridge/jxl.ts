// SPDX-License-Identifier: MPL-2.0
/** Lazy, serial worker delivery. Original encoded assets never become previews. */
import type { ExportOpts } from './export-shared.ts';
import type { AssetRef } from '@lolly-tools/core/host-v1';
import { JXL_LIMITS, validateJxlRequest, type JxlRequest, type JxlResult, type JxlInfo, type JxlEncodeOptions } from '../../../../engine/src/jxl.ts';
import { packPng } from '../../../../engine/src/png.ts';
let queue = Promise.resolve();
let pending = 0;
export function runJxl(request: JxlRequest, signal?: AbortSignal): Promise<JxlResult> {
  validateJxlRequest(request); signal?.throwIfAborted();
  if (pending >= 24) return Promise.reject(new Error('Too many JPEG XL operations are waiting. Try again when they finish.'));
  pending++;
  const task = queue.then(() => runWorker(request, signal));
  queue = task.then(() => {}, () => {}).finally(() => { pending--; });
  if (!signal) return task;
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    task.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
function runWorker(request: JxlRequest, signal?: AbortSignal): Promise<JxlResult> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./jxl.worker.ts', import.meta.url), { type: 'module' });
    let settled = false;
    const finish = (error?: unknown, result?: JxlResult): void => {
      if (settled) return; settled = true;
      clearTimeout(timer); signal?.removeEventListener('abort', abort); worker.terminate();
      error ? reject(error) : resolve(result!);
    };
    const abort = () => finish(signal?.reason ?? new Error('JPEG XL operation cancelled.'));
    const timer = setTimeout(() => finish(new Error('JPEG XL operation exceeded its two-minute budget.')), JXL_LIMITS.budgetMs);
    signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = event => finish(new Error(event.message || 'JPEG XL worker could not start.'));
    worker.onmessage = ({ data }: MessageEvent<{ result?: JxlResult; error?: string }>) => finish(data.error ? new Error(data.error) : data.result ? undefined : new Error('JPEG XL returned no result.'), data.result);
    worker.postMessage(request);
  });
}
export async function jxlDisplay(file: Blob, signal?: AbortSignal): Promise<{ blob: Blob; info: JxlInfo }> {
  const { bytes, info } = await runJxl({ operation: 'decode', bytes: new Uint8Array(await file.arrayBuffer()) }, signal);
  const png = packPng(bytes, { width: info!.width, height: info!.height, channels: 4, depth: 8 });
  return { blob: new Blob([png as BlobPart], { type: 'image/png' }), info: info! };
}
export async function encodeJxlCanvas(canvas: HTMLCanvasElement | OffscreenCanvas, options: JxlEncodeOptions = {}, signal?: AbortSignal): Promise<Blob> {
  if (canvas.width * canvas.height > JXL_LIMITS.encodePixels || canvas.width > JXL_LIMITS.edge || canvas.height > JXL_LIMITS.edge) throw new Error('JPEG XL encoding is limited to 8 megapixels and 16384 pixels per edge.');
  const context = (canvas as HTMLCanvasElement).getContext('2d');
  if (!context) throw new Error('JPEG XL needs readable image pixels.');
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const result = await runJxl({ operation: 'encode', bytes: new Uint8Array(pixels.buffer), width: canvas.width, height: canvas.height, options }, signal);
  return new Blob([result.bytes as BlobPart], { type: 'image/jxl' });
}

/** Prepare display pixels lazily, retaining the encoded source and cache ownership. */
export async function jxlAssetRef(ref: AssetRef, blob: Blob, cache?: Map<string, string>, key = ''): Promise<AssetRef> {
  let url = cache?.get(key);
  let info: JxlInfo | undefined;
  if (!url) {
    const display = await jxlDisplay(blob);
    info = display.info;
    url = URL.createObjectURL(display.blob);
    cache?.set(key, url);
  }
  return { ...ref, original: { url: ref.url, format: 'jxl' }, url, width: ref.width ?? info?.width, height: ref.height ?? info?.height, meta: { ...ref.meta, ...(info && !ref.meta?.jxl ? { jxl: info } : {}), displayFormat: 'png', displayDepth: 8, displayColorSpace: 'srgb' } };
}

/** Apply supported export policy before rendering, then add descriptive metadata. */
export async function renderJxlExport(render: () => Promise<Blob>, opts: ExportOpts): Promise<Blob> {
  if (opts.hdr || opts.depth && opts.depth !== 8) throw new Error('JPEG XL render export currently supplies 8-bit sRGB pixels.');
  if (opts.c2pa) throw new Error('JPEG XL Content Credentials are unavailable. Choose PNG for a signed export.');
  const blob = await render();
  const { jxlWithXmp } = await import('../../../../engine/src/jxl-container.ts');
  const { buildExportXmp } = await import('../../../../engine/src/image-meta.ts');
  return new Blob([jxlWithXmp(new Uint8Array(await blob.arrayBuffer()), buildExportXmp(opts.meta)) as BlobPart], { type: 'image/jxl' });
}
