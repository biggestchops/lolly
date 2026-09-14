// SPDX-License-Identifier: MPL-2.0
import { markLookFailed, markLookReady } from './gallery-carousel.ts';
import { previewDeadline } from '../lib/preview-deadline.ts';

/** A failed or stalled preview releases the serial queue and stays visibly failed. */
export async function loadGalleryLook(
  gcar: HTMLElement,
  slide: HTMLElement,
  render: () => Promise<{ thumb: string; href: string }>,
  timeoutMs = 30_000,
): Promise<void> {
  const img = slide.querySelector<HTMLImageElement>('.gcar-img');
  if (!gcar.isConnected || !img || img.getAttribute('src')) return;
  let expired = false;
  const work = async (): Promise<void> => {
    const { thumb, href } = await render();
    if (expired || !gcar.isConnected) return;
    if (!thumb) throw new Error('Preview unavailable');
    img.src = thumb;
    await img.decode();
    if (expired || !gcar.isConnected) return;
    slide.querySelector('a')?.setAttribute('href', href);
    markLookReady(gcar, slide);
  };
  try {
    await previewDeadline(work(), timeoutMs);
  } catch {
    expired = true;
    if (gcar.isConnected) {
      img.removeAttribute('src');
      markLookFailed(gcar, slide);
    }
  }
}
