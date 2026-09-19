// SPDX-License-Identifier: MPL-2.0
import { BRAND_STYLE_PROPERTIES, type BrandStyleEvidence } from '../../../../../engine/src/brand-evidence.ts';
import { t, tRaw } from '../../i18n.ts';
import { escape as escapeText } from '../../utils.ts';

const labels = () => ({
  'font-family': t('Font family'), 'font-size': t('Type size'), 'font-weight': t('Weight'),
  'line-height': t('Line height'), 'letter-spacing': t('Letter spacing'), gap: t('Gap'),
  'padding-top': t('Top padding'), 'padding-right': t('Right padding'),
  'padding-bottom': t('Bottom padding'), 'padding-left': t('Left padding'), 'border-top-left-radius': t('Corner radius'),
});
export function styleEvidenceHtml(evidence: BrandStyleEvidence): string {
  const names = labels();
  return `<div class="ds-style-evidence"><h4>${t('Style observations')}</h4><p>${escapeText(evidence.mode === 'computed'
    ? tRaw('Measured from {n} visible elements in the captured page. This is a sample, not the whole site.', { n: evidence.sampled })
    : t('Read from declarations in the supplied styles. These values may not be used by the rendered page.'))}</p>
    ${evidence.truncated ? `<p>${t('The observation limit was reached. Some values are not included.')}</p>` : ''}
    ${evidence.viewport ? `<p>${escapeText(tRaw('Captured at {width} × {height} CSS pixels, with a {scheme} colour preference.', { width: evidence.viewport.width, height: evidence.viewport.height, scheme: evidence.viewport.scheme === 'dark' ? t('dark') : t('light') }))}</p>` : ''}
    <dl>${BRAND_STYLE_PROPERTIES.map(property => `<div><dt>${escapeText(names[property])}</dt><dd>${escapeText(evidence.values.filter(v => v.property === property).slice(0, 4).map(v => `${v.value} (${v.count})`).join(', ') || t('Not observed'))}</dd></div>`).join('')}</dl>
    <p>${t('Counts show occurrences in this sample. These observations do not change your typography or spacing.')}</p></div>`;
}
