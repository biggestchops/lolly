// SPDX-License-Identifier: MPL-2.0
/** Export the current verification with the active brand's UI tokens. */
import type { HostV1 } from '@lolly-tools/core/host-v1';
import { announce } from '../a11y.ts';
import { escape as esc } from '../utils.ts';
import { t, tRaw } from '../i18n.ts';

export async function saveReportCard(host: HostV1, btn: HTMLButtonElement): Promise<void> {
  const scope = btn.closest('.valid-result');
  if (!scope) return;
  const span = btn.querySelector('span');
  const orig = span?.textContent ?? '';
  btn.disabled = true;
  if (span) span.textContent = t('Preparing…');
  try {
    const heroName = scope.querySelector('.valid-hero-filename')?.textContent ?? 'file';
    const verdict = scope.querySelector('.valid-hero-pill, .valid-hero-verdict')?.textContent?.trim() ?? '';
    const lampRows = [...scope.querySelectorAll('.lampstrip .lamp')].map((l) => ({
      state: l.getAttribute('data-state') ?? 'unlit',
      label: l.querySelector('.lamp-label')?.textContent ?? '',
      word: l.querySelector('.lamp-word')?.textContent ?? '',
    }));
    const receiptLine = scope.querySelector('.valid-receipt .guide-fact')?.textContent ?? '';
    const node = document.createElement('div');
    node.className = 'valid-report-export';
    const dotColor: Record<string, string> = { fact: '#2fae62', warn: '#e0453a', hint: '#eba13c', unlit: '#5a6472' };
    node.innerHTML = `
      <div class="valid-report-export-kicker">${esc(t('Verification report'))} · Lolly</div>
      <div class="valid-report-export-title">${esc(heroName)}</div>
      <div class="valid-report-export-verdict">${esc(verdict)}</div>
      ${lampRows.map((l) => `<div class="valid-report-export-row"><span class="valid-report-export-dot" style="background:${dotColor[l.state] ?? dotColor.unlit}"></span><strong>${esc(l.label)}</strong><span class="valid-report-export-muted">${esc(l.word)}</span></div>`).join('')}
      <div class="valid-report-export-receipt">${esc(receiptLine)}</div>
      <div class="valid-report-export-foot">${esc(tRaw('Checked on this device with Lolly · {date} · lolly.tools/verify', { date: new Date().toLocaleString() }))}</div>`;
    document.body.appendChild(node);
    try {
      const png = await host.export.render(node, 'png');
      let bytes = new Uint8Array(await png.arrayBuffer());
      try {
        if (host.c2pa?.sign) bytes = new Uint8Array(await host.c2pa.sign(bytes, 'png', {}));
      } catch { /* unsigned beats no report - the card still says what it is */ }
      await host.export.file(new Blob([bytes as BlobPart], { type: 'image/png' }), { filename: `${heroName.replace(/\.[a-z0-9]+$/i, '')}-verification.png` });
      announce(t('Report card saved.'));
    } finally { node.remove(); }
  } catch {
    announce(t('The report card could not be created.'));
  } finally {
    btn.disabled = false;
    if (span) span.textContent = orig;
  }
}
