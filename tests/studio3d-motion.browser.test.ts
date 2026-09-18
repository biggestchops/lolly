// SPDX-License-Identifier: MPL-2.0
/**
 * 3D Studio motion library in a real browser (plan 267, lane B: applying the pose).
 *
 * Run with:
 *   node --import ./tests/css-stub.mjs --test tests/studio3d-motion.browser.test.ts
 *   STUDIO_NATIVE=1 node --import ./tests/css-stub.mjs --test tests/studio3d-motion.browser.test.ts
 *
 * Uses the shared harness (tests/helpers/studio3d-browser.ts) at 256 px on the ring and
 * bolt fixture, which is symmetric about neither axis, so a turn shows in the silhouette.
 *
 * What is checked, for every one of the ten loops:
 *   1. the placement rule: the subject's lowest point sits exactly on the floor plus the
 *      loop's own lift, at sixteen phases. This is measured in the scene through the real
 *      placeStudioScene, with the same box three grounds the subject by;
 *   2. reproducibility: the frame at 0.25 differs from the frame at 0.5 and the frame at
 *      0.25 comes back byte for byte;
 *   3. the rest rule: the frame at phase 0 is the still render, byte for byte, burst
 *      included, because a burst at amount zero draws the whole object;
 *   4. a pulse keeps its contact with the floor and a jump comes back down onto it;
 *   5. a spin and land at p = 0.05 is above the floor and turned;
 *   6. a bursting clip frame is not refused as an empty frame;
 *   7. at the largest amount every loop, the burst's flying pieces included, stays inside
 *      the shadow camera the rig builds from the resting footprint. With STUDIO_SHOTS set
 *      the measured reach of each loop is written there as motion-frustum.json.
 *
 * With STUDIO_SHOTS set, a four-frame contact sheet per loop is written there, plus one
 * combined motion-sheet.png of every loop.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { Page } from 'playwright';
import {
  type StudioFrame,
  type StudioHarness,
  type StudioValues,
  saveShot,
  startStudioHarness,
  studioSkip,
} from './helpers/studio3d-browser.ts';

/** One placed subject's box at one phase, with the pose that put it there. */
interface Placement {
  phase: number;
  pose: { spin: number; tilt: [number, number]; lift: number; scale: [number, number, number]; burst: number };
  min: [number, number, number];
  max: [number, number, number];
}

interface MotionTestApi {
  frameAt(time: number, seconds?: number): StudioFrame;
  pngAt(time: number, seconds?: number): string;
  clipError(times: number[], seconds: number): string | null;
  placement(values: StudioValues, phases: number[], seconds?: number): Promise<Placement[]>;
  shadowLights(values: StudioValues): [number, number, number][];
  sheet(frames: string[], columns: number, labels?: string[]): Promise<string>;
}

declare global {
  interface Window {
    /** Page helpers added by tests/studio3d-motion.browser.test.ts. */
    motionTest?: MotionTestApi;
  }
}

