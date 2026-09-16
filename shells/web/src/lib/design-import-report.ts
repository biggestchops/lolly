// SPDX-License-Identifier: MPL-2.0
/** Import findings travel with the author's source, never with the recipient tool. */
export interface DesignImportFinding {
  page: number;
  kind: 'fixed' | 'review';
  message: string;
  object?: string;
}
const reports = new WeakMap<Blob, DesignImportFinding[]>();
export function setDesignImportReport(file: Blob, findings: DesignImportFinding[]): void { reports.set(file, findings); }
export function getDesignImportReport(file: Blob): DesignImportFinding[] { return reports.get(file) || []; }
