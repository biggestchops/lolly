// SPDX-License-Identifier: MPL-2.0
import { OUTPUT } from './scene.ts';
import type { RecordingSession } from '../../bridge/recorder-session.ts';
type CropTrack = MediaStreamTrack & { cropTo(target: unknown): Promise<void> };
type CaptureGlobal = typeof globalThis & { CropTarget?: { fromElement(el: HTMLElement): Promise<unknown> } };

export function productionRecordingSupported(): boolean {
  return !!(globalThis as CaptureGlobal).CropTarget?.fromElement && !!navigator.mediaDevices?.getDisplayMedia
    && typeof HTMLCanvasElement.prototype.captureStream === 'function' && typeof MediaRecorder !== 'undefined';
}

/** Start from a key gesture in the audience tab. Cropping must succeed before encoding starts. */
export async function recordProduction(surface: HTMLElement, microphone: boolean, signal: AbortSignal) {
  const streams: MediaStream[] = [];
  const video = document.createElement('video'); video.muted = true; video.playsInline = true;
  let session: RecordingSession | null = null;
  let callback = 0, timer = 0;
  const release = () => {
    signal.removeEventListener('abort', abort);
    if (callback) video.cancelVideoFrameCallback?.(callback);
    if (timer) clearInterval(timer);
    callback = timer = 0;
    video.pause();
    video.srcObject = null;
    for (const track of new Set(streams.splice(0).flatMap(stream => stream.getTracks()))) track.stop();
  };
  const abort = () => { session?.cancel(); release(); };
  const check = () => { if (signal.aborted) throw new DOMException('Recording cancelled', 'AbortError'); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    check();
    if (!productionRecordingSupported()) throw new Error('Tab region capture is unavailable');
    const capture = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: OUTPUT.fps, max: OUTPUT.fps } }, audio: false,
      preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude',
    } as DisplayMediaStreamOptions);
    streams.push(capture); check();
    const track = capture.getVideoTracks()[0] as CropTrack | undefined;
    if (!track?.cropTo) throw new Error('Choose this audience tab to record the output');
    await track.cropTo(await (globalThis as CaptureGlobal).CropTarget!.fromElement(surface)); check();
    await track.applyConstraints({ advanced: [{ cursor: 'never' } as MediaTrackConstraintSet] });
    if (microphone) {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      streams.push(mic); check();
    }
    video.srcObject = capture;
    await video.play(); check();
    const canvas = document.createElement('canvas'); canvas.width = OUTPUT.w; canvas.height = OUTPUT.h;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Video output is unavailable');
    const draw = () => {
      ctx.fillStyle = '#05070c'; ctx.fillRect(0, 0, OUTPUT.w, OUTPUT.h);
      if (video.readyState >= 2 && video.videoWidth && video.videoHeight) ctx.drawImage(video, 0, 0, OUTPUT.w, OUTPUT.h);
    };
    draw();
    if (video.requestVideoFrameCallback) {
      const frame = () => { draw(); callback = video.requestVideoFrameCallback(frame); };
      callback = video.requestVideoFrameCallback(frame);
    } else timer = window.setInterval(draw, 1000 / OUTPUT.fps);
    const composed = canvas.captureStream(OUTPUT.fps); streams.push(composed);
    if (microphone) for (const audio of streams[1]!.getAudioTracks()) composed.addTrack(audio);
    let offEnded = () => {};
    const { recordMediaSource } = await import('../../bridge/recorder.ts'); check();
    session = await recordMediaSource({ stream: composed, micActive: microphone,
      release: () => { offEnded(); release(); },
      onSourceEnded: finish => {
        const tracks = [track, ...composed.getAudioTracks()];
        for (const source of tracks) source.addEventListener('ended', finish, { once: true });
        offEnded = () => { for (const source of tracks) source.removeEventListener('ended', finish); };
        if (tracks.some(source => source.readyState === 'ended')) queueMicrotask(finish);
      },
    }, { source: 'screen', audio: microphone, format: 'webm', maxMs: 30 * 60_000 });
    if (signal.aborted) { session.cancel(); check(); }
    return session;
  } catch (error) { release(); throw error; }
}
