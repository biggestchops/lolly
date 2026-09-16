// SPDX-License-Identifier: MPL-2.0
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { studioAnimated, studioLightMotion } from '../../../../../engine/src/studio3d.ts';
import type {
  StudioSceneV1,
  StudioSourceInfo,
} from '../../../../../packages/core/src/studio3d-v1.ts';
import { halton, StudioCapture } from './capture.ts';
import { fitStudioObject, pickStudioFocus, placeStudioObject } from './camera.ts';
import { applyStudioMaterials } from './materials.ts';
import { loadStudioSource, type StudioAsset, type StudioRead } from './source.ts';
import { buildStudioStage, type StudioStage, studioBackdrop, studioCamera } from './stage.ts';

export class StudioRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly capture: StudioCapture;
  private readonly scene = new THREE.Scene();
  private readonly environment: THREE.Texture;
  private readonly environmentTarget: THREE.WebGLRenderTarget;
  private readonly pmrem: THREE.PMREMGenerator;
  private asset: StudioAsset | null = null;
  private assetKey = '';
  private backdrop: THREE.Texture | null = null;
  private backdropKey = '';
  private stage: StudioStage | null = null;
  private stageKey = '';
  private frameKey = '';
  private recipe: StudioSceneV1 | null = null;
  private restoreMaterials: (() => void) | null = null;
  private disposed = false;
  private controller = new AbortController();
  private revision = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.capture = new StudioCapture(canvas);
    this.pmrem = new THREE.PMREMGenerator(this.capture.renderer);
    const room = new RoomEnvironment();
    this.environmentTarget = this.pmrem.fromScene(room, 0.025);
    this.environment = this.environmentTarget.texture;
    room.dispose();
    this.scene.environment = this.environment;
  }

  async update(recipe: StudioSceneV1, read: StudioRead): Promise<StudioSourceInfo> {
    if (this.disposed) throw new Error('The studio has been closed.');
    this.controller.abort();
    this.controller = new AbortController();
    const signal = this.controller.signal,
      revision = ++this.revision;
    const assetKey = JSON.stringify([
      recipe.source,
      recipe.shape,
      recipe.source.kind === 'primitive'
        ? [recipe.materials.colorA, recipe.materials.colorB]
        : null,
    ]);
    const backdropKey = JSON.stringify([
      recipe.stage.backdrop,
      recipe.stage.backdropUrl,
      recipe.stage.background,
      recipe.stage.background2,
      recipe.stage.backdropStrength,
    ]);
    let nextAsset: StudioAsset | null = null,
      nextBackdrop: THREE.Texture | null = null;
    try {
      if (assetKey !== this.assetKey) nextAsset = await loadStudioSource(recipe, read, signal);
      if (backdropKey !== this.backdropKey)
        nextBackdrop = await studioBackdrop(recipe, read, signal);
      signal.throwIfAborted();
      if (revision !== this.revision || this.disposed)
        throw new DOMException('Studio update cancelled', 'AbortError');
      this.restoreMaterials?.();
      this.restoreMaterials = null;
      if (nextAsset) {
        this.asset?.dispose();
        this.asset = nextAsset;
        nextAsset = null;
        this.assetKey = assetKey;
      }
      if (nextBackdrop) {
        this.backdrop?.dispose();
        this.backdrop = nextBackdrop;
        nextBackdrop = null;
        this.backdropKey = backdropKey;
      }
      if (!this.asset) throw new Error('The studio source did not load.');
      this.restoreMaterials = applyStudioMaterials(this.asset, recipe);
      this.recipe = recipe;
      this.frameKey = '';
      return this.asset.info;
    } finally {
      nextAsset?.dispose();
      nextBackdrop?.dispose();
    }
  }

  render(
    width: number,
    height: number,
    quality: 'preview' | 'export',
    time = 0,
    clipSeconds?: number
  ): void {
    const recipe = this.recipe,
      asset = this.asset;
    if (!recipe || !asset || !this.backdrop || this.disposed)
      throw new Error('Wait for the studio source to finish loading.');
    const frameKey = JSON.stringify([
      this.revision,
      width,
      height,
      quality,
      studioAnimated(recipe) ? time : 0,
      clipSeconds,
    ]);
    if (frameKey === this.frameKey) return;
    const camera = studioCamera(recipe, width / height),
      target = new THREE.Vector3(...recipe.camera.target);
    const stageKey = JSON.stringify([
      recipe.stage,
      recipe.lights,
      recipe.camera,
      recipe.materials.colorA,
      recipe.materials.colorB,
      width / height,
    ]);
    if (!this.stage || stageKey !== this.stageKey) {
      this.stage?.dispose();
      this.stage = buildStudioStage(recipe, camera, this.backdrop);
      this.stageKey = stageKey;
    }
    this.scene.clear();
    this.scene.add(this.stage.group, asset.object);
    this.scene.background = null;
    this.scene.environmentIntensity = recipe.environment.intensity;
    this.scene.environmentRotation.y = THREE.MathUtils.degToRad(recipe.environment.rotation);
    placeStudioObject(asset.object, recipe, time, clipSeconds);
    const origin = camera.position.clone(),
      right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion),
      up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const focus = recipe.camera.focus || origin.distanceTo(target);
    const samples =
      quality === 'export'
        ? recipe.quality.exportSamples
        : !studioAnimated(recipe)
          ? recipe.quality.previewSamples
          : 2;
    const lightMotion = studioLightMotion(recipe, time, clipSeconds);
    const axis = new THREE.Vector3(0, 1, 0);
    this.capture.render(this.scene, camera, width, height, samples, recipe.exposure, (i) => {
      for (const light of this.stage!.lights) {
        light.light.position.copy(light.position).applyAxisAngle(axis, lightMotion.angle);
        light.light.intensity = light.intensity * lightMotion.strength;
        if (light.light instanceof THREE.RectAreaLight) light.light.lookAt(0, 1.5, 0);
        if (light.light.castShadow) light.light.position.x += (halton(i + 1, 2) - 0.5) * light.size;
        if (light.light.castShadow) light.light.position.y += (halton(i + 1, 3) - 0.5) * light.size;
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
    camera.clearViewOffset();
    this.frameKey = frameKey;
  }

  view(camera: Partial<StudioSceneV1['camera']>): void {
    if (!this.recipe) return;
    this.recipe = { ...this.recipe, camera: { ...this.recipe.camera, ...camera } };
    this.frameKey = '';
  }

  fit(aspect: number): { zoom: number; target: THREE.Vector3 } | null {
    return this.asset && this.recipe
      ? fitStudioObject(this.asset.object, this.recipe, aspect)
      : null;
  }

  focus(aspect: number, x: number, y: number): number | null {
    return this.asset && this.recipe
      ? pickStudioFocus(this.asset.object, this.recipe, aspect, x, y)
      : null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.revision++;
    this.controller.abort();
    this.restoreMaterials?.();
    this.stage?.dispose();
    this.asset?.dispose();
    this.backdrop?.dispose();
    this.environmentTarget.dispose();
    this.pmrem.dispose();
    this.capture.dispose();
  }
}
