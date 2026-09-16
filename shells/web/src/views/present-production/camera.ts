// SPDX-License-Identifier: MPL-2.0
/** One output-owned camera. A preview borrows the stream and never stops its tracks. */
export type CameraState = 'off' | 'starting' | 'ready' | 'interrupted' | 'error';
export function createPresentationCamera(video: HTMLVideoElement, changed: (state: CameraState, message: string) => void,
  acquire: (constraints: MediaStreamConstraints) => Promise<MediaStream> = c => navigator.mediaDevices.getUserMedia(c)) {
  let epoch = 0;
  let stream: MediaStream | null = null;
  let disposed = false;
  const stopTracks = (s: MediaStream | null) => { s?.getTracks().forEach(track => { track.stop(); }); };
  const clear = () => { video.srcObject = null; stopTracks(stream); stream = null; };
  return {
    async start(deviceId?: string): Promise<void> {
      if (disposed) return;
      const mine = ++epoch;
      clear(); changed('starting', '');
      try {
        const next = await acquire({ video: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } }, audio: false });
        if (disposed || mine !== epoch) { stopTracks(next); return; }
        stream = next;
        for (const track of next.getVideoTracks()) {
          track.addEventListener('ended', () => { if (mine === epoch && !disposed) { ++epoch; clear(); changed('interrupted', ''); } });
          track.addEventListener('mute', () => { if (mine === epoch && !disposed) changed('interrupted', ''); });
          track.addEventListener('unmute', () => { if (mine === epoch && !disposed) changed('ready', ''); });
        }
        video.srcObject = next;
        await video.play();
        if (disposed || mine !== epoch) return;
        changed('ready', '');
      } catch (error) {
        if (disposed || mine !== epoch) return;
        clear();
        const name = error && typeof error === 'object' && 'name' in error ? error.name : '';
        const message = name === 'NotAllowedError' ? 'Allow camera access in your browser or system settings, then try again.'
          : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'This camera is unavailable. Choose another camera.'
          : name === 'NotReadableError' ? 'Close other apps using this camera, then try again.' : 'Check the camera connection and try again.';
        changed('error', message);
      }
    },
    stop(): void { ++epoch; clear(); changed('off', ''); },
    dispose(): void { disposed = true; ++epoch; clear(); },
  };
}
