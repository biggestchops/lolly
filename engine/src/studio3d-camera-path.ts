// SPDX-License-Identifier: MPL-2.0
/** Camera paths: keys captured from the live view, sampled deterministically over the loop. */
import type { StudioCameraKeyV1, StudioSceneV1, StudioVector3 } from '@lolly-tools/core';

export type StudioValues = Record<string, unknown>;
export const STUDIO_CAMERA_KEY_LIMIT = 12;

function record(value: unknown): StudioValues {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as StudioValues) : {};
}
const num = (value: unknown, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : fallback;
};

/** The pose the camera holds when it is not travelling. */
export function studioRestPose(scene: StudioSceneV1): StudioCameraKeyV1 {
  const c = scene.camera;
  return {
    at: 0,
    azimuth: c.azimuth,
    elevation: c.elevation,
    fov: c.fov,
    zoom: c.zoom,
    target: [...c.target] as StudioVector3,
    focus: c.focus,
  };
}

/** Catmull-Rom through four values; t runs 0 to 1 between the middle two. */
function spline(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t,
    t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

function mix(keys: StudioCameraKeyV1[], leg: number, t: number, ease: string): StudioCameraKeyV1 {
  const a = keys[leg]!,
    b = keys[leg + 1]!;
  const pick = (key: StudioCameraKeyV1): number[] => [
    key.azimuth,
    key.elevation,
    key.fov,
    key.zoom,
    key.target[0],
    key.target[1],
    key.target[2],
    key.focus,
  ];
  let values: number[];
  if (ease === 'flow' && keys.length > 2) {
    const before = keys[Math.max(0, leg - 1)]!,
      after = keys[Math.min(keys.length - 1, leg + 2)]!;
    values = pick(a).map((_, i) =>
      spline(pick(before)[i]!, pick(a)[i]!, pick(b)[i]!, pick(after)[i]!, t)
    );
  } else {
    const s = ease === 'linear' ? t : t * t * (3 - 2 * t);
    values = pick(a).map((v, i) => v + (pick(b)[i]! - v) * s);
  }
  // Focus at 0 means automatic on either key, so a leg touching automatic stays automatic.
  const focus = a.focus > 0 && b.focus > 0 ? values[7]! : 0;
  return {
    at: a.at + (b.at - a.at) * t,
    azimuth: values[0]!,
    elevation: values[1]!,
    fov: values[2]!,
    zoom: values[3]!,
    target: [values[4]!, values[5]!, values[6]!],
    focus,
  };
}

/** Where the camera is at loop time `time` (0 to 1 of the clip); still scenes hold the rest pose. */
export function studioCameraPose(
  scene: StudioSceneV1,
  time: number,
  clipSeconds?: number
): StudioCameraKeyV1 {
  const motion = scene.cameraMotion;
  if (motion?.kind !== 'keys' || motion.keys.length < 2) return studioRestPose(scene);
  const seconds = Number.isFinite(time)
    ? Math.max(0, time) * (clipSeconds && clipSeconds > 0 ? clipSeconds : scene.motion.seconds)
    : 0;
  // A closed loop wraps; an open move holds its last key once the clip is used up.
  const progress = seconds / scene.motion.seconds;
  const phase = motion.loop ? progress % 1 : Math.min(1, progress);
  const keys = [...motion.keys].sort((x, y) => x.at - y.at);
  if (motion.loop) keys.push({ ...keys[0]!, at: 1 });
  const first = keys[0]!,
    last = keys[keys.length - 1]!;
  if (phase <= first.at) return { ...first, at: phase };
  if (phase >= last.at) return { ...last, at: phase };
  for (let leg = 0; leg < keys.length - 1; leg++) {
    const a = keys[leg]!,
      b = keys[leg + 1]!;
    if (phase >= a.at && phase <= b.at) {
      const span = b.at - a.at;
      return mix(keys, leg, span > 0 ? (phase - a.at) / span : 1, motion.ease);
    }
  }
  return { ...last, at: phase };
}

export function studioCameraTravels(scene: StudioSceneV1): boolean {
  return !!scene.cameraMotion && scene.cameraMotion.kind === 'keys' && scene.cameraMotion.keys.length >= 2;
}

/** A key row from the live camera values, as the sidebar stores them. */
export function studioCameraKeyFromView(values: StudioValues): StudioValues {
  const camera = record(values.camera),
    target = record(values.target);
  return {
    azimuth: num(camera.azimuth, 25),
    elevation: num(camera.elevation, 14),
    fov: num(camera.fov, 29),
    zoom: num(camera.zoom, 1),
    panX: num(num(target.x, 0) + num(camera.panX, 0), 0),
    panY: num(num(target.y, 1.6) + num(camera.panY, 0), 1.6),
    panZ: num(num(target.z, 0) + num(camera.panZ, 0), 0),
    focusDistance: num(values.focusDistance, 0),
  };
}

/** Append the live view as a key; keys are spaced evenly in time when one is added. */
export function studioAddCameraKey(values: StudioValues): { id: string; value: unknown } {
  const rows = Array.isArray(values.cameraKeys) ? (values.cameraKeys as StudioValues[]) : [];
  if (rows.length >= STUDIO_CAMERA_KEY_LIMIT)
    throw new Error(`A camera path holds up to ${STUDIO_CAMERA_KEY_LIMIT} keys.`);
  const next = [...rows, studioCameraKeyFromView(values)];
  return {
    id: 'cameraKeys',
    value: next.map((row, i) => ({
      ...row,
      at: Math.round((next.length > 1 ? (i / (next.length - 1)) * 100 : 0) * 10) / 10,
    })),
  };
}

/** The saved camera values that show a key's view, for a jump to it. */
export function studioCameraFromKey(values: StudioValues, index: number): { id: string; value: unknown }[] {
  const rows = Array.isArray(values.cameraKeys) ? (values.cameraKeys as StudioValues[]) : [];
  const key = rows[index];
  if (!key) throw new Error('That camera key does not exist.');
  const target = record(values.target);
  return [
    {
      id: 'camera',
      value: {
        azimuth: num(key.azimuth, 25),
        elevation: num(key.elevation, 14),
        fov: num(key.fov, 29),
        zoom: num(key.zoom, 1),
        panX: num(num(key.panX, 0) - num(target.x, 0), 0),
        panY: num(num(key.panY, 1.6) - num(target.y, 1.6), 0),
        panZ: num(num(key.panZ, 0) - num(target.z, 0), 0),
      },
    },
    { id: 'focusDistance', value: num(key.focusDistance, 0) },
  ];
}
