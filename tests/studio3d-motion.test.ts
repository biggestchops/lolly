// SPDX-License-Identifier: MPL-2.0
/**
 * The 3D Studio motion library (plan 267, lane A).
 *
 * Every loop is a pure function of the phase, so the rules that make a loop safe to
 * ship can be checked here rather than looked at in a browser: the pose at phase 0 is
 * the pose the recipe asks for, a continuous loop repeats, a one-shot loop settles and
 * holds, the subject never rises out of its own shadow, and a squash keeps its volume.
 *
 * The recipe pins in tests/fixtures/studio3d/recipes/05-motion-*.json record the shape
 * of each loop at nine phases. Rewrite them with
 * `node tests/fixtures/studio3d/recipes/generate.ts --motion` only when a change to a
 * loop is intended: they are the review step for one.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import {
  anticipate,
  backOut,
  bounceOut,
  bump,
  smoothstep,
  STUDIO_MOTION_KINDS,
  STUDIO_ONE_SHOT_KINDS,
  STUDIO_POSE_MAX_LIFT,
  STUDIO_POSE_REST,
  type StudioPoseV1,
  studioObjectPose,
} from '../engine/src/studio3d-motion.ts';
import { STUDIO_CAMERA_MOTIONS } from '../engine/src/studio3d-camera-path.ts';
import { buildStudioScene, studioAnimated, studioTime } from '../engine/src/studio3d.ts';
import { loadTool } from '../engine/src/loader.ts';
import { createRuntime } from '../engine/src/runtime.ts';
import { baseHost } from './helpers/host.ts';

const root = resolve(import.meta.dirname, '..');
const recipeDir = join(root, 'tests', 'fixtures', 'studio3d', 'recipes');

type Values = Record<string, unknown>;

const manifest: { inputs: { id: string; [key: string]: unknown }[] } = JSON.parse(
  readFileSync(join(root, 'community/3d-studio/tool.json'), 'utf8')
);

function input(id: string): Record<string, unknown> {
  const found = manifest.inputs.find((i) => i.id === id);
  assert.ok(found, `3d-studio declares the input ${id}`);
  return found as Record<string, unknown>;
}

function scene(values: Values) {
  return buildStudioScene({ version: 1, values });
}

/** Every kind but `still`, which is the only one that never moves. */
const MOVING = STUDIO_MOTION_KINDS.filter((kind) => kind !== 'still');
/**
 * The kinds that run without stopping, so the pose repeats every loop. The turntable
 * is left out on purpose: its turn accumulates rather than wrapping, which is what
 * `studioTime` has always returned and what a long clip of one relies on.
 */
const CONTINUOUS = MOVING.filter(
  (kind) => kind !== 'turntable' && !(STUDIO_ONE_SHOT_KINDS as readonly string[]).includes(kind)
);

function poseAt(kind: string, phase: number, values: Values = {}): StudioPoseV1 {
  return studioObjectPose(scene({ motion: kind, ...values }), phase);
}

function poseParts(pose: StudioPoseV1): unknown[] {
  return [pose.spin, ...pose.tilt, pose.lift, ...pose.scale, pose.burst];
}

function closeTo(a: StudioPoseV1, b: StudioPoseV1, tolerance: number, what: string): void {
  const left = poseParts(a) as number[];
  const right = poseParts(b) as number[];
  for (const [i, value] of left.entries())
    assert.ok(
      Math.abs(value - right[i]!) <= tolerance,
      `${what}: field ${i} is ${value}, expected about ${right[i]}`
    );
}

