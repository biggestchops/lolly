// SPDX-License-Identifier: MPL-2.0
/**
 * The export frame clock carries a clip's length and pixel size to every clocked call.
 *
 * Run with:
 *   node --import ./tests/css-stub.mjs --test shells/web/src/bridge/frame-clock.test.ts
 *
 * createFrameSource names the clip length and size on each frame, but the static-chrome
 * probe and the repaint after it name only a time. The clock remembers the last values it
 * was given between begin and end, so those calls render the same kind of frame.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setExportHost } from './export-shared.ts';
import type { WebHost } from './export-shared.ts';
import { beginFrameClock, endFrameClock, frameClockCanvas, renderFrameAt } from './frame-clock.ts';
import type { FrameClockCanvas, FrameClockSize } from './frame-clock.ts';

type Call = [number, number | undefined, FrameClockSize | undefined];

/** A stand-in canvas whose clock records every call; `throws` makes the hook fail. */
function clockCanvas(throws = false) {
  const calls: Call[] = [];
  const canvas = {
    __lollyFrameDriven: false,
    __lollyFrameRender(t: number, clipSec?: number, size?: FrameClockSize) {
      calls.push([t, clipSec, size]);
      if (throws) throw new Error('frame failed');
    },
    querySelectorAll: () => [],
  };
  return { canvas: canvas as unknown as FrameClockCanvas, calls };
}

test('a call that names only a time reuses the clip length and size given since begin', () => {
  const { canvas, calls } = clockCanvas();
  const size = { width: 320, height: 240 };
  const fc = beginFrameClock(canvas);
  assert.equal(fc, canvas);
  assert.equal(canvas.__lollyFrameDriven, true, 'begin raises the capture flag');
  renderFrameAt(fc, 0.1, 5, size);
  renderFrameAt(fc, 0.37);
  renderFrameAt(fc, 0.71);
  assert.deepEqual(calls, [
    [0.1, 5, size],
    [0.37, 5, size],
    [0.71, 5, size],
  ]);
  endFrameClock(fc);
  assert.equal(canvas.__lollyFrameDriven, false, 'end clears the capture flag');
});

test('a still names a size and no clip length, and the size alone is carried', () => {
  const { canvas, calls } = clockCanvas();
  const fc = beginFrameClock(canvas);
  renderFrameAt(fc, 0, undefined, { width: 64, height: 32 });
  renderFrameAt(fc, 0.5);
  assert.deepEqual(calls, [
    [0, undefined, { width: 64, height: 32 }],
    [0.5, undefined, { width: 64, height: 32 }],
  ]);
  endFrameClock(fc);
});

test('a later explicit value replaces the remembered one', () => {
  const { canvas, calls } = clockCanvas();
  const fc = beginFrameClock(canvas);
  renderFrameAt(fc, 0, 5, { width: 10, height: 10 });
  renderFrameAt(fc, 0.2, 8, { width: 20, height: 20 });
  renderFrameAt(fc, 0.3);
  assert.deepEqual(calls[2], [0.3, 8, { width: 20, height: 20 }]);
  endFrameClock(fc);
});

test('a new begin forgets what the previous capture named', () => {
  const { canvas, calls } = clockCanvas();
  const first = beginFrameClock(canvas);
  renderFrameAt(first, 0.1, 5, { width: 200, height: 150 });
  const second = beginFrameClock(canvas);
  renderFrameAt(second, 0.37);
  assert.deepEqual(calls[1], [0.37, undefined, undefined]);
  endFrameClock(second);
});

test('end forgets what the capture named', () => {
  const { canvas, calls } = clockCanvas();
  const fc = beginFrameClock(canvas);
  renderFrameAt(fc, 0.1, 5, { width: 200, height: 150 });
  endFrameClock(fc);
  renderFrameAt(fc, 0.4);
  assert.deepEqual(calls[1], [0.4, undefined, undefined]);
});

test('a throwing clock is logged as a warning, not thrown', () => {
  const logged: [string, string][] = [];
  setExportHost({ log: (level: string, message: string) => logged.push([level, message]) } as unknown as WebHost);
  try {
    const { canvas, calls } = clockCanvas(true);
    const fc = beginFrameClock(canvas);
    assert.doesNotThrow(() => renderFrameAt(fc, 0.25, 5, { width: 8, height: 8 }));
    assert.equal(calls.length, 1);
    assert.deepEqual(logged, [['warn', '__lollyFrameRender threw: frame failed']]);
    endFrameClock(fc);
  } finally {
    setExportHost(null as unknown as WebHost);
  }
});

test('a node without a clock gets no canvas, and the calls do nothing', () => {
  const node = { querySelectorAll: () => [] } as unknown as Element;
  assert.equal(frameClockCanvas(node), null);
  const fc = beginFrameClock(node);
  assert.equal(fc, null);
  assert.doesNotThrow(() => {
    renderFrameAt(fc, 0.5, 5, { width: 1, height: 1 });
    endFrameClock(fc);
  });
});

test('a clock canvas inside the exported node is found', () => {
  const { canvas } = clockCanvas();
  const node = { querySelectorAll: (selector: string) => (selector === 'canvas' ? [canvas] : []) } as unknown as Element;
  assert.equal(frameClockCanvas(node), canvas);
});
