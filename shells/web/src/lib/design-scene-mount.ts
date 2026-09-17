// SPDX-License-Identifier: MPL-2.0
/**
 * Scene boxes in a Design document: a poster for every one, a live renderer for the
 * selected one (plan 265 milestone 3, lane B).
 *
 * The Design tool paints a `kind: '3d'` box as a marker and nothing else, the way it
 * paints video, Lottie and camera boxes:
 *
 *   <div class="lolly-box-img lolly-box-scene" data-lolly-scene="<the scene's query>"
 *        data-scene-state="poster"></div>
 *
 * The tool stays data only, so everything below happens in the shell. This module runs
 * after every paint of the canvas (views/tool/render.ts), reads each marker's query
 * through the 3D Studio manifest, resolves the asset ids in it to refs, and gives the
 * box a picture. Which picture depends on the selection: the one selected scene box gets
 * a real renderer through lib/studio3d/mount.ts, and every other box gets a poster drawn
 * off screen through the pool (lib/studio3d/poster.ts). A browser keeps only about
 * sixteen WebGL contexts alive, so a document with twenty scenes must cost one.
 *
 * What other lanes need from here:
 *   `data-scene-seconds` on the marker      the recipe's own clip length, for the clock.
 *   liveDesignScene()                       the box the playhead may drive, or null.
 *   designSceneFor(el) / designScenes()     the decoded values behind a marker.
 *   renderDesignScenePoster(box, opts)      one frame at a size, time and quality.
 *   prepareDesignScenePoster(box, opts)     the same, put into the marker for an export.
 *
 * Nothing here throws into the canvas view: a scene that cannot be drawn keeps whatever
 * picture it had and says why in its own status line.
 */
import { designSceneDecode } from '@lolly/engine';
import type { AssetRef } from '@lolly-tools/core/host-v1';
import type { InputManifest } from '../../../../engine/src/inputs.ts';
import { buildStudioScene } from '../../../../engine/src/studio3d.ts';
import type { StudioValues } from '../../../../engine/src/studio3d-collection.ts';
import { setSceneManifest, SCENE_TOOL_ID } from '../bridge/asset-dependencies.ts';
import { t } from '../i18n.ts';
import { destroyToolStudio, mountToolStudio, studioShaperFor } from './studio3d/mount.ts';
import {
  createStudioPosters,
  type StudioPoster,
  type StudioPosterQueue,
  type StudioPosterRequest,
} from './studio3d/poster.ts';
import type { StudioSceneQuality } from './studio3d/scene-host.ts';

/** The tool a scene box's query belongs to. Its manifest is what the query is read with. */
export const DESIGN_SCENE_TOOL = SCENE_TOOL_ID;
/** The long side a poster is drawn at, whatever the device pixel ratio asks for. */
export const DESIGN_SCENE_POSTER_MAX = 800;
/** Distinct scene queries kept decoded. Older ones are read again if they come back. */
const DECODE_CACHE = 64;

/** The parts of the host this enhancer uses. A shell passes its whole HostV1. */
export interface DesignSceneHost {
  assets: {
    get(id: string, opts?: { format?: string; version?: string }): Promise<AssetRef>;
    bytes?(target: AssetRef | string): Promise<Uint8Array>;
  };
  text?: Parameters<typeof studioShaperFor>[0]['text'];
}

export interface DesignSceneOptions {
  host: DesignSceneHost;
  /** The 3D Studio manifest, from whichever catalog loader the caller already holds. */
  manifest: () => Promise<InputManifest>;
  /** False once a newer paint has started; this pass then stops where it is. */
  isCurrent?: () => boolean;
}

/** What this module knows about one scene box. */
export interface DesignSceneInfo {
  boxId: string;
  /** The element the studio mount is keyed on: the `.lolly-box` around the marker. */
  container: Element;
  marker: HTMLElement;
  /** Full studio values, with every asset id resolved to a ref. */
  values: StudioValues;
  /** The scene's identity. Two boxes with the same scene share a cached poster. */
  recipeKey: string;
  /** The recipe's own clip length, also stamped on the marker as data-scene-seconds. */
  seconds: number;
  /** True while this box holds the one live renderer. */
  live: boolean;
}

interface SceneEntry {
  boxId: string;
  container: Element;
  marker: HTMLElement;
  query: string;
  values: StudioValues;
  recipeKey: string;
  seconds: number;
  /** The poster on screen now, and whether this module minted its url. */
  poster: { url: string; owned: boolean } | null;
  /** The size the poster on screen was asked for, so a resize can tell there was one. */
  size: { width: number; height: number } | null;
}

