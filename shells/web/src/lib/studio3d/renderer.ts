// SPDX-License-Identifier: MPL-2.0
import * as THREE from 'three';
import {
  type StudioObjectBox,
  studioOverlaps,
  studioSceneObjects,
} from '../../../../../engine/src/studio3d-arrangement.ts';
import { STUDIO_LIGHT_TARGET, studioPlaceableLights } from '../../../../../engine/src/studio3d-lights.ts';
import { studioCameraPose } from '../../../../../engine/src/studio3d-camera-path.ts';
import { studioAnimated, studioLightMotion } from '../../../../../engine/src/studio3d.ts';
import type {
  StudioObjectV1,
  StudioSceneV1,
  StudioSourceInfo,
} from '../../../../../packages/core/src/studio3d-v1.ts';
import { halton, StudioCapture, StudioEmptyFrameError } from './capture.ts';
import { fitStudioObject, pickStudioFocus, placeStudioScene } from './camera.ts';
import { loadStudioEnvironment, type StudioEnvironment, studioPalette } from './environment.ts';
import { applyStudioMaterials, studioHasTransmission } from './materials.ts';
import {
  instantiateStudioAsset,
  loadStudioSource,
  type StudioAsset,
  type StudioRead,
  type StudioShaper,
} from './source.ts';
import type { StudioSceneCounters, StudioSceneHost } from './scene-host.ts';
import { buildStudioStage, type StudioStage, studioBackdrop, studioCamera } from './stage.ts';

const MAX_SCENE_TRIANGLES = 1_000_000;

/** One placed subject: a light copy of a shared asset plus its own material assignments. */
interface Instance {
  spec: StudioObjectV1;
  /** Index of this object's row; rows waiting for a file have no instance. */
  row: number;
  key: string;
  asset: StudioAsset;
  object: THREE.Group;
  restore: () => void;
}

/** The scene values one object is evaluated with: its own source and slot bindings. */
function objectScene(recipe: StudioSceneV1, spec: StudioObjectV1): StudioSceneV1 {
  return {
    ...recipe,
    source: spec.source,
    transform: spec.transform,
    materials: { ...recipe.materials, bindings: spec.bindings },
  };
}

/**
 * What one loaded source depends on. Only outlines (artwork, words and the badge) are
 * extruded with the shared depth and bevel, so a shape edit never re-reads a model file.
 * Primitives bake both colours at load. Words and STL bake colour A too, but materials.ts
 * recolours them, so a colour edit does not reshape words or re-read an STL file.
 */
function assetKey(recipe: StudioSceneV1, spec: StudioObjectV1): string {
  const { kind, primitive } = spec.source;
  const extruded = kind === 'svg' || kind === 'text' || (kind === 'primitive' && primitive === 'badge');
  return JSON.stringify([
    spec.source,
    extruded ? recipe.shape : null,
    kind === 'primitive' ? [recipe.materials.colorA, recipe.materials.colorB] : null,
  ]);
}

/** The recipe a frame at `time` is drawn with: on a camera path the camera is the sampled pose. */
function framedRecipe(posed: StudioSceneV1, time: number, clipSeconds?: number): StudioSceneV1 {
  const pose = studioCameraPose(posed, time, clipSeconds);
  return {
    ...posed,
    camera: {
      ...posed.camera,
      azimuth: pose.azimuth,
      elevation: pose.elevation,
      fov: pose.fov,
      zoom: pose.zoom,
      target: pose.target,
      focus: pose.focus,
    },
  };
}

/**
 * The pixel rectangle a box covers in a frame, with y counted from the bottom, or null when
 * part of the box is behind the camera, where a projection says nothing useful.
 */
function projectedBox(box: THREE.Box3, camera: THREE.PerspectiveCamera | THREE.OrthographicCamera, width: number, height: number): THREE.Box2 | null {
  const rect = new THREE.Box2();
  const corner = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
    if (corner.clone().applyMatrix4(camera.matrixWorldInverse).z > -camera.near) return null;
    corner.project(camera);
    rect.expandByPoint(new THREE.Vector2(((corner.x + 1) / 2) * width, ((corner.y + 1) / 2) * height));
  }
  return rect;
}

