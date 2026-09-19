// SPDX-License-Identifier: MPL-2.0
/** True float still export; the caller keeps metadata and C2PA orchestration. */
import { exportDeepFrame } from '../../../../engine/src/deep-export.ts';
import { drawDeep } from '../../../../engine/src/deep-compose.ts';
import { fromU8Srgb, type DeepFrame } from '../../../../engine/src/pixels.ts';
import { runJxl } from './jxl.ts';
import type { ExportOpts } from './export-shared.ts';
import { tRaw } from '../i18n.ts';
export async function renderDeepExport(opts: ExportOpts, format: string): Promise<Blob> {
  const input = opts.deepFrame!;
  let frame: DeepFrame = { ...input, space: input.space ?? 'srgb-linear' };
  if (opts.watermark) {
    const canvas = new OffscreenCanvas(frame.width, frame.height), ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not render the draft mark.');
    ctx.fillStyle = 'rgba(118,118,118,.5)'; ctx.font = `bold ${Math.max(14, frame.width/7)}px monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(tRaw('DRAFT'), frame.width/2, frame.height/2);
    frame = { ...frame, data: new Float32Array(frame.data) };
    drawDeep(frame, { frame: fromU8Srgb(ctx.getImageData(0,0,frame.width,frame.height).data,frame.width,frame.height) });
  }
  if (opts.durable) throw new Error('Durable pixel credentials are not yet available for float exports. Turn off Durable or export an SDR copy.');
  return exportDeepFrame({ ...frame, space: input.space }, format, opts, {
    jxl: request => runJxl(request),
    async sdr(data,width,height,format,options) {
      const mime = ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif' } as Record<string,string>)[format];
      if (!mime) throw new Error(`Float editing cannot export ${format}. Choose a raster still format.`);
      const canvas = new OffscreenCanvas(width,height), ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('SDR export is unavailable.');
      ctx.putImageData(new ImageData(new Uint8ClampedArray(data),width,height),0,0);
      const blob = await canvas.convertToBlob({ type: mime, quality: options.quality });
      if (blob.type !== mime) throw new Error(`This browser cannot encode ${mime}.`);
      const { insertJpegExif, insertJpegXmp, insertWebpMeta, insertAvifExif } = await import('./export-image-meta.ts');
      let bytes = new Uint8Array(await blob.arrayBuffer());
      bytes = (mime === 'image/jpeg' ? insertJpegXmp(insertJpegExif(bytes,options.meta),options.meta) : mime === 'image/webp' ? insertWebpMeta(bytes,options.meta) : insertAvifExif(bytes,options.meta)) as Uint8Array<ArrayBuffer>;
      return new Blob([bytes], { type: mime });
    },
  });
}

export async function renderDesignOrFrame(node:Element,format:string,opts:ExportOpts,host:import('@lolly-tools/core/host-v1').HostV1|null):Promise<Blob> {
  if (!opts.deepFrame) {
    if (!host) throw new Error('HDR Design export requires the host bridge.');
    const deepFrame = await (await import('./deep-design.ts')).renderDeepDesign(node,opts,host);
    opts = {...opts,deepFrame,width:deepFrame.width,height:deepFrame.height,scale:1};
  }
  return renderDeepExport(opts,format);
}
