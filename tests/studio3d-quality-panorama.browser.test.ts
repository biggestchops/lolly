// SPDX-License-Identifier: MPL-2.0
/**
 * 3D Studio: a painted environment points one way everywhere.
 *
 * A painted environment reaches the picture three ways: its lamps and painted pixels are
 * filtered into the lighting map that the subject reflects, and the raw painting is the
 * crisp background at zero blur. Each path can use its own longitude convention, so this
 * suite renders a mirror sphere in the desert and measures four directions in world space:
 *   - the reflected lamp: the brightest highlight on the sphere;
 *   - the reflected painted sun: the warm glow in the sphere's reflection of the sky;
 *   - the background sun: the brightest part of the crisp background;
 *   - the lamp as environment.ts places it, lamp(43, 34).
 * They must agree within 10 degrees, and turning the environment by 90 degrees must turn all
 * of them together. The lamp outshines the painted sun, so the highlight alone could not see
 * a lighting map whose painted pixels face the wrong way; the warm glow can.
 *
 * The pushed 3D Studio 0.4 code fails this: the lighting map mirrors the painted pixels, so
 * the reflected painted sun is about 96 degrees from the lamp. The correction (environment.ts
 * stores the painting in the layout three's lookup reads) changes pushed painted-environment
 * output, so it waits for the maintainer's answer to question Q6 of plan 265. Until then the
 * case is a todo: Node still runs it and prints every measure, but a failure does not fail the
 * run. When Q6 is accepted, the correction goes in with CORRECTIONS['painted-environment'] in
 * studio3d-compat.browser.test.ts, and the todo option comes off.
 *
 * Directions are measured from the rendered pixels with the scene's own camera
 * (studioCamera) and the placed sphere (loadStudioSource and placeStudioScene), both
 * evaluated in the page. Longitudes are reported as place() writes them: atan2(x, z).
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  type StudioFrame,
  type StudioHarness,
  saveShot,
  startStudioHarness,
  studioSkip,
} from './helpers/studio3d-browser.ts';

type Vec3 = [number, number, number];

interface PanoramaView {
  /** Camera position, world matrix and inverse projection, column by column. */
  position: Vec3;
  world: number[];
  projectionInverse: number[];
  /** The placed sphere in world space. */
  center: Vec3;
  radius: number;
}

declare global {
  interface Window {
    /** The scene camera and placed sphere for a set of studio values (this suite's page helper). */
    panoramaView?: (
      values: Record<string, unknown>,
      width: number,
      height: number
    ) => Promise<PanoramaView>;
  }
}

const pageHelper = `
import { Group as PanoramaGroup } from 'three';
import { buildStudioScene as panoramaRecipe } from './engine/src/studio3d.ts';
import { studioSceneObjects as panoramaObjects } from './engine/src/studio3d-arrangement.ts';
import { studioCamera as panoramaCamera } from './shells/web/src/lib/studio3d/stage.ts';
import { placeStudioScene as panoramaPlace } from './shells/web/src/lib/studio3d/camera.ts';
import { loadStudioSource as panoramaSource } from './shells/web/src/lib/studio3d/source.ts';
window.panoramaView = async (values, width, height) => {
  const recipe = panoramaRecipe({ version: 1, values: { ...studioDefaults, ...values } });
  const camera = panoramaCamera(recipe, width / height);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  const asset = await panoramaSource(recipe, read, new AbortController().signal);
  try {
    const root = new PanoramaGroup();
    root.add(asset.object);
    panoramaPlace(root, [{ object: asset.object, spec: panoramaObjects(recipe)[0] }], recipe);
    let sphere = null;
    asset.object.traverse((node) => {
      if (sphere || !node.isMesh) return;
      node.geometry.computeBoundingSphere();
      sphere = node.geometry.boundingSphere.clone().applyMatrix4(node.matrixWorld);
    });
    if (!sphere) throw new Error('The sphere has no mesh.');
    return {
      position: camera.position.toArray(),
      world: camera.matrixWorld.toArray(),
      projectionInverse: camera.projectionMatrixInverse.toArray(),
      center: sphere.center.toArray(),
      radius: sphere.radius,
    };
  } finally {
    asset.dispose();
  }
};
`;

/** The desert's sun lamp, lamp(scene, 43, 34, ...) in environment.ts. */
const LAMP = { lon: 43, lat: 34 };
const TOLERANCE_DEGREES = 10;
const SIZE = 256;
/** Why the case is a todo; remove the option from the case once Q6 is answered. */
const AWAITING_Q6 =
  'plan 265 Q6: the orientation correction changes pushed 0.4 painted environments and waits for acceptance';