describe('the motion library', () => {
  it('offers ten kinds, and the manifest offers exactly those', () => {
    assert.deepEqual(
      [...STUDIO_MOTION_KINDS],
      ['still', 'turntable', 'hover', 'pulse', 'wobble', 'pop', 'coin', 'jump', 'spinland', 'burst']
    );
    const options = input('motion').options as { value: string; label?: string }[];
    assert.deepEqual(
      options.map((o) => o.value),
      [...STUDIO_MOTION_KINDS],
      'the motion select and STUDIO_MOTION_KINDS name the same kinds, in the same order'
    );
    for (const option of options) assert.ok(option.label, `${option.value} has a label`);
    assert.deepEqual(
      [...STUDIO_ONE_SHOT_KINDS],
      ['pop', 'coin', 'jump', 'spinland', 'burst'],
      'the one-shot kinds are the ones that hold a rest at the end'
    );
  });

  it('is exactly the rest pose at phase 0, whatever the amount, rest and length', () => {
    for (const kind of STUDIO_MOTION_KINDS)
      for (const motionAmount of [0.25, 0.5, 1, 1.5, 2])
        for (const motionRest of [0, 0.15, 0.25, 0.4, 0.6])
          for (const duration of [1, 3, 5, 12, 30]) {
            const values = { motion: kind, motionAmount, motionRest, duration };
            assert.deepEqual(
              studioObjectPose(scene(values), 0),
              STUDIO_POSE_REST,
              `${kind} at amount ${motionAmount}, rest ${motionRest}, ${duration}s`
            );
            // The same moment of the clip clock, which is the path an export takes.
            assert.deepEqual(studioObjectPose(scene(values), 0, 8), STUDIO_POSE_REST, kind);
          }
  });

  it('hands back a pose of its own, so the shared rest pose cannot be written through', () => {
    const pose = poseAt('jump', 0);
    assert.notEqual(pose, STUDIO_POSE_REST);
    pose.lift = 99;
    pose.scale[1] = 99;
    assert.equal(STUDIO_POSE_REST.lift, 0);
    assert.equal(STUDIO_POSE_REST.scale[1], 1);
    assert.deepEqual(poseAt('jump', 0), STUDIO_POSE_REST);
  });

  it('turns a turntable by exactly studioTime and nothing else', () => {
    for (const turnDegrees of [-720, -90, 0, 360, 720])
      for (const duration of [1, 5, 30])
        for (const clip of [undefined, 3, 12])
          for (const time of [0, 0.125, 0.5, 0.9, 1, 2.75]) {
            const recipe = scene({ motion: 'turntable', turnDegrees, duration, motionAmount: 2 });
            const pose = studioObjectPose(recipe, time, clip);
            assert.equal(pose.spin, studioTime(recipe, time, clip), `${turnDegrees} at ${time}`);
            assert.deepEqual(
              { ...pose, spin: 0 },
              STUDIO_POSE_REST,
              'a turntable only turns: no tilt, lift, scale or burst'
            );
          }
  });

  it('repeats every loop for the kinds that run without stopping', () => {
    assert.deepEqual([...CONTINUOUS], ['hover', 'pulse', 'wobble']);
    // The turntable keeps turning instead of repeating, which is the behaviour a clip
    // of one has always had; it comes back to the same view once a loop.
    const turning = scene({ motion: 'turntable', turnDegrees: 360 });
    assert.ok(studioObjectPose(turning, 2).spin > studioObjectPose(turning, 1).spin);
    assert.ok(
      Math.abs((studioObjectPose(turning, 1.25).spin % (2 * Math.PI)) - Math.PI / 2) < 1e-9
    );
    for (const kind of CONTINUOUS)
      for (const phase of [0.05, 0.2, 0.37, 0.5, 0.66, 0.99]) {
        const values = { motionAmount: 1.5, duration: 4 };
        closeTo(poseAt(kind, phase + 1, values), poseAt(kind, phase, values), 1e-9, `${kind}`);
        closeTo(poseAt(kind, phase + 7, values), poseAt(kind, phase, values), 1e-8, `${kind}`);
      }
  });

  it('lands and holds still for the rest of the loop on the one-shot kinds', () => {
    for (const kind of STUDIO_ONE_SHOT_KINDS)
      for (const motionRest of [0.05, 0.25, 0.6]) {
        const values = { motionRest, motionAmount: 2 };
        const settled = 1 - motionRest;
        for (const phase of [settled, settled + 0.001, (settled + 1) / 2, 0.999])
          assert.deepEqual(
            poseAt(kind, phase, values),
            STUDIO_POSE_REST,
            `${kind} at phase ${phase} with a rest of ${motionRest}`
          );
        // It has to be doing something before it settles, or the kind is inert.
        const moves = [0.1, 0.3, 0.5].some(
          (phase) =>
            JSON.stringify(poseParts(poseAt(kind, phase * settled, values))) !==
            JSON.stringify(poseParts(STUDIO_POSE_REST))
        );
        assert.ok(moves, `${kind} moves before it lands`);
      }
  });

  it('never lifts the subject out of its own shadow', () => {
    assert.equal(STUDIO_POSE_MAX_LIFT, 4);
    for (const kind of STUDIO_MOTION_KINDS)
      for (const motionAmount of [1, 2])
        for (let step = 0; step <= 400; step++) {
          const pose = poseAt(kind, step / 400, { motionAmount, motionRest: 0 });
          assert.ok(
            pose.lift >= 0 && pose.lift <= STUDIO_POSE_MAX_LIFT,
            `${kind} lifts ${pose.lift} at amount ${motionAmount}`
          );
        }
  });

  it('keeps the volume under a squash and stays even under a breath', () => {
    for (const kind of STUDIO_MOTION_KINDS)
      for (const motionAmount of [0.25, 1, 2])
        for (let step = 0; step <= 200; step++) {
          const [sx, sy, sz] = poseAt(kind, step / 200, { motionAmount, motionRest: 0.2 }).scale;
          assert.ok(sx > 0 && sy > 0 && sz > 0, `${kind} scales to ${sx}, ${sy}, ${sz}`);
          if (sx === sy && sy === sz) continue;
          assert.equal(sx, sz, `${kind} squashes the two side axes alike`);
          assert.ok(
            Math.abs(sx * sy * sz - 1) <= 1e-6,
            `${kind} keeps its volume: ${sx} by ${sy} by ${sz}`
          );
        }
    // Pulse and pop change size, so they are the two that must stay even.
    for (const kind of ['pulse', 'pop'])
      for (const phase of [0.1, 0.3, 0.5, 0.7]) {
        const [sx, sy, sz] = poseAt(kind, phase, { motionAmount: 2 }).scale;
        assert.equal(sx, sy, kind);
        assert.equal(sy, sz, kind);
      }
  });

  it('reports a burst only while bursting, out and back inside 0 to 1', () => {
    for (const kind of STUDIO_MOTION_KINDS)
      for (let step = 0; step <= 100; step++) {
        const pose = poseAt(kind, step / 100, { motionAmount: 2, motionRest: 0.25 });
        if (kind !== 'burst') assert.equal(pose.burst, 0, `${kind} does not burst`);
        else assert.ok(pose.burst >= 0 && pose.burst <= 1, `burst is ${pose.burst}`);
      }
    assert.equal(poseAt('burst', 0).burst, 0);
    assert.equal(poseAt('burst', 0.75, { motionRest: 0.25 }).burst, 0, 'whole again by the rest');
    assert.ok(poseAt('burst', 0.375, { motionRest: 0.25 }).burst > 0.99, 'fully apart in the middle');
  });

  it('calls every kind but a still image animated, and keeps the light and camera clauses', () => {
    for (const kind of STUDIO_MOTION_KINDS)
      assert.equal(studioAnimated(scene({ motion: kind })), kind !== 'still', kind);
    assert.equal(studioAnimated(scene({ motion: 'still', lightMotion: 'orbit' })), true);
    assert.equal(
      studioAnimated(scene({ motion: 'still', lightMotion: 'orbit', lightMotionAmount: 0 })),
      false
    );
  });

  it('gives the same answer every time, with no clock and no random numbers', () => {
    const source = readFileSync(join(root, 'engine/src/studio3d-motion.ts'), 'utf8');
    assert.equal(/Math\.random|Date\.now|new Date/.test(source), false);
    for (const kind of STUDIO_MOTION_KINDS) {
      const recipe = scene({ motion: kind, motionAmount: 1.35, motionRest: 0.3, duration: 7 });
      for (const phase of [0.13, 0.41, 0.88])
        assert.deepEqual(
          studioObjectPose(recipe, phase, 5),
          studioObjectPose(recipe, phase, 5),
          kind
        );
    }
  });
});

