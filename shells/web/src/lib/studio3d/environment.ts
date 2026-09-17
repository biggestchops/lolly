// SPDX-License-Identifier: MPL-2.0
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import type { StudioSceneV1 } from '../../../../../packages/core/src/studio3d-v1.ts';
import type { StudioRead } from './source.ts';

export interface StudioEnvironment {
  /** Prefiltered radiance the scene lights, reflects and can show behind a scene image. */
  texture: THREE.Texture;
  /** The unfiltered panorama, when one is kept, for a crisp background at zero blur. */
  backdrop?: THREE.Texture;
  warnings: string[];
  dispose(): void;
}
/** Brand colours a generated environment may take: colour A and B, background and accent. */
export interface StudioPalette {
  a: string;
  b: string;
  bg: string;
  bg2: string;
}
export type StudioEnvironmentKind = StudioSceneV1['environment']['kind'];
const PANO_W = 2048;
const PANO_H = 1024;
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_WIDTH = 8192;
const MAX_HEIGHT = 4096;

function panel(
  scene: THREE.Scene,
  size: [number, number],
  position: [number, number, number],
  intensity: number,
  color = '#ffffff'
): void {
  const geometry = new THREE.PlaneGeometry(size[0], size[1]);
  const material = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
  material.color.multiplyScalar(intensity);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.lookAt(0, 0, 0);
  scene.add(mesh);
}

/**
 * Direction of an equirectangular pixel as the builders paint it: longitude across, latitude
 * down, with the middle column facing +z and longitude growing towards +x, as in place().
 */
function direction(u: number, v: number): [number, number, number] {
  const lon = (u - 0.5) * 2 * Math.PI,
    lat = (0.5 - v) * Math.PI;
  return [Math.sin(lon) * Math.cos(lat), Math.sin(lat), Math.cos(lon) * Math.cos(lat)];
}
/**
 * three reads an equirectangular map with longitude atan2(z, x), so its middle column faces +x.
 * Painted column u belongs in stored column 1.25 - u (a quarter turn and a mirror). Moving
 * every column there makes three show each painted pixel in the direction it was painted
 * for, which is also where place() puts the lamps.
 */
