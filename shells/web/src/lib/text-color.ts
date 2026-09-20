// SPDX-License-Identifier: MPL-2.0
/** Text uses the shared colour field and retains its authored colour space. */
import { mountColorField } from '../components/color-field.ts';
import { t } from '../i18n.ts';
export function mountTextColor(root: HTMLElement, initial: string, change: (color: string) => void, opening?: () => void) {
  root.classList.add('text-color-control');
  let value = initial;
  const id = `text-ink-${crypto.randomUUID()}`;
  const isOpen = () => !!root.querySelector('.color-popover:not([hidden])');
  function mount() {
    mountColorField(root, id, { value, float: true, modes: true, onChange(hex, detail) { value = detail?.css ?? (hex === 'transparent' ? '#00000000' : hex); change(value); } });
    const trigger = root.querySelector<HTMLElement>('.color-trigger')!;
    trigger.setAttribute('aria-label', t('Text colour')); trigger.title = t('Text colour');
    trigger.addEventListener('click', () => { if (!isOpen()) opening?.(); }, { capture: true });
  }
  mount();
  return {
    isOpen,
    close() { const popover = root.querySelector<HTMLElement>('.color-popover:not([hidden])'); if (!popover) return false; root.querySelector<HTMLElement>('.color-trigger')?.click(); return true; },
    update(next: string, mixed = false) {
      if (next !== value && !isOpen() && !root.contains(document.activeElement)) { value = next; mount(); }
      root.querySelector('.color-trigger')?.setAttribute('aria-label', mixed ? t('Text colour: Mixed') : t('Text colour'));
    },
  };
}
