// SPDX-License-Identifier: MPL-2.0
/** Portable studio recipe validation, material finishes and repeatable camera time. */
import type {
  StudioFinish,
  StudioLightV1,
  StudioSceneV1,
  StudioSourceV1,
  StudioVector3,
} from '@lolly-tools/core';
import { studioActiveValues } from './studio3d-collection.ts';

type Values = Record<string, unknown>;
function record(value: unknown): Values {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Values) : {};
}
function number(value: unknown, fallback: number, min: number, max: number): number {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : NaN;
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}
function choice<T extends string>(value: unknown, choices: readonly T[], fallback: T): T {
  return typeof value === 'string' && choices.includes(value as T) ? (value as T) : fallback;
}
function color(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toLowerCase()
    : fallback;
}
function enabled(value: unknown, fallback = false): boolean {
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return fallback;
}
function vector(
  value: unknown,
  keys: string[],
  defaults: StudioVector3,
  limit: number
): StudioVector3 {
  const v = record(value);
  return keys.map((key, i) => number(v[key], defaults[i]!, -limit, limit)) as StudioVector3;
}
function asset(value: unknown): { id: string; url: string; name: string } {
  const v = record(value);
  return {
    id: String(v.id || ''),
    url: typeof v.url === 'string' ? v.url : '',
    name: String(v.name || v.filename || v.url || ''),
  };
}
const FINISHES: StudioFinish[] = ['matte', 'satin', 'enamel', 'metal'];

export function studioFinish(finish: StudioFinish): {
  roughness: number;
  metalness: number;
  clearcoat: number;
} {
  switch (finish) {
    case 'matte':
      return { roughness: 0.8, metalness: 0, clearcoat: 0 };
    case 'enamel':
      return { roughness: 0.22, metalness: 0, clearcoat: 0.6 };
    case 'metal':
      return { roughness: 0.23, metalness: 1, clearcoat: 0.15 };
    default:
      return { roughness: 0.4, metalness: 0, clearcoat: 0.18 };
  }
}

