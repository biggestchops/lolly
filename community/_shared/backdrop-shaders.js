// SPDX-License-Identifier: MPL-2.0
// === lolly:shared backdrop-shaders - canonical source; edit here and run pnpm run sync:shared ===
    var FLUX_HEADER = `#version 300 es
precision highp float;
uniform float u_time;
uniform vec4 u_colors[6];
uniform float u_colorsCount;
uniform vec4 u_colorBack;
uniform vec4 u_colorAccent;
uniform float u_intensity;
uniform float u_density;
uniform float u_brandMix;
in mediump vec2 v_objectUV;
out vec4 fragColor;
const float TAU = 6.28318530718;
mat2 turn(float a) { return mat2(cos(a), -sin(a), sin(a), cos(a)); }

// A non-wrapping ramp: even a single swatch keeps shadows and lit facets.
// Interpolating squared channels avoids a dark seam between bright swatches.
vec3 palette(float t) {
  float at = clamp(t, 0.0, 1.0) * max(0.0, u_colorsCount - 1.0);
  vec3 c = u_colors[0].rgb;
  for (int i = 1; i < 6; i++) {
    if (float(i) >= u_colorsCount) break;
    float blend = smoothstep(0.0, 1.0, clamp(at - float(i - 1), 0.0, 1.0));
    c = sqrt(mix(c * c, u_colors[i].rgb * u_colors[i].rgb, blend));
  }
  return c;
}
vec3 finish(float light, float hue, float rim, vec2 p) {
  float l = clamp(light, 0.0, 1.0);
  vec3 spectrum = 0.5 + 0.5 * cos(TAU * (hue + l * 0.32 + vec3(0.0, 0.33, 0.67)));
  spectrum = spectrum * (0.2 + 0.85 * l) + rim * 0.26;
  vec3 brand = palette((l - 0.08) * 1.42 + 0.08 * sin(hue * TAU)) * (0.28 + 0.95 * l);
  brand += u_colorAccent.rgb * rim * 0.32;
  brand = mix(brand, mix(u_colorAccent.rgb, vec3(1.0), 0.4), clamp(rim * 0.46, 0.0, 0.5));
  vec3 c = mix(spectrum, brand, u_brandMix);
  c = mix(u_colorBack.rgb, c, smoothstep(0.015, 0.3, l));
  // Gentle edge falloff preserves the chosen ground on light and dark palettes.
  return mix(c, u_colorBack.rgb, 0.2 * smoothstep(0.4, 1.65, length(p)));
}
`;
    var CUSTOM_SHADERS = {
      silkFlowFragmentShader: FLUX_HEADER + `
void main() {
  vec2 p = v_objectUV * 2.0;
  vec2 q = turn(-0.45) * p;
  float t = u_time * 0.24;
  // Nested displacement makes broad folds curl into finer silk filaments.
  for (int i = 0; i < 4; i++) {
    float f = float(i);
    q += (0.18 + u_intensity * 0.22) / (1.0 + f * 0.5)
      * sin(q.yx * (1.7 + f * 0.65) + vec2(t, -t * 0.7) + f * 1.6);
    q = turn(0.16) * q;
  }
  float fold = q.y * (5.0 + u_density * 9.0) + sin(q.x * 2.1 + t) * 1.7;
  fold += 0.45 * sin(fold * 0.65 + q.x * 2.3 - t);
  float crest = 0.5 + 0.5 * sin(fold);
  float satin = pow(crest, 1.7);
  float threadPhase = fold * 7.0 + q.x * 4.0;
  float thread = pow(0.5 + 0.5 * sin(threadPhase), 10.0) * smoothstep(0.15, 0.8, crest);
  thread *= 1.0 - smoothstep(0.6, 2.0, fwidth(threadPhase));
  float rim = pow(crest, 48.0) + thread * 0.4;
  float light = 0.09 + satin * (0.58 + u_intensity * 0.2) + thread * 0.09;
  fragColor = vec4(finish(light, q.x * 0.16 + t * 0.035, rim, p), 1.0);
}
`,
      prismBloomFragmentShader: FLUX_HEADER + `
void main() {
  vec2 p = v_objectUV * 2.0;
  float t = u_time * 0.2;
  float r = length(p);
  float petals = floor(5.0 + u_density * 7.0);
  float wedge = TAU / petals;
  float angle = atan(p.y, p.x) + t * 0.16;
  float folded = abs(mod(angle + wedge * 0.5, wedge) - wedge * 0.5);
  vec2 q = r * vec2(cos(folded), sin(folded));
  // Mirrored curved facets open and close around a luminous centre.
  float curve = length(q - vec2(0.6 + 0.15 * sin(t), 0.34));
  float phase = curve * (13.0 + u_density * 9.0) - t * 1.2
    + sin(r * 5.0 - t) * (0.5 + u_intensity * 1.8);
  float facet = 0.5 + 0.5 * cos(phase);
  float beams = pow(0.5 + 0.5 * cos(folded * petals), 6.0);
  float etchPhase = q.y * 48.0 + sin(q.x * 12.0 - t) * 2.0;
  float etch = pow(0.5 + 0.5 * cos(etchPhase), 18.0) * pow(facet, 4.0);
  etch *= 1.0 - smoothstep(0.6, 2.0, fwidth(etchPhase));
  float rim = pow(facet, 28.0) * (0.4 + beams * 0.6) + etch * 0.6;
  float halo = exp(-r * r * 2.2);
  float light = 0.06 + pow(facet, 3.0) * (0.4 + u_intensity * 0.28)
    + halo * 0.15 + beams * 0.09;
  fragColor = vec4(finish(light, r * 0.22 - t * 0.06, rim, p), 1.0);
}
`,
      liquidContoursFragmentShader: FLUX_HEADER + `
float terrain(vec2 p, float t) {
  float h = 0.0;
  float amplitude = 0.55;
  for (int i = 0; i < 4; i++) {
    p += sin(p.yx * 1.2 + t * 0.3) * (0.2 + u_intensity * 0.35);
    h += amplitude * sin(p.x + t) * cos(p.y - t * 0.6);
    p = turn(0.83) * p * 1.85 + 1.4;
    amplitude *= 0.45;
  }
  return h;
}
void main() {
  vec2 p = v_objectUV * 2.0;
  float t = u_time * 0.22;
  float h = terrain(p * 1.65, t);
  float bands = h * (7.0 + u_density * 15.0) + t * 0.45;
  float ridge = 0.5 + 0.5 * sin(bands);
  float width = max(fwidth(bands), 0.015);
  float line = 1.0 - smoothstep(0.035, 0.035 + width * 1.3, abs(cos(bands)));
  // Screen-space slope gives the contours a metallic, embossed edge.
  vec2 slope = vec2(dFdx(h), dFdy(h)) / max(length(fwidth(p)), 0.0001);
  vec3 normal = normalize(vec3(-slope * 1.4, 1.0));
  float shine = pow(max(dot(normal, normalize(vec3(-0.5, 0.7, 1.0))), 0.0), 12.0);
  float light = 0.12 + ridge * 0.34 + h * 0.12 + shine * (0.2 + u_intensity * 0.25);
  fragColor = vec4(finish(light, h * 0.32 + t * 0.04, line * 0.55 + shine * 0.6, p), 1.0);
}
`,
    };
// === /lolly:shared backdrop-shaders ===
