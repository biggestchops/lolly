// SPDX-License-Identifier: MPL-2.0
/** One metadata path for PDF structure and image, media and text containers. */
import { extractFileMetadata } from '@lolly/engine';
import type { FileMetadata, MetaField, MetaGroup } from '@lolly/engine';
import type { HostV1 } from '@lolly-tools/core/host-v1';
import { pdfProvenanceField } from './valid-provenance.ts';
import { readHiddenPdfText } from './valid-preview.ts';

// Which section a PDF finding's label belongs in (its findings arrive as flat
// {label, detail, tone} rows from host.pdf.analyze).
// The structural scan emits a FIXED label set (bridge/pdf-structure.ts), so it
// routes by exact match rather than by the substring guessing the Info/XMP
// fields need - a new structural label should land deliberately, not by
// accident of which keyword it happens to contain.
// A Map, not an object literal: a bare `LOOKUP[label]` answers truthily for
// 'constructor' and friends, and `label` here is data read out of a file.
const PDF_STRUCTURE_LABELS = new Map<string, MetaGroup>([
  ['attachments', 'structure'], ['javascript', 'structure'], ['launch actions', 'structure'],
  ['form submission', 'structure'], ['remote documents', 'structure'], ['links', 'structure'],
  ['form values', 'structure'], ['xfa form', 'structure'], ['annotations', 'structure'],
  ['hidden layers', 'structure'], ['layers', 'structure'],
  ['digital signature', 'authorship'], ['pages', 'technical'],
]);

const pdfGroup = (label: string): MetaGroup => {
  const l = label.toLowerCase();
  const structural = PDF_STRUCTURE_LABELS.get(l);
  if (structural) return structural;
  if (l === 'created' || l === 'modified' || l.includes('date')) return 'timestamps';
  if (l.includes('produc') || l.includes('created with') || l.includes('creatortool') || l.includes('software')) return 'software';
  if (l.includes('author') || l.includes('creator')) return 'authorship';
  if (l.includes('title') || l.includes('subject') || l.includes('keyword')) return 'description';
  return 'description';
};

// PDF is parsed by the shell (pdf-lib, via host.pdf.analyze); every other format
// is read by the DOM-free engine extractor. Never throws - worst case, undefined.
export async function readVerifyMetadata(host: HostV1, bytes: Uint8Array, file: File): Promise<FileMetadata | undefined> {
  const isPdf = bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
  if (!isPdf) return extractFileMetadata(bytes);
  try {
    const findings = (await host.pdf?.analyze(bytes))?.findings ?? [];
    const fields: MetaField[] = findings.map((f) => ({ label: f.label, value: f.detail, group: pdfGroup(f.label), sensitive: f.tone === 'warn', ...pdfProvenanceField(f.label) }));
    // Prepended, not appended: within its section this is the row that matters
    // most, and it should not sit below the page count.
    const hidden = await readHiddenPdfText(host, file, bytes);
    if (hidden) fields.unshift(hidden);
    return { format: 'PDF', fields };
  } catch { return undefined; }
}
