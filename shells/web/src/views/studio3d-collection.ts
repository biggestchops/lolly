// SPDX-License-Identifier: MPL-2.0
/** Review a saved collection and deliver it through the existing batch job. */
import './studio3d-collection.css';
import { type InputModelItem, matchesShowIf } from '../../../../engine/src/inputs.ts';
import type { Runtime } from '../../../../engine/src/runtime.ts';
import {
  type StudioValues,
  studioCollectionRows,
  studioCollectionSize,
} from '../../../../engine/src/studio3d-collection.ts';
import { mountModal } from '../components/modal.ts';
import { isBatchRunActive, startBatchExport } from '../lib/batch-job.ts';
import { renderStudioCollection } from '../lib/studio3d/collection-preview.ts';
import type { PanelEl, WebToolHost } from './tool.ts';
import { syncInputs } from './tool-inputs.ts';

const controls = new Set([
  'studio',
  'materialMode',
  'colorA',
  'colorB',
  'finishA',
  'finishB',
  'surfaceFinishes',
  'faceFinishA',
  'bevelFinishA',
  'sideFinishA',
  'faceFinishB',
  'bevelFinishB',
  'sideFinishB',
  'exposure',
  'collectionSize',
]);
const open = new WeakSet<Runtime>();

export function openStudioCollection(runtime: Runtime, host: WebToolHost): void {
  if (open.has(runtime)) return;
  open.add(runtime);
  let closed = false,
    timer = 0,
    generation = 0;
  let abort = new AbortController(),
    work = Promise.resolve();
  let unsubscribe = () => {};
  const urls = new Set<string>();
  const releaseImages = () => {
    for (const url of urls) URL.revokeObjectURL(url);
    urls.clear();
  };
  const dialog = mountModal(
    `<header><h2>Review collection</h2><button type="button" data-studio-close aria-label="Close collection review">Close</button></header>
    <p>Change the shared look here. Edit an item to adjust its framing. Save the studio to keep the whole collection together.</p>
    <div class="studio-collection-layout"><div data-studio-collection-controls class="tool-inputs"></div>
      <div><p data-studio-collection-status role="status">Preparing previews...</p><div data-studio-collection-grid></div></div></div>
    <footer><span>Previews use 8 samples. Exports use the saved render quality and start at the beginning of the animation loop.</span>
      <button type="button" data-studio-set-export disabled>Export PNG set</button></footer>`,
    {
      className: 'studio-collection-dialog',
      ariaLabel: 'Review studio collection',
      onClose: () => {
        closed = true;
        generation++;
        clearTimeout(timer);
        abort.abort();
        unsubscribe();
        panel._inputsDispose?.();
        releaseImages();
        open.delete(runtime);
      },
    }
  );
  const panel = dialog.el.querySelector<PanelEl>('[data-studio-collection-controls]')!;
  const grid = dialog.el.querySelector<HTMLElement>('[data-studio-collection-grid]')!;
  const status = dialog.el.querySelector<HTMLElement>('[data-studio-collection-status]')!;
  const exporting = dialog.el.querySelector<HTMLButtonElement>('[data-studio-set-export]')!;
  let previous: InputModelItem[] | null = null,
    lastKey = '',
    lastModel = '',
    snapshot: StudioValues | null = null;
  const readValues = (): StudioValues =>
    Object.fromEntries(runtime.getModel().map((item) => [item.id, item.value]));
  const read = async (url: string, signal: AbortSignal): Promise<Uint8Array> => {
    signal.throwIfAborted();
    if (!host.assets.bytes) throw new Error('Asset bytes are unavailable in this app.');
    const bytes = await host.assets.bytes(url);
    signal.throwIfAborted();
    return bytes;
  };
  const refresh = (values: StudioValues, resolved: StudioValues) => {
    abort.abort();
    abort = new AbortController();
    const signal = abort.signal,
      gen = ++generation;
    exporting.disabled = true;
    snapshot = null;
    status.textContent = 'Updating previews...';
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      work = work
        .catch(() => {})
        .then(async () => {
          if (closed || gen !== generation) return;
          releaseImages();
          grid.replaceChildren();
          try {
            const rows = studioCollectionRows(resolved),
              size = studioCollectionSize(values);
            const cards = rows.map((row) => {
              const card = document.createElement('article');
              const image = document.createElement('div');
              image.className = 'studio-collection-image';
              image.style.aspectRatio = `${size.width} / ${size.height}`;
              const name = document.createElement('h3');
              name.textContent = row.name;
              const detail = document.createElement('p');
              detail.textContent = row.ownFraming ? 'Own framing' : 'Shared framing';
              const edit = document.createElement('button');
              edit.type = 'button';
              edit.textContent = `Edit ${row.name}`;
              edit.onclick = () => {
                void runtime.setInput('activeSubject', row.index + 1);
                dialog.close();
              };
              card.append(image, name, detail, edit);
              grid.append(card);
              return { image, detail };
            });
            let done = 0,
              failed = 0;
            await renderStudioCollection(rows, read, signal, size, (row, result) => {
              if (closed || gen !== generation) return;
              const card = cards[row.index]!;
              if (result instanceof Error) {
                failed++;
                card.detail.textContent = result.message;
                card.detail.setAttribute('role', 'alert');
              } else {
                const url = URL.createObjectURL(result);
                urls.add(url);
                const img = document.createElement('img');
                img.src = url;
                img.alt = `${row.name}, rendered in this studio`;
                card.image.append(img);
              }
              status.textContent = `Rendered ${++done} of ${rows.length}`;
            });
            if (closed || gen !== generation) return;
            status.textContent = failed
              ? `${failed} item(s) need attention before export.`
              : `${rows.length} previews ready. All share this studio.`;
            if (!failed) {
              snapshot = structuredClone(values);
              exporting.disabled = false;
            }
          } catch (error) {
            if (!closed && gen === generation && !signal.aborted)
              status.textContent = (error as Error).message;
          }
        });
    }, 250);
  };
  unsubscribe = runtime.subscribe(() => {
    if (closed) return;
    const model = runtime.getModel();
    const values = readValues();
    previous = syncInputs(
      panel,
      model
        .filter((item) => controls.has(item.id) && matchesShowIf(item.showIf, values))
        .map((item) => ({ ...item, showIf: undefined })),
      previous,
      runtime,
      host,
      () => {},
      '3d-studio'
    );
    if (values.source !== 'collection') {
      dialog.close();
      return;
    }
    const modelKey = JSON.stringify(values);
    if (modelKey !== lastModel) {
      lastModel = modelKey;
      abort.abort();
      generation++;
      clearTimeout(timer);
      snapshot = null;
      exporting.disabled = true;
      status.textContent = 'Updating previews...';
    }
    // Read the same settled marker as the main renderer, including resolved asset URLs.
    const key = runtime.getHydrated();
    if (key !== lastKey) {
      lastKey = key;
      const template = document.createElement('template');
      template.innerHTML = key;
      const marker = template.content.querySelector<HTMLElement>('[data-lolly-studio]');
      if (marker?.dataset.lollyStudio) {
        const resolved = JSON.parse(marker.dataset.lollyStudio) as { values: StudioValues };
        refresh(structuredClone(values), resolved.values);
      }
    }
  });
  dialog.el.querySelector<HTMLButtonElement>('[data-studio-close]')!.onclick = () => dialog.close();
  exporting.onclick = () => {
    if (!snapshot || closed) return;
    if (isBatchRunActive()) {
      status.textContent = 'Wait for the current batch export to finish.';
      return;
    }
    const values = structuredClone(snapshot),
      size = studioCollectionSize(values);
    const rows = studioCollectionRows(values).map((row) => ({
      toolId: '3d-studio',
      values: row.values,
      filename: row.filename,
      format: 'png',
      outWidth: size.width,
      outHeight: size.height,
    }));
    const name = String(values.collectionName || 'Studio collection').slice(0, 120);
    startBatchExport(`Rendering ${name}`, async (job) => {
      const { runBatchWithProgress } = await import('../pro/run-overlay.ts');
      return runBatchWithProgress(host, rows, { job, format: 'png', zipBaseName: name });
    });
    status.textContent =
      'PNG set queued. Progress and cancellation are available in the job notification.';
  };
}
