// SPDX-License-Identifier: MPL-2.0
import * as THREE from 'three';

const vertexShader = 'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}';
const copyShader =
  'uniform sampler2D frame;uniform float weight;varying vec2 vUv;void main(){gl_FragColor=texture2D(frame,vUv)*weight;}';
const outputShader = `
uniform sampler2D frame;
uniform sampler2D glow;
uniform float glowStrength;
varying vec2 vUv;
void main(){
  vec4 pixel=texture2D(frame,vUv)+texture2D(glow,vUv)*glowStrength;
  gl_FragColor=vec4(pixel.a>0.00001?pixel.rgb/pixel.a:vec3(0.),clamp(pixel.a,0.,1.));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <premultiplied_alpha_fragment>
}`;
// Light beyond white, in premultiplied linear terms: what a self-lit surface adds on top
// of a fully exposed one. Its luminance becomes the halo's alpha so a cutout keeps it.
const brightShader = `
uniform sampler2D frame;
varying vec2 vUv;
void main(){
  vec4 pixel=texture2D(frame,vUv);
  vec3 excess=max(pixel.rgb-vec3(pixel.a),vec3(0.));
  float lum=dot(excess,vec3(0.2126,0.7152,0.0722));
  gl_FragColor=vec4(excess,min(1.,lum));
}`;
const blurShader = `
uniform sampler2D frame;
uniform vec2 step;
varying vec2 vUv;
void main(){
  vec4 sum=texture2D(frame,vUv)*0.227027;
  sum+=(texture2D(frame,vUv+step*1.384615)+texture2D(frame,vUv-step*1.384615))*0.316216;
  sum+=(texture2D(frame,vUv+step*3.230769)+texture2D(frame,vUv-step*3.230769))*0.070270;
  gl_FragColor=sum;
}`;

export function halton(index: number, base: number): number {
  let f = 1,
    result = 0;
  for (let i = index; i > 0; i = Math.floor(i / base)) {
    f /= base;
    result += f * (i % base);
  }
  return result;
}

/** Retained float targets accumulate linear premultiplied samples before display encoding. */
export class StudioCapture {
  readonly renderer: THREE.WebGLRenderer;
  private readonly sample = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    depthBuffer: true,
    samples: 4,
  });
  private readonly sum = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    depthBuffer: false,
  });
  private readonly quad = new THREE.PlaneGeometry(2, 2);
  private readonly copy = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader: copyShader,
    uniforms: { frame: { value: this.sample.texture }, weight: { value: 1 } },
    depthTest: false,
    depthWrite: false,
    transparent: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    toneMapped: false,
  });
  /** Half-size targets for the glow halo; ping-pong blurred, added at output. */
  private readonly glowA = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    depthBuffer: false,
  });
  private readonly glowB = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    depthBuffer: false,
  });
  private readonly bright = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader: brightShader,
    uniforms: { frame: { value: this.sum.texture } },
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
  });
  private readonly blur = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader: blurShader,
    uniforms: { frame: { value: null }, step: { value: new THREE.Vector2() } },
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
  });
  private readonly output = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader: outputShader,
    uniforms: {
      frame: { value: this.sum.texture },
      glow: { value: this.glowB.texture },
      glowStrength: { value: 0 },
    },
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
    premultipliedAlpha: true,
  });
  private readonly screen = new THREE.Scene();
  private readonly screenCamera = new THREE.Camera();
  private readonly mesh: THREE.Mesh;
  private width = 0;
  private height = 0;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true,
      antialias: false,
    });
    if (!this.renderer.extensions.has('EXT_color_buffer_float')) {
      this.renderer.dispose();
      this.renderer.forceContextLoss();
      throw new Error('This device does not support the studio float render targets.');
    }
    this.renderer.setPixelRatio(1);
    this.renderer.autoClear = false;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.mesh = new THREE.Mesh(this.quad, this.copy);
    this.screen.add(this.mesh);
  }

  render(
    scene: THREE.Scene,
    camera: THREE.Camera,
    width: number,
    height: number,
    samples: number,
    exposure: number,
    step: (i: number) => void,
    /** Strength of the halo around self-lit surfaces; 0 skips the pass entirely. */
    glow = 0
  ): void {
    if (this.disposed) throw new Error('The studio renderer has been released.');
    const w = Math.max(1, Math.round(width)),
      h = Math.max(1, Math.round(height));
    if (w > 4096 || h > 4096 || w * h > 12_000_000)
      throw new Error('Use studio output up to 4096 pixels per side and 12 megapixels total.');
    if (w !== this.width || h !== this.height) {
      this.width = w;
      this.height = h;
      this.renderer.setSize(w, h, false);
      this.sample.setSize(w, h);
      this.sum.setSize(w, h);
      this.glowA.setSize(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)));
      this.glowB.setSize(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)));
    }
    const renderer = this.renderer,
      count = Math.max(1, Math.round(samples));
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.setRenderTarget(this.sum);
    renderer.clear(true, false, false);
    this.copy.uniforms.weight!.value = 1 / count;
    this.mesh.material = this.copy;
    try {
      for (let i = 0; i < count; i++) {
        step(i);
        renderer.setRenderTarget(this.sample);
        renderer.clear(true, true, true);
        renderer.render(scene, camera);
        renderer.setRenderTarget(this.sum);
        renderer.render(this.screen, this.screenCamera);
      }
      if (glow > 0) {
        // Bright pass into A, then two separable blurs at half size: A → B (across),
        // B → A (down), A → B (across), B → A (down); the output reads the last target.
        this.mesh.material = this.bright;
        renderer.setRenderTarget(this.glowA);
        renderer.clear(true, false, false);
        renderer.render(this.screen, this.screenCamera);
        this.mesh.material = this.blur;
        const gw = this.glowA.width,
          gh = this.glowA.height;
        const passes: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget, number, number][] = [
          [this.glowA, this.glowB, 2.2 / gw, 0],
          [this.glowB, this.glowA, 0, 2.2 / gh],
          [this.glowA, this.glowB, 4.4 / gw, 0],
          [this.glowB, this.glowA, 0, 4.4 / gh],
        ];
        for (const [from, to, sx, sy] of passes) {
          this.blur.uniforms.frame!.value = from.texture;
          (this.blur.uniforms.step!.value as THREE.Vector2).set(sx, sy);
          renderer.setRenderTarget(to);
          renderer.clear(true, false, false);
          renderer.render(this.screen, this.screenCamera);
        }
        this.output.uniforms.glow!.value = this.glowA.texture;
      }
      this.output.uniforms.glowStrength!.value = glow;
      renderer.setRenderTarget(null);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = exposure;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.mesh.material = this.output;
      renderer.clear(true, true, true);
      renderer.render(this.screen, this.screenCamera);
      if (renderer.getContext().isContextLost())
        throw new Error(
          'The graphics context was lost. Reload the studio and try a smaller output.'
        );
    } finally {
      renderer.setRenderTarget(null);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.sample.dispose();
    this.sum.dispose();
    this.glowA.dispose();
    this.glowB.dispose();
    this.bright.dispose();
    this.blur.dispose();
    this.copy.dispose();
    this.output.dispose();
    this.quad.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