interface FrameCanvas extends HTMLCanvasElement {
  __lollyFrameRender?: (t: number, seconds?: number, size?: { width: number; height: number }) => void;
}

const entries = new Map<string, SceneEntry>();
/** One decode per distinct query string: the same scene in four boxes is read once. */
const decoded = new Map<string, Promise<{ values: StudioValues; recipeKey: string; seconds: number }>>();
/** The box holding the live renderer, or null. Never more than one per document. */
let live: string | null = null;
/** Box ids the canvas reports as selected, filtered to the ones that are scene boxes. */
let selected: string[] = [];
/** The last options a pass ran with, so a selection change can mount without them. */
let options: DesignSceneOptions | null = null;
let posters: StudioPosterQueue | null = null;
let settled: Promise<void> = Promise.resolve();
let observer: ResizeObserver | null = null;
let manifestOnce: Promise<InputManifest> | null = null;

/** Every poster and the live renderer this module currently holds. Awaited by an export. */
export function designScenesSettled(): Promise<void> {
  return settled;
}

// ── decoding ────────────────────────────────────────────────────────────────

/**
 * Every input whose value is an asset id, and the block fields that hold one.
 *
 * The engine's `designSceneAssetIds` answers WHICH ids a scene names, which is what the
 * pack and cache walkers want. This answers where they sit, because each one has to be
 * replaced in place by the ref the studio loads bytes from. Both read the manifest rather
 * than a list of input names, so a studio that gains an asset input needs no edit here.
 */
function assetInputs(manifest: InputManifest): { top: string[]; blocks: Map<string, string[]> } {
  const top: string[] = [];
  const blocks = new Map<string, string[]>();
  for (const input of manifest.inputs ?? []) {
    if (input.type === 'asset') top.push(input.id);
    if (input.type === 'blocks') {
      const fields = (input.fields ?? []).filter((f) => f.type === 'asset').map((f) => f.id);
      if (fields.length) blocks.set(input.id, fields);
    }
  }
  return { top, blocks };
}

/**
 * An asset value becomes the ref shape the studio reads, as the 3D Studio hook resolves
 * it. A decoded scene carries an unresolved stub (`{ source, id }`) or a bare id; a ref
 * that already has a url is handed back as it is.
 */
async function resolveAsset(host: DesignSceneHost, value: unknown): Promise<unknown> {
  const record =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as { id?: unknown; url?: unknown })
      : null;
  if (record && typeof record.url === 'string' && record.url) return value;
  const id = typeof value === 'string' ? value : typeof record?.id === 'string' ? record.id : '';
  if (!id) return value;
  let ref: AssetRef;
  try {
    ref = await host.assets.get(id);
  } catch {
    // A missing id stays as it was: the studio names the file it cannot find.
    return value;
  }
  const name = (ref.meta as { name?: string } | undefined)?.name;
  return { id: ref.id || '', url: ref.url || '', name: name || ref.id || '' };
}

/**
 * The query a marker carries, expanded through the engine's own grammar helper, so what
 * comes back is the whole scene rather than the edits to it, and the ids in it resolved to
 * refs with bytes behind them. An empty query is a scene of studio defaults.
 */
async function decodeScene(
  query: string,
  manifest: InputManifest,
  host: DesignSceneHost
): Promise<{ values: StudioValues; recipeKey: string; seconds: number }> {
  const values: StudioValues = designSceneDecode(query, manifest);
  const { top, blocks } = assetInputs(manifest);
  for (const id of top) values[id] = await resolveAsset(host, values[id]);
  for (const [id, fields] of blocks) {
    const rows = values[id];
    if (!Array.isArray(rows)) continue;
    values[id] = await Promise.all(
      rows.map(async (row: unknown) => {
        const next = { ...(row as Record<string, unknown>) };
        for (const field of fields) next[field] = await resolveAsset(host, next[field]);
        return next;
      })
    );
  }
  const recipeKey = JSON.stringify(values);
  // A recipe that does not build has no clip length; the poster render reports why.
  let seconds = 0;
  try {
    seconds = buildStudioScene({ version: 1, values }).motion.seconds;
  } catch {
    seconds = 0;
  }
  return { values, recipeKey, seconds };
}