/** Page code added to the harness bundle; it shares the harness page's own names. */
const extraSource = `
import { Box3 as MotionBox, Group as MotionGroup } from 'three';
import { studioSceneObjects as motionObjects } from './engine/src/studio3d-arrangement.ts';
import { studioObjectPose as motionPose } from './engine/src/studio3d-motion.ts';
import { buildStudioScene as motionScene } from './engine/src/studio3d.ts';
import { placeStudioScene as motionPlace } from './shells/web/src/lib/studio3d/camera.ts';
import { loadStudioSource as motionSource } from './shells/web/src/lib/studio3d/source.ts';

const markerNow = () => container.querySelector('[data-lolly-studio]');
// One clocked frame of a clip, drawn and read the way an export frame is.
const clocked = (time, seconds) => {
  const canvas = studioCanvas();
  const was = canvas.__lollyFrameDriven === true;
  canvas.__lollyFrameDriven = true;
  try {
    canvas.__lollyFrameRender(time, seconds);
    return readFrame(markerNow());
  } finally {
    canvas.__lollyFrameDriven = was;
  }
};

window.motionTest = {
  frameAt: (time, seconds = 5) => clocked(time, seconds),
  pngAt: (time, seconds = 5) => clocked(time, seconds).png,
  // Raising the capture flag asks for the next frame to be checked, so the first time
  // here is the one the empty-frame check reads, exactly as the first frame of a clip is.
  clipError(times, seconds) {
    const canvas = studioCanvas();
    const was = canvas.__lollyFrameDriven === true;
    canvas.__lollyFrameDriven = true;
    try {
      for (const time of times) canvas.__lollyFrameRender(time, seconds);
      return null;
    } catch (error) {
      return error.message;
    } finally {
      canvas.__lollyFrameDriven = was;
    }
  },
  async placement(values, phases, seconds = 5) {
    const recipe = motionScene({ version: 1, values: { ...studioDefaults, ...values } });
    const asset = await motionSource(recipe, read, new AbortController().signal, shapeText);
    try {
      const root = new MotionGroup();
      root.add(asset.object);
      const spec = motionObjects(recipe)[0];
      return phases.map((phase) => {
        const pose = motionPose(recipe, phase, seconds);
        motionPlace(root, [{ object: asset.object, spec }], recipe, phase, seconds, pose);
        // The same box three grounds the subject by, so the reading is the placement itself.
        const box = new MotionBox().setFromObject(root);
        return { phase, pose, min: box.min.toArray(), max: box.max.toArray() };
      });
    } finally {
      asset.dispose();
    }
  },
  // The lights the rig gives a shadow camera to, as the recipe states them.
  shadowLights(values) {
    const recipe = motionScene({ version: 1, values: { ...studioDefaults, ...values } });
    return recipe.lights.filter((light) => light.shadows).map((light) => light.position);
  },
  async sheet(frames, columns, labels) {
    const images = await Promise.all(
      frames.map(
        (url) =>
          new Promise((done, fail) => {
            const image = new Image();
            image.onload = () => done(image);
            image.onerror = () => fail(new Error('A sheet frame did not load.'));
            image.src = url;
          })
      )
    );
    const width = images[0].width, height = images[0].height;
    const rows = Math.ceil(images.length / columns);
    const canvas = document.createElement('canvas');
    canvas.width = width * columns;
    canvas.height = height * rows;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0c322c';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const [i, image] of images.entries())
      ctx.drawImage(image, (i % columns) * width, Math.floor(i / columns) * height);
    ctx.font = '600 15px system-ui, sans-serif';
    ctx.fillStyle = '#ffffff';
    for (const [i, label] of (labels ?? []).entries())
      if (label) ctx.fillText(label, 8, i * height + 21);
    return canvas.toDataURL();
  },
};
`;

/** The eight loops this plan adds, beside the two the studio always had. */
const NEW_KINDS = ['hover', 'pulse', 'wobble', 'pop', 'coin', 'jump', 'spinland', 'burst'] as const;
const EVERY_KIND = ['still', 'turntable', ...NEW_KINDS] as const;
/** The subject: a ring and a bolt, so a turn changes the silhouette. */
const SUBJECT = { source: 'artwork', artwork: { url: '/fixture.svg' } } as const;
const PHASES = [0, 0.25, 0.5, 0.75];
const SIZE = 256;

let harness: StudioHarness | undefined;

function studio(): StudioHarness {
  if (!harness) throw new Error('The 3D Studio harness did not start.');
  return harness;
}

const open = () => studio().open();
const render = (page: Page, values: StudioValues) => studio().render(page, values);
const pngAt = (page: Page, time: number) =>
  page.evaluate((time) => window.motionTest!.pngAt(time), time);
const frameAt = (page: Page, time: number) =>
  page.evaluate((time) => window.motionTest!.frameAt(time), time);
const placement = (page: Page, values: StudioValues, phases: number[]) =>
  page.evaluate(
    ([values, phases]) =>
      window.motionTest!.placement(values as StudioValues, phases as number[]),
    [values, phases] as [StudioValues, number[]]
  );

/** The lowest row holding any drawn pixel, counted from the top, or -1 for an empty frame. */
function lowestDrawnRow(frame: StudioFrame): number {
  for (let y = frame.height - 1; y >= 0; y--)
    for (let x = 0; x < frame.width; x++)
      if (frame.pixels[(y * frame.width + x) * 4 + 3]! > 0) return y;
  return -1;
}

/** The centre of the shadow: alpha in the object-and-shadow frame where the object is clear. */
function shadowCentre(shadow: StudioFrame, object: StudioFrame): [number, number] {
  let x = 0,
    y = 0,
    weight = 0;
  for (let row = 0; row < shadow.height; row++)
    for (let column = 0; column < shadow.width; column++) {
      const i = (row * shadow.width + column) * 4 + 3;
      const alpha = shadow.pixels[i]!;
      if (object.pixels[i]! > 0 || alpha < 3) continue;
      x += column * alpha;
      y += row * alpha;
      weight += alpha;
    }
  return weight ? [x / weight, y / weight] : [-1, -1];
}

/** Length of a vector. */
function length([x, y, z]: number[]): number {
  return Math.hypot(x!, y!, z!);
}

