// SPDX-License-Identifier: MPL-2.0
import type { CameraState } from './camera.ts';
import type { PresentationContent } from './source.ts';
import { t } from '../../i18n.ts';
import { mountCameraChoice } from './camera-choice.ts';
import { mountCameraFraming } from './framing.ts';
import { mountPreparedScenes } from './prepared-scenes.ts';
import { cameraCrop, layoutBoxes, readScene, type PresentationScene, type Layout, type LogoAsset, type PreparedScene } from './scene.ts';

export interface ProductionControls {
  content?: PresentationContent;
  scene: PresentationScene;
  apply(scene: PresentationScene): Promise<boolean>;
  camera(on: boolean): void;
  cameraDevice?: string;
  chooseCamera?(deviceId: string): void;
  savePrepared?(scenes: PreparedScene[]): void;
  cue(on: boolean): void;
  upload(file: File): Promise<LogoAsset>;
  record(audio: boolean): void;
  recordingSupported: boolean;
  close(): void;
}

/** All controls are built in the private popup's document, including file selection. */
export function mountProductionControls(doc: Document, host: HTMLElement, api: ProductionControls) {
  const root = doc.createElement('section'); root.className = 'pr-production-controls';
  const header = doc.createElement('header'); header.className = 'pr-production-header';
  const title = doc.createElement('h2'); title.textContent = t('Presentation');
  const hint = doc.createElement('p'); hint.textContent = t('Share the audience window. These controls stay private.');
  const status = doc.createElement('p'); status.setAttribute('role', 'status');
  const sourceStatus = doc.createElement('p'); sourceStatus.setAttribute('role', 'status');
  const recordStatus = doc.createElement('p'); recordStatus.setAttribute('role', 'status');
  status.textContent = t('Output ready to share.');
  header.append(title, hint);
  const scroll = doc.createElement('div'); scroll.className = 'pr-production-scroll';
  const footer = doc.createElement('footer'); footer.className = 'pr-production-footer';
  root.append(header, scroll, footer);
  let target: HTMLElement = scroll;
  const releaseContentControls = api.content?.controls(scroll);
  function section(label: string, open = false): HTMLElement {
    const details = doc.createElement('details'); details.className = 'pr-production-section'; details.open = open;
    const summary = doc.createElement('summary'); summary.textContent = label; details.append(summary);
    const body = doc.createElement('div'); body.className = 'pr-production-fields'; details.append(body); scroll.append(details);
    return body;
  }
  let draft = readScene(api.scene);
  const fields: Array<() => void> = [];
  const writers: Array<() => void> = [];
  let position: ReturnType<typeof mountCameraFraming> | null = null;
  const preview = doc.createElement('div'); preview.className = 'pr-prepared-camera';
  const self = doc.createElement('video'); self.muted = true; self.playsInline = true;
  preview.append(self);
  let selfMirror = false;
  function previewCrop(): void {
    for (const read of fields) read();
    const normalized = readScene(draft), box = layoutBoxes(normalized).camera;
    const width = Math.min(192, 128 * box.w / box.h), height = width * box.h / box.w;
    preview.style.width = `${width}px`; preview.style.height = `${height}px`;
    const sw = self.videoWidth || 1280, sh = self.videoHeight || 720;
    const crop = cameraCrop(sw, sh, box, normalized.camera), scale = width / crop.w;
    Object.assign(self.style, { width: `${sw * scale}px`, height: `${sh * scale}px`, left: `${-crop.x * scale}px`, top: `${-crop.y * scale}px` });
    preview.style.transform = selfMirror ? 'scaleX(-1)' : '';
    position?.update(normalized);
  }
  const readDraft = () => { for (const read of fields) read(); return readScene(draft); };
  const prepare = (scene: PresentationScene) => { draft = readScene(scene); for (const write of writers) write(); previewCrop(); };
  self.addEventListener('resize', previewCrop);
  root.addEventListener('input', previewCrop);
  function button(label: string, run: () => void): HTMLButtonElement {
    const b = doc.createElement('button'); b.type = 'button'; b.className = 'btn btn--ghost'; b.textContent = label;
    b.addEventListener('click', run); target.append(b); return b;
  }
  function labelFor(label: string, input: HTMLElement): void {
    input.setAttribute('aria-label', label);
    const wrapper = doc.createElement('label'); wrapper.textContent = label; wrapper.append(input); target.append(wrapper);
  }
  const layout = doc.createElement('select');
  for (const [value, label] of [ ['content', t('Content only')], ['inset', t('Camera inset')], ['side', t('Side by side')],
    ['camera', t('Camera full screen')], ['holding', t('Holding screen')] ]) {
    const option = doc.createElement('option'); option.value = value!; option.textContent = label!; layout.append(option);
  }
  layout.value = draft.layout; labelFor(t('Prepared scene'), layout);
  fields.push(() => { draft.layout = layout.value as Layout; });
  writers.push(() => { layout.value = draft.layout; });
  const releaseScenes = api.savePrepared ? mountPreparedScenes(doc, scroll, {
    read: readDraft, ready: () => !uploading,
    prepare: scene => { ++uploadEpoch; uploading = false; file.value = ''; apply.disabled = applying; prepare(scene); },
    save: api.savePrepared, status: message => { status.textContent = message; },
  }) : undefined;
  target = section(t('Camera'), true);
  const cameraChoice = mountCameraChoice(doc, target, api.cameraDevice ?? '', id => api.chooseCamera?.(id));
  const cameraRow = doc.createElement('div'); cameraRow.className = 'pr-camera-row'; target.append(cameraRow);
  const cameraBody = target; target = cameraRow;
  let cameraOn = false;
  const cameraButton = button(t('Start camera'), () => api.camera(!cameraOn));
  cameraRow.append(sourceStatus);
  target = cameraBody; target.append(preview);
  const framing = doc.createElement('details'); framing.className = 'pr-camera-framing';
  const framingTitle = doc.createElement('summary'); framingTitle.textContent = t('Framing'); framing.append(framingTitle);
  target.append(framing); target = framing;
  position = mountCameraFraming(doc, framing, box => {
    draft.camera.box = box; for (const write of writers) write(); previewCrop();
  });
  function number(label: string, get: () => number, min: number, max: number, step: number, set: (value: number) => void): void {
    const input = doc.createElement('input'); input.type = 'number'; input.min = String(min); input.max = String(max); input.step = String(step); input.value = String(get());
    labelFor(label, input); fields.push(() => set(input.valueAsNumber));
    writers.push(() => { input.value = String(get()); });
  }
  function check(label: string, get: () => boolean, set: (value: boolean) => void): HTMLInputElement {
    const input = doc.createElement('input'); input.type = 'checkbox'; input.checked = get();
    labelFor(label, input); fields.push(() => set(input.checked)); writers.push(() => { input.checked = get(); }); return input;
  }
  for (const [key, label, max] of [['x', t('Camera left'), 1184], ['y', t('Camera top'), 648], ['w', t('Camera width'), 1280], ['h', t('Camera height'), 720]] as const) {
    number(label, () => draft.camera.box[key], key === 'w' ? 96 : key === 'h' ? 72 : 0, max, 1, v => { draft.camera.box[key] = v; });
  }
  number(t('Camera crop zoom'), () => draft.camera.zoom, 1, 4, 0.1, v => { draft.camera.zoom = v; });
  check(t('Fit whole camera image'), () => draft.camera.fit === 'contain', v => { draft.camera.fit = v ? 'contain' : 'cover'; });
  number(t('Camera crop horizontal'), () => draft.camera.focalX, 0, 1, 0.05, v => { draft.camera.focalX = v; });
  number(t('Camera crop vertical'), () => draft.camera.focalY, 0, 1, 0.05, v => { draft.camera.focalY = v; });
  number(t('Camera corner radius'), () => draft.camera.radius, 0, 120, 1, v => { draft.camera.radius = v; });
  number(t('Camera border width'), () => draft.camera.border, 0, 12, 1, v => { draft.camera.border = v; });
  check(t('Mirror camera in output'), () => draft.camera.mirror, v => { draft.camera.mirror = v; });
  check(t('Mirror my private preview'), () => selfMirror, v => { selfMirror = v; });
  target = section(t('Logo'));
  const file = doc.createElement('input'); file.type = 'file'; file.accept = 'image/png,image/jpeg,image/webp,image/svg+xml';
  labelFor(t('Logo image'), file);
  let uploading = false, applying = false, uploadEpoch = 0;
  file.addEventListener('change', () => {
    const picked = file.files?.[0]; if (!picked) return;
    const epoch = ++uploadEpoch;
    uploading = true; apply.disabled = true; status.textContent = t('Loading logo…');
    void api.upload(picked).then(asset => { if (epoch === uploadEpoch) { draft.logo.asset = asset; status.textContent = t('Logo prepared. Apply to show it.'); } },
      () => { if (epoch === uploadEpoch) status.textContent = t('Could not load this logo.'); }).finally(() => {
        if (epoch === uploadEpoch) { uploading = false; apply.disabled = applying; }
      });
  });
  button(t('Remove logo'), () => { ++uploadEpoch; uploading = false; apply.disabled = applying; draft.logo.asset = null; file.value = ''; status.textContent = t('Apply to remove the logo.'); });
  number(t('Logo width'), () => draft.logo.width, 48, 400, 1, v => { draft.logo.width = v; });
  check(t('Logo at top left'), () => draft.logo.anchor === 'left', v => { draft.logo.anchor = v ? 'left' : 'right'; });
  function text(label: string, get: () => string, max: number, set: (value: string) => void): void {
    const input = doc.createElement('input'); input.type = 'text'; input.value = get(); input.maxLength = max;
    labelFor(label, input); fields.push(() => set(input.value)); writers.push(() => { input.value = get(); });
  }
  target = section(t('Lower third'), true);
  text(t('Lower-third name'), () => draft.lower.title, 90, v => { draft.lower.title = v; });
  text(t('Lower-third detail'), () => draft.lower.subtitle, 140, v => { draft.lower.subtitle = v; });
  let cueOn = false;
  const cue = button(t('Show lower third'), () => { cueOn = !cueOn; api.cue(cueOn); setCue(cueOn); });
  function setCue(on: boolean): void {
    cueOn = on; cue.textContent = on ? t('Hide lower third') : t('Show lower third'); cue.setAttribute('aria-pressed', String(on));
  }
  setCue(false);
  target = footer;
  footer.append(status);
  const apply = button(t('Apply scene'), () => {
    if (uploading) { status.textContent = t('Wait for the logo to finish loading.'); return; }
    for (const read of fields) read();
    prepare(readScene(draft)); applying = true; apply.disabled = true;
    void api.apply(draft).then(applied => { status.textContent = applied === false ? t('Scene was not applied. Apply again when ready.') : t('Scene applied.'); },
      () => { status.textContent = t('Could not apply the scene. Check the logo is available.'); }).finally(() => { applying = false; apply.disabled = uploading; });
  });
  apply.setAttribute('aria-label', t('Apply prepared scene'));
  apply.classList.remove('btn--ghost');
  apply.classList.add('btn--primary');
  target = section(t('Recording'));
  target.append(recordStatus);
  const recordLimit = doc.createElement('p'); recordLimit.textContent = t('Recording stops after 30 minutes.'); target.append(recordLimit);
  let micSelected = false;
  const microphone = check(t('Record microphone'), () => micSelected, value => { micSelected = value; });
  const record = button(t('Record output'), () => api.record(microphone.checked));
  record.disabled = !api.recordingSupported;
  if (!api.recordingSupported) {
    const explanation = doc.createElement('p'); explanation.textContent = t('Recording this output needs a browser with tab region capture. You can still share the audience window in your call.'); target.append(explanation);
  }
  target = footer;
  const exitHint = doc.createElement('p'); exitHint.textContent = t('Stop sharing in your call before returning to the editor.'); footer.append(exitHint);
  button(t('End presentation'), api.close).classList.add('pr-end-presentation');
  host.append(root);
  preview.hidden = true;
  previewCrop();
  return {
    preview(stream: MediaStream | null): void {
      if (self.srcObject === stream) return;
      self.srcObject = stream;
      position?.preview(stream);
      if (stream) void self.play().catch(() => {});
    },
    status(message: string): void { status.textContent = message; },
    source(message: string, state: CameraState): void {
      sourceStatus.textContent = message;
      cameraOn = state === 'ready' || state === 'starting';
      cameraButton.textContent = cameraOn ? t('Stop camera') : t('Start camera');
      preview.hidden = state !== 'ready';
      if (state === 'ready') void cameraChoice.refresh();
    },
    cue: setCue,
    recordStatus(message: string): void { recordStatus.textContent = message; },
    recording(on: boolean, retry = false): void { record.textContent = on ? t('Stop recording') : retry ? t('Save recording') : t('Record output'); },
    dispose(): void { ++uploadEpoch; releaseContentControls?.(); releaseScenes?.(); cameraChoice.dispose(); position?.dispose(); self.srcObject = null; root.remove(); },
  };
}
