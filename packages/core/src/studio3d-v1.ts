// SPDX-License-Identifier: MPL-2.0

export type StudioVector3 = [number, number, number];
export type StudioProjection = 'perspective' | 'orthographic';
export type StudioFinish =
  | 'matte'
  | 'satin'
  | 'enamel'
  | 'metal'
  | 'chrome'
  | 'clay'
  | 'velvet'
  | 'glow'
  | 'neon'
  | 'glass'
  | 'frosted'
  | 'pearl'
  | 'iridescent';

/** Everything a finish sets on a physical material; absent members keep the material's own. */
export interface StudioFinishSpec {
  roughness: number;
  metalness: number;
  clearcoat: number;
  clearcoatRoughness?: number;
  /** Light through the body: 1 is clear glass; `ior` and `thickness` shape it. */
  transmission?: number;
  ior?: number;
  thickness?: number;
  /** Fabric-like fuzz at grazing angles: 1 with a high sheen roughness reads as velvet. */
  sheen?: number;
  sheenRoughness?: number;
  /** Self-lit: the region's own colour scaled by this factor. */
  emissive?: number;
  iridescence?: number;
  iridescenceIOR?: number;
}

export interface StudioSourceV1 {
  kind: 'svg' | 'glb' | 'stl' | 'primitive' | 'text';
  id: string;
  url: string;
  primitive: 'badge' | 'sphere' | 'box' | 'torus';
  /** Words set in a brand font and outlined on the host, present for `kind: 'text'`. */
  text?: {
    text: string;
    /** A brand role (`sans`, `display`, `mono`) or a font family the host knows. */
    font: string;
    weight: number;
    /** Extra letter spacing in em. */
    tracking: number;
    lineHeight: number;
    align: 'left' | 'center' | 'right';
  };
}

/** One subject inside an arrangement. Its id is stable across edits so saved overrides survive reordering. */
export interface StudioObjectV1 {
  id: string;
  name: string;
  source: StudioSourceV1;
  transform: { rotation: StudioVector3; position: StudioVector3; scale: number };
  /** Rest on the stage surface; the y position then lifts the object above it. */
  grounded: boolean;
  visible: boolean;
  /** Explicit material A/B slot names for this object; empty keeps the alternating rule. */
  bindings: { a: string; b: string };
  /** An artwork or model row with no file chosen yet: kept in the list, not rendered. */
  pending?: boolean;
}

export interface StudioMaterialV1 {
  slot: string;
  color: string;
  roughness: number;
  metalness: number;
  clearcoat: number;
  /** A named finish applied on top of the numbers, for glow, glass, velvet and the like. */
  finish?: StudioFinish;
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
    /** Halo strength around self-lit finishes, 0 to 1; only drawn when one is in use. */
    glow?: number;
  };
  lights: StudioLightV1[];
  /**
   * Image-based light. `room`, `softbox` and `window` are generated on device; `image`
   * is an imported equirectangular radiance map (.hdr or .exr) whose bytes stay on the
   * asset rail. Illumination and reflections share one strength in this raster renderer;
   * `background` shows the map behind a scene image, blurred by `blur`.
   */
  environment: {
    intensity: number;
    rotation: number;
    kind:
      | 'room'
      | 'softbox'
      | 'window'
      | 'studio'
      | 'gallery'
      | 'warehouse'
      | 'stage'
      | 'desert'
      | 'synthwave'
      | 'image';
    url: string;
    id: string;
    background: boolean;
    blur: number;
  };
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
    /** Depth forms: soft spheres in brand colours, or copies of the subject sharing its geometry. */
    atmosphereForms: 'spheres' | 'copies';
    /** 0 keeps the forms near the subject; 1 pushes them far in front of and behind it. */
    atmosphereSpread: number;
    atmosphereCount: number;
    seed: number;
    /**
     * The hemisphere fill light: `sky` lights surfaces that face up, `ground` those that
     * face down. Today it is colour A over the stage background at 0.12, so changing the
     * background also changes this fill light.
     */
    fill: { sky: string; ground: string; intensity: number };
  };
  exposure: number;
  /** Samples per frame: a still takes `exportSamples`, a video or GIF frame `clipSamples`. */
  quality: { previewSamples: number; exportSamples: number; clipSamples: number };
  motion: { kind: 'still' | 'turntable'; seconds: number; degrees: number };
  lightAnimation?: { kind: 'still' | 'orbit' | 'breathe'; amount: number };
  /**
   * Present for an arrangement: several subjects photographed together. `source` and
   * `transform` mirror the first object so single-object readers keep working; the
   * renderer places every entry here and turns the whole group for a turntable.
   */
  objects?: StudioObjectV1[];
  /** Zero-based selected object for gestures and material slot notes. */
  activeObject?: number;
  /**
   * A camera path for motion: with `kind: 'keys'` and two or more keys the camera
   * travels through them over the loop; `still` keeps the live camera. `flow` passes
   * through every key with continuous velocity, `smooth` eases each leg, `linear` does not.
   */
  cameraMotion?: {
    kind: 'still' | 'keys';
    ease: 'linear' | 'smooth' | 'flow';
    loop: boolean;
    keys: StudioCameraKeyV1[];
  };
}

/** One saved view on a camera path; `at` is the loop fraction it is reached at. */
export interface StudioCameraKeyV1 {
  at: number;
  azimuth: number;
  elevation: number;
  fov: number;
  zoom: number;
  target: StudioVector3;
  /** 0 keeps automatic focus on the target. */
  focus: number;
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
