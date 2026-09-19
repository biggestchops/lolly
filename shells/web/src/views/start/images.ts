// SPDX-License-Identifier: MPL-2.0
/**
 * start: images.
 *
 * Every function takes the shared `start: StartCtx` first (see context.ts). Sibling
 * calls in this file are direct; a call into another module, and every use of a
 * function as a value (an event listener), goes through `start.<module>.<fn>`. Extracted verbatim
 * from mountStart() by scripts/split-closure.ts.
 */
import { extractSvgColors, imageColorCloud } from '@lolly/engine';
import { tRaw } from '../../i18n.ts';
import { censusFromImageCloud, censusFromSvgColors } from '../../lib/design-system/census.ts';
import type { DesignCensus } from '../../lib/design-system/census.ts';
import { IMAGE_MAX_BYTES, condenseColors } from './shared.ts';
import { bindOp, type StartCtx } from './context.ts';

/** A screenshot or a photo as colour candidates. The decoder is imported on
 *  demand - it drags in the bitmap/codec chunk, which has no business in the
 *  studio's entry chunk (the Colour Lab does the same, for the same reason). */
export const scanImageFile = async (start: StartCtx, 
  file: File,
  note?: (msg: string, isError?: boolean) => void
): Promise<void> => {
  start.reference.cancelReference();
  const revision = start.referenceRevision;
  const stage = start.importModal?.el.querySelector<HTMLElement>('[data-ds-stage="image"]');
  stage?.querySelector('[data-reference-review]')?.remove();
  stage?.classList.remove('has-reference-review');
  const current = (): boolean => start.referenceRevision === revision && !!stage?.isConnected && !stage.hidden;
  const isSvg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
  const limit = isSvg ? 2 * 1024 * 1024 : IMAGE_MAX_BYTES;
  if (file.size > limit) {
    note?.(
      tRaw('{filename} is too large (max {n} MB).', {
        filename: file.name,
        n: Math.round(limit / (1024 * 1024)),
      }),
      true
    );
    return;
  }
  // The decode is the only step that can fail because of the FILE, so it is the
  // only step inside this catch - a storage failure keeping candidates must not
  // report back as "that image could not be read".
  let census: DesignCensus;
  try {
    if (isSvg) {
      census = censusFromSvgColors(extractSvgColors(await file.text()), file.name);
    } else {
    const { sampleImageFile } = await import('../../lib/image-sample.ts');
    const img = await sampleImageFile(file);
    const cloud = imageColorCloud(img.data, img.width, img.height, {
      space: img.space,
      maxPoints: 256,
    });
    census = condenseColors(censusFromImageCloud(cloud, file.name));
    }
  } catch {
    if (!current()) return;
    note?.(tRaw('{filename} could not be read as an image.', { filename: file.name }), true);
    return;
  }
  if (!current()) return;
  start.reference.reviewReference(census, { method: isSvg ? 'svg' : 'image', label: file.name });
};
export function imagesOps(start: StartCtx) {
  return {
    scanImageFile: bindOp(start, scanImageFile),
  };
}
