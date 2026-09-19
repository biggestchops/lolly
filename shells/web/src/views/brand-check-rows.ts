// SPDX-License-Identifier: MPL-2.0
/** Brand findings share the export check panel and the tool's normal undo path. */
import { applyBrandFix, checkBrandDesign, type BrandFinding } from '../../../../engine/src/brand-check.ts';
import type { TokensSnapshot } from '@lolly-tools/core/host-v1';
import { t, tRaw } from '../i18n.ts';
import type { PreflightRow } from './export-preflight.ts';

function findingText(f: BrandFinding): string {
  const fields: Record<string, string> = { bg: t('fill'), fg: t('text colour'), stroke: t('stroke'), font: t('font'), image: t('image') };
  const field = fields[f.field ?? ''] ?? t('value');
  if (f.kind === 'reference') return tRaw('“{name}”: {value} does not resolve to a colour in this design system.', { name: f.label, value: f.value ?? '' });
  if (f.kind === 'coverage') return t('No readable composition was available for brand checks.');
  if (f.status === 'unknown') return tRaw('“{name}”: the {field} could not be compared with the selected design system.', { name: f.label, field });
  if (f.kind === 'asset') return tRaw('“{name}”: this image is outside the design system’s declared asset IDs. It may be intentional.', { name: f.label });
  return tRaw('“{name}”: {field} {value} is outside this design system. Suggested: {suggestion}.', { name: f.label, field, value: f.value ?? '', suggestion: f.suggestion ?? '' });
}
export async function brandCheckRows(options: {
  boxes: () => unknown;
  snapshot: () => Promise<TokensSnapshot | undefined>;
  write: (boxes: Record<string, unknown>[]) => unknown | Promise<unknown>;
  theme?: string;
}): Promise<PreflightRow[]> {
  let snapshot: TokensSnapshot | undefined;
  try { snapshot = await options.snapshot(); } catch { snapshot = undefined; }
  const doc = snapshot?.document;
  if (!doc) return [{ id: 'brand.unavailable', tone: 'gap', text: t('The design system could not be read. Brand values have not been checked.') }];
  const report = checkBrandDesign(options.boxes(), doc, { theme: snapshot?.selection.theme ?? options.theme });
  const rows: PreflightRow[] = report.findings.slice(0, 60).map(f => ({
    id: f.id, tone: f.status === 'unknown' ? 'gap' : 'note', text: findingText(f),
    ...(f.fix ? { action: {
      label: f.kind === 'font' ? t('Use brand font') : tRaw('Use {colour}', { colour: f.suggestion ?? '' }),
      run: async () => {
        const snapshot = await options.snapshot();
        const boxes = options.boxes();
        const current = checkBrandDesign(boxes, snapshot?.document, { theme: snapshot?.selection.theme ?? options.theme });
        const stillOffered = current.findings.some(item => JSON.stringify(item.fix) === JSON.stringify(f.fix));
        const next = stillOffered ? applyBrandFix(boxes, f.fix!) : null;
        if (!next) throw new Error(t('This item changed. Close and reopen the checks to review it again.'));
        await options.write(next);
      },
    } } : {}),
  }));
  if (snapshot?.system?.label) rows.unshift({ id: 'brand.system', tone: 'note', text: tRaw('Design system: {name}', { name: snapshot.system.label }) });
  rows.push({ id: 'brand.coverage', tone: 'gap', text: tRaw('Compared {colors} colour values, {fonts} font choices and {assets} asset IDs. Gradients, effects, nested content and subjective quality were not assessed.', report.checked) });
  if (report.coverage.truncated || report.findings.length > 60) rows.push({ id: 'brand.limit', tone: 'gap', text: t('Some items are not shown. Review the rest after these items.') });
  return rows;
}