function subtract(a: number[], b: number[]): [number, number, number] {
  return [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
}

function scale(a: number[], k: number): [number, number, number] {
  return [a[0]! * k, a[1]! * k, a[2]! * k];
}

function dot(a: number[], b: number[]): number {
  return a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
}

function cross(a: number[], b: number[]): [number, number, number] {
  return [
    a[1]! * b[2]! - a[2]! * b[1]!,
    a[2]! * b[0]! - a[0]! * b[2]!,
    a[0]! * b[1]! - a[1]! * b[0]!,
  ];
}

function unit(a: number[]): [number, number, number] {
  const size = length(a) || 1;
  return scale(a, 1 / size);
}

/**
 * How far one point reaches across a light's shadow camera, and how deep it is into it.
 * A directional light's shadow camera looks from the light at the rig's target with the
 * world up axis, and its box is `extent` either side (stage.ts builds it), so a point is
 * inside when both spans are within the extent and the depth is between the near and far
 * planes.
 */
function shadowReach(
  point: number[],
  light: number[],
  target: number[]
): { across: number; up: number; depth: number } {
  const forward = unit(subtract(target, light));
  const right = unit(cross(forward, [0, 1, 0]));
  const above = cross(right, forward);
  const fromLight = subtract(point, light);
  // The target sits on the camera's own axis, so the two spans are read straight off it.
  return {
    across: Math.abs(dot(fromLight, right)),
    up: Math.abs(dot(fromLight, above)),
    depth: dot(fromLight, forward) - dot(subtract(target, light), forward),
  };
}

/** The eight corners of a box, and for a burst the box its pieces fly out into. */
function corners(min: number[], max: number[]): number[][] {
  const out: number[][] = [];
  for (const x of [min[0]!, max[0]!])
    for (const y of [min[1]!, max[1]!])
      for (const z of [min[2]!, max[2]!]) out.push([x, y, z]);
  return out;
}

describe('3D Studio motion library', { skip: studioSkip }, () => {
  before(async () => {
    harness = await startStudioHarness({ size: SIZE, extraSource });
  });
  after(async () => {
    await harness?.close();
  });

  it('grounds every loop on the floor plus its own lift, at every phase', async () => {
    const page = await open();
    try {
      const phases = Array.from({ length: 16 }, (_, i) => i / 16);
      // Where the recipe itself puts the subject, which every loop is a difference from.
      const [still] = await placement(page, { ...SUBJECT, motion: 'still' }, [0]);
      const floor = still!.min[1];
      for (const kind of EVERY_KIND) {
        const placed = await placement(page, { ...SUBJECT, motion: kind, duration: 5 }, phases);
        assert.equal(placed.length, phases.length);
        for (const step of placed)
          assert.ok(
            Math.abs(step.min[1] - floor - step.pose.lift) < 1e-6,
            `${kind} at phase ${step.phase}: the subject's lowest point is ${step.min[1]}, the recipe rests it at ${floor} and the loop lifts it ${step.pose.lift}`
          );
        assert.ok(
          Math.abs(placed[0]!.min[1] - floor) < 1e-6,
          `${kind} starts where the recipe rests it, not at ${placed[0]!.min[1]}`
        );
      }
    } finally {
      await page.close();
    }
  });

  it('renders every loop reproducibly and starts every one at the rest pose', async () => {
    const page = await open();
    try {
      await render(page, { ...SUBJECT, motion: 'still' });
      const rest = await pngAt(page, 0);
      const sheets: string[] = [];
      for (const kind of NEW_KINDS) {
        await render(page, { ...SUBJECT, motion: kind, duration: 5 });
        // A burst flies out and comes back, so it is equally far along at 0.25 and at
        // 0.5 by design. Its pair reads either side of the moment it is furthest out.
        const [a, b] = kind === 'burst' ? [0.2, 0.4] : [0.25, 0.5];
        const first = await pngAt(page, a),
          next = await pngAt(page, b),
          repeated = await pngAt(page, a);
        assert.notEqual(first, next, `${kind} must draw a different frame at ${b} than at ${a}`);
        assert.equal(first, repeated, `${kind} must draw the same frame at ${a} twice`);
        const frames: string[] = [];
        for (const phase of PHASES) frames.push(await pngAt(page, phase));
        assert.equal(frames[0], rest, `${kind} must start at the rest pose, as the still render draws it`);
        const sheet = await page.evaluate(
          ([frames, label]) => window.motionTest!.sheet(frames as string[], 4, [label as string]),
          [frames, kind] as [string[], string]
        );
        sheets.push(sheet);
        await saveShot(`motion-${kind}.png`, sheet);
      }
      const combined = await page.evaluate(
        ([sheets, labels]) => window.motionTest!.sheet(sheets as string[], 1, labels as string[]),
        [sheets, [...NEW_KINDS]] as [string[], string[]]
      );
      await saveShot('motion-sheet.png', combined);
    } finally {
      await page.close();
    }
  });

  it('keeps a pulse planted and brings a jump back down onto its own contact', async () => {
    const page = await open();
    try {
      const phases = Array.from({ length: 24 }, (_, i) => i / 24);
      // The object alone, so the silhouette's lowest row is the subject's own contact.
      await render(page, { ...SUBJECT, motion: 'pulse', duration: 5, outputMode: 'object' });
      const restRow = lowestDrawnRow(await frameAt(page, 0));
      assert.ok(restRow > 0, 'the resting subject is drawn');
      let drift = 0;
      for (const phase of phases)
        drift = Math.max(drift, Math.abs(lowestDrawnRow(await frameAt(page, phase)) - restRow));
      // A pulse breathes, so its own contact edge grows a pixel towards the camera; a pose
      // grounded on the resting box instead would float the subject off its contact by
      // about a sixteenth of its height, which is fifteen pixels of this frame.
      assert.ok(drift <= 1, `a pulse moved its lowest row by ${drift} px`);
      const jump = { ...SUBJECT, motion: 'jump', duration: 5 };
      await render(page, { ...jump, outputMode: 'object' });
      const jumpRest = lowestDrawnRow(await frameAt(page, 0));
      const airborne = await placement(page, jump, phases);
      const apex = airborne.reduce((high, step) => (step.pose.lift > high.pose.lift ? step : high));
      assert.ok(apex.pose.lift > 0.5, `a jump leaves the floor, and its apex lift is ${apex.pose.lift}`);
      const landed = airborne.filter((step) => step.phase > apex.phase && step.pose.lift === 0);
      assert.ok(landed.length > 0, 'a jump comes back down inside its loop');
      const landing = landed[0]!;
      const landingRow = lowestDrawnRow(await frameAt(page, landing.phase));
      // The landing squash widens the subject, which brings its contact edge one pixel
      // nearer the camera; what matters is that it is on the floor and not above it.
      assert.ok(
        landingRow >= jumpRest && landingRow - jumpRest <= 1,
        `a jump landing at phase ${landing.phase} stands on row ${landingRow}, having left row ${jumpRest}`
      );
      assert.ok(
        lowestDrawnRow(await frameAt(page, apex.phase)) < jumpRest,
        'the subject is off the floor at the apex'
      );
      // The shadow is the object-and-shadow frame's alpha where the object frame is clear.
      await render(page, { ...jump, outputMode: 'object-shadow' });
      const shadowRest = await frameAt(page, 0),
        shadowApex = await frameAt(page, apex.phase);
      await render(page, { ...jump, outputMode: 'object' });
      const objectRest = await frameAt(page, 0),
        objectApex = await frameAt(page, apex.phase);
      const [restX, restY] = shadowCentre(shadowRest, objectRest),
        [apexX, apexY] = shadowCentre(shadowApex, objectApex);
      assert.ok(restY > 0 && apexY > 0, 'both frames hold a shadow');
      assert.ok(
        Math.hypot(apexX - restX, apexY - restY) > 2,
        `the shadow follows the jump: it moved from ${restX},${restY} to ${apexX},${apexY}`
      );
      await saveShot('motion-jump-apex.png', shadowApex.png);
    } finally {
      await page.close();
    }
  });

  it('drops a spin and land in from above, turned', async () => {
    const page = await open();
    try {
      const values = { ...SUBJECT, motion: 'spinland', duration: 5 };
      const [rest, early] = await placement(page, values, [0, 0.05]);
      assert.ok(early!.pose.lift > 0, `spinland is above the floor at 0.05, by ${early!.pose.lift}`);
      assert.ok(early!.min[1] > rest!.min[1], 'and its lowest point is above the resting one');
      const width = (step: Placement) => step.max[0] - step.min[0];
      assert.ok(
        Math.abs(width(early!) - width(rest!)) > 1e-3,
        `and it is turned: ${width(early!)} wide against ${width(rest!)} at rest`
      );
      await render(page, { ...values, outputMode: 'object' });
      const restRow = lowestDrawnRow(await frameAt(page, 0));
      assert.ok(lowestDrawnRow(await frameAt(page, 0.05)) < restRow, 'and it is drawn above the floor');
    } finally {
      await page.close();
    }
  });

  it('draws a bursting clip frame without refusing it as empty', async () => {
    const page = await open();
    try {
      await render(page, { ...SUBJECT, motion: 'burst', duration: 5, outputMode: 'object' });
      const failure = await page.evaluate(() =>
        window.motionTest!.clipError([0.5, 0.75, 0.9], 5)
      );
      assert.equal(failure, null, 'a bursting frame is not decided by a ray against the whole object');
      const whole = await page.evaluate(() => window.motionTest!.clipError([0], 5));
      assert.equal(whole, null, 'and the intact subject at phase 0 passes the check');
      // A loop that lifts the subject clear of a square frame is drawing what it was
      // asked to draw, so those phases must not be refused either.
      await render(page, { ...SUBJECT, motion: 'spinland', duration: 5, outputMode: 'object' });
      for (const phase of [0.1, 0.2, 0.25, 0.3]) {
        const lifted = await page.evaluate(
          (phase) => window.motionTest!.clipError([phase as number], 5),
          phase
        );
        assert.equal(lifted, null, `a spin and land at phase ${phase} is not refused as empty`);
      }
    } finally {
      await page.close();
    }
  });

  it('keeps every loop at the largest amount inside the shadow camera', async () => {
    const page = await open();
    try {
      const phases = Array.from({ length: 24 }, (_, i) => i / 24);
      // The rig is built on the light target and the extent the renderer works out from
      // the footprint of the resting subject (renderer.ts), with the near and far planes
      // stage.ts gives the shadow camera.
      const target = [0, 1.5, 0];
      const near = 0.1,
        far = 60;
      const report: Record<string, unknown> = {};
      for (const kind of EVERY_KIND) {
        const values = { ...SUBJECT, motion: kind, duration: 5, motionAmount: 2 };
        const placed = await placement(page, values, phases);
        const lights = await page.evaluate(
          (values) => window.motionTest!.shadowLights(values as StudioValues),
          values as StudioValues
        );
        assert.ok(lights.length > 0, 'the default rig casts a shadow');
        const footprint = Math.max(
          ...[placed[0]!.min[0], placed[0]!.max[0], placed[0]!.min[2], placed[0]!.max[2]].map(Math.abs)
        );
        const extent = Math.max(7, Math.ceil((footprint + 2) * 2) / 2);
        // A burst throws its pieces out of the subject's own box: every piece leaves its
        // place in the object along a direction of its own, as far as the spread this lane
        // hands the shader, while the fall takes them down. A direction of length one
        // reaches exactly the spread across the shadow camera whichever way it points, so
        // the fall grows the box and the spread grows the reach.
        const spread = kind === 'burst' ? 2 * 2 : 0,
          fall = kind === 'burst' ? 1.5 * 2 : 0;
        // Each span is watched on its own: the phase that reaches furthest across the
        // camera is rarely the phase that reaches furthest up it.
        const worst = { across: 0, up: 0, depth: 0, acrossAt: 0, upAt: 0, lift: 0 };
        for (const step of placed)
          for (const light of lights)
            for (const point of corners(
              // Down to the floor and no further: the floor is what takes a shadow, so a
              // piece that has fallen under it is behind the receiver and shadows nothing.
              [step.min[0], Math.max(step.min[1] - fall, 0), step.min[2]],
              step.max
            )) {
              const reach = shadowReach(point, light, target);
              if (reach.across + spread > worst.across) {
                worst.across = reach.across + spread;
                worst.acrossAt = step.phase;
              }
              if (reach.up + spread > worst.up) {
                worst.up = reach.up + spread;
                worst.upAt = step.phase;
                worst.lift = step.pose.lift;
              }
              worst.depth = Math.max(worst.depth, Math.abs(reach.depth) + spread);
            }
        report[kind] = { extent, ...worst };
        assert.ok(
          worst.across <= extent && worst.up <= extent,
          `${kind} at amount 2 reaches ${worst.across.toFixed(2)} across the shadow camera at phase ${worst.acrossAt} and ${worst.up.toFixed(2)} up it at phase ${worst.upAt}, which is ${extent} either way`
        );
        assert.ok(
          worst.depth < far / 2 - near,
          `${kind} at amount 2 sits ${worst.depth.toFixed(2)} from the middle of a ${far} deep shadow camera`
        );
      }
      if (process.env.STUDIO_SHOTS) {
        await mkdir(process.env.STUDIO_SHOTS, { recursive: true });
        await writeFile(
          join(process.env.STUDIO_SHOTS, 'motion-frustum.json'),
          JSON.stringify(report, null, 2)
        );
      }
    } finally {
      await page.close();
    }
  });

  it('has no browser or shader errors', () => assert.deepEqual(studio().errors, []));
});
