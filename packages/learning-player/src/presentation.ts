// SPDX-License-Identifier: MPL-2.0
import type { LearningPresentation } from '@lolly-tools/core/learning-v1';

/** The portable player consumes the same semantic slots as the authoring UI. */
export const learningPresentationSlots = {
  '--ui-color-text-default': 'color',
  '--ui-color-text-muted': 'color',
  '--ui-color-surface-canvas': 'color',
  '--ui-color-surface-raised': 'color',
  '--ui-color-surface-muted': 'color',
  '--ui-color-action-primary': 'color',
  '--ui-color-action-on-primary': 'color',
  '--ui-color-selection-surface': 'color',
  '--ui-color-selection-border': 'color',
  '--ui-color-border-default': 'color',
  '--ui-color-focus-ring': 'color',
  '--ui-type-ui-family': 'font-family',
  '--learning-font-heading': 'font-family',
  '--ui-type-body': 'font-size',
  '--ui-type-heading': 'font-size',
  '--ui-space-panel': 'padding',
  '--ui-space-page': 'padding',
  '--ui-radius-control': 'border-radius',
  '--ui-radius-surface': 'border-radius',
  '--ui-elevation-panel': 'box-shadow',
} as const;

/** CSS is built only from allowed, resolved values. A stored course cannot inject
 * rules, URLs, HTML or scripts through a brand token or font descriptor. */
export function learningPresentationCss(
  presentation?: LearningPresentation,
  fontUrl: (path: string) => string = (path) => path
): string {
  if (!presentation) return '';
  if (presentation.version !== 1 || !['light', 'dark'].includes(presentation.colorScheme))
    throw new Error('Unsupported course presentation.');
  const values = Object.entries(presentation.tokens)
    .map(([slot, value]) => {
      const kind = learningPresentationSlots[slot as keyof typeof learningPresentationSlots];
      const safe =
        typeof value === 'string' &&
        value.length <= 500 &&
        (kind === 'color'
          ? /^(?:#[a-f\d]{3,8}|(?:rgb|hsl)a?\([\d\s.,%/+-]+\)|transparent)$/i.test(value)
          : kind === 'font-family'
            ? /^[\p{L}\p{N}\s,'"_-]+$/u.test(value)
            : kind === 'box-shadow'
              ? /^(?:none|[\d\s.,%()a-z-]+)$/i.test(value) && !/url|var|expression/i.test(value)
              : kind
                ? /^(?:\d+(?:\.\d+)?)(?:px|rem|em)?$/.test(value)
                : false);
      if (!safe) throw new Error(`Invalid course presentation token: ${slot}`);
      return `${slot}:${value};`;
    })
    .join('');
  const faces = presentation.fonts
    .map((face) => {
      if (
        !/^[\p{L}\p{N}\s_-]+$/u.test(face.family) ||
        !/^\d{1,4}(?: \d{1,4})?$/.test(face.weight) ||
        !/^(normal|italic|oblique)$/.test(face.style) ||
        (face.unicodeRange && !/^[Uu+\dA-Fa-f?,\s-]+$/.test(face.unicodeRange)) ||
        !/^media\/[a-f\d]{64}\.(woff2?|ttf|otf)$/.test(face.file.path)
      )
        throw new Error('Invalid course font descriptor.');
      const url = fontUrl(face.file.path);
      if (!/^(?:media\/[a-f\d]{64}\.(?:woff2?|ttf|otf)|blob:[a-z\d:/._-]+)$/i.test(url))
        throw new Error('Invalid course font URL.');
      return `@font-face{font-family:${JSON.stringify(face.family)};src:url("${url}");font-weight:${face.weight};font-style:${face.style};font-display:swap;${face.unicodeRange ? `unicode-range:${face.unicodeRange};` : ''}}`;
    })
    .join('\n');
  return `${faces}\n:root{color-scheme:${presentation.colorScheme};${values}}`;
}
