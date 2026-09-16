// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPresentationCamera } from './camera.ts';

function fixture() {
  let stopped = 0;
  const track = Object.assign(new EventTarget(), { stop: () => { stopped++; } });
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
  const video = { srcObject: null, play: async () => {} } as unknown as HTMLVideoElement;
  return { stream, video, track, stopped: () => stopped };
}

test('camera acquired after stop or disposal is immediately released', async () => {
  for (const operation of ['stop', 'dispose'] as const) {
    const f = fixture(); let resolve!: (s: MediaStream) => void;
    const states: string[] = [];
    const camera = createPresentationCamera(f.video, state => states.push(state), () => new Promise(r => { resolve = r; }));
    const start = camera.start(); camera[operation](); resolve(f.stream); await start;
    assert.equal(f.stopped(), 1); assert.equal(f.video.srcObject, null); assert.ok(!states.includes('ready'));
  }
});

test('camera failures, interruption and restart never retain old devices', async () => {
  const f = fixture(); const states: string[] = [];
  let denied = true;
  const camera = createPresentationCamera(f.video, s => states.push(s), async () => {
    if (denied) throw new Error('Denied'); return f.stream;
  });
  await camera.start(); assert.equal(states.at(-1), 'error');
  denied = false; await camera.start(); assert.equal(states.at(-1), 'ready');
  f.track.dispatchEvent(new Event('mute')); assert.equal(states.at(-1), 'interrupted');
  f.track.dispatchEvent(new Event('unmute')); assert.equal(states.at(-1), 'ready');
  f.track.dispatchEvent(new Event('ended')); assert.equal(states.at(-1), 'interrupted');
  assert.equal(f.video.srcObject, null); assert.equal(f.stopped(), 1);
  f.track.dispatchEvent(new Event('unmute')); assert.equal(states.at(-1), 'interrupted');
  camera.dispose(); camera.dispose(); assert.equal(f.stopped(), 1);
});

test('camera ending while playback starts cannot report ready later', async () => {
  const f = fixture(), states: string[] = [];
  let play!: () => void;
  f.video.play = () => new Promise<void>(resolve => { play = resolve; });
  const camera = createPresentationCamera(f.video, state => states.push(state), async () => f.stream);
  const opening = camera.start(); await Promise.resolve();
  f.track.dispatchEvent(new Event('ended')); play(); await opening;
  assert.equal(states.at(-1), 'interrupted'); assert.equal(f.video.srcObject, null); assert.equal(f.stopped(), 1);
  camera.dispose();
});

test('changing cameras releases the old source and stale acquisitions cannot replace the selected one', async () => {
  const a = fixture(), b = fixture(), late = fixture(), requests: MediaStreamConstraints[] = [];
  let resolve!: (stream: MediaStream) => void;
  const camera = createPresentationCamera(a.video, () => {}, async constraints => {
    requests.push(constraints);
    if (requests.length === 1) return a.stream;
    if (requests.length === 2) return new Promise<MediaStream>(r => { resolve = r; });
    return b.stream;
  });
  await camera.start('one'); const pending = camera.start('two');
  assert.equal(a.stopped(), 1); await camera.start('three'); resolve(late.stream); await pending;
  assert.equal(a.video.srcObject, b.stream); assert.equal(late.stopped(), 1);
  assert.deepEqual((requests[2]!.video as MediaTrackConstraints).deviceId, { exact: 'three' });
  assert.equal(requests[2]!.audio, false); camera.dispose(); assert.equal(b.stopped(), 1);
});