const rad = (degrees: number) => (degrees * Math.PI) / 180;
const deg = (radians: number) => (radians * 180) / Math.PI;
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: Vec3): Vec3 => {
  const length = Math.hypot(...a);
  return [a[0] / length, a[1] / length, a[2] / length];
};
const along = (origin: Vec3, d: Vec3, t: number): Vec3 => [
  origin[0] + d[0] * t,
  origin[1] + d[1] * t,
  origin[2] + d[2] * t,
];
/** A direction from a longitude and latitude in degrees, as place() in environment.ts builds it. */
const place = (lon: number, lat: number): Vec3 => [
  Math.sin(rad(lon)) * Math.cos(rad(lat)),
  Math.sin(rad(lat)),
  Math.cos(rad(lon)) * Math.cos(rad(lat)),
];
const lonOf = (d: Vec3) => deg(Math.atan2(d[0], d[2]));
const latOf = (d: Vec3) => deg(Math.asin(Math.max(-1, Math.min(1, d[1]))));
const angle = (a: Vec3, b: Vec3) =>
  deg(Math.acos(Math.max(-1, Math.min(1, dot(unit(a), unit(b))))));
const wrap = (degrees: number) => ((((degrees + 180) % 360) + 360) % 360) - 180;
/** Turns a direction about +y the way environmentRotation turns the map. */
const turn = (d: Vec3, degrees: number) => place(lonOf(d) + degrees, latOf(d));
const label = (d: Vec3 | null) =>
  d ? `lon ${lonOf(d).toFixed(1)}, lat ${latOf(d).toFixed(1)}` : 'not found';

/** Applies a column-major 4x4 matrix to a point, with the perspective divide. */
function apply(e: number[], [x, y, z]: Vec3): Vec3 {
  const w = 1 / (e[3]! * x + e[7]! * y + e[11]! * z + e[15]!);
  return [
    (e[0]! * x + e[4]! * y + e[8]! * z + e[12]!) * w,
    (e[1]! * x + e[5]! * y + e[9]! * z + e[13]!) * w,
    (e[2]! * x + e[6]! * y + e[10]! * z + e[14]!) * w,
  ];
}

/** Every pixel of a frame as a world ray, split into the sphere's reflections and the background. */
function classify(frame: StudioFrame, view: PanoramaView) {
  const reflections: { d: Vec3; lum: number; warm: number }[] = [];
  const background: { d: Vec3; lum: number; warm: number }[] = [];
  for (let y = 0; y < frame.height; y++)
    for (let x = 0; x < frame.width; x++) {
      const ndc: Vec3 = [
        ((x + 0.5) / frame.width) * 2 - 1,
        1 - ((y + 0.5) / frame.height) * 2,
        0.5,
      ];
      const d = unit(sub(apply(view.world, apply(view.projectionInverse, ndc)), view.position));
      const i = (y * frame.width + x) * 4;
      const [r, g, b] = [frame.pixels[i]!, frame.pixels[i + 1]!, frame.pixels[i + 2]!];
      const sample = { lum: r + g + b, warm: r - b };
      const toCentre = sub(view.center, view.position);
      const closest = dot(toCentre, d);
      const miss = Math.sqrt(Math.max(0, dot(toCentre, toCentre) - closest * closest));
      if (miss < view.radius) {
        const t = closest - Math.sqrt(view.radius ** 2 - miss ** 2);
        const n = unit(sub(along(view.position, d, t), view.center));
        // Grazing pixels mix the rim with the background; keep the face of the sphere.
        if (-dot(d, n) < 0.3) continue;
        const k = 2 * dot(d, n);
        reflections.push({
          ...sample,
          d: unit([d[0] - k * n[0], d[1] - k * n[1], d[2] - k * n[2]]),
        });
      } else if (miss > view.radius * 1.15) background.push({ ...sample, d });
    }
  return { reflections, background };
}

/** The mean direction of the brightest pixels (within 3% of the brightest). */
function brightest(samples: { d: Vec3; lum: number }[]): Vec3 | null {
  let top = 0;
  for (const s of samples) top = Math.max(top, s.lum);
  const sum: Vec3 = [0, 0, 0];
  let count = 0;
  for (const s of samples)
    if (s.lum >= top * 0.97) {
      for (const k of [0, 1, 2] as const) sum[k] += s.d[k];
      count++;
    }
  return count ? unit(sum) : null;
}

/**
 * The warm glow of the painted sun in the sky band from 20 to 50 degrees up. The sky there is
 * blue, so red minus blue picks out the sun; each pixel counts by how far it rises above the
 * midpoint between the band's median and its warmest value.
 */
