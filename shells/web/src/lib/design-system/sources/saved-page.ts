// SPDX-License-Identifier: MPL-2.0
/** Local page text is data: this adapter neither renders it nor follows its URLs. */
import { sha256Hex } from '@lolly/engine';
import { extractSite } from '../extract-site.ts';

export const PAGE_MAX_BYTES = 2 * 1024 * 1024;
export const PAGE_MAX_FILES = 20;
export interface PageText { name: string; text: string }
export type PageFile = Pick<File, 'name' | 'size' | 'text'>;

export async function readPageFiles(files: readonly PageFile[]): Promise<PageText[]> {
  if (!files.length) throw new Error('empty');
  if (files.length > PAGE_MAX_FILES) throw new Error('count');
  if (files.some(f => !/\.(html?|css)$/i.test(f.name))) throw new Error('format');
  if (files.reduce((n, f) => n + f.size, 0) > PAGE_MAX_BYTES) throw new Error('size');
  if (files.filter(f => /\.html?$/i.test(f.name)).length > 1) throw new Error('pages');
  return Promise.all(files.map(async f => ({ name: f.name.slice(0, 180), text: await f.text() })));
}

export async function extractSavedPage(input: readonly PageText[]) {
  if (!input.length || input.length > PAGE_MAX_FILES) throw new Error('count');
  const encoder = new TextEncoder();
  let bytes = 0;
  const parts = input.map(p => {
    if (typeof p.name !== 'string' || typeof p.text !== 'string' || !/\.(html?|css)$/i.test(p.name)) throw new Error('format');
    bytes += encoder.encode(p.text).length;
    if (bytes > PAGE_MAX_BYTES) throw new Error('size');
    return { name: p.name.slice(0, 180), text: p.text.replace(/\r\n?/g, '\n') };
  }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : a.text < b.text ? -1 : a.text > b.text ? 1 : 0);
  const pages = parts.filter(p => /\.html?$/i.test(p.name));
  if (pages.length > 1) throw new Error('pages');
  if (!parts.some(p => p.text.trim())) throw new Error('empty');
  const html = pages[0]?.text ?? '';
  const result = extractSite({ html, cssTexts: parts.filter(p => /\.css$/i.test(p.name)).map(p => p.text) });
  const label = pages[0]?.name ?? parts[0]!.name;
  result.census.source = { kind: pages.length ? 'site' : 'css', label };
  return { census: result.census, files: parts.map(p => p.name), sha256: await sha256Hex(encoder.encode(JSON.stringify(parts))) };
}
