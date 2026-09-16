// SPDX-License-Identifier: MPL-2.0
/** Shared-shell presentation composition; the existing presenter still owns deck navigation. */
import type { AssetRef } from '@lolly-tools/core/host-v1';
import type { RecordingSession } from '../bridge/recorder-session.ts';
import { t } from '../i18n.ts';
import { createPresentationCamera, type CameraState } from './present-production/camera.ts';
import { mountProductionControls } from './present-production/controls.ts';
import { mountProductionOutput } from './present-production/output.ts';
import { productionRecordingSupported, recordProduction } from './present-production/recording.ts';
import { layoutBoxes, readScene, type PresentationScene, type LogoAsset } from './present-production/scene.ts';
import type { PresentationContent } from './present-production/source.ts';

export interface ProductionOptions {
  content?: PresentationContent;
  scene?: unknown;
  controlsWindow: Window;
  resolveLogo(asset: LogoAsset): Promise<AssetRef>;
  uploadLogo(file: File): Promise<AssetRef>;
  saveScene(scene: PresentationScene): void;
  saveRecording(blob: Blob, microphone: boolean): Promise<void>;
}

export function mountPresentationProduction(stage: HTMLElement, frames: HTMLElement, opts: ProductionOptions,
  layout: () => void, close: () => void) {
  let scene = readScene(opts.scene), disposed = false, applying = 0;
  const output = mountProductionOutput(stage, frames);
  const sourcePage = frames.querySelector<HTMLElement>('.pr-page');
  const releaseSource = sourcePage ? opts.content?.mount(sourcePage) : undefined;
  output.logo(null); output.update(scene);
  let controls: ReturnType<typeof mountProductionControls> | null = null;
  let cameraState: CameraState = 'off';
  let cameraDevice = '';
  let status = t('Not recording.'), sourceStatus = t('Camera off.');
  const say = (message: string) => { status = message; controls?.recordStatus(message); };
  const camera = createPresentationCamera(output.video, (state, message) => {
    cameraState = state;
    output.cameraReady(state === 'ready');
    controls?.preview(state === 'ready' ? output.video.srcObject as MediaStream : null);
    const states = { off: t('Camera off.'), starting: t('Starting camera…'), ready: t('Camera ready.'),
      interrupted: t('Camera interrupted. Start camera to reconnect.'), error: t('Could not start camera.') };
    sourceStatus = `${states[state]} ${message ? t(message) : ''}`.trim(); controls?.source(sourceStatus, state);
  });
  let recording: RecordingSession | null = null, preparing: AbortController | null = null;
  let requested: boolean | null = null, stopping = false;
  let pendingSave: { blob: Blob; microphone: boolean } | null = null;
  async function stopRecording(): Promise<void> {
    requested = null;
    if (stopping) return;
    if (preparing) { preparing.abort(); preparing = null; }
    const session = recording; recording = null;
    if (!session && !pendingSave) return;
    stopping = true;
    controls?.recording(false); say(t('Saving recording…'));
    try {
      if (session) {
        const blob = await session.stop();
        if (!blob.size) throw new Error('Empty recording');
        pendingSave = { blob, microphone: session.micActive === true };
      }
      await opts.saveRecording(pendingSave!.blob, pendingSave!.microphone);
      pendingSave = null;
      say(t('Recording saved.'));
    } catch { say(pendingSave ? t('Could not save. Keep this presentation open and choose Save recording to retry.') : t('Could not finish the recording. No file was saved.')); }
    finally { stopping = false; controls?.recording(false, !!pendingSave); }
  }
  async function startRecording(audio: boolean): Promise<void> {
    if (disposed || preparing || recording || stopping || pendingSave) return;
    const abort = new AbortController(); preparing = abort;
    say(t('Choose the audience tab in the recording picker.'));
    try {
      const session = await recordProduction(output.surface, audio, abort.signal);
      if (disposed || abort.signal.aborted) { session.cancel(); return; }
      recording = session; controls?.recording(true); say(t('Recording output. Press R again to stop.'));
      void session.finished.then(() => { if (recording === session) void stopRecording(); });
    } catch { if (!disposed) say(t('Recording did not start. Choose this audience tab in a browser with tab region capture.')); }
    finally { if (preparing === abort) preparing = null; }
  }
  async function apply(next: PresentationScene, persist = true): Promise<boolean> {
    const epoch = ++applying, prepared = readScene(next);
    const logo = prepared.logo.asset ? await opts.resolveLogo(prepared.logo.asset) : null;
    if (logo) {
      if (logo.type !== 'vector' && logo.type !== 'raster') throw new Error('Choose an image logo');
      const image = new Image(); image.src = logo.url; await image.decode();
    }
    if (disposed || epoch !== applying) return false;
    scene = readScene({ ...prepared, prepared: scene.prepared }); output.logo(logo?.url ?? null); output.update(scene); output.hold(false); layout();
    if (scene.layout === 'holding') { camera.stop(); opts.content?.pause(); }
    if (persist) opts.saveScene(readScene(scene));
    return true;
  }
  function hold(): void {
    ++applying; output.hold(true); output.cue(false); camera.stop(); opts.content?.pause(); controls?.cue(false);
  }
  // Reopen resolves assets but never opens a device or replays a lower-third cue.
  if (scene.logo.asset) void apply(scene, false).catch(() => say(t('Saved logo is unavailable. Choose a logo and Apply.')));
  return {
    viewport: () => { const box = layoutBoxes(scene).content; return { w: box.w, h: box.h }; },
    controls(doc: Document, host: HTMLElement): void {
      controls?.dispose();
      controls = mountProductionControls(doc, host, { scene,
        content: opts.content,
        apply, camera: on => { if (on) void camera.start(cameraDevice); else camera.stop(); }, cue: on => output.cue(on),
        cameraDevice, chooseCamera: id => {
          cameraDevice = id;
          if (cameraState === 'ready' || cameraState === 'starting' || cameraState === 'interrupted') void camera.start(id);
        },
        savePrepared: prepared => { scene = readScene({ ...scene, prepared }); opts.saveScene(readScene(scene)); },
        upload: async file => {
          const asset = await opts.uploadLogo(file);
          if (asset.type !== 'vector' && asset.type !== 'raster') throw new Error('Choose an image logo');
          return { id: asset.id, source: asset.source, format: asset.format, version: asset.version };
        },
        recordingSupported: productionRecordingSupported(),
        record: audio => {
          if (recording || preparing || pendingSave) { void stopRecording(); return; }
          requested = audio; window.focus(); say(t('In the audience window, press R and choose that tab to start recording.'));
        }, close,
      });
      controls.recordStatus(status); controls.source(sourceStatus, cameraState); controls.recording(!!recording, !!pendingSave);
      controls.preview(output.video.srcObject as MediaStream | null);
    },
    lostControls(): void { hold(); void stopRecording(); controls?.dispose(); controls = null; },
    hold,
    key(key: string): boolean {
      if (key.toLowerCase() !== 'r') return false;
      if (recording || preparing) void stopRecording();
      else if (requested !== null) { const audio = requested; requested = null; void startRecording(audio); }
      return true;
    },
    dispose(): void {
      disposed = true; ++applying; camera.dispose(); opts.content?.pause(); void stopRecording(); controls?.dispose(); releaseSource?.(); output.dispose();
    },
  };
}