describe('the easing helpers', () => {
  it('starts and ends where it says it does', () => {
    assert.equal(smoothstep(0), 0);
    assert.equal(smoothstep(1), 1);
    assert.equal(smoothstep(-3), 0);
    assert.equal(smoothstep(4), 1);
    assert.equal(backOut(0, 0.4), 0);
    assert.equal(backOut(1, 0.4), 1);
    assert.equal(anticipate(0, 0.2), 0);
    assert.equal(anticipate(1, 0.2), 1);
    assert.equal(bounceOut(0), 0);
    assert.ok(Math.abs(bounceOut(1) - 1) < 1e-12);
    assert.equal(bump(0, 0, 1), 0);
    assert.equal(bump(1, 0, 1), 0);
    assert.equal(bump(0.5, 0, 1), 1);
    assert.equal(bump(-2, 0, 1), 0);
    assert.equal(bump(0.5, 1, 1), 0, 'an empty window is no bump at all');
  });

  it('overshoots, winds up and bounces', () => {
    const peak = Math.max(...Array.from({ length: 101 }, (_, i) => backOut(i / 100, 0.4)));
    assert.ok(peak > 1, `backOut passes its target: ${peak}`);
    const dip = Math.min(...Array.from({ length: 101 }, (_, i) => anticipate(i / 100, 0.3)));
    assert.ok(dip < 0, `anticipate winds up first: ${dip}`);
    // A bounce touches down and comes back up, more than once.
    const touches = Array.from({ length: 275 }, (_, i) => bounceOut(i / 275)).filter(
      (v, i, all) => i > 0 && i < all.length - 1 && v > all[i - 1]! && v > all[i + 1]!
    );
    assert.ok(touches.length >= 2, `the bounce lands more than once: ${touches.length}`);
    for (let i = 0; i <= 100; i++) {
      const value = bounceOut(i / 100);
      assert.ok(value >= 0 && value <= 1, `bounceOut stays in range: ${value}`);
    }
  });
});

