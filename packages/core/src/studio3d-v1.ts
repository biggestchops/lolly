// SPDX-License-Identifier: MPL-2.0

export type StudioVector3 = [number, number, number];
export type StudioProjection = 'perspective' | 'orthographic';
export type StudioFinish = 'matte' | 'satin' | 'enamel' | 'metal';

export interface StudioSourceV1 {
  kind: 'svg' | 'glb' | 'stl' | 'primitive';
  id: string;
  url: string;
  primitive: 'badge' | 'sphere' | 'box' | 'torus';
}

export interface StudioMaterialV1 {
  slot: string;
  color: string;
  roughness: number;
  metalness: number;
  clearcoat: number;
}

export interface StudioLightV1 {
  id: string;
  kind: 'directional' | 'point' | 'spot' | 'area';
  color: string;
  intensity: number;
  position: StudioVector3;
  size: number;
  shadows: boolean;
}

/** Portable evaluated scene. URLs are resolved by the shell; source IDs are retained. */
export interface StudioSceneV1 {
  version: 1;
  source: StudioSourceV1;
  shape: { depth: number; bevel: number; smoothness: number };
  transform: { rotation: StudioVector3; position: StudioVector3; scale: number };
  camera: {
    projection: StudioProjection;
    azimuth: number;
    elevation: number;
    fov: number;
    zoom: number;
    target: StudioVector3;
    focus: number;
    aperture: number;
  };
  materials: {
    mode: 'source' | 'pair' | 'custom';
    finishA: StudioFinish;
    finishB: StudioFinish;
    colorA: string;
    colorB: string;
    overrides: StudioMaterialV1[];
    /** Optional explicit pair roles. Empty bindings preserve the original alternating rule. */
    bindings?: { a: string; b: string };
    surfaces?: {
      a: Record<'face' | 'bevel' | 'side', StudioFinish | 'inherit'>;
      b: Record<'face' | 'bevel' | 'side', StudioFinish | 'inherit'>;
    };
  };
  lights: StudioLightV1[];
  environment: { intensity: number; rotation: number };
  stage: {
    output: 'scene' | 'object-shadow' | 'object';
    floor: 'shadow' | 'matte' | 'cove';
    floorColor: string;
    shadowOpacity: number;
    background: string;
    background2: string;
    backdrop: 'solid' | 'gradient' | 'image';
    backdropUrl: string;
    backdropId: string;
    backdropStrength: number;
    pedestal: boolean;
    atmosphere: boolean;
    seed: number;
  };
  exposure: number;
  quality: { previewSamples: number; exportSamples: number };
  motion: { kind: 'still' | 'turntable'; seconds: number; degrees: number };
  lightAnimation?: { kind: 'still' | 'orbit' | 'breathe'; amount: number };
}

export interface StudioSurfaceInfo {
  id: string;
  label: string;
  color: string;
}

export interface StudioSourceInfo {
  slots: StudioSurfaceInfo[];
  triangles: number;
  warnings: string[];
}