/** Normalize user inputs once; the editor, renderer and headless shell share this recipe. */
export function buildStudioScene(input: unknown): StudioSceneV1 {
  const wrapper = record(input);
  if (wrapper.version !== 1) throw new Error('This studio recipe version is not supported.');
  const v = studioActiveValues(record(wrapper.values));
  const kind = choice(v.source, ['artwork', 'model', 'primitive'] as const, 'primitive');
  const uploaded = asset(v.upload);
  const selected = asset(kind === 'artwork' ? v.artwork : v.modelAsset);
  const picked = uploaded.url ? uploaded : selected;
  const modelFormat = choice(v.modelFormat, ['auto', 'glb', 'stl'] as const, 'auto');
  const source: StudioSourceV1 = {
    kind:
      kind === 'artwork'
        ? 'svg'
        : kind === 'model'
          ? modelFormat === 'stl' ||
            (modelFormat === 'auto' && /\.stl(?:$|[?#])/i.test(picked.name))
            ? 'stl'
            : 'glb'
          : 'primitive',
    id: picked.id,
    url: picked.url,
    primitive: choice(v.primitive, ['badge', 'sphere', 'box', 'torus'] as const, 'badge'),
  };
  if (source.kind !== 'primitive' && !source.url)
    throw new Error(
      kind === 'artwork'
        ? 'Choose an SVG or upload your artwork.'
        : 'Choose or upload a GLB or STL model.'
    );
  const primary = color(v.colorA, '#38b98a'),
    secondary = color(v.colorB, '#173d37');
  const keyColor = color(v.keyColor, '#d9fff1'),
    fillColor = color(v.fillColor, primary),
    rimColor = color(v.rimColor, primary);
  const coolColor = color(v.coolColor, '#426dff');
  const preset = choice(
    v.studio,
    ['soft', 'dramatic', 'electric', 'warm', 'custom'] as const,
    'dramatic'
  );
  const drama = number(v.drama, 0.7, 0, 1),
    light = record(v.lightLevels);
  const intensity = number(light.key, 2.5, 0, 20),
    fill = number(light.fill, 0.7, 0, 20),
    rim = number(light.rim, 3, 0, 20);
  const softness = number(v.softness, 1.5, 0, 5);
  let lights: StudioLightV1[] = [
    {
      id: 'key',
      kind: 'directional',
      color: preset === 'warm' ? color(v.warmColor, '#ffc196') : keyColor,
      intensity: preset === 'soft' ? intensity * 0.7 : intensity,
      position: [-3.6, 6.8, 4],
      size: softness,
      shadows: true,
    },
    {
      id: 'fill',
      kind: 'directional',
      color: preset === 'electric' ? coolColor : fillColor,
      intensity: fill * (preset === 'soft' ? 1.6 : 1 - drama * 0.65),
      position: [5, 3, 4],
      size: softness,
      shadows: false,
    },
    {
      id: 'rim',
      kind: 'directional',
      color: preset === 'warm' ? color(v.warmColor, '#ffc196') : rimColor,
      intensity: rim,
      position: [3, 5, -3],
      size: softness,
      shadows: false,
    },
    {
      id: 'key-card',
      kind: 'area',
      color: keyColor,
      intensity: 3,
      position: [-4, 4, 3],
      size: Math.max(0.2, softness * 2),
      shadows: false,
    },
  ];
  if (preset === 'custom') {
    if (!Array.isArray(v.lights) || !v.lights.length)
      throw new Error('Add at least one light to the custom studio.');
    if (v.lights.length > 8) throw new Error('A studio supports up to eight lights.');
    lights = v.lights.map((row, i) => {
      const l = record(row);
      const kind = choice(l.kind, ['directional', 'point', 'spot', 'area'] as const, 'directional');
      return {
        id: `light-${i + 1}`,
        kind,
        color: color(l.color, keyColor),
        intensity: number(l.intensity, 2, 0, 50),
        position: [number(l.x, -3, -30, 30), number(l.y, 6, -30, 30), number(l.z, 4, -30, 30)],
        size: number(l.size, 1.5, 0.01, 10),
        shadows: kind !== 'area' && enabled(l.shadows, true),
      };
    });
  }
  const camera = record(v.camera),
    shape = record(v.shape),
    transform = record(v.transform),
    target = record(v.target);
  const backdrop = asset(v.backdropImage);
  const projection = choice(v.projection, ['perspective', 'orthographic'] as const, 'perspective');
  const rows = Array.isArray(v.materials) ? v.materials : [];
  if (rows.length > 32) throw new Error('A studio supports up to 32 material overrides.');
  const seen = new Set<string>();
  const overrides = rows.map((row, i) => {
    const m = record(row),
      slot = String(m.slot || i + 1).trim();
    if (seen.has(slot)) throw new Error(`Material slot ${slot} has more than one override.`);
    seen.add(slot);
    return {
      slot,
      color: color(m.color, primary),
      roughness: number(m.roughness, 0.4, 0.04, 1),
      metalness: number(m.metalness, 0, 0, 1),
      clearcoat: number(m.clearcoat, 0.2, 0, 1),
    };
  });
  return {
    version: 1,
    source,
    shape: {
      depth: number(shape.depth, 0.25, 0.01, 2),
      bevel: number(shape.bevel, 0.025, 0, 0.15),
      smoothness: Math.round(number(shape.smoothness, 24, 8, 64)),
    },
    transform: {
      rotation: vector(v.rotation, ['x', 'y', 'z'], [-6, -16, -7], 360),
      position: vector(v.position, ['x', 'y', 'z'], [0, 0.1, 0], 10),
      scale: number(transform.scale, 1, 0.1, 5),
    },
    camera: {
      projection,
      azimuth: number(camera.azimuth, 25, -180, 180),
      elevation: number(camera.elevation, 14, -60, 80),
      fov: number(camera.fov, 29, 15, 80),
      zoom: number(camera.zoom, 1, 0.05, 3),
      target: [
        number(target.x, 0, -5, 5) + number(camera.panX, 0, -20, 20),
        number(target.y, 1.6, -5, 10) + number(camera.panY, 0, -20, 20),
        number(target.z, 0, -5, 5) + number(camera.panZ, 0, -20, 20),
      ],
      focus: number(v.focusDistance, 0, 0, 500),
      aperture:
        projection === 'perspective' && v.depthOfField === true
          ? number(v.aperture, 0.12, 0.01, 0.5)
          : 0,
    },
    materials: {
      mode: choice(v.materialMode, ['source', 'pair', 'custom'] as const, 'source'),
      finishA: choice(v.finishA, FINISHES, 'satin'),
      finishB: choice(v.finishB, FINISHES, 'enamel'),
      colorA: primary,
      colorB: secondary,
      overrides,
      bindings: {
        a: String(v.materialSlotA || '').trim(),
        b: String(v.materialSlotB || '').trim(),
      },
      ...(enabled(v.surfaceFinishes)
        ? {
            surfaces: Object.fromEntries(
              ['a', 'b'].map((role) => [
                role,
                Object.fromEntries(
                  ['face', 'bevel', 'side'].map((surface) => [
                    surface,
                    choice(
                      v[`${surface}Finish${role.toUpperCase()}`],
                      [...FINISHES, 'inherit'],
                      'inherit'
                    ),
                  ])
                ),
              ])
            ) as NonNullable<StudioSceneV1['materials']['surfaces']>,
          }
        : {}),
    },
    lights,
    environment: {
      intensity: number(v.environmentIntensity, 0.4, 0, 3),
      rotation: number(v.environmentRotation, 0, -180, 180),
    },
    stage: {
      output: choice(v.outputMode, ['scene', 'object-shadow', 'object'] as const, 'scene'),
      floor: choice(v.floor, ['shadow', 'matte', 'cove'] as const, 'shadow'),
      floorColor: color(v.floorColor, secondary),
      shadowOpacity: number(v.shadowOpacity, 0.4, 0, 1),
      background: color(v.background, secondary),
      background2: color(v.background2, primary),
      backdrop: choice(v.backdrop, ['solid', 'gradient', 'image'] as const, 'gradient'),
      backdropUrl: backdrop.url,
      backdropId: backdrop.id,
      backdropStrength: number(v.backdropStrength, 0.5, 0, 1),
      pedestal: v.pedestal === true,
      atmosphere: v.atmosphere === true,
      seed: Math.round(number(v.seed, 1, 1, 99999)),
    },
    exposure: number(v.exposure, 1.1, 0.1, 4),
    quality: { previewSamples: 8, exportSamples: Math.round(number(v.samples, 64, 8, 256)) },
    motion: {
      kind: choice(v.motion, ['still', 'turntable'] as const, 'still'),
      seconds: number(v.duration, 5, 1, 30),
      degrees: number(v.turnDegrees, 360, -720, 720),
    },
    lightAnimation: {
      kind: choice(v.lightMotion, ['still', 'orbit', 'breathe'] as const, 'still'),
      amount: number(v.lightMotionAmount, 0.35, 0, 1),
    },
  };
}

export function studioAnimated(scene: StudioSceneV1): boolean {
  return (
    scene.motion.kind !== 'still' ||
    !!(
      scene.lightAnimation &&
      scene.lightAnimation.kind !== 'still' &&
      scene.lightAnimation.amount > 0
    )
  );
}

/** Light animation uses clip time and returns to its authored pose at every loop boundary. */
export function studioLightMotion(
  scene: StudioSceneV1,
  time: number,
  clipSeconds?: number
): { angle: number; strength: number } {
  const motion = scene.lightAnimation;
  if (!motion || motion.kind === 'still') return { angle: 0, strength: 1 };
  const seconds = Number.isFinite(time)
    ? Math.max(0, time) * (clipSeconds && clipSeconds > 0 ? clipSeconds : scene.motion.seconds)
    : 0;
  const phase = (seconds / scene.motion.seconds) % 1;
  return {
    angle: motion.kind === 'orbit' ? Math.sin(phase * 2 * Math.PI) * Math.PI * motion.amount : 0,
    strength:
      motion.kind === 'breathe'
        ? 1 - (1 - Math.cos(phase * 2 * Math.PI)) * motion.amount * 0.35
        : 1,
  };
}

export function studioTime(scene: StudioSceneV1, time: number, clipSeconds?: number): number {
  if (scene.motion.kind === 'still') return 0;
  const seconds = Number.isFinite(time)
    ? Math.max(0, time) * (clipSeconds && clipSeconds > 0 ? clipSeconds : scene.motion.seconds)
    : 0;
  return ((seconds / scene.motion.seconds) * scene.motion.degrees * Math.PI) / 180;
}