function warmGlow(samples: { d: Vec3; warm: number }[]): Vec3 | null {
  const band = samples.filter((s) => latOf(s.d) > 20 && latOf(s.d) < 50);
  if (!band.length) return null;
  const warmth = band.map((s) => s.warm).sort((a, b) => a - b);
  const median = warmth[Math.floor(warmth.length / 2)]!,
    top = warmth[warmth.length - 1]!;
  // A band with no glow has no sun to find.
  if (top - median < 20) return null;
  const cut = (median + top) / 2;
  const sum: Vec3 = [0, 0, 0];
  for (const s of band)
    if (s.warm > cut) for (const k of [0, 1, 2] as const) sum[k] += s.d[k] * (s.warm - cut);
  return unit(sum);
}

let harness: StudioHarness | undefined;

describe('3D Studio painted environment orientation', { skip: studioSkip }, () => {
  before(async () => {
    harness = await startStudioHarness({ size: SIZE, extraSource: pageHelper });
  });
  after(async () => {
    await harness?.close();
  });

  it('reflects and shows the desert sun where its lamp is, and turns all of them together', {
    todo: AWAITING_Q6,
  }, async () => {
    if (!harness) throw new Error('The 3D Studio harness did not start.');
    const page = await harness.open();
    try {
      const base = {
        source: 'primitive',
        primitive: 'sphere',
        finishA: 'chrome',
        colorA: '#ffffff',
        environment: 'desert',
        environmentBackground: true,
        environmentBlur: 0,
        environmentIntensity: 1,
        outputMode: 'scene',
        // The environment alone lights the mirror: one custom light at zero strength, so no
        // direct highlight competes with the lamp's reflection.
        studio: 'custom',
        lights: [{ kind: 'directional', intensity: 0, shadows: false }],
      };
      const measured: Record<number, Record<string, Vec3>> = {};
      // Every disagreement is gathered before the case fails, so a run reports both rotations.
      const problems: string[] = [];
      for (const rotation of [0, 90]) {
        const lamp = place(LAMP.lon + rotation, LAMP.lat);
        const measure = async (name: string, camera: Record<string, number>) => {
          const values = { ...base, environmentRotation: rotation, camera };
          const frame = await harness!.render(page, values);
          assert.equal(frame.state, 'ready', frame.info);
          const view = await page.evaluate(([v, w, h]) => window.panoramaView!(v, w, h), [
            values,
            frame.width,
            frame.height,
          ] as const);
          await saveShot(`panorama-desert-r${rotation}-${name}.png`, frame.png);
          return classify(frame, view);
        };
        // From 90 degrees beside the lamp, the sphere shows the lamp and the sky around it
        // well inside its outline.
        const side = await measure('reflection', {
          azimuth: wrap(LAMP.lon + rotation + 90),
          elevation: 14,
        });
        // Looking 17 degrees beside the lamp and up from below the horizon, with a wide lens,
        // the painted sun is in view and clear of the sphere.
        const sky = await measure('background', {
          azimuth: wrap(LAMP.lon + rotation + 180 + 17),
          elevation: -20,
          fov: 80,
          zoom: 0.5,
        });
        const found = {
          'reflected lamp': brightest(side.reflections),
          'reflected painted sun': warmGlow(side.reflections),
          'background sun': brightest(sky.background),
          lamp,
        };
        const report = Object.entries(found)
          .map(([name, d]) => `${name}: ${label(d)}`)
          .join('; ');
        console.log(`rotation ${rotation}: ${report}`);
        const directions: Record<string, Vec3> = {};
        for (const [name, d] of Object.entries(found)) {
          if (d) directions[name] = d;
          else problems.push(`rotation ${rotation}: the ${name} was not found (${report})`);
        }
        const names = Object.keys(directions);
        for (const [i, a] of names.entries())
          for (const b of names.slice(i + 1)) {
            const apart = angle(directions[a]!, directions[b]!);
            console.log(`rotation ${rotation}: ${a} to ${b}: ${apart.toFixed(1)} degrees`);
            if (apart > TOLERANCE_DEGREES)
              problems.push(
                `rotation ${rotation}: the ${a} and the ${b} are ${apart.toFixed(1)} degrees apart (${report})`
              );
          }
        measured[rotation] = directions;
      }
      for (const name of Object.keys(measured[0]!)) {
        const [from, to] = [measured[0]![name], measured[90]![name]];
        if (!from || !to) continue;
        const turned = angle(turn(from, 90), to);
        console.log(`the ${name} turned ${turned.toFixed(1)} degrees away from a 90 degree turn`);
        if (turned > TOLERANCE_DEGREES)
          problems.push(
            `the ${name} turned ${turned.toFixed(1)} degrees away from a 90 degree turn`
          );
      }
      assert.deepEqual(problems, []);
      assert.deepEqual(harness.errors, []);
    } finally {
      await page.close();
    }
  });
});
