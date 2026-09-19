// SPDX-License-Identifier: MPL-2.0
/** Synthetic fixtures authored for these tests, under the repository licence. */
import { lottieStatic as fixed, lottieTransform } from '../../engine/src/lottie-sequence.ts';
import type { LottieAnimation, LottieObject } from '../../engine/src/lottie-model.ts';
import { storeZip } from '../../engine/src/zip.ts';

export function movingLottie(fr = 24, ip = 12): LottieAnimation {
  const end = ip + fr * 2;
  const ks = lottieTransform();
  ks.p = { a: 1, k: [{ t: ip, s: [10, 32, 0], e: [54, 32, 0], o: { x: 0.33, y: 0 }, i: { x: 0.67, y: 1 } }, { t: end, s: [54, 32, 0] }] };
  return { v: '5.13.0', nm: 'Moving dot', w: 64, h: 64, fr, ip, op: end, layers: [{ ty: 4, ind: 1, nm: 'Dot', ip, op: end, st: 0, ks, shapes: [
    { ty: 'el', p: fixed([0, 0]), s: fixed([12, 12]) }, { ty: 'fl', c: fixed([1, 0, 0, 1]), o: fixed(100), r: 1 },
  ] }] };
}
export function nestedLottie(): LottieAnimation {
  const source = movingLottie(25, 10);
  const nested = structuredClone(source.layers);
  source.assets = [{ id: 'shared-id', layers: nested, w: 64, h: 64 }];
  source.layers = [{ ty: 0, ind: 1, refId: 'shared-id', w: 64, h: 64, ip: 10, op: 60, st: 0, sr: 1, ks: lottieTransform(),
    tm: { a: 1, k: [{ t: 10, s: [0.4], e: [2.4], o: { x: 0, y: 0 }, i: { x: 1, y: 1 } }, { t: 60, s: [2.4] }] } }];
  return source;
}
export function trimmedLottie(): LottieAnimation {
  const source = movingLottie(29.97, 0);
  source.layers[0]!.ks = lottieTransform();
  source.layers[0]!.shapes = [
    { ty: 'sh', ks: fixed({ v: [[10, 10], [50, 10], [50, 50]], i: [[0, 0], [0, 0], [0, 0]], o: [[0, 0], [0, 0], [0, 0]], c: false }) },
    { ty: 'st', c: fixed([0, 0.5, 1, 1]), o: fixed(100), w: fixed(4), lc: 2, lj: 2 },
    { ty: 'tm', s: fixed(0), o: fixed(0), m: 1, e: { a: 1, k: [{ t: 0, s: [0], e: [100], o: { x: 0, y: 0 }, i: { x: 1, y: 1 } }, { t: source.op, s: [100] }] } },
  ];
  return source;
}
export function lottiePackage(version: '1' | '2', animations = [movingLottie(), nestedLottie()], extra: LottieObject = {}): Uint8Array {
  const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
  return storeZip([
    { name: 'manifest.json', bytes: encode({ version: version === '1' ? '1.0' : '2', animations: animations.map((_, i) => ({ id: `animation-${i}`, name: `Choice ${i + 1}` })), ...(version === '1' ? { activeAnimationId: 'animation-1' } : { initial: { animation: 'animation-1' } }), ...extra }) },
    ...animations.map((animation, i) => ({ name: `${version === '1' ? 'animations' : 'a'}/animation-${i}.json`, bytes: encode(animation) })),
  ], { forceDeflate: true });
}
