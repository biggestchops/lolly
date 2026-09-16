// SPDX-License-Identifier: MPL-2.0
/** Saved presentation choices. Devices, permissions and live cues never enter this record. */
export type Layout = 'content' | 'inset' | 'side' | 'camera' | 'holding';
export interface Placement { x: number; y: number; w: number; h: number }
export interface LogoAsset { id: string; source: 'user' | 'library' | 'remote'; format: string; version?: string; pin?: { version: string; format: string } }
export interface SceneSettings {
  version: 1;
  layout: Layout;
  camera: { id: 'camera'; box: Placement; fit: 'cover' | 'contain'; zoom: number; focalX: number; focalY: number; mirror: boolean; radius: number; border: number };
  logo: { id: 'logo'; asset: LogoAsset | null; anchor: 'left' | 'right'; width: number };
  lower: { id: 'lower'; title: string; subtitle: string };
}
export interface PreparedScene { id: string; name: string; scene: SceneSettings }
export interface PresentationScene extends SceneSettings { prepared: PreparedScene[] }
export const MAX_PREPARED_SCENES = 8;
export const OUTPUT = { w: 1280, h: 720, fps: 30 } as const;
const num = (v: unknown, fallback: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, typeof v === 'number' && Number.isFinite(v) ? v : fallback));
const row = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const text = (v: unknown, max: number): string => typeof v === 'string' ? v.slice(0, max) : '';

/** Whitelist fields at every boundary, including reopen and Apply. No opaque runtime handles. */
export function readSceneSettings(value?: unknown): SceneSettings {
  const raw = row(value), v = raw.version === 1 ? raw : {};
  const c = row(v.camera), b = row(c.box), l = row(v.logo), a = row(l.asset), p = row(a.pin), lower = row(v.lower);
  const version = text(p.version, 200) || text(a.version, 200);
  const format = text(p.format, 30) || text(a.format, 30) || 'png';
  const w = num(b.w, 320, 96, OUTPUT.w), h = num(b.h, 240, 72, OUTPUT.h);
  return {
    version: 1,
    layout: ['content', 'inset', 'side', 'camera', 'holding'].includes(String(v.layout)) ? v.layout as Layout : 'inset',
    camera: { id: 'camera', box: { x: num(b.x, 920, 0, OUTPUT.w - w), y: num(b.y, 440, 0, OUTPUT.h - h), w, h },
      fit: c.fit === 'contain' ? 'contain' : 'cover',
      zoom: num(c.zoom, 1, 1, 4), focalX: num(c.focalX, 0.5, 0, 1), focalY: num(c.focalY, 0.5, 0, 1), mirror: c.mirror === true,
      radius: num(c.radius, 16, 0, 120), border: num(c.border, 0, 0, 12) },
    logo: { id: 'logo', asset: typeof a.id === 'string' && a.id.length > 0 && a.id.length < 2048
      ? { id: a.id, source: a.source === 'library' || a.source === 'remote' ? a.source : 'user',
        format,
        // Share files and private pairing use explicit pins to carry exact bytes
        // and rebase them to the receiver's stored version after import.
        ...(version ? { version, pin: { version, format } } : {}) } : null,
      anchor: l.anchor === 'left' ? 'left' : 'right', width: num(l.width, 160, 48, 400) },
    lower: { id: 'lower', title: text(lower.title, 90), subtitle: text(lower.subtitle, 140) },
  };
}

export function readScene(value?: unknown): PresentationScene {
  const v = row(value), seen = new Set<string>();
  const prepared: PreparedScene[] = [];
  for (const entry of (v.version === 1 && Array.isArray(v.prepared) ? v.prepared.slice(0, MAX_PREPARED_SCENES) : [])) {
    const item = row(entry), id = text(item.id, 80), name = text(item.name, 40).trim();
    if (!id || !name || seen.has(id)) continue;
    seen.add(id); prepared.push({ id, name, scene: readSceneSettings(item.scene) });
  }
  return { ...readSceneSettings(value), prepared };
}

export function layoutBoxes(scene: SceneSettings): { content: Placement; camera: Placement } {
  return {
    content: { x: 0, y: 0, w: scene.layout === 'side' ? 880 : OUTPUT.w, h: OUTPUT.h },
    camera: scene.layout === 'camera' ? { x: 0, y: 0, ...OUTPUT } : scene.layout === 'side'
      ? { x: 900, y: 120, w: 360, h: 480 } : scene.camera.box,
  };
}

/** Cover crop in source pixels, independent of the destination's position. */
export function cameraCrop(sw: number, sh: number, box: Placement, camera: PresentationScene['camera']): Placement {
  const choose = camera.fit === 'contain' ? Math.min : Math.max;
  const scale = choose(box.w / Math.max(1, sw), box.h / Math.max(1, sh)) * camera.zoom;
  const w = box.w / scale, h = box.h / scale;
  return { x: (sw - w) * camera.focalX, y: (sh - h) * camera.focalY, w, h };
}
