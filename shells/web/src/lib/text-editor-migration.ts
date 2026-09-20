// SPDX-License-Identifier: MPL-2.0
/** Capture rendered legacy semantics once, without normalizing its literal characters. */
import type { TextCharacterV1, TextFontResourceV1, TextSpanV1, TextParagraphStyleV1 } from '@lolly-tools/core';
import { pinEditorFont } from './text-editor-fonts.ts';
import { rgbaToHex } from './color-formats.ts';
import { parseCssColorFull } from '../bridge/export-css.ts';
import { normalizeTextSpans, parseColor, defaultTextFrameSettings } from '@lolly/engine';
export async function captureLegacyText(element: HTMLElement) {
  const fonts = new Map<string, TextFontResourceV1>(), spans: TextSpanV1[] = [];
  let source = '';
  const base = getComputedStyle(element);
  if (base.textTransform !== 'none' && base.textTransform !== '') throw new Error('Remove the display-case transform before upgrading this text.');
  const runs: Array<{ text: string; style: CSSStyleDeclaration }> = [];
  function walk(node: Node, style: CSSStyleDeclaration): void {
    if (node.nodeType === 3) { if (node.textContent) runs.push({ text: node.textContent, style }); return; }
    if (node.nodeType !== 1) return;
    const el = node as HTMLElement;
    if (['SCRIPT', 'STYLE'].includes(el.tagName)) return;
    if (el.hasAttribute('data-emoji')) { runs.push({ text: el.getAttribute('data-emoji')!, style }); return; }
    if (el.tagName === 'BR') { runs.push({ text: '\n', style }); return; }
    const next = getComputedStyle(el);
    for (const child of el.childNodes) walk(child, next);
  }
  for (const child of element.childNodes) walk(child, base);
  const styles = new Map<string, Promise<TextCharacterV1>>();
  function character(style: CSSStyleDeclaration, text: string): Promise<TextCharacterV1> {
    const key = [style.fontFamily, style.fontWeight, style.fontStyle, style.fontSize, style.color, style.letterSpacing, style.textDecorationLine, style.fontFeatureSettings].join('\0');
    let pending = styles.get(key);
    if (!pending) {
      pending = pinEditorFont(style, text).then(pinned => {
        for (const font of pinned.fonts) fonts.set(font.id, font);
        const color = parseCssColorFull(style.color);
        const features: Record<string, number> = {};
        for (const match of style.fontFeatureSettings.matchAll(/["']([A-Za-z0-9]{4})["']\s*(on|off|\d+)?/g)) features[match[1]!] = match[2] === 'off' ? 0 : match[2] && match[2] !== 'on' ? Number(match[2]) : 1;
        if (style.fontKerning === 'none') features.kern = 0;
        return { ...pinned.character, ...(Object.keys(features).length ? { features } : {}), size: parseFloat(style.fontSize) || 16, color: parseColor(style.color) ? style.color : color ? rgbaToHex(...color) : '#000000', tracking: parseFloat(style.letterSpacing) || 0, underline: style.textDecorationLine.includes('underline'), strike: style.textDecorationLine.includes('line-through') };
      });
      styles.set(key, pending);
    }
    return pending;
  }
  const defaultCharacter = await character(base, runs.map(run => run.text).join(''));
  for (const run of runs) {
    const start = source.length; source += run.text;
    const style = await character(run.style, run.text), previous = spans.at(-1);
    if (previous && JSON.stringify(previous.character) === JSON.stringify(style)) previous.end = source.length;
    else spans.push({ start, end: source.length, character: style });
  }
  const direction = base.direction === 'rtl' ? 'rtl' : 'ltr';
  const alignment = base.textAlign;
  const align: TextParagraphStyleV1['align'] = alignment === 'center' ? 'center' : alignment === 'justify' ? 'justify' : alignment === 'end' || alignment === (direction === 'rtl' ? 'left' : 'right') ? 'end' : 'start';
  const paragraph: TextParagraphStyleV1 = { direction, align, lineHeight: (parseFloat(base.lineHeight) || (defaultCharacter.size ?? 16)*1.2)/(defaultCharacter.size ?? 16) };
  const settings = defaultTextFrameSettings('fixed');
  settings.inset = { top: parseFloat(base.paddingTop)||0, right: parseFloat(base.paddingRight)||0, bottom: parseFloat(base.paddingBottom)||0, left: parseFloat(base.paddingLeft)||0 };
  const parent = element.parentElement && getComputedStyle(element.parentElement);
  settings.verticalAlign = parent?.alignItems === 'center' ? 'center' : parent?.alignItems === 'flex-end' ? 'bottom' : 'top';
  return { source, character: defaultCharacter, fonts: [...fonts.values()], spans: normalizeTextSpans(source, spans), paragraph, settings };
}