// ── the marker's own furniture ──────────────────────────────────────────────

const POSTER_STYLE =
  'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:block;';
const WAIT_STYLE = 'position:absolute;inset:0;background:rgba(127,127,127,.12);border-radius:inherit;';
const STATUS_STYLE =
  'position:absolute;left:0;right:0;bottom:0;margin:0;padding:4px 6px;font-size:11px;line-height:1.35;text-align:center;background:rgba(0,0,0,.55);color:#fff;';

function part<K extends keyof HTMLElementTagNameMap>(
  marker: HTMLElement,
  tag: K,
  selector: string,
  build: (el: HTMLElementTagNameMap[K]) => void
): HTMLElementTagNameMap[K] {
  const found = marker.querySelector<HTMLElementTagNameMap[K]>(selector);
  if (found) return found;
  const made = document.createElement(tag);
  build(made);
  marker.appendChild(made);
  return made;
}

function posterImage(marker: HTMLElement): HTMLImageElement {
  return part(marker, 'img', 'img.lolly-scene-poster', (img) => {
    img.className = 'lolly-scene-poster';
    img.alt = '';
    img.draggable = false;
    img.setAttribute('style', POSTER_STYLE);
    img.hidden = true;
  });
}

/** The calm fill a box shows until its first poster arrives. Never part of an export. */
function waitPanel(marker: HTMLElement): HTMLElement {
  return part(marker, 'div', 'div.lolly-scene-wait', (el) => {
    el.className = 'lolly-scene-wait';
    el.setAttribute('style', WAIT_STYLE);
    el.setAttribute('aria-hidden', 'true');
    el.setAttribute('data-export-hide', '');
  });
}

/**
 * The one status line. The studio mount writes into this element too (it looks for
 * `[data-studio-status]` inside its marker), so a live scene's own message and a poster
 * failure share one place and cannot stack up.
 */
function statusLine(marker: HTMLElement): HTMLElement {
  return part(marker, 'p', 'p.lolly-scene-status', (el) => {
    el.className = 'lolly-scene-status';
    el.setAttribute('style', STATUS_STYLE);
    el.setAttribute('data-studio-status', '');
    el.setAttribute('data-export-hide', '');
    el.setAttribute('role', 'status');
    el.hidden = true;
  });
}

/**
 * Build the marker's three parts once, in paint order: the poster, the calm fill over it
 * while there is none, and the status line on top. The studio mount writes into that last
 * one by selector, so it has to be there before a renderer is asked for, not after.
 */
function furnish(marker: HTMLElement): void {
  posterImage(marker);
  waitPanel(marker);
  statusLine(marker);
}

function say(marker: HTMLElement, message: string): void {
  const line = statusLine(marker);
  line.textContent = message;
  line.hidden = !message;
}

function showPoster(entry: SceneEntry, url: string, owned: boolean): void {
  const img = posterImage(entry.marker);
  const previous = entry.poster;
  entry.poster = { url, owned };
  img.src = url;
  img.hidden = false;
  waitPanel(entry.marker).hidden = true;
  if (previous?.owned && previous.url !== url) {
    try {
      URL.revokeObjectURL(previous.url);
    } catch {
      /* already gone */
    }
  }
}

// ── posters ─────────────────────────────────────────────────────────────────

/**
 * The pixel size a poster is drawn at: the box's own layout size times the device pixel
 * ratio, capped on the long side. Layout size, not the rect on screen, so panning and
 * zooming the artboard never redraws a thing.
 */
function posterSize(marker: HTMLElement): { width: number; height: number } | null {
  let width = marker.clientWidth;
  let height = marker.clientHeight;
  if (width < 1 || height < 1) {
    const box = marker.getBoundingClientRect();
    width = box.width;
    height = box.height;
  }
  if (width < 1 || height < 1) return null;
  const ratio = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  width *= ratio;
  height *= ratio;
  const factor = Math.min(1, DESIGN_SCENE_POSTER_MAX / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * factor)),
    height: Math.max(1, Math.round(height * factor)),
  };
}

function requestFor(
  entry: SceneEntry,
  size: { width: number; height: number },
  time = 0,
  quality: StudioSceneQuality = 'export'
): StudioPosterRequest {
  return {
    key: entry.boxId,
    recipeKey: entry.recipeKey,
    values: entry.values,
    width: size.width,
    height: size.height,
    time,
    quality,
  };
}

