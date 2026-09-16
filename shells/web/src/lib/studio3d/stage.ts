// SPDX-License-Identifier: MPL-2.0
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import type { StudioSceneV1 } from '../../../../../packages/core/src/studio3d-v1.ts';
import type { StudioRead } from './source.ts';

export interface StudioStage {
  group: THREE.Group;
  lights: { light: THREE.Light; position: THREE.Vector3; size: number; intensity: number }[];
  dispose(): void;
}

export async function studioBackdrop(
  scene: StudioSceneV1,
  read: StudioRead,
  signal: AbortSignal
): Promise<THREE.Texture> {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = scene.stage.background;
  ctx.fillRect(0, 0, 1024, 1024);
  if (scene.stage.backdrop === 'image') {
    if (!scene.stage.backdropUrl)
      throw new Error('Choose a backdrop image or use a solid or gradient background.');
    const bytes = await read(scene.stage.backdropUrl, signal);
    signal.throwIfAborted();
    if (bytes.length > 16 * 1024 * 1024) throw new Error('Use a backdrop smaller than 16 MB.');
    const image = await createImageBitmap(new Blob([bytes.slice().buffer]));
    try {
      const scale = Math.max(1024 / image.width, 1024 / image.height);
      ctx.drawImage(
        image,
        (1024 - image.width * scale) / 2,
        (1024 - image.height * scale) / 2,
        image.width * scale,
        image.height * scale
      );
    } finally {
      image.close();
    }
    ctx.globalAlpha = 1 - scene.stage.backdropStrength;
    ctx.fillRect(0, 0, 1024, 1024);
    ctx.globalAlpha = 1;
  } else if (scene.stage.backdrop === 'gradient') {
    const gradient = ctx.createRadialGradient(460, 570, 30, 512, 512, 740);
    gradient.addColorStop(0, scene.stage.background2);
    gradient.addColorStop(1, scene.stage.background);
    ctx.globalAlpha = scene.stage.backdropStrength;
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1024, 1024);
    ctx.globalAlpha = 1;
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function studioCamera(
  recipe: StudioSceneV1,
  aspect: number
): THREE.PerspectiveCamera | THREE.OrthographicCamera {
  const cfg = recipe.camera,
    distance = 11.3 / cfg.zoom;
  const azimuth = THREE.MathUtils.degToRad(cfg.azimuth),
    elevation = THREE.MathUtils.degToRad(cfg.elevation);
  const camera =
    cfg.projection === 'orthographic'
      ? new THREE.OrthographicCamera(
          (-3 * aspect) / cfg.zoom,
          (3 * aspect) / cfg.zoom,
          3 / cfg.zoom,
          -3 / cfg.zoom,
          0.05,
          Math.max(150, distance + 100)
        )
      : new THREE.PerspectiveCamera(cfg.fov, aspect, 0.05, Math.max(150, distance + 100));
  camera.position
    .set(
      Math.sin(azimuth) * Math.cos(elevation) * distance,
      Math.sin(elevation) * distance,
      Math.cos(azimuth) * Math.cos(elevation) * distance
    )
    .add(new THREE.Vector3(...cfg.target));
  camera.lookAt(...cfg.target);
  return camera;
}

function coveGeometry(): THREE.BufferGeometry {
  const rows: [number, number][] = [
    [0, 50],
    [0, -3],
  ];
  for (let i = 1; i <= 32; i++) {
    const t = ((i / 32) * Math.PI) / 2;
    rows.push([3 * (1 - Math.cos(t)), -3 - 3 * Math.sin(t)]);
  }
  rows.push([50, -6]);
  const vertices: number[] = [],
    indices: number[] = [];
  for (const [y, z] of rows) vertices.push(-50, y, z, 50, y, z);
  for (let i = 0; i < rows.length - 1; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function buildStudioStage(
  recipe: StudioSceneV1,
  camera: THREE.Camera,
  backdrop: THREE.Texture
): StudioStage {
  RectAreaLightUniformsLib.init();
  const group = new THREE.Group(),
    geometries = new Set<THREE.BufferGeometry>(),
    materials = new Set<THREE.Material>();
  const lights: StudioStage['lights'] = [];
  const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh => {
    geometries.add(geometry);
    materials.add(material);
    const result = new THREE.Mesh(geometry, material);
    group.add(result);
    return result;
  };
  if (recipe.lights.filter((l) => l.shadows).length > 4)
    throw new Error('Use at most four shadow-casting lights.');
  for (const cfg of recipe.lights) {
    let light: THREE.Light;
    if (cfg.kind === 'area') {
      light = new THREE.RectAreaLight(cfg.color, cfg.intensity, cfg.size, cfg.size * 1.4);
    } else if (cfg.kind === 'point')
      light = new THREE.PointLight(cfg.color, cfg.intensity * 20, 80, 2);
    else if (cfg.kind === 'spot') {
      const spot = new THREE.SpotLight(cfg.color, cfg.intensity * 30, 80, Math.PI / 4, 0.6, 2);
      spot.target.position.set(0, 1.5, 0);
      group.add(spot.target);
      light = spot;
    } else {
      const directional = new THREE.DirectionalLight(cfg.color, cfg.intensity);
      directional.target.position.set(0, 1.5, 0);
      group.add(directional.target);
      light = directional;
    }
    light.position.set(...cfg.position);
    light.lookAt(0, 1.5, 0);
    light.castShadow = cfg.shadows;
    if (
      light instanceof THREE.DirectionalLight ||
      light instanceof THREE.SpotLight ||
      light instanceof THREE.PointLight
    ) {
      light.shadow.mapSize.set(1024, 1024);
      light.shadow.bias = -0.0001;
      light.shadow.normalBias = 0.008;
      if (light instanceof THREE.DirectionalLight)
        Object.assign(light.shadow.camera, {
          left: -7,
          right: 7,
          top: 7,
          bottom: -7,
          near: 0.1,
          far: 60,
        });
    }
    group.add(light);
    lights.push({
      light,
      position: light.position.clone(),
      size: cfg.size,
      intensity: light.intensity,
    });
  }
  group.add(new THREE.HemisphereLight(recipe.materials.colorA, recipe.stage.background, 0.12));
  const sceneOutput = recipe.stage.output === 'scene';
  if (recipe.stage.output !== 'object') {
    const shadow = !sceneOutput || recipe.stage.floor === 'shadow';
    const material = shadow
      ? new THREE.ShadowMaterial({ color: 0x000000, opacity: recipe.stage.shadowOpacity })
      : new THREE.MeshPhysicalMaterial({
          color: recipe.stage.floorColor,
          roughness: 0.7,
          metalness: 0.02,
          side: THREE.DoubleSide,
        });
    const floor = mesh(
      !shadow && recipe.stage.floor === 'cove' ? coveGeometry() : new THREE.PlaneGeometry(150, 150),
      material
    );
    if (shadow || recipe.stage.floor !== 'cove') floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
  }
  if (sceneOutput) {
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion),
      up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion),
      forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const half = (distance: number): number =>
      camera instanceof THREE.PerspectiveCamera
        ? distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
        : 3 / recipe.camera.zoom;
    const plane = mesh(
      new THREE.PlaneGeometry(half(60) * 5, half(60) * 5),
      new THREE.MeshBasicMaterial({ map: backdrop })
    );
    plane.position.copy(camera.position).addScaledVector(forward, 60);
    plane.quaternion.copy(camera.quaternion);
    if (recipe.stage.pedestal) {
      const pedestal = mesh(
        new THREE.CylinderGeometry(1.6, 1.7, 0.3, 96),
        new THREE.MeshPhysicalMaterial({
          color: recipe.stage.floorColor,
          roughness: 0.3,
          metalness: 0.1,
        })
      );
      pedestal.position.y = 0.15;
      pedestal.castShadow = true;
      pedestal.receiveShadow = true;
    }
    if (recipe.stage.atmosphere) {
      const forms = [
        [-0.8, 0.68, 18, 0.23],
        [0.72, 0.64, 24, 0.32],
        [0.82, -0.23, 16, 0.14],
        [-0.44, 0.88, 36, 0.085],
        [0.14, 1.01, 28, 0.18],
        [-1.04, -0.62, 3.4, 0.4],
        [1, -0.74, 4.3, 0.32],
      ];
      const geometry = new THREE.SphereGeometry(1, 32, 24);
      for (const [i, form] of forms.entries()) {
        const [x, y, d, radius] = form as [number, number, number, number];
        const shift = Math.sin(recipe.stage.seed * 17 + i * 3) * 0.08;
        const sphere = mesh(
          geometry,
          new THREE.MeshPhysicalMaterial({
            color: [recipe.materials.colorA, recipe.materials.colorB, recipe.stage.background2][
              i % 3
            ],
            roughness: 0.48,
            metalness: 0.06,
            clearcoat: 0.15,
          })
        );
        sphere.position
          .copy(camera.position)
          .addScaledVector(forward, d)
          .addScaledVector(right, (x + shift) * half(d))
          .addScaledVector(up, y * half(d));
        sphere.scale.setScalar(radius * half(d));
      }
    }
  }
  return {
    group,
    lights,
    dispose: () => {
      for (const { light } of lights)
        if (
          light instanceof THREE.DirectionalLight ||
          light instanceof THREE.SpotLight ||
          light instanceof THREE.PointLight
        ) {
          light.shadow.map?.dispose();
          light.shadow.mapPass?.dispose();
        }
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
    },
  };
}
