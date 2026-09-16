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
import { halton, StudioCapture } from './capture.ts';
import { fitStudioObject, pickStudioFocus, placeStudioScene } from './camera.ts';
import { loadStudioEnvironment, type StudioEnvironment, studioPalette } from './environment.ts';
import { applyStudioMaterials, studioHasEmissive, studioHasTransmission } from './materials.ts';
import {
  instantiateStudioAsset,
  loadStudioSource,
  type StudioAsset,
  type StudioRead,
  type StudioShaper,
} from './source.ts';
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

function assetKey(recipe: StudioSceneV1, spec: StudioObjectV1): string {
  return JSON.stringify([
    spec.source,
    recipe.shape,
    spec.source.kind === 'primitive' ? [recipe.materials.colorA, recipe.materials.colorB] : null,
  ]);
}

export class StudioRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly capture: StudioCapture;
  private readonly scene = new THREE.Scene();
  private readonly pmrem: THREE.PMREMGenerator;
  private environment: StudioEnvironment | null = null;
  private environmentKey = '';
  /** Loaded sources shared by every object that names the same bytes and shape. */
  private readonly assets = new Map<string, StudioAsset>();
  private readonly root = new THREE.Group();
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

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.capture = new StudioCapture(canvas);
    this.pmrem = new THREE.PMREMGenerator(this.capture.renderer);
  }

  async update(
    recipe: StudioSceneV1,
    read: StudioRead,
    shaper?: StudioShaper
  ): Promise<StudioSourceInfo> {
    if (this.disposed) throw new Error('The studio has been closed.');
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
    try {
      const missing = [...new Set(keys)].filter((key) => !this.assets.has(key));
      // Every load settles before anything is kept or thrown, so a failed object cannot
      // leave a sibling's bytes loading into a map nobody disposes.
      const settled = await Promise.allSettled([
        ...missing.map(async (key) => {
          const spec = specs[keys.indexOf(key)]!;
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
    const pose = studioCameraPose(posed, time, clipSeconds);
    const recipe: StudioSceneV1 = {
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
    this.scene.add(this.stage.group, this.root);
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
    const glow = studioHasEmissive(recipe) ? (recipe.materials.glow ?? 0) : 0;
    try {
      this.capture.render(this.scene, camera, width, height, samples, recipe.exposure, (i) => {
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
      }, glow);
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

  view(camera: Partial<StudioSceneV1['camera']>): void {
    if (!this.recipe) return;
    this.recipe = { ...this.recipe, camera: { ...this.recipe.camera, ...camera } };
    this.frameKey = '';
  }

  /** Preview an object at a new position while it is dragged; the saved row changes on release. */
  moveObject(row: number, position: [number, number, number]): void {
    const instance = this.instances.find((candidate) => candidate.row === row);
    if (!this.recipe?.objects || !instance) return;
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
    if (JSON.stringify(state) === JSON.stringify(this.lightHandles)) return;
    this.lightHandles = state;
    this.frameKey = '';
  }

  /** Preview a light at a new position while it is dragged; the saved rig changes on release. */
  moveLight(index: number, position: [number, number, number]): void {
    if (!this.recipe?.lights[index]) return;
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
    if (this.highlighted === index) return;
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
    this.capture.dispose();
  }
}