describe('the motion recipe', () => {
  it('reads the amount and the rest, and holds them to their ranges', () => {
    const motion = (values: Values) => scene(values).motion;
    assert.deepEqual(motion({}), {
      kind: 'still',
      seconds: 5,
      degrees: 360,
      amount: 1,
      rest: 0.25,
    });
    assert.equal(motion({ motionAmount: 1.4 }).amount, 1.4);
    assert.equal(motion({ motionAmount: 9 }).amount, 2);
    assert.equal(motion({ motionAmount: 0 }).amount, 0.25);
    assert.equal(motion({ motionAmount: 'loud' }).amount, 1);
    assert.equal(motion({ motionRest: 0.5 }).rest, 0.5);
    assert.equal(motion({ motionRest: 4 }).rest, 0.6);
    assert.equal(motion({ motionRest: -1 }).rest, 0);
    for (const kind of STUDIO_MOTION_KINDS) assert.equal(motion({ motion: kind }).kind, kind);
    assert.equal(motion({ motion: 'somersault' }).kind, 'still', 'an unknown kind is a still');
  });

  it('declares the two controls the loops read', () => {
    const amount = input('motionAmount');
    assert.equal(amount.label, 'Motion amount');
    assert.equal(amount.type, 'number');
    assert.equal(amount.section, 'Motion');
    assert.deepEqual([amount.default, amount.min, amount.max, amount.step], [1, 0.25, 2, 0.05]);
    assert.deepEqual(
      (amount.showIf as { motion: string[] }).motion,
      STUDIO_MOTION_KINDS.filter((kind) => kind !== 'still' && kind !== 'turntable'),
      'the amount is offered for the loops it scales'
    );
    const held = input('motionRest');
    assert.equal(held.label, 'Rest between loops');
    assert.equal(held.section, 'Motion');
    assert.deepEqual([held.default, held.min, held.max, held.step], [0.25, 0, 0.6, 0.05]);
    assert.deepEqual(
      (held.showIf as { motion: string[] }).motion,
      [...STUDIO_ONE_SHOT_KINDS],
      'a rest between loops belongs to the loops that play once'
    );
    for (const id of ['motion', 'motionAmount', 'motionRest'])
      assert.ok(String(input(id).help ?? '').length > 20, `${id} says what it does`);
  });

  it('offers the loop length for every kind that has one', () => {
    const showIf = input('duration').showIf as { motion?: string[]; cameraMotion?: string[] }[];
    const byMotion = showIf.find((clause) => clause.motion);
    assert.ok(byMotion, 'the loop seconds are shown for a moving subject');
    assert.deepEqual(byMotion.motion, [...MOVING], 'every loop has a length to set');
    // A camera move takes the loop seconds exactly as an authored path does, so the
    // clause has to name every camera value but Hold the current view.
    const byCamera = showIf.find((clause) => clause.cameraMotion);
    assert.ok(byCamera, 'the loop seconds are shown for a moving camera');
    assert.deepEqual(
      byCamera.cameraMotion,
      STUDIO_CAMERA_MOTIONS.filter((kind) => kind !== 'still')
    );
  });
});

