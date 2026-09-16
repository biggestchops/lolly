// SPDX-License-Identifier: MPL-2.0
/** Trusted layout measurement for templates with bounded text-fit annotations. */
import { resolveVectorFont, refreshFontRegistry } from '../bridge/font-registry.ts';
import type { HostV1 } from '@lolly-tools/core/host-v1';

const coverage = new Map<string, Promise<Set<number>>>();
export async function checkTextLayout(root: Element, textApi: HostV1['text']): Promise<{ ok: boolean; issues: string[] }> {
  const issues: string[] = [];
  const sourceError = root.querySelector('[data-source-tool-error]')?.textContent?.trim();
  if (sourceError) return {ok: false, issues: [sourceError]};
  root.getBoundingClientRect();
  await root.ownerDocument.fonts?.ready;
  refreshFontRegistry();
  const textNodes = new Set<Element>(root.querySelectorAll('.lolly-locked-design .lolly-box-text'));
  for (const node of root.querySelectorAll('[data-source-tool] *')) {
    if (!node.closest('[hidden], style, script') && [...node.childNodes].some(child => child.nodeType === Node.TEXT_NODE && child.textContent?.trim())) textNodes.add(node);
  }
  for (const node of textNodes) {
    const value = node.textContent || '';
    if (!value.trim()) continue;
    const style = getComputedStyle(node);
    let font: Awaited<ReturnType<typeof resolveVectorFont>>;
    try { font = await resolveVectorFont(style, value); } catch { issues.push('The packaged font could not be read. Import the original tool again.'); continue; }
    if (!font?.face?.family.startsWith('LollyFont')) { issues.push('A packaged font is unavailable. Import the original tool file again.'); continue; }
    if (!textApi?.characters) { issues.push('Font coverage is unavailable in this shell. Open this tool in a supported browser.'); continue; }
    let available = coverage.get(font.url);
    if (!available) { available = textApi.characters!(font.url).then(points => new Set(points)); coverage.set(font.url, available); }
    let points: Set<number>;
    try { points = await available; } catch { coverage.delete(font.url); issues.push('Font coverage could not be checked. Try importing the tool again.'); continue; }
    const missing = [...new Set([...value].filter(c => !/\s/u.test(c) && !points.has(c.codePointAt(0)!)))];
    if (missing.length) issues.push(`The approved font cannot draw ${missing.slice(0, 8).join(' ')}. Choose supported text or ask the designer for a font revision.`);
  }
  const boxes = root.querySelectorAll<HTMLElement>('[data-design-fit="fixed"], [data-design-fit="shrink"]');
  const measured: Array<{box: HTMLElement; text: HTMLElement; min: number; fits(): boolean}> = [];
  for (const box of boxes) {
    const text = box.querySelector<HTMLElement>('.lolly-box-text');
    if (!text || !box.clientWidth || !box.clientHeight || !box.isConnected) {
      issues.push('Text layout could not be measured. Open this tool in a browser to export.');
      continue;
    }
    const min = Number(box.dataset.fitMin);
    const max = Number(box.dataset.fitMax);
    const lines = Number(box.dataset.fitLines);
    const base = parseFloat(getComputedStyle(text).fontSize);
    const fits = (): boolean => {
      const style = getComputedStyle(text);
      const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
      return text.scrollWidth <= box.clientWidth + 1 && text.scrollHeight <= box.clientHeight + 1 && (!lines || text.scrollHeight <= lines * lineHeight + 1);
    };
    if (!(min > 0) || !(max >= min) || !(base > 0)) { issues.push('Review the font-size rule for this input.'); continue; }
    if (box.dataset.designFit === 'shrink') {
      let low = min;
      let high = max;
      text.style.fontSize = `${max}px`;
      if (!fits()) {
        for (let i = 0; i < 12; i++) {
          const mid = (low + high) / 2;
          text.style.fontSize = `${mid}px`;
          if (fits()) low = mid; else high = mid;
        }
        text.style.fontSize = `${low}px`;
      }
    }
    box.dataset.requestedSize = String(max);
    box.dataset.effectiveSize = String(parseFloat(getComputedStyle(text).fontSize));
    measured.push({box, text, min, fits});
    const valid = fits();
    box.dataset.fitStatus = valid ? 'ok' : 'overflow';
    if (!valid) issues.push('Text does not fit within the designer’s limits. Shorten it or choose another layout.');
  }
  const groups = new Set(measured.map(m => m.box.dataset.fitGroup).filter(Boolean));
  for (const group of groups) {
    const members = measured.filter(m => m.box.dataset.fitGroup === group);
    const size = Math.min(...members.map(m => Number(m.box.dataset.effectiveSize)));
    for (const m of members) {
      if (size < m.min) { issues.push('The linked objects have no shared fitted size within their limits. Review their minimum sizes.'); continue; }
      m.text.style.fontSize = `${size}px`; m.box.dataset.effectiveSize = String(size);
      if (!m.fits()) { m.box.dataset.fitStatus = 'overflow'; issues.push('Linked text does not fit at its shared size. Shorten it or review the limits.'); }
    }
  }
  for (const box of root.querySelectorAll<HTMLElement>('[data-image-min-width], [data-image-formats]')) {
    const minWidth = Number(box.dataset.imageMinWidth), minHeight = Number(box.dataset.imageMinHeight);
    const formats = box.dataset.imageFormats?.split(',').filter(Boolean) || [];
    if (!minWidth && !minHeight && !formats.length) continue;
    const img = box.querySelector('img');
    if (!img) continue;
    box.dataset.imageStatus = 'ok';
    const imageIssue=(message:string):void=>{box.dataset.imageStatus='error';issues.push(message);};
    try {
      await img.decode();
      const src = img.currentSrc || img.src;
      const mime = src.startsWith('data:') ? src.slice(5, src.indexOf(';')) : (await fetch(src).then(r => r.blob())).type;
      const format = mime === 'image/svg+xml' ? 'svg' : mime.replace('image/', '');
      if (formats.length && !formats.includes(format)) imageIssue(`This image must use ${formats.join(', ').toUpperCase()}. Choose an approved format.`);
      if (format !== 'svg' && (img.naturalWidth < minWidth || img.naturalHeight < minHeight)) imageIssue(`This image needs at least ${minWidth || 1} × ${minHeight || 1} pixels. Choose a larger image.`);
    } catch { imageIssue('This image could not be checked. Replace it before exporting.'); }
  }
  return { ok: issues.length === 0, issues };
}
