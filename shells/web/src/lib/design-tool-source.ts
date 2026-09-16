// SPDX-License-Identifier: MPL-2.0
/** The imported original belongs to the authoring session, never the shared tool. */
import type { Runtime } from '../../../../engine/src/runtime.ts';
import { getDesignImportReport, type DesignImportFinding } from './design-import-report.ts';
export interface DesignToolSource { name: string; data: string; pages?: number[]; findings?: DesignImportFinding[]; reviewed?: boolean }
export class DesignSourceReviewError extends Error {}
export function checkDesignToolSource(runtime: Runtime): void {
  const source = sources.get(runtime);
  if (!source?.reviewed && source?.findings?.some(f => f.kind === 'review')) throw new DesignSourceReviewError('Compare the imported artwork with the original and review the conversion notes before sharing.');
}
const pickedPages = new WeakMap<Blob, number[]>();
export const rulesSourcePages = (file: Blob): number[] | undefined => pickedPages.get(file);
export const setRulesSourcePages = (file: Blob, pages: number[]): void => { pickedPages.set(file,pages); };
const sources = new WeakMap<Runtime, DesignToolSource>();
export function getDesignToolSource(runtime: Runtime): DesignToolSource | undefined { return sources.get(runtime); }
export function restoreDesignToolSource(runtime: Runtime, value: unknown): void {
  const source = value as DesignToolSource | null;
  if (source && typeof source.name === 'string' && typeof source.data === 'string' && (source.data === '' || source.data.startsWith('data:application/pdf;base64,'))) {
    const findings = Array.isArray(source.findings) ? source.findings.filter(f => f && Number.isInteger(f.page) && f.page >= 0 && ['fixed','review'].includes(f.kind) && typeof f.message === 'string' && (f.object === undefined || typeof f.object === 'string')) : [];
    const pages = Array.isArray(source.pages) ? source.pages.filter(p => Number.isInteger(p) && p >= 0) : undefined;
    sources.set(runtime, {...source, findings, pages, reviewed:source.reviewed === true});
  }
}
export async function rememberDesignToolSource(runtime: Runtime, file: File): Promise<void> {
  sources.delete(runtime);
  if (!/\.(pdf|ai)$/i.test(file.name)) return;
  const head = new Uint8Array(await file.slice(0,1024).arrayBuffer());
  if (!new TextDecoder().decode(head).includes('%PDF-')) return;
  const source: DesignToolSource = {name:file.name,pages:rulesSourcePages(file),findings:structuredClone(getDesignImportReport(file)),reviewed:false,data:''};
  sources.set(runtime,source);
  if (file.size > 30 * 1024 * 1024) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  source.data = `data:application/pdf;base64,${btoa(binary)}`;
}
