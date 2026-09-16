// SPDX-License-Identifier: MPL-2.0
/** Serial, cancellable contact-sheet rendering with one owned GPU context. */
import { buildStudioScene } from '../../../../../engine/src/studio3d.ts';
import type { StudioCollectionRow } from '../../../../../engine/src/studio3d-collection.ts';
import { StudioRenderer } from './renderer.ts';
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
  const canvas = document.createElement('canvas');
  const renderer = new StudioRenderer(canvas);
  const scale = Math.min(1, 320 / Math.max(size.width, size.height));
  try {
    for (const row of rows) {
      signal.throwIfAborted();
      try {
        const recipe = buildStudioScene({ version: 1, values: { ...row.values, samples: 8 } });
        await renderer.update(
          recipe,
          (url, inner) => read(url, AbortSignal.any([signal, inner])),
          shaper ?? undefined
        );
        signal.throwIfAborted();
        renderer.render(
          Math.round(size.width * scale),
          Math.round(size.height * scale),
          'export',
          0
        );
        const blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (value) =>
              value ? resolve(value) : reject(new Error('The preview could not be captured.')),
            'image/png'
          )
        );
        signal.throwIfAborted();
        onItem(row, blob);
      } catch (error) {
        signal.throwIfAborted();
        onItem(row, error instanceof Error ? error : new Error(String(error)));
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } finally {
    renderer.dispose();
  }
}
