// SPDX-License-Identifier: MPL-2.0
/**
 * Serial, cancellable contact-sheet rendering through one leased GPU context.
 *
 * The whole set's asset keys are passed to every update as `retain`, so each item's
 * geometry stays loaded while its neighbours render. Twelve icons are twelve reads and
 * no disposals until the lease ends, instead of twelve reads and twelve disposals.
 */
import { buildStudioScene } from '../../../../../engine/src/studio3d.ts';
import {
  type StudioCollectionRow,
  studioSheetSize,
} from '../../../../../engine/src/studio3d-collection.ts';
import type { StudioSceneV1 } from '../../../../../packages/core/src/studio3d-v1.ts';
import { acquireStudioRenderer } from './pool.ts';
import { studioAssetKeys } from './renderer.ts';
import type { StudioRead, StudioShaper } from './source.ts';

export async function renderStudioCollection(
  rows: StudioCollectionRow[],
  read: StudioRead,
  signal: AbortSignal,
  size: { width: number; height: number },
  onItem: (row: StudioCollectionRow, result: Blob | Error) => void,
  shaper?: StudioShaper | null
): Promise<void> {
  signal.throwIfAborted();
  // Every recipe is built first, so the sources this sheet needs are known before the
  // first update and none of them is evicted part way through. A row whose values do
  // not make a scene is reported against that row and holds nothing.
  const planned = rows.map((row) => {
    try {
      return {
        row,
        recipe: buildStudioScene({ version: 1, values: { ...row.values, samples: 8 } }),
        error: null as Error | null,
      };
    } catch (error) {
      return {
        row,
        recipe: null as StudioSceneV1 | null,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  });
  const retain = [
    ...new Set(planned.flatMap((item) => (item.recipe ? studioAssetKeys(item.recipe) : []))),
  ];
  const preview = studioSheetSize(size);
  const lease = await acquireStudioRenderer('sheet');
  const { renderer, canvas } = lease;
  try {
    for (const { row, recipe, error } of planned) {
      signal.throwIfAborted();
      try {
        if (!recipe) throw error ?? new Error('This item has no scene to render.');
        await renderer.update(
          recipe,
          (url, inner) => read(url, AbortSignal.any([signal, inner])),
          shaper ?? undefined,
          { retain }
        );
        signal.throwIfAborted();
        renderer.render(preview.width, preview.height, 'export', 0);
        const blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (value) =>
              value ? resolve(value) : reject(new Error('The preview could not be captured.')),
            'image/png'
          )
        );
        signal.throwIfAborted();
        onItem(row, blob);
      } catch (itemError) {
        signal.throwIfAborted();
        onItem(row, itemError instanceof Error ? itemError : new Error(String(itemError)));
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } finally {
    lease.release();
  }
}