/** True when a ray hit a mesh that is drawn: visible up to its object, with a material that shows. */
function drawnHit(hit: THREE.Intersection, object: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = hit.object; node; node = node.parent) {
    if (!node.visible) return false;
    if (node === object) break;
  }
  if (!(hit.object instanceof THREE.Mesh)) return false;
  const assigned: THREE.Material | THREE.Material[] = hit.object.material;
  const material = Array.isArray(assigned) ? assigned[hit.face?.materialIndex ?? 0] : assigned;
  return !!material && material.visible && !(material.transparent && material.opacity <= 0);
}

/**
 * three's shadow pass draws most casters with one shared depth material and copies each
 * caster's colour map onto it without recompiling it. Once a textured model has cast a
 * shadow, that material keeps a map input, and an untextured caster drawn after the model
 * was replaced uploads the disposed map again: one orphaned texture on every model swap.
 * This caster is drawn first in every pass. It has no area, so it adds nothing to a shadow
 * or a frame, and its own 1 pixel map replaces the stale one. Depth and distance output do
 * not read the map unless alpha testing is on, and it is off here.
 */
function depthMapReset(): { mesh: THREE.Mesh; dispose(): void } {
  const blank = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  blank.needsUpdate = true;
  const empty = new THREE.BufferGeometry();
  empty.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(9), 3));
  const material = new THREE.MeshBasicMaterial({ map: blank });
  const mesh = new THREE.Mesh(empty, material);
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  return {
    mesh,
    dispose: () => {
      blank.dispose();
      material.dispose();
      empty.dispose();
    },
  };
}

/** Relative points inside a rectangle a coverage probe tries, centre first. */
const PROBE_POINTS: [number, number][] = [
  [0, 0],
  [-0.25, -0.25],
  [0.25, -0.25],
  [-0.25, 0.25],
  [0.25, 0.25],
];

