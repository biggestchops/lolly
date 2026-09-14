// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { loadGalleryLook } from './gallery-look-loader.ts';
import { carouselDotsMarkup } from './gallery-carousel.ts';

test('a timed-out render stays failed when it eventually resolves', async () => {
  const dom = new JSDOM(`<div class="gcar"><ol class="gcar-track"><li class="gcar-slide"><a href="#old"><img class="gcar-img"></a></li></ol>${carouselDotsMarkup(2)}</div>`);
  const gcar = dom.window.document.querySelector<HTMLElement>('.gcar')!;
  const slide = gcar.querySelector<HTMLElement>('.gcar-slide')!;
  const img = slide.querySelector('img')!;
  img.decode = async () => {};
  let finish!: (result: { thumb: string; href: string }) => void;
  await loadGalleryLook(gcar, slide, () => new Promise(resolve => { finish = resolve; }), 10);
  assert.ok(slide.classList.contains('is-failed'));
  assert.equal(gcar.querySelector('.gcar-dot')?.hasAttribute('data-look-pending'), false);
  finish({ thumb: 'late.svg', href: '#late' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(img.hasAttribute('src'), false);
  assert.equal(slide.querySelector('a')?.getAttribute('href'), '#old');
  assert.equal(slide.classList.contains('is-loaded'), false);
  dom.window.close();
});

test('a preview removed during rendering cannot paint or change its link', async () => {
  const dom = new JSDOM('<div class="gcar"><ol class="gcar-track"><li class="gcar-slide"><a href="#old"><img class="gcar-img"></a></li></ol></div>');
  const gcar = dom.window.document.querySelector<HTMLElement>('.gcar')!;
  const slide = gcar.querySelector<HTMLElement>('.gcar-slide')!;
  let finish!: (result: { thumb: string; href: string }) => void;
  const done = loadGalleryLook(gcar, slide, () => new Promise(resolve => { finish = resolve; }));
  gcar.remove();
  finish({ thumb: 'late.svg', href: '#late' });
  await done;
  assert.equal(slide.querySelector('img')?.hasAttribute('src'), false);
  assert.equal(slide.querySelector('a')?.getAttribute('href'), '#old');
  dom.window.close();
});
