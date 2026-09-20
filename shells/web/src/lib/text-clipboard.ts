// SPDX-License-Identifier: MPL-2.0
/** Bounded clipboard admission. Pasted markup never becomes live editor DOM. */
import { textSemanticSource } from '../../../../engine/src/text-semantic.ts';
import type { TextCharacterV1, TextDocumentV1, TextRangeV1, TextSpanV1, TextStoryV1 } from '@lolly-tools/core';
import { createTextStory, normalizeTextSpans, sliceTextDocument, parseColor } from '@lolly/engine';
import { parseCssColorFull } from '../bridge/export-css.ts';
import { rgbaToHex } from './color-formats.ts';
export const TEXT_CLIPBOARD_MIME = 'application/x-lolly-text+json';
const escapeMarkup = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/\r/g, '&#13;');
export function copyTextFragment(data: Pick<DataTransfer, 'setData'>, document: TextDocumentV1, story: TextStoryV1, range: TextRangeV1): void {
  const fragment = sliceTextDocument(document, story, range), content = fragment.stories[0]!;
  data.setData('text/plain', textSemanticSource(content).source);
  data.setData(TEXT_CLIPBOARD_MIME, JSON.stringify(fragment));
  const html = content.spans.map(span => {
    const c = span.character ?? {}, font = fragment.fonts.find(font => font.id === c.font);
    const css = [font ? `font-family:${font.family.replace(/[;"<>]/g, '')}` : '', `font-size:${c.size ?? 16}px`, `color:${c.color ?? '#000000'}`,
      `font-weight:${c.weight ?? 400}`, `font-style:${c.italic ? 'italic' : 'normal'}`, `text-decoration:${[c.underline ? 'underline' : '', c.strike ? 'line-through' : ''].filter(Boolean).join(' ') || 'none'}`].filter(Boolean).join(';');
    const tag = span.literal ? 'code' : 'span';
    return `<${tag} style="${escapeMarkup(css)}">${escapeMarkup(textSemanticSource(content,span).source)}</${tag}>`;
  }).join('');
  data.setData('text/html', `<div style="white-space:pre-wrap">${html || escapeMarkup(textSemanticSource(content).source)}</div>`);
}
/** Basic HTML character formatting uses installed pins; scripts, images and CSS URLs are discarded. */
export function pastedTextHtml(html: string, base: TextCharacterV1, document: TextDocumentV1, parse: (html: string) => Document): TextDocumentV1 {
  if (html.length > 512 * 1024) throw new Error('This pasted markup is too large. Paste a smaller selection.');
  const root = parse(html).body, spans: TextSpanV1[] = [];
  let source = '', nodes = 0, paragraphEnd = false;
  function append(text: string, character: TextCharacterV1, literal = false): void {
    if (text && paragraphEnd && source && !/[\n\r\u2028\u2029]$/.test(source) && !/^[\n\r\u2028\u2029]/.test(text)) { const at = source.length; source += '\n'; spans.push({ start: at, end: at + 1, character }); }
    paragraphEnd = false;
    const start = source.length; source += text;
    if (source.length > 64000) throw new Error('This text exceeds the story limit. Paste a smaller selection.');
    if (text) spans.push({ start, end: source.length, character, ...(literal ? { literal: true } : {}) });
  }
  function walk(node: Node, character: TextCharacterV1, depth: number, literal = false): void {
    if (++nodes > 8192 || depth > 64) throw new Error('This pasted markup is too complex. Paste as plain text.');
    if (node.nodeType === 3) { append(node.textContent ?? '', character, literal); return; }
    if (node.nodeType !== 1) return;
    const el = node as HTMLElement, tag = el.tagName.toUpperCase(), css = el.style;
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'TEMPLATE', 'SVG', 'MATH', 'IMG', 'LINK', 'META'].includes(tag) || el.hidden || css.display === 'none' || css.visibility === 'hidden') return;
    if (tag === 'BR') { append('\u2028', character); return; }
    const next = { ...character };
    if (['B', 'STRONG'].includes(tag)) next.weight = 700;
    if (['I', 'EM'].includes(tag)) next.italic = true;
    if (tag === 'U') next.underline = true;
    if (['S', 'STRIKE', 'DEL'].includes(tag)) next.strike = true;
    if (css.fontWeight) { const value = css.fontWeight === 'bold' ? 700 : css.fontWeight === 'normal' ? 400 : Number(css.fontWeight); if (value >= 1 && value <= 1000) next.weight = value; }
    if (css.fontStyle) next.italic = css.fontStyle === 'italic' || css.fontStyle === 'oblique';
    if (/^[\d.]+(?:px|pt)$/.test(css.fontSize)) { const value = parseFloat(css.fontSize) * (css.fontSize.endsWith('pt') ? 4 / 3 : 1); if (value >= 1 && value <= 1000) next.size = value; }
    const color = parseCssColorFull(css.color); if (parseColor(css.color)) next.color = css.color; else if (color) next.color = rgbaToHex(...color);
    if (css.textDecorationLine || css.textDecoration) { const value = css.textDecorationLine || css.textDecoration; next.underline = value.includes('underline'); next.strike = value.includes('line-through'); }
    if (css.fontFamily) {
      const names = css.fontFamily.split(',').map(name => name.trim().replace(/^['"]|['"]$/g, '').toLowerCase());
      const font = document.fonts.find(font => names.includes(font.family.toLowerCase())); if (font) { next.font = font.id; next.axes = {}; }
    }
    const block = /^(P|DIV|H[1-6]|LI|BLOCKQUOTE|PRE)$/.test(tag);
    if (block && source && !/[\n\r\u2028\u2029]$/.test(source)) append('\n', character);
    for (const child of el.childNodes) walk(child, next, depth + 1, literal || tag === 'PRE' || tag === 'CODE');
    if (block) paragraphEnd = true;
  }
  for (const child of root.childNodes) walk(child, base, 0);
  const story = createTextStory('paste', source, index => `p${index}`);
  story.spans = normalizeTextSpans(source, spans);
  story.paragraphs = story.paragraphs.map(paragraph => ({ ...paragraph, paragraph: { character: base } }));
  return { version: 1, stories: [story], fonts: document.fonts, styles: [] };
}
