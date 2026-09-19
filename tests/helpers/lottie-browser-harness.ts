// SPDX-License-Identifier: MPL-2.0
import { DotLottie } from '@lottiefiles/dotlottie-web';
import lottie from 'lottie-web/build/player/lottie_light';
import { readLottie, selectLottie } from '../../engine/src/dotlottie.ts';

/** Both production's light SVG player and the independent ThorVG WASM player. */
export async function frames(bytes: number[], times: number[]): Promise<{ svg: string; pixels: number[] }[]> {
  const data = selectLottie(readLottie(new Uint8Array(bytes))).animation;
  const element = document.createElement('div');
  element.style.cssText = `width:${data.w}px;height:${data.h}px`;
  const canvas = document.createElement('canvas');
  canvas.width = data.w; canvas.height = data.h;
  document.body.append(element, canvas);
  DotLottie.setWasmUrl('https://lottie.test/player.wasm');
  const svg = lottie.loadAnimation({ container: element, renderer: 'svg', loop: false, autoplay: false, animationData: structuredClone(data) });
  svg.setSubframe(true);
  const independent = new DotLottie({ canvas, data: new Uint8Array(bytes).buffer, autoplay: false, loop: false, useFrameInterpolation: true, renderConfig: { devicePixelRatio: 1, autoResize: false, freezeOnOffscreen: false } });
  try {
    await Promise.all([
      new Promise<void>((resolve, reject) => {
        if (svg.isLoaded) { resolve(); return; }
        const timer = setTimeout(() => reject(new Error('SVG player timeout')), 5000);
        svg.addEventListener('DOMLoaded', () => { clearTimeout(timer); resolve(); });
        svg.addEventListener('data_failed', () => { clearTimeout(timer); reject(new Error('SVG player failed')); });
      }),
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Independent player timeout')), 10000);
        independent.addEventListener('load', () => { clearTimeout(timer); resolve(); });
        independent.addEventListener('loadError', event => { clearTimeout(timer); reject(new Error(JSON.stringify(event))); });
      }),
    ]);
    const results = [];
    for (const time of times) {
      svg.goToAndStop(time * data.fr / 1000, true);
      independent.setFrame(time * data.fr / 1000);
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const pixels = independent.buffer;
      if (!pixels) throw new Error('No independent pixels');
      results.push({ svg: element.querySelector('svg')!.outerHTML, pixels: Array.from(pixels) });
    }
    return results;
  } finally { svg.destroy(); independent.destroy(); element.remove(); canvas.remove(); }
}
