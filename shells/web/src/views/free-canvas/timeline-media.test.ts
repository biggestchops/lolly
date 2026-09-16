// SPDX-License-Identifier: MPL-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addMediaRef } from './timeline.ts';
import type { FcCtx } from './context.ts';
import type { Box } from '../free-canvas-math.ts';
import type { AssetRef } from '@lolly-tools/core/host-v1';

function fixture() {
  let boxes: Box[] = [{ id: 'first', lane: 'seq', start: 0, dur: 4 }];
  const commits: Box[][] = [];
  const fc = {
    disposed: false,
    cfg: { idField: 'id', xField: 'x', yField: 'y', wField: 'w', hField: 'h', imageField: 'media', fitField: 'fit' },
    timeCfg: { laneField: 'lane', startField: 'start', durField: 'dur' },
    addKinds: [
      { id: 'clip', seed: { kind: 'image', bg: 'var(--brand-primary)', fit: 'cover' } },
      { id: 'audio', seed: { kind: 'audio', volume: 0.7 } },
    ],
    select: {
      getBoxes: () => boxes,
      freshId: () => `clip-${boxes.length}`,
      assignFrames: (next: Box[]) => next,
      commit: (next: Box[]) => { commits.push(next); boxes = next; },
      syncTimelineBtn() {},
    },
    document: { activeFrameIndex: () => -1 },
    helpers: { canvasWH: () => ({ w: 1920, h: 1080 }) },
    timelinePanel: { setOpen() {}, selectAndReveal() {} },
    chromeSync: { renderChrome() {} },
    narration: { maybePromptSequenceFrames() {} },
  } as unknown as FcCtx;
  return { fc, commits, boxes: () => boxes };
}

test('media appends sequentially with measured duration, manifest tokens and durable refs', () => {
  const f = fixture();
  const ref: AssetRef = { source: 'library', id: 'brand/footage', type: 'video', format: 'mp4', url: '/footage.mp4', meta: { durationMs: 2500 } };
  assert.equal(addMediaRef(f.fc, ref, 1), true);
  assert.equal(addMediaRef(f.fc, { id: 'brand/photo', type: 'raster' } as AssetRef, 1), true);
  assert.equal(f.commits.length, 2);
  const [video, still] = f.boxes().slice(1);
  assert.equal(video!.start, 4);
  assert.equal(video!.dur, 2.5);
  assert.equal(video!.w, 1920);
  assert.equal(video!.h, 1080);
  assert.equal(video!.bg, 'var(--brand-primary)');
  assert.equal(video!.media, ref);
  assert.equal(still!.start, 6.5);
});

test('audio begins at the captured playhead without entering the magnetic sequence', () => {
  const f = fixture();
  addMediaRef(f.fc, { source: 'user', id: 'user/music', type: 'audio', format: 'wav', url: '/music.wav', meta: { durationMs: 12000 } }, 2);
  const audio = f.boxes().at(-1)!;
  assert.equal(audio.lane, '');
  assert.equal(audio.start, 2);
  assert.equal(audio.dur, 12);
  assert.equal(audio.volume, 0.7);
  assert.equal(f.boxes()[0]!.start, 0);
  assert.equal(f.commits.length, 1);
});

test('late intake and unsupported media cannot mutate a disposed editor', () => {
  const f = fixture();
  assert.equal(addMediaRef(f.fc, { id: 'palette', type: 'palette' } as AssetRef, 0), false);
  f.fc.disposed = true;
  assert.equal(addMediaRef(f.fc, { id: 'video', type: 'video' } as AssetRef, 0), false);
  assert.equal(f.commits.length, 0);
});
