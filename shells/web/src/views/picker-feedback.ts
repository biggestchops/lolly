// SPDX-License-Identifier: MPL-2.0
import { t } from '../i18n.ts';
import { announce } from '../a11y.ts';
import type { CollectResult } from './picker.ts';

export const collectOk = (r: CollectResult | boolean): boolean => typeof r === 'boolean' ? r : r.ok;
export const collectLabel = (r: CollectResult | boolean): string =>
  (typeof r === 'object' && r.label) || (collectOk(r) ? t('Added') : t('Couldn’t add'));
// Flash a tile as added (green ✓ overlay) or failed, then restore - the dialog stays
// open so several items can be gathered in a row. The card owns `position:relative`
// already (the format badge sits on it), so the overlay pins cleanly.
export function flashCard(el: HTMLElement, r: CollectResult | boolean): void {
  const ok = collectOk(r), label = collectLabel(r);
  const card = el.closest<HTMLElement>('.asset-picker-toolcell, .asset-picker-card, .asset-picker-toolitem') ?? el;
  card.classList.add(ok ? 'is-added' : 'is-addfail');
  const badge = document.createElement('span');
  badge.className = 'asset-picker-added';
  badge.textContent = (ok ? '✓ ' : '') + label;
  card.appendChild(badge);
  announce(label);
  setTimeout(() => { badge.remove(); card.classList.remove('is-added', 'is-addfail'); }, 1200);
}