export class StudioRenderer implements StudioSceneHost<HTMLCanvasElement, THREE.Camera, THREE.Vector3> {
  readonly canvas: HTMLCanvasElement;
  private readonly output: StudioCapture;
  private readonly scene = new THREE.Scene();
  private readonly pmrem: THREE.PMREMGenerator;
  private environment: StudioEnvironment | null = null;
  private environmentKey = '';
  /** Loaded sources shared by every object that names the same bytes and shape. */
  private readonly assets = new Map<string, StudioAsset>();
  private readonly root = new THREE.Group();
  private readonly depthReset = depthMapReset();
  private instances: Instance[] = [];
  private backdrop: THREE.Texture | null = null;
  private backdropKey = '';
  private stage: StudioStage | null = null;
  private stageKey = '';
  private frameKey = '';
  private recipe: StudioSceneV1 | null = null;
  private highlighted: number | null = null;
  /** Preview-only light handles: null hides them, otherwise the selected light index. */
  private lightHandles: { selected: number | null } | null = null;
  private disposed = false;
  private controller = new AbortController();
  private revision = 0;
  /** Set while a capture holds the frame; updates wait on it before swapping anything in. */
  private hold: { released: Promise<void>; release: () => void } | null = null;
  private readonly counts = {
    updates: 0,
    sourceLoads: 0,
    materialSets: 0,
    stageBuilds: 0,
    backdropBuilds: 0,
    environmentBuilds: 0,
    frames: 0,
    captures: 0,
  };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.output = new StudioCapture(canvas);
    this.pmrem = new THREE.PMREMGenerator(this.output.renderer);
  }

  /** Hold or release the current frame for a capture (see StudioSceneHost.freeze). */
  freeze(on: boolean): void {
    if (on && !this.hold) {
      let release = () => {};
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      this.hold = { released, release };
    } else if (!on && this.hold) {
      const { release } = this.hold;
      this.hold = null;
      release();
    }
  }

  inspect(): StudioSceneCounters {
    const { geometries, textures } = this.output.renderer.info.memory;
    return { ...this.counts, memory: { geometries, textures } };
  }

  async update(
    recipe: StudioSceneV1,
    read: StudioRead,
    shaper?: StudioShaper
  ): Promise<StudioSourceInfo> {
    if (this.disposed) throw new Error('The studio has been closed.');
    this.counts.updates++;
    this.controller.abort();
    this.controller = new AbortController();
    const signal = this.controller.signal,
      revision = ++this.revision;
    const everySpec = studioSceneObjects(recipe);
    // A row still waiting for its file is listed, named in the notes, and never loaded.
    const rows = everySpec.flatMap((spec, row) => (spec.pending ? [] : [row]));
    const specs = rows.map((row) => everySpec[row]!);
    const keys = specs.map((spec) => assetKey(recipe, spec));
    const backdropKey = JSON.stringify([
      recipe.stage.backdrop,
      recipe.stage.backdropUrl,
      recipe.stage.background,
      recipe.stage.background2,
      recipe.stage.backdropStrength,
    ]);
    const painted = !['room', 'softbox', 'window', 'image'].includes(recipe.environment.kind);
    const environmentKey = JSON.stringify([
      recipe.environment.kind,
      recipe.environment.url,
      recipe.environment.id,
      painted ? studioPalette(recipe) : null,
    ]);
    const loaded = new Map<string, StudioAsset>();
    const pending: { backdrop: THREE.Texture | null; environment: StudioEnvironment | null } = {
      backdrop: null,
      environment: null,
    };
    if (backdropKey !== this.backdropKey) this.counts.backdropBuilds++;
    if (environmentKey !== this.environmentKey) this.counts.environmentBuilds++;
    try {
      const missing = [...new Set(keys)].filter((key) => !this.assets.has(key));
      // Every load settles before anything is kept or thrown, so a failed object cannot
      // leave a sibling's bytes loading into a map nobody disposes.
      const settled = await Promise.allSettled([
        ...missing.map(async (key) => {
          const spec = specs[keys.indexOf(key)]!;
          this.counts.sourceLoads++;
          try {
            loaded.set(key, await loadStudioSource(objectScene(recipe, spec), read, signal, shaper));
          } catch (error) {
            if (recipe.objects && error instanceof Error && !signal.aborted)
              throw new Error(`${spec.name}: ${error.message}`);
            throw error;
          }
        }),
        backdropKey !== this.backdropKey
          ? studioBackdrop(recipe, read, signal).then((texture) => {
              pending.backdrop = texture;
            })
          : Promise.resolve(),
        environmentKey !== this.environmentKey
          ? loadStudioEnvironment(recipe, read, signal, this.pmrem).then((environment) => {
              pending.environment = environment;
            })
          : Promise.resolve(),
      ]);
      signal.throwIfAborted();
      if (revision !== this.revision || this.disposed)
        throw new DOMException('Studio update cancelled', 'AbortError');
      const failed = settled.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected'
      );
      if (failed) throw failed.reason;
      // A capture keeps the frame it started with: the new sources wait here until it ends.
      while (this.hold) {
        await this.hold.released;
        signal.throwIfAborted();
        if (revision !== this.revision || this.disposed)
          throw new DOMException('Studio update cancelled', 'AbortError');
      }
      for (const [key, asset] of loaded) this.assets.set(key, asset);
      loaded.clear();
      if (pending.backdrop) {
        this.backdrop?.dispose();
        this.backdrop = pending.backdrop;
        pending.backdrop = null;
        this.backdropKey = backdropKey;
      }
      if (pending.environment) {
        this.environment?.dispose();
        this.environment = pending.environment;
        pending.environment = null;
        this.environmentKey = environmentKey;
      }
      for (const instance of this.instances) {
        instance.restore();
        instance.asset.dispose();
      }
      this.instances = [];
      this.root.clear();
      for (const key of [...this.assets.keys()]) if (!keys.includes(key)) {
        this.assets.get(key)!.dispose();
        this.assets.delete(key);
      }
      let triangles = 0;
      const warnings: string[] = [];
      const instances: Instance[] = [];
      try {
        for (const [i, spec] of specs.entries()) {
          const shared = this.assets.get(keys[i]!);
          if (!shared) throw new Error('The studio source did not load.');
          const asset = instantiateStudioAsset(shared);
          let restore = () => {};
          try {
            this.counts.materialSets++;
            restore = applyStudioMaterials(asset, objectScene(recipe, spec));
          } catch (error) {
            asset.dispose();
            throw recipe.objects && error instanceof Error
              ? new Error(`${spec.name}: ${error.message}`)
              : error;
          }
          instances.push({ spec, row: rows[i]!, key: keys[i]!, asset, object: asset.object, restore });
          if (spec.visible) triangles += shared.info.triangles;
          for (const warning of shared.info.warnings) {
            const message = recipe.objects ? `${spec.name}: ${warning}` : warning;
            if (!warnings.includes(message)) warnings.push(message);
          }
        }
        if (triangles > MAX_SCENE_TRIANGLES)
          throw new Error(
            `This arrangement has ${Math.round(triangles).toLocaleString()} triangles. Keep the visible total below one million.`
          );
      } catch (error) {
        for (const instance of instances) {
          instance.restore();
          instance.asset.dispose();
        }
        throw error;
      }
      this.instances = instances;
      for (const instance of instances) this.root.add(instance.object);
      this.recipe = recipe;
      this.frameKey = '';
      const boxes = placeStudioScene(this.root, this.instances, recipe);
      if (recipe.objects) warnings.push(...studioOverlaps(boxes));
      for (const spec of everySpec)
        if (spec.pending)
          warnings.push(
            `${spec.name}: no file yet. ${spec.source.kind === 'svg' ? 'Choose an SVG' : 'Choose a GLB or STL model'} in its row, or drop files on the Objects list.`
          );
      for (const warning of this.environment?.warnings ?? []) if (!warnings.includes(warning)) warnings.push(warning);
      if (recipe.stage.output !== 'scene' && studioHasTransmission(recipe))
        warnings.push(
          'Glass shows as solid crystal in a transparent output, because there is no scene behind it to see through. Choose Complete scene for see-through glass.'
        );
      const active =
        this.instances.find((instance) => instance.row === (recipe.activeObject ?? 0)) ??
        this.instances[0]!;
      return { slots: active.asset.info.slots, triangles, warnings };
    } catch (error) {
      for (const asset of loaded.values()) asset.dispose();
      pending.backdrop?.dispose();
      pending.environment?.dispose();
      throw error;
    }
  }

  /** World-space bounds of every visible subject at time zero. */
  private boxes(): StudioObjectBox[] {
    return this.recipe ? placeStudioScene(this.root, this.instances, this.recipe) : [];
  }

  render(
    width: number,
    height: number,
    quality: 'preview' | 'export' | 'clip',
    time = 0,
    clipSeconds?: number
  ): void {
    const posed = this.recipe,
      environment = this.environment;
    if (!posed || !this.instances.length || !this.backdrop || !environment || this.disposed)
      throw new Error('Wait for the studio source to finish loading.');
    // On a camera path the frame's camera is the sampled pose; the saved camera is the rest view.
    const recipe = framedRecipe(posed, time, clipSeconds);
    const showEnvironment = recipe.environment.background && recipe.stage.output === 'scene';
    const frameKey = JSON.stringify([
      this.revision,
      width,
      height,
      quality,
      studioAnimated(recipe) ? time : 0,
      clipSeconds,
      quality === 'preview' ? this.highlighted : null,
      quality === 'preview' ? this.lightHandles : null,
    ]);
    if (frameKey === this.frameKey) return;
    this.counts.frames++;
    const camera = studioCamera(recipe, width / height),
      target = new THREE.Vector3(...recipe.camera.target);
    const footprint = this.boxes().reduce(
      (radius, box) =>
        Math.max(radius, ...[box.min[0], box.max[0], box.min[2], box.max[2]].map(Math.abs)),
      0
    );
    const extent = Math.max(7, Math.ceil((footprint + 2) * 2) / 2);
    const stageKey = JSON.stringify([
      recipe.stage,
      recipe.lights,
      recipe.camera,
      recipe.materials.colorA,
      recipe.materials.colorB,
      width / height,
      extent,
      showEnvironment,
      // Copies of the subject are cloned from the placed instances, so they follow every reload.
      recipe.stage.atmosphere && recipe.stage.atmosphereForms === 'copies' ? this.revision : 0,
    ]);
    if (!this.stage || stageKey !== this.stageKey) {
      this.counts.stageBuilds++;
      this.stage?.dispose();
      this.stage = buildStudioStage(
        recipe,
        camera,
        this.backdrop,
        extent,
        !showEnvironment,
        this.root
      );
      this.stageKey = stageKey;
    }
    this.scene.clear();
    this.scene.add(this.depthReset.mesh, this.stage.group, this.root);
    this.scene.environment = environment.texture;
    this.scene.environmentIntensity = recipe.environment.intensity;
    this.scene.environmentRotation.y = THREE.MathUtils.degToRad(recipe.environment.rotation);
    // The map behind a scene image is the same radiance, so highlights and scenery agree;
    // at zero blur a painted panorama shows crisp rather than through the prefilter.
    this.scene.background = showEnvironment
      ? recipe.environment.blur === 0 && environment.backdrop
        ? environment.backdrop
        : environment.texture
      : null;
    this.scene.backgroundIntensity = recipe.environment.intensity;
    this.scene.backgroundBlurriness = recipe.environment.blur;
    this.scene.backgroundRotation.y = THREE.MathUtils.degToRad(recipe.environment.rotation);
    placeStudioScene(this.root, this.instances, recipe, time, clipSeconds);
    let outline: THREE.Box3Helper | null = null;
    const selected =
      this.highlighted === null
        ? null
        : this.instances.find((instance) => instance.row === this.highlighted);
    if (quality === 'preview' && selected?.spec.visible) {
      outline = new THREE.Box3Helper(
        new THREE.Box3().setFromObject(selected.object),
        new THREE.Color('#ffffff')
      );
      this.scene.add(outline);
    }
    const handles = quality === 'preview' && this.lightHandles ? this.buildLightHandles(recipe) : null;
    if (handles) this.scene.add(handles.group);
    const origin = camera.position.clone(),
      right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion),
      up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const focus = recipe.camera.focus || origin.distanceTo(target);
    const samples =
      quality === 'export'
        ? recipe.quality.exportSamples
        : quality === 'clip'
          ? recipe.quality.clipSamples
          : !studioAnimated(recipe)
            ? recipe.quality.previewSamples
            : 2;
    const lightMotion = studioLightMotion(recipe, time, clipSeconds);
    const axis = new THREE.Vector3(0, 1, 0);
    try {
      this.output.render(this.scene, camera, width, height, samples, recipe.exposure, (i) => {
        for (const light of this.stage!.lights) {
          light.light.position.copy(light.position).applyAxisAngle(axis, lightMotion.angle);
          light.light.intensity = light.intensity * lightMotion.strength;
          if (light.light instanceof THREE.RectAreaLight) light.light.lookAt(0, 1.5, 0);
          if (light.light.castShadow)
            light.light.position.x += (halton(i + 1, 2) - 0.5) * light.size;
          if (light.light.castShadow)
            light.light.position.y += (halton(i + 1, 3) - 0.5) * light.size;
        }
        const radius = Math.sqrt(halton(i + 1, 13)) * recipe.camera.aperture,
          angle = 2 * Math.PI * halton(i + 1, 11);
        const x = Math.cos(angle) * radius,
          y = Math.sin(angle) * radius;
        camera.position.copy(origin).addScaledVector(right, x).addScaledVector(up, y);
        const factor =
          camera instanceof THREE.PerspectiveCamera
            ? height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * focus)
            : 0;
        camera.setViewOffset(
          width,
          height,
          -x * factor + halton(i + 1, 5) - 0.5,
          y * factor + halton(i + 1, 7) - 0.5,
          width,
          height
        );
      });
    } finally {
      if (outline) {
        this.scene.remove(outline);
        outline.geometry.dispose();
        (outline.material as THREE.Material).dispose();
      }
      if (handles) {
        this.scene.remove(handles.group);
        handles.dispose();
      }
    }
    camera.clearViewOffset();
    this.frameKey = frameKey;
  }

  /** Draw one export or clip frame; with `verify`, check once that the subject is not missing from it. */
  capture(
    width: number,
    height: number,
    quality: 'export' | 'clip',
    time = 0,
    clipSeconds?: number,
    verify = false
  ): void {
    this.counts.captures++;
    this.render(width, height, quality, time, clipSeconds);
    if (verify) this.verifyFrame(width, height, time, clipSeconds);
  }

  /**
   * A transparent output with its subject in frame must hold some opaque pixels. The check
   * projects each visible object's bounds, confirms with a ray that the object covers a
   * pixel there (a box corner can reach into the frame while the object does not), then
   * reads the alpha of those pixels once. A scene output is exempt, because its backplate
   * covers every pixel, and so is a subject outside the frame.
   */
  private verifyFrame(width: number, height: number, time: number, clipSeconds?: number): void {
    const posed = this.recipe;
    if (!posed || posed.stage.output === 'scene') return;
    const w = Math.max(1, Math.round(width)),
      h = Math.max(1, Math.round(height));
    const camera = studioCamera(framedRecipe(posed, time, clipSeconds), w / h);
    camera.updateMatrixWorld(true);
    placeStudioScene(this.root, this.instances, posed, time, clipSeconds);
    const frame = new THREE.Box2(new THREE.Vector2(0, 0), new THREE.Vector2(w, h));
    const covered = new THREE.Box2();
    const ray = new THREE.Raycaster();
    let confirmed = false;
    for (const instance of this.instances) {
      if (!instance.spec.visible) continue;
      const bounds = new THREE.Box3().setFromObject(instance.object);
      const rect = bounds.isEmpty() ? null : projectedBox(bounds, camera, w, h);
      if (!rect || rect.intersect(frame).isEmpty()) continue;
      covered.union(rect);
      const center = rect.getCenter(new THREE.Vector2()),
        size = rect.getSize(new THREE.Vector2());
      confirmed ||= PROBE_POINTS.some(([dx, dy]) => {
        ray.setFromCamera(
          new THREE.Vector2(((center.x + dx * size.x) / w) * 2 - 1, ((center.y + dy * size.y) / h) * 2 - 1),
          camera
        );
        return ray.intersectObject(instance.object, true).some((hit) => drawnHit(hit, instance.object));
      });
    }
    const extent = covered.getSize(new THREE.Vector2());
    if (!confirmed || covered.isEmpty() || extent.x * extent.y < 16) return;
    const x = Math.floor(covered.min.x),
      y = Math.floor(covered.min.y);
    const alpha = this.output.alphaIn(x, y, Math.ceil(covered.max.x) - x, Math.ceil(covered.max.y) - y);
    if (alpha.some((value) => value > 0)) return;
    // The blank frame is not kept, so the next capture of the same frame draws it again.
    this.frameKey = '';
    throw new StudioEmptyFrameError();
  }

  view(camera: Partial<StudioSceneV1['camera']>): void {
    if (!this.recipe || this.hold) return;
    const next = { ...this.recipe.camera, ...camera };
    // Putting back the camera a frame was drawn with (a capture resets any orbit) keeps that frame.
    if (JSON.stringify(next) === JSON.stringify(this.recipe.camera)) return;
    this.recipe = { ...this.recipe, camera: next };
    this.frameKey = '';
  }

  /** Preview an object at a new position while it is dragged; the saved row changes on release. */
  moveObject(row: number, position: [number, number, number]): void {
    const instance = this.instances.find((candidate) => candidate.row === row);
    if (!this.recipe?.objects || !instance || this.hold) return;
    const spec = { ...instance.spec, transform: { ...instance.spec.transform, position } };
    instance.spec = spec;
    this.recipe = {
      ...this.recipe,
      objects: this.recipe.objects.map((object, i) => (i === row ? spec : object)),
    };
    this.frameKey = '';
  }

  /** A sphere per placeable light in its own colour, a line to the target, and a ring on the selection. */
  private buildLightHandles(recipe: StudioSceneV1): { group: THREE.Group; dispose(): void } {
    const group = new THREE.Group();
    const disposables: { dispose(): void }[] = [];
    const target = new THREE.Vector3(...STUDIO_LIGHT_TARGET);
    const sphere = new THREE.SphereGeometry(0.16, 16, 12);
    const ring = new THREE.RingGeometry(0.24, 0.3, 32);
    disposables.push(sphere, ring);
    for (const index of studioPlaceableLights(recipe)) {
      const light = recipe.lights[index]!;
      const position = new THREE.Vector3(...light.position);
      const material = new THREE.MeshBasicMaterial({ color: light.color, toneMapped: false });
      const lineMaterial = new THREE.LineBasicMaterial({
        color: light.color,
        transparent: true,
        opacity: 0.55,
        toneMapped: false,
      });
      const line = new THREE.BufferGeometry().setFromPoints([position, target]);
      disposables.push(material, lineMaterial, line);
      const handle = new THREE.Mesh(sphere, material);
      handle.position.copy(position);
      group.add(handle, new THREE.Line(line, lineMaterial));
      if (this.lightHandles?.selected === index) {
        const marker = new THREE.Mesh(
          ring,
          new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide, toneMapped: false })
        );
        disposables.push(marker.material as THREE.Material);
        marker.position.copy(position);
        marker.lookAt(target);
        group.add(marker);
      }
    }
    return {
      group,
      dispose: () => {
        for (const item of disposables) item.dispose();
      },
    };
  }

  /** Show light handles in previews only, marking one; exports never carry them. */
  showLightHandles(state: { selected: number | null } | null): void {
    if (this.hold || JSON.stringify(state) === JSON.stringify(this.lightHandles)) return;
    this.lightHandles = state;
    this.frameKey = '';
  }

  /** Preview a light at a new position while it is dragged; the saved rig changes on release. */
  moveLight(index: number, position: [number, number, number]): void {
    if (!this.recipe?.lights[index] || this.hold) return;
    const lights = this.recipe.lights.map((light, i) =>
      i === index ? { ...light, position } : light
    );
    // The key reflection card keeps its offset from the key while the key moves.
    const key = lights.find((light) => light.id === 'key'),
      card = lights.findIndex((light) => light.id === 'key-card');
    if (key && card >= 0 && this.recipe.lights[index]!.id === 'key') {
      const before = this.recipe.lights[index]!.position;
      lights[card] = {
        ...lights[card]!,
        position: lights[card]!.position.map((n, i) => n + position[i]! - before[i]!) as [
          number,
          number,
          number,
        ],
      };
    }
    this.recipe = { ...this.recipe, lights };
    this.frameKey = '';
  }

  /** The placeable light whose handle sits nearest a canvas point, within a small screen radius. */
  pickLight(aspect: number, x: number, y: number): number | null {
    if (!this.recipe) return null;
    const camera = studioCamera(this.recipe, aspect);
    camera.updateMatrixWorld(true);
    let best: { index: number; distance: number } | null = null;
    for (const index of studioPlaceableLights(this.recipe)) {
      const projected = new THREE.Vector3(...this.recipe.lights[index]!.position).project(camera);
      if (projected.z > 1) continue;
      const distance = Math.hypot((projected.x - x) * aspect, projected.y - y);
      if (distance < 0.12 && (!best || distance < best.distance)) best = { index, distance };
    }
    return best?.index ?? null;
  }

  /** Outline one object in previews only; exports never carry it. */
  highlight(index: number | null): void {
    if (this.hold || this.highlighted === index) return;
    this.highlighted = index;
    this.frameKey = '';
  }

  fit(aspect: number, row?: number): { zoom: number; target: THREE.Vector3 } | null {
    if (!this.recipe || !this.instances.length) return null;
    this.boxes();
    const subject =
      row === undefined
        ? this.root
        : this.instances.find((instance) => instance.row === row)?.object;
    return subject ? fitStudioObject(subject, this.recipe, aspect) : null;
  }

  focus(aspect: number, x: number, y: number): number | null {
    if (!this.recipe || !this.instances.length) return null;
    this.boxes();
    return pickStudioFocus(this.root, this.recipe, aspect, x, y);
  }

  /** The current view camera, including an unsaved orbit in progress. */
  camera(aspect: number): THREE.Camera | null {
    if (!this.recipe) return null;
    const camera = studioCamera(this.recipe, aspect);
    camera.updateMatrixWorld(true);
    return camera;
  }

  /** Which object sits under a canvas point, with the world point that was hit. */
  pick(aspect: number, x: number, y: number): { index: number; point: THREE.Vector3 } | null {
    if (!this.recipe || !this.instances.length) return null;
    this.boxes();
    const camera = studioCamera(this.recipe, aspect);
    camera.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(x, y), camera);
    const hit = ray.intersectObject(this.root, true)[0];
    if (!hit) return null;
    const instance = this.instances.find((candidate) => {
      let node: THREE.Object3D | null = hit.object;
      while (node && node !== candidate.object) node = node.parent;
      return node === candidate.object;
    });
    return instance ? { index: instance.row, point: hit.point } : null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.revision++;
    this.controller.abort();
    // An update held by a capture wakes, sees the abort and releases what it loaded.
    this.freeze(false);
    for (const instance of this.instances) {
      instance.restore();
      instance.asset.dispose();
    }
    this.instances = [];
    for (const asset of this.assets.values()) asset.dispose();
    this.assets.clear();
    this.stage?.dispose();
    this.backdrop?.dispose();
    this.environment?.dispose();
    this.pmrem.dispose();
    this.depthReset.dispose();
    this.output.dispose();
  }
}
