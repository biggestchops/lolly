// SPDX-License-Identifier: MPL-2.0
/** Local vendor marks identify a recorded product, not the reliability of its claim. */
import marks from '../lib/verify-vendors/marks.json' with { type: 'json' };
import { icon } from '../lib/icons.ts';
import { LOLLY_MARK_SVG } from '../lib/lolly-mark.ts';

const vendors: Array<[RegExp, keyof typeof marks]> = [
  [/canva/i, 'canva'], [/affinity publisher/i, 'affinitypublisher'], [/affinity designer/i, 'affinitydesigner'],
  [/affinity photo/i, 'affinityphoto'], [/affinity/i, 'affinity'], [/indesign/i, 'adobeindesign'],
  [/illustrator/i, 'adobeillustrator'], [/photoshop/i, 'adobephotoshop'], [/lightroom/i, 'adobelightroom'],
  [/premiere/i, 'adobepremierepro'], [/after effects/i, 'adobeaftereffects'], [/adobe/i, 'adobe'],
  [/inkscape/i, 'inkscape'], [/gimp/i, 'gimp'], [/krita/i, 'krita'], [/figma/i, 'figma'], [/penpot/i, 'penpot'],
  [/blender/i, 'blender'], [/sketch/i, 'sketch'], [/audacity/i, 'audacity'], [/davinci/i, 'davinciresolve'],
  [/apple|iphone|ipad|ios\b|macos/i, 'apple'], [/libreoffice/i, 'libreoffice'], [/obs studio/i, 'obsstudio'],
  [/ffmpeg|lavf|lavc/i, 'ffmpeg'], [/openai|chatgpt|dall.?e/i, 'openai'], [/google|gemini|imagen/i, 'google'],
];
export function vendorMark(name: string): string {
  const key = vendors.find(([pattern]) => pattern.test(name))?.[1];
  const svg = /\blolly\b/i.test(name) ? LOLLY_MARK_SVG : key
    ? `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${marks[key].map((d) => `<path d="${d}"/>`).join('')}</svg>` : icon('tool');
  return `<span class="valid-vendor-mark" aria-hidden="true"${key ? ` data-vendor="${key}"` : ''}>${svg}</span>`;
}