function posterFailed(entry: SceneEntry, error: unknown): void {
  console.warn('[design] a scene poster could not be drawn:', error);
  say(entry.marker, t('This scene could not be drawn.'));
}

/** Ask for this box's poster at its current size. A cached one is put in without a render. */
function requestPoster(entry: SceneEntry): void {
  if (!posters || live === entry.boxId) return;
  const size = posterSize(entry.marker);
  // Not laid out yet: the resize observer calls back with the first real size.
  if (!size) return;
  entry.size = size;
  const request = requestFor(entry, size);
  const hit = posters.cached(request);
  if (hit) {
    showPoster(entry, URL.createObjectURL(hit.blob), true);
    return;
  }
  if (!entry.poster) {
    waitPanel(entry.marker).hidden = false;
    posterImage(entry.marker).hidden = true;
  }
  posters.schedule(
    request,
    (poster: StudioPoster) => {
      const current = entries.get(entry.boxId);
      if (current !== entry || !entry.marker.isConnected || live === entry.boxId) return;
      say(entry.marker, '');
      // A url of this box's own, so the queue evicting its copy cannot blank the picture.
      showPoster(entry, URL.createObjectURL(poster.blob), true);
    },
    (error) => {
      if (entries.get(entry.boxId) === entry) posterFailed(entry, error);
    }
  );
}

// ── the one live renderer ───────────────────────────────────────────────────

async function mountLive(entry: SceneEntry): Promise<void> {
  const opts = options;
  if (!opts) return;
  live = entry.boxId;
  posters?.cancel(entry.boxId);
  const marker = entry.marker;
  furnish(marker);
  marker.dataset.lollyStudio = JSON.stringify({ version: 1, values: entry.values });
  marker.dataset.sceneState = 'live';
  waitPanel(marker).hidden = Boolean(entry.poster);
  const read = readerFor(opts.host);
  try {
    await mountToolStudio(entry.container, {
      read,
      shapeText: studioShaperFor(opts.host),
      // Read only in this milestone: with no setInput the mount hides its camera actions,
      // takes no gesture and runs no motion loop. The playhead drives it instead.
      setInput: undefined,
      isCurrent: () => live === entry.boxId && marker.isConnected,
    });
    if (live !== entry.boxId || !marker.isConnected) return;
    const canvas = marker.querySelector<HTMLCanvasElement>('canvas');
    // The canvas sits inside a box the user drags and selects, so the pointer goes to the
    // box, not to a renderer that takes no gestures anyway.
    if (canvas) canvas.style.pointerEvents = 'none';
    if (marker.dataset.studioState === 'ready') {
      posterImage(marker).hidden = true;
      waitPanel(marker).hidden = true;
    }
  } catch (error) {
    console.warn('[design] a scene renderer could not start:', error);
    if (live !== entry.boxId || !marker.isConnected) return;
    // The poster stays where it is. The mount has written its own reason into the status
    // line for most failures, but a renderer that cannot open a context at all writes the
    // text without showing it, so this raises the line whatever happened.
    posterImage(marker).hidden = !entry.poster;
    waitPanel(marker).hidden = Boolean(entry.poster);
    const line = statusLine(marker);
    if (!line.textContent) line.textContent = t('This scene could not be drawn.');
    line.hidden = false;
  }
}

/** Take the last frame off the live canvas, close the renderer and put the poster back. */
function unmountLive(): void {
  const boxId = live;
  live = null;
  if (!boxId) return;
  const entry = entries.get(boxId);
  if (!entry) return;
  const canvas = entry.marker.querySelector<FrameCanvas>('canvas');
  let snapshot: string | null = null;
  if (canvas) {
    try {
      canvas.__lollyFrameRender?.(0);
      snapshot = canvas.toDataURL('image/png');
    } catch {
      snapshot = null;
    }
  }
  destroyToolStudio(entry.container);
  delete entry.marker.dataset.lollyStudio;
  delete entry.marker.dataset.studioState;
  entry.marker.dataset.sceneState = 'poster';
  if (snapshot) {
    // The frame that was on screen a moment ago is the honest poster: the box does not
    // flash while a fresh render of the same thing is queued behind it.
    posters?.cancel(entry.boxId);
    showPoster(entry, snapshot, false);
  } else if (entry.poster) showPoster(entry, entry.poster.url, entry.poster.owned);
  else requestPoster(entry);
}

