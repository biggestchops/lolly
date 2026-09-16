// SPDX-License-Identifier: MPL-2.0
/** Progress changes only when Verify starts the corresponding local operation. */
import { escape as esc } from '../utils.ts';
import { t } from '../i18n.ts';
import { LOLLY_MARK_SVG } from '../lib/lolly-mark.ts';
import { icon } from '../lib/icons.ts';
const phases = {
  bytes: ['Reading the file', 'Lolly reads the bytes on this device.'],
  credentials: ['Checking Content Credentials', 'Looking for C2PA records and checking available signatures and file hashes.'],
  seal: ['Checking text signatures', 'Looking for an embedded SEAL record. External keys are not fetched.'],
  metadata: ['Reading embedded metadata', 'Looking for software, creators, dates, locations and licence declarations.'],
  pixels: ['Checking image signals', 'Looking for Lolly Imprints and checking supported images for hidden pixel data.'],
  container: ['Checking embedded images', 'Looking for Lolly Imprints in supported document images.'],
  history: ['Checking local export history', 'Comparing the file with exports saved on this device.'],
  text: ['Reading text signals', 'Checking text for recorded markers and writing patterns.'],
} as const;
export type VerifyPhase = keyof typeof phases;
export function checkingHtml(message: string, queued = false): string {
  return `<div class="valid-loading" role="status"><p class="valid-loading-text">${esc(message)}</p><span class="valid-loading-mark" aria-hidden="true">${LOLLY_MARK_SVG}</span><strong data-verify-stage>${queued ? t('Waiting to check') : t(phases.bytes[0])}</strong><p data-verify-stage-note>${queued ? t('Files are checked one at a time to limit memory use.') : t(phases.bytes[1])}</p><span class="valid-loading-private">${icon('shield')}${t('On this device')}</span></div>`;
}
export async function updateVerifyProgress(root: HTMLElement, phase: VerifyPhase, index: number): Promise<void> {
  const card = root.querySelector<HTMLElement>(`[data-card-index="${index}"] .valid-loading`) ?? root.querySelector<HTMLElement>('.valid-loading');
  if (!card) return;
  const badge = card.closest('.valid-item')?.querySelector('.valid-item-badge');
  if (badge) badge.textContent = t('Checking…');
  const title = card.querySelector('[data-verify-stage]'), note = card.querySelector('[data-verify-stage-note]');
  if (title) title.textContent = t(phases[phase][0]);
  if (note) note.textContent = t(phases[phase][1]);
  // Yield to painting before synchronous parsing. No timer claims a check finished.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
