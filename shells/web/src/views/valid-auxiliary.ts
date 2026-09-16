// SPDX-License-Identifier: MPL-2.0
/** Scoped evidence from the embedded rendition, before its raw byte preview. */
import type { FileMetadata } from '@lolly/engine';
import { escape as esc } from '../utils.ts';
import { t } from '../i18n.ts';
import { metadataValueHtml } from './valid-links.ts';

const readableValue = (label: string, value: string): string =>
  /^(Native|Stored) pixel format$/.test(label) && value === '1278226488'
    ? `${t('8-bit single channel')} (L008 · ${value})` : value;

export function auxiliaryMetadataHtml(meta: FileMetadata): string {
  const embedded = meta.appended?.metadata;
  if (!embedded) return '';
  return `<details class="valid-auxiliary"><summary><strong>${esc(embedded.name)}</strong><span>${t('XMP/RDF')} · ${t('{n} fields', { n: embedded.fields.length })}</span></summary>
    <p class="valid-origin-note">${t('Metadata from the embedded image. Not authenticated.')}</p>
    <dl class="valid-auxiliary-fields">${embedded.fields.map((field) => `<div><dt>${esc(field.label)}</dt><dd>${metadataValueHtml(readableValue(field.label, field.value))}<small>${esc(field.source ?? field.label)}</small></dd></div>`).join('')}</dl>
    <details class="valid-auxiliary-xml"><summary>${t('Original XMP/RDF')}</summary><pre>${esc(embedded.xmp)}</pre></details>
  </details>`;
}