function applySelection(): void {
  const next = selected.length === 1 ? (selected[0] ?? null) : null;
  if (live && live !== next) unmountLive();
  if (!next || live === next) return;
  const entry = entries.get(next);
  if (entry) settled = settled.then(() => mountLive(entry)).catch(() => {});
}

/**
 * Which boxes the canvas has selected. The Design view calls this from its selection port;
 * exactly one scene box in the selection makes that box live, anything else makes none.
 */
export function setSelectedScenes(ids: readonly string[]): void {
  selected = ids.filter((id) => entries.has(id));
  applySelection();
}

// ── the pass ────────────────────────────────────────────────────────────────

function readerFor(host: DesignSceneHost) {
  return async (url: string, signal: AbortSignal): Promise<Uint8Array> => {
    signal.throwIfAborted();
    if (!host.assets.bytes) throw new Error('Asset bytes are unavailable in this app.');
    const bytes = await host.assets.bytes(url);
    signal.throwIfAborted();
    return bytes;
  };
}

function watch(marker: HTMLElement): void {
  if (typeof ResizeObserver === 'undefined') return;
  observer ??= new ResizeObserver((changed) => {
    for (const change of changed) {
      const entry = [...entries.values()].find((item) => item.marker === change.target);
      if (!entry || live === entry.boxId) continue;
      const size = posterSize(entry.marker);
      if (!size) continue;
      if (entry.size && size.width === entry.size.width && size.height === entry.size.height)
        continue;
      requestPoster(entry);
    }
  });
  observer.observe(marker);
}

function retire(entry: SceneEntry): void {
  observer?.unobserve(entry.marker);
  posters?.cancel(entry.boxId);
  destroyToolStudio(entry.container);
  if (entry.poster?.owned)
    try {
      URL.revokeObjectURL(entry.poster.url);
    } catch {
      /* already gone */
    }
  if (live === entry.boxId) live = null;
}

/**
 * Give every scene box in this canvas its picture. Called after each paint, and on a paint
 * with no markers at all, so a box that was removed hands its renderer back.
 */
export function mountDesignScenes(container: Element, opts: DesignSceneOptions): Promise<void> {
  const pass = runScenePass(container, opts);
  settled = Promise.allSettled([settled, pass]).then(() => {});
  return pass;
}

async function runScenePass(
  container: Element,
  opts: DesignSceneOptions
): Promise<void> {
  const current = () => opts.isCurrent?.() !== false;
  options = opts;
  for (const [id, entry] of [...entries])
    if (!entry.marker.isConnected) {
      retire(entry);
      entries.delete(id);
    }
  const markers = [...container.querySelectorAll<HTMLElement>('[data-lolly-scene]')];
  if (!markers.length) return;
  posters ??= createStudioPosters(readerFor(opts.host), studioShaperFor(opts.host));
  // The two asset walkers (bridge/asset-dependencies.ts) read a scene's uploads out of
  // the same query, synchronously, from six call sites that have no manifest to hand. The
  // first canvas to load one registers it for them, so a `.lolly` pack and the retained
  // cache carry a scene's files rather than missing them.
  manifestOnce ??= opts.manifest().then((manifest) => {
    setSceneManifest(manifest);
    return manifest;
  });
  let manifest: InputManifest;
  try {
    manifest = await manifestOnce;
  } catch (error) {
    manifestOnce = null;
    for (const marker of markers) say(marker, t('This scene could not be drawn.'));
    console.warn('[design] the 3D Studio manifest could not be loaded:', error);
    return;
  }
  if (!current()) return;
  const seen = new Set<string>();
  for (const [index, marker] of markers.entries()) {
    const box = marker.closest<HTMLElement>('.lolly-box') ?? marker.parentElement ?? marker;
    const boxId = box.getAttribute('data-box-id') || `scene-${index}`;
    const query = marker.dataset.lollyScene ?? '';
    seen.add(boxId);
    let scene: { values: StudioValues; recipeKey: string; seconds: number };
    try {
      const pending = decoded.get(query) ?? decodeScene(query, manifest, opts.host);
      decoded.set(query, pending);
      // A long edit session mints a query per change; only the live ones are worth holding.
      while (decoded.size > DECODE_CACHE) decoded.delete(decoded.keys().next().value as string);
      scene = await pending;
    } catch (error) {
      decoded.delete(query);
      say(marker, t('This scene could not be drawn.'));
      console.warn('[design] a scene could not be read:', error);
      continue;
    }
    if (!current() || !marker.isConnected) return;
    // The clock (lane C) reads the clip length off the marker rather than decoding again.
    marker.dataset.sceneSeconds = String(scene.seconds);
    furnish(marker);
    const previous = entries.get(boxId);
    if (previous && previous.marker !== marker) observer?.unobserve(previous.marker);
    const entry: SceneEntry = {
      boxId,
      container: box,
      marker,
      query,
      values: scene.values,
      recipeKey: scene.recipeKey,
      seconds: scene.seconds,
      // A repaint makes new elements; the picture the old ones held is still the right one.
      poster: previous?.recipeKey === scene.recipeKey ? (previous.poster ?? null) : null,
      size: previous?.recipeKey === scene.recipeKey ? (previous.size ?? null) : null,
    };
    entries.set(boxId, entry);
    watch(marker);
    if (entry.poster) showPoster(entry, entry.poster.url, entry.poster.owned);
    marker.dataset.sceneState = live === boxId ? 'live' : 'poster';
    if (live === boxId) await mountLive(entry);
    else requestPoster(entry);
    if (!current()) return;
  }
  for (const [id, entry] of [...entries])
    if (!seen.has(id) && !entry.marker.isConnected) {
      retire(entry);
      entries.delete(id);
    }
  applySelection();
}

