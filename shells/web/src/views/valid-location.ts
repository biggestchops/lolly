// SPDX-License-Identifier: MPL-2.0
/** Explicit handoff to OpenStreetMap's own reverse-address lookup website. */
import { mountModal } from '../components/modal.ts';
import { escape as esc } from '../utils.ts';
import { t } from '../i18n.ts';

export function addressLookupUrl(lat: number, lon: number): string | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const url = new URL('https://nominatim.openstreetmap.org/ui/reverse.html');
  url.searchParams.set('lat', lat.toFixed(5));
  url.searchParams.set('lon', lon.toFixed(5));
  url.searchParams.set('zoom', '18');
  return url.href;
}

export function wireAddressRequests(root: HTMLElement): void {
  root.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-request-address]') : null;
    if (!button?.dataset.lat || !button.dataset.lon) return;
    const lat = Number(button.dataset.lat), lon = Number(button.dataset.lon);
    const url = addressLookupUrl(lat, lon);
    if (!url) return;
    // Use the provider's website: a distributed client cannot enforce the public
    // API's application-wide rate cap. https://operations.osmfoundation.org/policies/nominatim/
    const modal = mountModal(`<h2 class="modal-title">${t('Request address?')}</h2>
      <p class="modal-msg">${t('OpenStreetMap Nominatim will receive these coordinates and your IP address. The asset stays on this device.')}</p>
      <div class="valid-link-destination"><strong>${lat.toFixed(5)}, ${lon.toFixed(5)}</strong><br>nominatim.openstreetmap.org</div>
      <p class="modal-msg">${t('The lookup opens in a new tab. Do not send private or confidential locations. Addresses are approximate.')}</p>
      <p class="valid-location-service"><a href="https://operations.osmfoundation.org/policies/nominatim/" target="_blank" rel="noopener noreferrer">${t('Service usage policy')}</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a></p>
      <div class="modal-actions"><button type="button" class="btn" data-address-cancel>${t('Cancel')}</button><a class="btn" href="${esc(url)}" target="_blank" rel="noopener noreferrer" data-address-open>${t('Request address')} ↗</a></div>`, {
      className: 'modal valid-link-dialog valid-address-dialog', ariaLabel: t('Request address?'),
      initialFocus: (el) => el.querySelector<HTMLElement>('[data-address-cancel]'),
    });
    modal.el.querySelector('[data-address-cancel]')?.addEventListener('click', () => modal.close());
    modal.el.querySelector('[data-address-open]')?.addEventListener('click', () => { setTimeout(() => modal.close(), 0); });
  });
}
