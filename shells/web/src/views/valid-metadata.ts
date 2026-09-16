// SPDX-License-Identifier: MPL-2.0
/** Readable metadata groups with raw values kept one level below the report. */
import { META_GROUP_ORDER, META_GROUP_LABEL, isStrippableFormat } from '@lolly/engine';
import type { FileMetadata, MetaGroup } from '@lolly/engine';
import { icon, type IconName } from '../lib/icons.ts';
import { escape as esc } from '../utils.ts';
import { t } from '../i18n.ts';
import { metadataValueHtml, metadataUrl, contactUrl, contactLinkHtml } from './valid-links.ts';
const groupIcons: Record<MetaGroup, IconName> = {
  location: 'mapPin', device: 'cpu', capture: 'camera', software: 'tool', authorship: 'user',
  timestamps: 'calendar', description: 'document', structure: 'package', technical: 'hash',
};

export function renderMetadata(meta: FileMetadata | undefined, fileIndex: number): string {
  if (!meta?.fields.length) return '';
  const hasLinks = meta.fields.some((f) => f.label === 'Link');
  const groups = META_GROUP_ORDER.map((group) => ({ group, fields: meta.fields.filter((f) => f.group === group
    && !(f.label === 'Link' && metadataUrl(f.value)) && !(f.label === 'Links' && hasLinks)) })).filter((g) => g.fields.length);
  return `<details class="valid-meta valid-panel-disclosure" open><summary class="valid-meta-head"><h3>${icon('eye')}<span>${t('Embedded metadata')}</span></h3><span class="valid-meta-count">${t('{n} fields', { n: meta.fields.length })} · ${esc(meta.format)}</span><span class="valid-disclosure-chev" aria-hidden="true">${icon('chevronDown')}</span></summary>
    <div class="valid-meta-body"><div class="valid-meta-actions"><span>${t('Editable values recorded in this file.')}</span>${isStrippableFormat(meta.format) ? `<button type="button" class="btn" data-clean-copy="${fileIndex}" data-clean-format="${esc(meta.format)}">${icon('download')}<span>${t('Cleaned copy')}</span></button>` : ''}<a class="btn" href="#/tool/strip-data">${icon('eye')}<span>${t('Hidden Data')}</span></a>${new Set(['JPEG', 'PNG', 'WEBP', 'SVG', 'PDF']).has(meta.format.toUpperCase()) ? `<a class="btn" href="#/tool/redact">${icon('pen')}<span>${t('Redact')}</span></a>` : ''}</div>
    <div class="valid-meta-grid">${groups.map(({ group, fields }) => `<details class="valid-meta-group"${group !== 'technical' ? ' open' : ''}><summary><h4>${icon(groupIcons[group])}<span>${esc(t(META_GROUP_LABEL[group]))}</span></h4><small>${fields.length}</small>${icon('chevronDown')}</summary><dl>${fields.map((f) => `<div class="valid-meta-row${f.sensitive ? ' is-sensitive' : ''}"><dt title="${esc(f.source ?? f.label)}">${esc(f.label)}</dt><dd>${contactUrl(f.value) && /email|phone|contact|^Link$/i.test(f.label) ? contactLinkHtml(f.value) : metadataValueHtml(f.value)}</dd></div>`).join('')}</dl></details>`).join('')}</div></div></details>`;
}