function threeLayout(painted: ImageData): ImageData {
  const stored = new ImageData(PANO_W, PANO_H);
  const from = new Uint32Array(painted.data.buffer),
    to = new Uint32Array(stored.data.buffer);
  // Column centres: (x + 0.5) / W = 1.25 - (source + 0.5) / W.
  const turn = (PANO_W * 5) / 4 - 1;
  for (let y = 0; y < PANO_H; y++) {
    const row = y * PANO_W;
    for (let x = 0; x < PANO_W; x++) to[row + x] = from[row + ((turn - x) % PANO_W)]!;
  }
  return stored;
}
/** The position of a panel at a longitude and latitude in degrees, at a radius. */
function place(lonDeg: number, latDeg: number, radius: number): [number, number, number] {
  const lon = (lonDeg * Math.PI) / 180,
    lat = (latDeg * Math.PI) / 180;
  return [Math.sin(lon) * Math.cos(lat) * radius, Math.sin(lat) * radius, Math.cos(lon) * Math.cos(lat) * radius];
}
function rgb(hex: string): [number, number, number] {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}
function css(hex: string, alpha = 1): string {
  const [r, g, b] = rgb(hex);
  return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${alpha})`;
}
function mixHex(a: string, b: string, t: number): string {
  return '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();
}

/**
 * Paint a panorama: `sky(ctx)` draws with 2D canvas calls; `pixel(u, v)` may then colour
 * each pixel from its direction, for grids and ground planes that need the geometry.
 */
function paintPanorama(
  sky: (ctx: CanvasRenderingContext2D) => void,
  pixel?: (u: number, v: number, dir: [number, number, number]) => [number, number, number] | null
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = PANO_W;
  canvas.height = PANO_H;
  const ctx = canvas.getContext('2d')!;
  sky(ctx);
  const painted = ctx.getImageData(0, 0, PANO_W, PANO_H);
  if (pixel) {
    const data = painted.data;
    for (let y = 0; y < PANO_H; y++)
      for (let x = 0; x < PANO_W; x++) {
        const u = (x + 0.5) / PANO_W,
          v = (y + 0.5) / PANO_H;
        const colour = pixel(u, v, direction(u, v));
        if (!colour) continue;
        const i = (y * PANO_W + x) * 4;
        data[i] = Math.min(255, Math.round(colour[0] * 255));
        data[i + 1] = Math.min(255, Math.round(colour[1] * 255));
        data[i + 2] = Math.min(255, Math.round(colour[2] * 255));
      }
  }
  ctx.putImageData(threeLayout(painted), 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.mapping = THREE.EquirectangularReflectionMapping;
  return texture;
}

/** A painted panorama on the inside of a sphere, plus bright panels for the light sources. */
function panoramaScene(backdrop: THREE.Texture): THREE.Scene {
  const scene = new THREE.Scene();
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(40, 48, 32),
    new THREE.MeshBasicMaterial({ map: backdrop, side: THREE.BackSide, toneMapped: false })
  );
  // A sphere's column u faces atan2(z, x) = 180 - 360u. Mirroring z gives 360u - 180, which
  // is three's own lookup, so the lighting map agrees with the stored background.
  sphere.scale.z = -1;
  scene.add(sphere);
  return scene;
}
function lamp(
  scene: THREE.Scene,
  lonDeg: number,
  latDeg: number,
  size: [number, number],
  intensity: number,
  color = '#ffffff'
): void {
  const geometry = new THREE.PlaneGeometry(size[0], size[1]);
  const material = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, toneMapped: false });
  material.color.multiplyScalar(intensity);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...place(lonDeg, latDeg, 30));
  mesh.lookAt(0, 0, 0);
  scene.add(mesh);
}
function vertical(ctx: CanvasRenderingContext2D, stops: [number, string][]): void {
  const gradient = ctx.createLinearGradient(0, 0, 0, PANO_H);
  for (const [at, colour] of stops) gradient.addColorStop(at, colour);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, PANO_W, PANO_H);
}
/** The ground plane a direction meets below the horizon, for floors drawn per pixel. */
function ground(dir: [number, number, number], height: number): [number, number] | null {
  if (dir[1] >= -0.002) return null;
  const t = -height / dir[1];
  return [dir[0] * t, dir[2] * t];
}

const BUILDERS: Record<
  Exclude<StudioEnvironmentKind, 'room' | 'softbox' | 'window' | 'image'>,
  (p: StudioPalette) => { scene: THREE.Scene; backdrop: THREE.Texture }
> = {
  studio: (p) => {
    const backdrop = paintPanorama((ctx) =>
      vertical(ctx, [
        [0, '#3a3a3c'],
        [0.42, '#5a5a5d'],
        [0.5, '#6a6a6d'],
        [0.53, '#4a4a4c'],
        [1, '#2a2a2b'],
      ])
    );
    const scene = panoramaScene(backdrop);
    lamp(scene, -50, 28, [22, 16], 9);
    lamp(scene, 55, 12, [16, 12], 3.2, mixHex('#ffffff', p.a, 0.18));
    lamp(scene, 180, 36, [30, 6], 2.4);
    lamp(scene, 0, -70, [40, 40], 0.5, '#8c8c8e');
    return { scene, backdrop };
  },
  gallery: (p) => {
    const backdrop = paintPanorama((ctx) =>
      vertical(ctx, [
        [0, '#f4f4f1'],
        [0.5, '#ececea'],
        [0.56, mixHex('#e2e2df', p.bg2, 0.08)],
        [1, '#d5d5d2'],
      ])
    );
    const scene = panoramaScene(backdrop);
    lamp(scene, 0, 78, [40, 40], 5.5, '#ffffff');
    lamp(scene, -90, 10, [24, 18], 1.6, '#fbfbf8');
    lamp(scene, 90, 10, [24, 18], 1.3, '#fbfbf8');
    return { scene, backdrop };
  },
  warehouse: (p) => {
    const backdrop = paintPanorama(
      (ctx) => {
        vertical(ctx, [
          [0, '#8e9498'],
          [0.36, '#7a8085'],
          [0.5, '#6d7276'],
          [0.52, '#3f4245'],
          [1, '#2b2d30'],
        ]);
        // Brick-like accent wall behind, tinted by the brand.
        ctx.fillStyle = css(mixHex('#5d5350', p.a, 0.12));
        ctx.fillRect(PANO_W * 0.62, PANO_H * 0.3, PANO_W * 0.2, PANO_H * 0.22);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        for (let x = 0; x < PANO_W; x += 128) ctx.fillRect(x, PANO_H * 0.3, 6, PANO_H * 0.22);
        // Window strip along one side.
        for (let i = 0; i < 7; i++) {
          ctx.fillStyle = '#c9d6e2';
          ctx.fillRect(PANO_W * 0.08 + i * 46, PANO_H * 0.38, 30, PANO_H * 0.1);
        }
      },
      (_u, _v, dir) => {
        const g = ground(dir, 1);
        if (!g) return null;
        const seam = (Math.abs(g[0]) % 3 < 0.06 || Math.abs(g[1]) % 3 < 0.06) ? 0.08 : 0;
        const base = 0.19 + 0.06 * Math.min(1, Math.hypot(g[0], g[1]) / 30);
        return [base - seam, base - seam + 0.005, base - seam + 0.01];
      }
    );
    const scene = panoramaScene(backdrop);
    for (const lon of [-120, -60, 0, 60, 120, 180]) lamp(scene, lon, 62, [6, 14], 7, '#f4f6f8');
    lamp(scene, -100, 6, [26, 10], 4.5, '#dbe7f2');
    return { scene, backdrop };
  },
  stage: (p) => {
    const backdrop = paintPanorama((ctx) => {
      vertical(ctx, [
        [0, '#050507'],
        [0.5, '#0b0b0f'],
        [0.53, '#101014'],
        [1, '#040405'],
      ]);
      // A wide screen behind the performer, in the accent colour, and rigging above.
      const screen = ctx.createLinearGradient(0, PANO_H * 0.3, 0, PANO_H * 0.5);
      screen.addColorStop(0, css(mixHex(p.bg2, '#000000', 0.2)));
      screen.addColorStop(1, css(mixHex(p.bg2, p.b, 0.6)));
      ctx.fillStyle = screen;
      ctx.fillRect(PANO_W * 0.34, PANO_H * 0.3, PANO_W * 0.32, PANO_H * 0.2);
      ctx.fillStyle = '#1a1a1e';
      ctx.fillRect(0, PANO_H * 0.18, PANO_W, 10);
    });
    const scene = panoramaScene(backdrop);
    lamp(scene, -40, 48, [5, 5], 18, p.a);
    lamp(scene, 40, 48, [5, 5], 18, p.b);
    lamp(scene, 0, 58, [6, 6], 14, '#ffffff');
    lamp(scene, 150, 30, [7, 7], 12, mixHex(p.a, '#ffffff', 0.4));
    lamp(scene, -150, 30, [7, 7], 12, mixHex(p.b, '#ffffff', 0.4));
    lamp(scene, 180, 6, [40, 12], 2.2, mixHex(p.bg2, p.b, 0.5));
    return { scene, backdrop };
  },
  desert: () => {
    const backdrop = paintPanorama(
      (ctx) => {
        vertical(ctx, [
          [0, '#2f6fd6'],
          [0.28, '#6fa3e6'],
          [0.47, '#d8e6f0'],
          [0.5, '#f1e4c8'],
          [0.51, '#d9a866'],
          [0.7, '#c58f4e'],
          [1, '#a8712f'],
        ]);
        const sun = ctx.createRadialGradient(PANO_W * 0.62, PANO_H * 0.31, 8, PANO_W * 0.62, PANO_H * 0.31, 120);
        sun.addColorStop(0, '#ffffff');
        sun.addColorStop(0.15, '#fff5d6');
        sun.addColorStop(1, 'rgba(255,240,200,0)');
        ctx.fillStyle = sun;
        ctx.fillRect(PANO_W * 0.5, PANO_H * 0.15, PANO_W * 0.25, PANO_H * 0.3);
      },
      (_u, _v, dir) => {
        const g = ground(dir, 1);
        if (!g) return null;
        const d = Math.hypot(g[0], g[1]);
        const dune = 0.5 + 0.5 * Math.sin(g[0] * 0.35 + Math.sin(g[1] * 0.2) * 1.5);
        const far = Math.min(1, d / 60);
        const r = 0.83 - dune * 0.14 - far * 0.1,
          gg = 0.62 - dune * 0.12 - far * 0.1,
          b = 0.34 - dune * 0.08 + far * 0.15;
        return [r, gg, b];
      }
    );
    const scene = panoramaScene(backdrop);
    lamp(scene, 43, 34, [3, 3], 60, '#fff6e0');
    lamp(scene, 0, -70, [40, 40], 0.9, '#d9a866');
    return { scene, backdrop };
  },
  synthwave: (p) => {
    const backdrop = paintPanorama(
      (ctx) => {
        vertical(ctx, [
          [0, mixHex('#08001a', p.bg, 0.25)],
          [0.32, mixHex('#2a0a4a', p.b, 0.2)],
          [0.5, mixHex('#ff3f8e', p.b, 0.35)],
          [0.505, '#120018'],
          [1, '#05000a'],
        ]);
        // The striped sun on the horizon, in the accent colour.
        const cx = PANO_W * 0.5,
          cy = PANO_H * 0.5,
          radius = PANO_H * 0.16;
        const sun = ctx.createLinearGradient(0, cy - radius, 0, cy);
        sun.addColorStop(0, '#ffe66d');
        sun.addColorStop(1, css(mixHex('#ff2d95', p.b, 0.4)));
        ctx.fillStyle = sun;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, Math.PI, 0);
        ctx.fill();
        ctx.fillStyle = css(mixHex('#2a0a4a', p.b, 0.2));
        for (let i = 0; i < 6; i++) ctx.fillRect(cx - radius, cy - radius * (0.55 - i * 0.09), radius * 2, 3 + i * 1.5);
        // Stars.
        ctx.fillStyle = '#ffffff';
        for (let i = 0; i < 160; i++) {
          const x = ((i * 977) % PANO_W), y = ((i * 613) % Math.floor(PANO_H * 0.42));
          ctx.fillRect(x, y, 2, 2);
        }
      },
      (_u, _v, dir) => {
        const g = ground(dir, 1);
        if (!g) return null;
        const d = Math.hypot(g[0], g[1]);
        const line = Math.abs(g[0]) % 2 < 0.07 || Math.abs(g[1]) % 2 < 0.07;
        const fade = Math.max(0, 1 - d / 45);
        const neon = rgb(p.a);
        return line ? [neon[0] * fade + 0.03, neon[1] * fade + 0.02, neon[2] * fade + 0.06] : [0.03, 0.01, 0.06];
      }
    );
    const scene = panoramaScene(backdrop);
    lamp(scene, 0, 4, [10, 5], 10, mixHex('#ff9ad5', p.b, 0.4));
    lamp(scene, 0, -50, [30, 30], 1.2, p.a);
    lamp(scene, 180, 50, [12, 12], 2, mixHex('#4a2a8a', p.a, 0.3));
    return { scene, backdrop };
  },
};

/** Generated studios: a neutral room, a broad soft box, or one bright window on a dim room. */
function generated(kind: 'room' | 'softbox' | 'window'): THREE.Scene {
  if (kind === 'room') return new RoomEnvironment();
  const scene = new THREE.Scene();
  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(20, 20, 20),
    new THREE.MeshBasicMaterial({ color: kind === 'softbox' ? '#5a5a5a' : '#1a1a1a', side: THREE.BackSide })
  );
  scene.add(shell);
  if (kind === 'softbox') {
    panel(scene, [12, 12], [0, 9.5, 0], 6);
    panel(scene, [8, 5], [-9.5, 3, 2], 3.5);
    panel(scene, [8, 5], [9.5, 3, -2], 2.5);
    panel(scene, [20, 20], [0, -9.9, 0], 0.35, '#8a8a8a');
  } else {
    panel(scene, [3.5, 6], [-9.5, 4, 3], 22, '#fff4e0');
    panel(scene, [4, 3], [8, 6, -6], 1.2, '#dbe6ff');
    panel(scene, [20, 20], [0, -9.9, 0], 0.12, '#666666');
  }
  return scene;
}

/**
 * The prefilter sizes its cube map from the source width, and a map narrower than this
 * collapses to a mip chain too short to sample, which reads as no light at all. Small
 * maps are replicated pixel for pixel to the minimum width first; nothing is invented.
 */
const MIN_WIDTH = 512;
function enlarge(
  data: THREE.TypedArray,
  width: number,
  height: number,
  channels: number
): { data: THREE.TypedArray; width: number; height: number } {
  if (width >= MIN_WIDTH) return { data, width, height };
  const factor = Math.ceil(MIN_WIDTH / width);
  const w = width * factor,
    h = height * factor;
  const out = new (data.constructor as new (n: number) => THREE.TypedArray)(w * h * channels);
  for (let y = 0; y < h; y++) {
    const sy = Math.floor(y / factor);
    for (let x = 0; x < w; x++) {
      const sx = Math.floor(x / factor);
      const from = (sy * width + sx) * channels,
        to = (y * w + x) * channels;
      for (let c = 0; c < channels; c++) out[to + c] = data[from + c]!;
    }
  }
  return { data: out, width: w, height: h };
}

function decodeRadiance(
  bytes: Uint8Array,
  name: string
): { texture: THREE.DataTexture; width: number; height: number; warnings: string[] } {
  const exr =
    bytes.length >= 4 &&
    bytes[0] === 0x76 &&
    bytes[1] === 0x2f &&
    bytes[2] === 0x31 &&
    bytes[3] === 0x01;
  const hdr = bytes.length >= 2 && bytes[0] === 0x23 && bytes[1] === 0x3f;
  if (!exr && !hdr)
    throw new Error(
      `${name || 'The environment file'} is not a Radiance .hdr or OpenEXR .exr map. A PNG or JPEG is a display image and cannot light a scene.`
    );
  const buffer = bytes.slice().buffer;
  const parsed = exr
    ? new EXRLoader().parse(buffer)
    : new HDRLoader().parse(buffer);
  if (!parsed?.width || !parsed.height || !parsed.data)
    throw new Error('The radiance map could not be decoded.');
  if (parsed.width > MAX_WIDTH || parsed.height > MAX_HEIGHT)
    throw new Error(
      `Use a radiance map up to ${MAX_WIDTH} by ${MAX_HEIGHT} pixels (this one is ${parsed.width} by ${parsed.height}).`
    );
  const format = (parsed as { format?: THREE.PixelFormat }).format ?? THREE.RGBAFormat;
  const channels = format === THREE.RedFormat ? 1 : format === THREE.RGFormat ? 2 : 4;
  const grown = enlarge(parsed.data as THREE.TypedArray, parsed.width, parsed.height, channels);
  const texture = new THREE.DataTexture(
    grown.data,
    grown.width,
    grown.height,
    format,
    parsed.type as THREE.TextureDataType
  );
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.flipY = exr ? false : (parsed as { flipY?: boolean }).flipY ?? true;
  texture.needsUpdate = true;
  const warnings: string[] = [];
  if (Math.abs(parsed.width / parsed.height - 2) > 0.1)
    warnings.push(
      `Equirectangular maps are twice as wide as tall; this map is ${parsed.width} by ${parsed.height} and is stretched to fit.`
    );
  return { texture, width: parsed.width, height: parsed.height, warnings };
}

/**
 * Build the prefiltered environment for a recipe. Generated studios need no bytes; an
 * imported map is decoded in linear radiance, filtered once, and the source texture released.
 */
function disposeScene(scene: THREE.Scene): void {
  scene.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      node.geometry.dispose();
      (node.material as THREE.Material).dispose();
    }
  });
}

export function studioPalette(recipe: StudioSceneV1): StudioPalette {
  return {
    a: recipe.materials.colorA,
    b: recipe.materials.colorB,
    bg: recipe.stage.background,
    bg2: recipe.stage.background2,
  };
}

export async function loadStudioEnvironment(
  recipe: StudioSceneV1,
  read: StudioRead,
  signal: AbortSignal,
  pmrem: THREE.PMREMGenerator
): Promise<StudioEnvironment> {
  const env = recipe.environment;
  if (env.kind === 'room' || env.kind === 'softbox' || env.kind === 'window') {
    const scene = generated(env.kind);
    const target = pmrem.fromScene(scene, env.kind === 'room' ? 0.025 : 0.04);
    disposeScene(scene);
    return { texture: target.texture, warnings: [], dispose: () => target.dispose() };
  }
  if (env.kind !== 'image') {
    // Painted panoramas take the brand's colours, so the map is rebuilt when they change.
    const { scene, backdrop } = BUILDERS[env.kind](studioPalette(recipe));
    const target = pmrem.fromScene(scene, 0.03);
    disposeScene(scene);
    return {
      texture: target.texture,
      backdrop,
      warnings: [],
      dispose: () => {
        target.dispose();
        backdrop.dispose();
      },
    };
  }
  const bytes = await read(env.url, signal);
  signal.throwIfAborted();
  if (!bytes.length || bytes.length > MAX_BYTES)
    throw new Error('Use a radiance map between 1 byte and 64 MB.');
  const decoded = decodeRadiance(bytes, env.id || env.url);
  try {
    signal.throwIfAborted();
    const target = pmrem.fromEquirectangular(decoded.texture);
    return { texture: target.texture, warnings: decoded.warnings, dispose: () => target.dispose() };
  } finally {
    decoded.texture.dispose();
  }
}
