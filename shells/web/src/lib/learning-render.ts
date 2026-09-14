// SPDX-License-Identifier: MPL-2.0
import type { LearningBlock } from '@lolly-tools/core/learning-v1';
import type { LearningBytes } from '../../../../engine/src/learning/compile.ts';
import { learningRenditions } from '../../../../engine/src/learning/delivery.ts';
import type { PickerHost } from '../views/picker.ts';
import { learningReader } from './learning-entry.ts';
import { renderRowToBlob, renderToolPages } from '../pro/render-export.ts';

async function blobBytes(blob: Blob): Promise<LearningBytes> {
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type };
}
export async function resolveLearningBlock(
  host: PickerHost,
  block: LearningBlock,
  signal?: AbortSignal
): Promise<LearningBytes[]> {
  signal?.throwIfAborted();
  const source = block.source;
  if (!source) throw new Error('Choose a source for this content.');
  if (source.kind === 'session' && source.toolId && source.values) {
    const manifest = await learningReader(host).tool(source.toolId);
    const rendition = learningRenditions(manifest).find((r) => r.kind === block.kind);
    if (!rendition)
      throw new Error(
        'This tool cannot export the chosen content type on this device. Choose another rendition or import a finished file.'
      );
    const row = { toolId: source.toolId, values: source.values } as Parameters<
      typeof renderRowToBlob
    >[0];
    if (block.kind === 'slides') {
      const result = await renderToolPages(row, host, { format: rendition.format, signal });
      if (result.format !== rendition.format)
        throw new Error('The renderer changed the requested format.');
      return Promise.all(result.pages.map(blobBytes));
    }
    const frames =
      block.kind === 'video' && Array.isArray(source.values.boxes)
        ? source.values.boxes.filter(
            (box): box is Record<string, unknown> =>
              !!box && typeof box === 'object' && box.kind === 'frame' && !box.hidden
          )
        : [];
    const frame = frames[0];
    if (frame && frames.some((f) => f.w !== frame.w || f.h !== frame.h))
      throw new Error(
        'Use equally sized frames for a course video, or export a finished video and add that file.'
      );
    const dimensions =
      frame &&
      typeof frame.w === 'number' &&
      typeof frame.h === 'number' &&
      frame.w > 0 &&
      frame.h > 0
        ? { width: frame.w, height: frame.h }
        : {};
    const rendered = await renderRowToBlob(row, host, {
      format: rendition.format,
      ...dimensions,
      embedMeta: false,
      c2pa: false,
      signal,
    });
    if (rendered.format !== rendition.format)
      throw new Error('The renderer changed the requested format.');
    return [await blobBytes(rendered.blob)];
  }
  if (!source.asset || source.asset.source === 'remote')
    throw new Error('Import this content onto your device before packaging.');
  const asset = await host.assets.get(source.asset.id, {
    format: source.asset.pin?.format || source.asset.format,
    version: source.asset.pin?.version || source.asset.version,
  });
  const response = await fetch(asset.url, { signal });
  if (!response.ok) throw new Error('A source file is unavailable. Replace it using Add content.');
  let blob = await response.blob();
  if (asset.type === 'vector') {
    const svg = new DOMParser().parseFromString(await blob.text(), 'image/svg+xml');
    if (
      svg.querySelector('parsererror, script, foreignObject') ||
      [...svg.querySelectorAll('*')].some((el) =>
        [...el.attributes].some(
          (a) =>
            ['href', 'src'].includes(a.localName) &&
            !a.value.startsWith('#') &&
            !/^data:image\/(png|jpeg|webp);base64,/.test(a.value)
        )
      ) ||
      /@import|url\(\s*['"]?(?!#|data:)[^)]/i.test(svg.documentElement.textContent || '')
    )
      throw new Error(
        'This SVG has unsupported or external content. Export it as a PNG from its source tool first.'
      );
    // Rasterise imported SVG in an image context, where scripts and remote resources cannot run.
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = Math.min(4096, img.naturalWidth || 1920);
      canvas.height = Math.max(
        1,
        Math.round((canvas.width * (img.naturalHeight || 1080)) / (img.naturalWidth || 1920))
      );
      if (canvas.height > 8192)
        throw new Error('This image is too tall. Resize it before packaging.');
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      blob = await new Promise<Blob>((yes, no) =>
        canvas.toBlob(
          (b) => (b ? yes(b) : no(new Error('The image could not be prepared.'))),
          'image/png'
        )
      );
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  return [await blobBytes(blob)];
}