// ── what the other lanes read ───────────────────────────────────────────────

function infoOf(entry: SceneEntry): DesignSceneInfo {
  return {
    boxId: entry.boxId,
    container: entry.container,
    marker: entry.marker,
    values: entry.values,
    recipeKey: entry.recipeKey,
    seconds: entry.seconds,
    live: live === entry.boxId,
  };
}

/** Every scene box this canvas holds, in the order the markers were found. */
export function designScenes(): DesignSceneInfo[] {
  return [...entries.values()].map(infoOf);
}

/** The scene box an element belongs to, or null. Takes a marker, a box or a child of one. */
export function designSceneFor(el: Element): DesignSceneInfo | null {
  for (const entry of entries.values())
    if (entry.marker === el || entry.marker.contains(el) || entry.container === el)
      return infoOf(entry);
  return null;
}

/** The box holding the live renderer, or null. Only this one answers the playhead. */
export function liveDesignScene(): DesignSceneInfo | null {
  const entry = live ? entries.get(live) : null;
  return entry ? infoOf(entry) : null;
}

function entryOf(box: string | Element): SceneEntry | null {
  if (typeof box === 'string') return entries.get(box) ?? null;
  for (const entry of entries.values())
    if (entry.marker === box || entry.marker.contains(box) || entry.container === box) return entry;
  return null;
}

/**
 * One frame of a scene box at a size, a moment and a standard, through the pool. `time` is
 * the normalised position in the recipe's own clip length, so a caller divides by the
 * marker's `data-scene-seconds`. What an export asks for, per box, per frame.
 */
export async function renderDesignScenePoster(
  box: string | Element,
  opts: { width: number; height: number; time?: number; quality?: StudioSceneQuality }
): Promise<StudioPoster> {
  const entry = entryOf(box);
  if (!entry || !posters) throw new Error('This box has no scene to draw.');
  return posters.request(
    requestFor(
      entry,
      { width: opts.width, height: opts.height },
      opts.time ?? 0,
      opts.quality ?? 'export'
    )
  );
}

/**
 * The same frame, put into the marker as the picture an export walker reads. The live
 * renderer's canvas is left where it is: a still export never depends on a live scene
 * being in the right state at capture time.
 */
export async function prepareDesignScenePoster(
  box: string | Element,
  opts: { width: number; height: number; time?: number; quality?: StudioSceneQuality }
): Promise<void> {
  const entry = entryOf(box);
  if (!entry) throw new Error('This box has no scene to draw.');
  const poster = await renderDesignScenePoster(box, opts);
  showPoster(entry, URL.createObjectURL(poster.blob), true);
}

/** Hand back every renderer and forget every box. One container, or the whole document. */
export function destroyDesignScenes(container?: Element): void {
  for (const [id, entry] of [...entries]) {
    if (container && !container.contains(entry.marker)) continue;
    retire(entry);
    entries.delete(id);
  }
  if (!container || !entries.size) {
    observer?.disconnect();
    observer = null;
    posters?.dispose();
    posters = null;
    decoded.clear();
    selected = [];
    options = null;
  }
}
