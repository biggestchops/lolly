// SPDX-License-Identifier: MPL-2.0
import { t } from '../../i18n.ts';
import { mountModal, type ModalHandle } from '../../components/modal.ts';
import type { TpCtx } from './context.ts';

/** A rendered preview uses the export executor, including its audio mix. */
export function rangePreviewOps(tp: TpCtx) {
  let modal: ModalHandle<void> | null = null;
  let abort: AbortController | null = null;
  let url = '';
  let shuttleFrame = 0;
  let rate = 0;
  const stopShuttle = (): void => {
    cancelAnimationFrame(shuttleFrame); shuttleFrame = 0; rate = 0;
  };
  const close = (): void => {
    abort?.abort(); abort = null;
    modal?.el.querySelector('video')?.pause();
    if (url) { URL.revokeObjectURL(url); url = ''; }
    modal = null;
  };
  return {
    async open(): Promise<void> {
      if (modal || tp.disposed) return;
      stopShuttle(); tp.clock.pause(); tp.playback.syncPlayBtn();
      const controller = new AbortController(); abort = controller;
      const view = mountModal('', { className: 'modal tl-mix-preview', ariaLabel: t('Preview mix'), onClose: close });
      modal = view;
      const title = document.createElement('h2'); title.textContent = t('Preview mix');
      const status = document.createElement('p'); status.textContent = t('Rendering'); status.setAttribute('role', 'status');
      const done = document.createElement('button'); done.type = 'button'; done.className = 'btn'; done.textContent = t('Close'); done.addEventListener('click', () => view.close());
      view.el.append(title, status, done);
      try {
        const { renderSequence } = await import('../../bridge/sequence-render.ts');
        if (controller.signal.aborted) return;
        const size = tp.opts.frameSize?.();
        const width = Math.min(960, size?.w ?? 960);
        const blob = await renderSequence(tp.canvasEl, 'mp4', { width, signal: controller.signal,
          onProgress: (n, total) => { status.textContent = `${t('Rendering')} ${Math.round(n / Math.max(1, total) * 100)}%`; } }, { log: tp.host.log });
        if (controller.signal.aborted || tp.disposed) return;
        url = URL.createObjectURL(blob);
        const video = document.createElement('video'); video.controls = true; video.playsInline = true; video.src = url;
        status.replaceWith(video); await video.play().catch(() => { /* controls remain available */ });
      } catch (error) {
        if (!controller.signal.aborted) { status.textContent = t('Could not render preview'); tp.host.log?.('warn', String(error)); }
      }
    },
    shuttle(direction: number): void {
      const next = Math.sign(rate) === direction ? Math.min(4, Math.abs(rate) * 2) : 1;
      stopShuttle(); tp.clock.pause(); rate = direction * next;
      let previous = performance.now();
      const tick = (now: number): void => {
        if (tp.disposed || !tp.open || !rate || tp.clock.playing()) { stopShuttle(); return; }
        const at = tp.clock.t() + (now - previous) * rate; previous = now;
        const end = tp.clock.duration();
        tp.clock.seek(Math.max(0, Math.min(end, at)), { scrubbing: true });
        if (at <= 0 || at >= end) { stopShuttle(); return; }
        shuttleFrame = requestAnimationFrame(tick);
      };
      shuttleFrame = requestAnimationFrame(tick);
    },
    stopShuttle,
    destroy(): void { stopShuttle(); modal?.close(); close(); },
  };
}
