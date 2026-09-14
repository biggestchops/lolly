// SPDX-License-Identifier: MPL-2.0
import type { LearningFile, LearningPresentation } from '@lolly-tools/core/learning-v1';
import type { CompiledLearning } from '../../../../engine/src/learning/compile.ts';
import {
  learningPresentationSlots,
  learningPresentationCss,
} from '../../../../packages/learning-player/src/presentation.ts';
import { discoverFontFaces } from '../bridge/fontface-discovery.ts';
import { REGISTERED } from './register-user-fonts.ts';
import type { LearningCtx } from '../views/learning/context.ts';

export function captureLearningPresentation(root: HTMLElement): LearningPresentation {
  const probe = document.createElement('span');
  probe.hidden = true;
  root.append(probe);
  const tokens: Record<string, string> = {};
  try {
    for (const [slot, property] of Object.entries(learningPresentationSlots)) {
      if (slot === '--learning-font-heading') {
        tokens[slot] = getComputedStyle(root.querySelector('h1') || root).fontFamily;
      } else {
        probe.style.setProperty(property, `var(${slot})`);
        tokens[slot] = getComputedStyle(probe).getPropertyValue(property).trim();
        probe.style.removeProperty(property);
      }
    }
  } finally {
    probe.remove();
  }
  const result: LearningPresentation = {
    version: 1,
    colorScheme: getComputedStyle(root).colorScheme === 'dark' ? 'dark' : 'light',
    tokens,
    fonts: [],
    licenses: [],
  };
  learningPresentationCss(result);
  return result;
}

export async function freezeLearningPresentation(
  ctx: LearningCtx,
  compiled: CompiledLearning,
  presentation: LearningPresentation,
  hash: (bytes: Uint8Array) => Promise<string>,
  signal?: AbortSignal
): Promise<void> {
  const families = new Set(
    [
      presentation.tokens['--ui-type-ui-family'],
      presentation.tokens['--learning-font-heading'],
    ].flatMap((stack) =>
      (stack || '').split(',').map((f) =>
        f
          .trim()
          .replace(/^['"]|['"]$/g, '')
          .toLowerCase()
      )
    )
  );
  const add = async (bytes: Uint8Array, mime: string, ext: string): Promise<LearningFile> => {
    signal?.throwIfAborted();
    const digest = await hash(bytes);
    if (!bytes.length || !/^[a-f\d]{64}$/.test(digest))
      throw new Error('The course font could not be saved.');
    const path = `media/${digest}.${ext}`;
    const total = Object.values(compiled.files).reduce((sum, file) => sum + file.length, 0);
    if (!compiled.files[path] && total + bytes.length > 512 * 1024 * 1024)
      throw new Error(
        'This course and its fonts exceed the 512 MB local package limit. Split it into smaller courses.'
      );
    compiled.files[path] = bytes;
    return { path, hash: digest, size: bytes.length, mime };
  };
  const fontFile = async (bytes: Uint8Array) => {
    const magic = String.fromCharCode(...bytes.slice(0, 4));
    const ext =
      magic === 'wOF2'
        ? 'woff2'
        : magic === 'wOFF'
          ? 'woff'
          : magic === 'OTTO'
            ? 'otf'
            : magic === '\0\x01\0\0' || magic === 'true'
              ? 'ttf'
              : '';
    if (!ext) throw new Error('A brand font is unavailable or is not a supported font file.');
    return add(bytes, `font/${ext}`, ext);
  };
  const registered = [...REGISTERED.entries()].filter(([, face]) =>
    families.has(face.family.replace(/^['"]|['"]$/g, '').toLowerCase())
  );
  const userFamilies = new Set<string>();
  if (registered.length) {
    for (const [id, face] of registered) {
      const ref = await ctx.host.assets.get(id);
      const response = await fetch(ref.url, { signal });
      if (!response.ok)
        throw new Error(
          `The brand font ${face.family} is unavailable. Restore it before exporting.`
        );
      const family = face.family.replace(/^['"]|['"]$/g, '').toLowerCase();
      userFamilies.add(family);
      presentation.fonts.push({
        family,
        weight: face.weight,
        style: face.style,
        unicodeRange: face.unicodeRange,
        file: await fontFile(new Uint8Array(await response.arrayBuffer())),
      });
    }
  }
  for (const face of discoverFontFaces()) {
    if (!families.has(face.family) || userFamilies.has(face.family)) continue;
    const response = await fetch(face.srcUrl, { signal });
    if (!response.ok)
      throw new Error(`The brand font ${face.family} is unavailable. Restore it before exporting.`);
    presentation.fonts.push({
      family: face.family,
      weight: face.weight,
      style: face.style,
      unicodeRange: face.unicodeRange,
      file: await fontFile(new Uint8Array(await response.arrayBuffer())),
    });
  }
  for (const [family, license] of [
    ['suse', 'OFL-SUSE.txt'],
    ['suse mono', 'OFL-SUSE-Mono.txt'],
    ['outfit', 'OFL-Outfit.txt'],
  ]) {
    if (!presentation.fonts.some((f) => f.family === family) || userFamilies.has(family!)) continue;
    const response = await fetch(`/fonts/${license}`, { signal });
    if (!response.ok) throw new Error('The bundled font licence is unavailable.');
    presentation.licenses.push(
      await add(new Uint8Array(await response.arrayBuffer()), 'text/plain', 'txt')
    );
  }
  signal?.throwIfAborted();
  learningPresentationCss(presentation);
  compiled.content.presentation = presentation;
}