describe('the clip length the tool reports', () => {
  it('gives a clip a length for every loop, and none for a still scene', async () => {
    const tool = await loadTool('3d-studio', (path) => readFile(join(root, 'community', path), 'utf8'));
    const host = baseHost({
      assets: { get: async (id: string) => ({ id, url: `/catalog/${id}.svg` }) },
    });
    const clipMs = async (values: Values): Promise<number> => {
      const runtime = await createRuntime(tool, host, { duration: 6, ...values });
      return Number(runtime.getHydratedText('{{_clipMs}}'));
    };
    for (const kind of STUDIO_MOTION_KINDS)
      assert.equal(await clipMs({ motion: kind }), kind === 'still' ? 0 : 6000, kind);
    for (const kind of STUDIO_CAMERA_MOTIONS)
      assert.equal(
        await clipMs({ cameraMotion: kind }),
        kind === 'still' || kind === 'keys' ? 0 : 6000,
        `camera ${kind}`
      );
    assert.equal(
      await clipMs({ cameraMotion: 'keys', cameraKeys: [{ at: 0 }, { at: 100 }] }),
      6000,
      'a path travels once it has two keys'
    );
    assert.equal(
      await clipMs({ cameraMotion: 'dolly', projection: 'orthographic' }),
      0,
      'an orthographic camera has no lens for a dolly zoom to change'
    );
    assert.equal(await clipMs({ lightMotion: 'orbit' }), 6000, 'a moving light is a clip too');
  });
});

describe('the pinned loops', () => {
  const files = readdirSync(recipeDir)
    .filter((file) => /^05-motion-.*\.json$/.test(file))
    .sort();

  it('pins one loop per kind', () => {
    assert.deepEqual(
      files.map((file) => file.replace(/^05-motion-|\.json$/g, '')).sort(),
      [...STUDIO_MOTION_KINDS].sort()
    );
  });

  for (const file of files)
    it(`${file} evaluates as it was pinned`, () => {
      const pinned: {
        source: string;
        era: string;
        kind: string;
        phases: number[];
        values: Values;
        scene: Record<string, unknown>;
        poses: StudioPoseV1[];
      } = JSON.parse(readFileSync(join(recipeDir, file), 'utf8'));
      assert.equal(pinned.source, 'plan-267');
      assert.equal(pinned.era, '0.5');
      const built = scene(pinned.values);
      const rerun = `${file}: rerun node tests/fixtures/studio3d/recipes/generate.ts --motion to re-pin a change on purpose`;
      assert.equal(built.motion.kind, pinned.kind, rerun);
      assert.deepEqual(JSON.parse(JSON.stringify(built)), pinned.scene, rerun);
      assert.deepEqual(
        pinned.phases.map((phase) => JSON.parse(JSON.stringify(studioObjectPose(built, phase)))),
        pinned.poses,
        rerun
      );
    });
});
