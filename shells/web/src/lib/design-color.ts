// SPDX-License-Identifier: MPL-2.0
/** Preserve authored Design colours and token links under the document's range policy. */
import { tokenColorVar } from '../../../../engine/src/color-face.ts';
import type { ColorFieldValue, ColorChangeDetail } from '../components/color-field.ts';

export function designColorValue(value: ColorFieldValue, editingRange: unknown, detail?: ColorChangeDetail): string {
  if (typeof value === 'object') return `var(${tokenColorVar(value.ref)}, ${value.value})`;
  return editingRange === 'hdr' && detail ? detail.css : value;
}
