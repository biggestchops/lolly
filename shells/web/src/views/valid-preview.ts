// SPDX-License-Identifier: MPL-2.0
/** One PDF parse for Verify's first-page preview and hidden-text findings. */
import type { HostV1 } from '@lolly-tools/core/host-v1';
import type { MetaField } from '@lolly/engine';
import { t, tRaw } from '../i18n.ts';
import type { PdfHandle } from './pdf-import.ts';

const previews = new WeakMap<File, string>();
const handles = new WeakMap<File, PdfHandle>();
export const pdfPageCountFor = (file: File): number | undefined => handles.get(file)?.pageCount;

async function rememberPdfPreview(file: File, handle: PdfHandle): Promise<void> {
  if (previews.has(file) || !handle.pageCount) return;
  try {
    const page = await handle.pageToSvg(0);
    if (page.svg.length <= 2 * 1024 * 1024) previews.set(file, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(page.svg)}`);
  } catch { /* The original PDF link remains available when preview rendering fails. */ }
}

export const pdfPreviewFor = (file: File): string | undefined => previews.get(file);

export async function openPdfForVerify(file: File, bytes: Uint8Array): Promise<PdfHandle> {
  const cached = handles.get(file);
  if (cached) return cached;
  const { openPdfFile } = await import('./pdf-import.ts');
  const handle = await openPdfFile(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  handles.set(file, handle);
  await rememberPdfPreview(file, handle);
  return handle;
}

/** Detect text covered by opaque shapes, checking at most 30 pages. */
export async function readHiddenPdfText(host: HostV1, file: File, bytes: Uint8Array): Promise<MetaField | undefined> {
    try {
      const handle = await openPdfForVerify(file, bytes);
      const scan = handle.findHiddenText?.({ maxPages: 30 });
      if (!scan?.findings.length) return undefined;

      const { findings, scanned } = scan;
      const words = findings.reduce((a, f) => a + (f.text.match(/\S+/g) ?? []).length, 0);
      const pages = new Set(findings.map((f) => f.page ?? 0)).size;
      const scope = scanned < handle.pageCount ? t(' (first {n} pages checked)', { n: scanned }) : '';
      // The words themselves are the evidence - quoting a couple of them is what
      // turns "a warning" into "look what is still in your file". Bounded, and
      // the whole recovered text is available in the extraction view.
      const sample = findings.slice(0, 2).map((f) => `“${f.text}”`).join(', ');

      return {
        label: t('Hidden text'),
        value: tRaw('{words} words in {runs} places on {pages} pages are covered by opaque shapes - still in the file, not visible on the page{scope}. For example: {sample}', {
          words, runs: findings.length, pages, scope, sample,
        }),
        group: 'structure',
        sensitive: true,
      };
    } catch (err) {
      host.log('warn', 'valid: hidden-text scan failed', { file: file.name, error: (err as Error)?.message });
      return undefined;
    }
  }


export interface VerifyPreview {
  url?: string; thumbnail?: string; pages?: number;
  kind: 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'none';
  format: string; name: string; snippet?: { body: string; more: boolean };
}

import { escape as esc } from '../utils.ts';
import { icon } from '../lib/icons.ts';
import { mountModal } from '../components/modal.ts';

export function mediaPreviewHtml(p: VerifyPreview | undefined, fileIndex: number): string {
  if (!p) return '';
  const label = tRaw('Preview of {name}', { name: p.name });
  const image = p.kind === 'pdf' ? p.thumbnail : p.kind === 'image' ? p.url : undefined;
  const content = image ? `<button type="button" class="valid-preview-stage" data-preview-enlarge aria-label="${esc(t('Enlarge preview'))}"><img src="${esc(image)}" alt="${esc(label)}" decoding="async"></button>`
    : p.kind === 'video' && p.url ? `<video src="${esc(p.url)}#t=0.1" preload="metadata" playsinline controls aria-label="${esc(label)}"></video>`
    : p.kind === 'audio' && p.url ? `<div class="valid-audio-art" aria-hidden="true">${icon('music')}</div><audio src="${esc(p.url)}" preload="metadata" controls aria-label="${esc(label)}"></audio>`
    : p.kind === 'text' && p.snippet ? `<pre class="valid-preview-text">${esc(p.snippet.body)}</pre>`
    : `<div class="valid-preview-unavailable">${icon('document')}<span>${t('Preview unavailable')}</span></div>`;
  const paging = p.kind === 'pdf' && (p.pages ?? 0) > 1 ? `<div class="valid-preview-paging"><button type="button" class="btn valid-icon-button" data-preview-page="-1" aria-label="${esc(t('Previous page'))}" disabled>${icon('chevronLeft')}</button><span data-preview-page-label aria-live="polite">${t('Page {n} of {total}', { n: 1, total: p.pages! })}</span><button type="button" class="btn valid-icon-button" data-preview-page="1" aria-label="${esc(t('Next page'))}">${icon('chevronRight')}</button></div>` : `<span>${p.kind === 'text' ? t('Text preview') : p.kind === 'pdf' ? t('Page 1') : esc(p.format.toUpperCase())}</span>`;
  // nosemgrep: lolly-href-escape-is-not-scheme-validation - a PDF preview's url is the blob: address valid.ts mints with URL.createObjectURL(file)
  return `<figure class="valid-preview valid-preview--lg is-${p.kind}" data-preview-file="${fileIndex}" data-preview-current="0"><div class="valid-preview-surface">${content}</div><figcaption><div class="valid-preview-toolbar">${paging}${image ? `<button type="button" class="btn valid-icon-button" data-preview-enlarge aria-label="${esc(t('Enlarge preview'))}" title="${esc(t('Enlarge preview'))}">${icon('zoomIn')}</button>` : ''}${p.kind === 'pdf' && p.url ? `<a class="btn" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${icon('document')}<span>${t('Open PDF')}</span></a>` : ''}</div>${p.snippet?.more ? `<small>${t('First {n} characters', { n: p.snippet.body.length })}</small>` : ''}<span class="valid-preview-error" role="status"></span></figcaption></figure>`;
}

export function wireVerifyPreviews(root: HTMLElement, fileAt: (index: number) => File | undefined): void {
  const interact = async (event: MouseEvent) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-preview-enlarge], [data-preview-page]') : null;
    const figure = button?.closest<HTMLElement>('[data-preview-file]');
    if (!button || !figure) return;
    if (button.hasAttribute('data-preview-enlarge')) {
      const copy = figure.cloneNode(true) as HTMLElement;
      copy.querySelectorAll('[data-preview-enlarge]').forEach((el) => {
        if (el.querySelector('img')) el.replaceWith(el.querySelector('img')!);
        else el.remove();
      });
      const modal = mountModal(`<header><h2>${t('Asset preview')}</h2><button type="button" class="btn" data-preview-close>${icon('close')}<span>${t('Close')}</span></button></header>${copy.outerHTML}`, { className: 'modal valid-preview-dialog', ariaLabel: t('Asset preview') });
      modal.el.querySelector('[data-preview-close]')?.addEventListener('click', () => modal.close());
      modal.el.addEventListener('click', (e) => { void interact(e); });
      return;
    }
    const file = fileAt(Number(figure.dataset.previewFile));
    const handle = file && handles.get(file);
    if (!handle || figure.dataset.previewBusy) return;
    const current = Number(figure.dataset.previewCurrent ?? 0);
    const page = current + Number(button.dataset.previewPage);
    if (!Number.isInteger(page) || page < 0 || page >= handle.pageCount) return;
    figure.dataset.previewBusy = 'true';
    figure.setAttribute('aria-busy', 'true');
    const buttons = figure.querySelectorAll<HTMLButtonElement>('[data-preview-page]');
    buttons.forEach((b) => { b.disabled = true; });
    const error = figure.querySelector<HTMLElement>('.valid-preview-error');
    if (error) error.textContent = t('Rendering page…');
    try {
      const rendered = await handle.pageToSvg(page);
      if (rendered.svg.length > 2 * 1024 * 1024) throw new Error('Preview limit');
      const img = figure.querySelector('img');
      if (!img || !figure.isConnected) return;
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(rendered.svg)}`;
      img.alt = t('Page {n}', { n: page + 1 });
      figure.dataset.previewCurrent = String(page);
      const label = figure.querySelector('[data-preview-page-label]');
      if (label) label.textContent = t('Page {n} of {total}', { n: page + 1, total: handle.pageCount });
      if (error) error.textContent = '';
    } catch { if (error) error.textContent = t('This page could not be previewed. Open the PDF to view it.'); }
    finally {
      const index = Number(figure.dataset.previewCurrent);
      buttons.forEach((b) => { b.disabled = Number(b.dataset.previewPage) < 0 ? index === 0 : index === handle.pageCount - 1; });
      delete figure.dataset.previewBusy;
      figure.removeAttribute('aria-busy');
    }
  };
  root.addEventListener('error', (event) => {
    const img = event.target instanceof HTMLImageElement ? event.target : null;
    const figure = img?.closest<HTMLElement>('[data-preview-file]');
    if (!img || !figure) return;
    const surface = figure.querySelector('.valid-preview-surface');
    if (surface) surface.innerHTML = `<div class="valid-preview-unavailable">${icon('document')}<span>${t('Preview unavailable')}</span></div>`;
    figure.querySelectorAll('[data-preview-enlarge]').forEach((el) => { el.remove(); });
  }, true);
  root.addEventListener('click', (e) => { void interact(e); });
}
