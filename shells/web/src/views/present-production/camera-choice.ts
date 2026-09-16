// SPDX-License-Identifier: MPL-2.0
import { enumerateInputs } from '../../components/device-picker.ts';
import { t } from '../../i18n.ts';

/** Device choices are local to this presentation and never become saved scene fields. */
export function mountCameraChoice(doc: Document, host: HTMLElement, initial: string, choose: (id: string) => void) {
  const label = doc.createElement('label'); label.textContent = t('Camera device');
  const select = doc.createElement('select'); select.setAttribute('aria-label', t('Camera device'));
  label.append(select); host.append(label);
  let selected = initial, epoch = 0, disposed = false;
  async function refresh(): Promise<void> {
    const mine = ++epoch, { cameras } = await enumerateInputs();
    if (disposed || mine !== epoch) return;
    select.replaceChildren();
    const add = (value: string, text: string) => { const option = doc.createElement('option'); option.value = value; option.textContent = text; select.append(option); };
    add('', t('Default camera'));
    for (const camera of cameras) add(camera.deviceId, camera.label);
    if (selected && !cameras.some(camera => camera.deviceId === selected)) add(selected, t('Selected camera unavailable'));
    select.value = selected;
  }
  select.addEventListener('change', () => { selected = select.value; choose(selected); });
  const media = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
  media?.addEventListener?.('devicechange', refresh);
  void refresh();
  return { refresh, dispose: () => { disposed = true; ++epoch; media?.removeEventListener?.('devicechange', refresh); label.remove(); } };
}
