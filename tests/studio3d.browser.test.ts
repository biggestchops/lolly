// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { Page } from 'playwright';
import {
  type StudioHarness,
  type StudioValues,
  startStudioHarness,
  studioSkip,
} from './helpers/studio3d-browser.ts';

let harness: StudioHarness | undefined;

function studio(): StudioHarness {
  if (!harness) throw new Error('The 3D Studio harness did not start.');
  return harness;
}

const open = () => studio().open();
const render = (page: Page, values: StudioValues) => studio().render(page, values);

describe('3D Studio actual renderer', { skip: studioSkip }, () => {
  before(async () => {
    harness = await startStudioHarness();
  });
  after(async () => {
    await harness?.close();
  });

  it('renders real geometry, reuses its canvas and source, and keeps alpha shadows bounded', async () => {
    const page = await open();
    try {
      const source = { source: 'artwork', artwork: { url: '/fixture.svg' }, shadowOpacity: 0.4 };
      const object = await render(page, { ...source, outputMode: 'object' });
      const shadow = await render(page, { ...source, outputMode: 'object-shadow' });
      assert.equal(object.width, 360);
      assert.equal(shadow.state, 'ready');
      assert.equal(shadow.reads, 1);
      assert.equal(shadow.reused, true);
      let solid = 0,
        clear = 0,
        shadowPixels = 0,
        maxShadow = 0;
      for (let i = 0; i < shadow.pixels.length; i += 4) {
        if (object.pixels[i + 3] === 255) solid++;
        if (shadow.pixels[i + 3] === 0) clear++;
        if (object.pixels[i + 3] === 0 && shadow.pixels[i + 3]! > 2) {
          shadowPixels++;
          maxShadow = Math.max(maxShadow, shadow.pixels[i + 3]!);
        }
      }
      assert.ok(
        solid > 1000 && clear > 1000 && shadowPixels > 100,
        JSON.stringify({ solid, clear, shadowPixels })
      );
      assert.ok(maxShadow <= 104, `Shadow alpha ${maxShadow} exceeds its 40% opacity`);
      const surfaced = await render(page, {
        ...source,
        outputMode: 'object-shadow',
        surfaceFinishes: true,
        faceFinishA: 'matte',
        bevelFinishA: 'metal',
        sideFinishA: 'metal',
        faceFinishB: 'enamel',
      });
      assert.notEqual(surfaced.png, shadow.png);
      assert.equal(surfaced.reads, 1);
      const again = await render(page, { ...source, outputMode: 'object-shadow' });
      assert.equal(again.png, shadow.png);
      const different = await render(page, {
        ...source,
        outputMode: 'object-shadow',
        studio: 'warm',
      });
      assert.notEqual(different.png, shadow.png);
      assert.equal(different.reads, 1);
      if (process.env.STUDIO_SHOTS) {
        await mkdir(process.env.STUDIO_SHOTS, { recursive: true });
        await writeFile(
          join(process.env.STUDIO_SHOTS, 'alpha.png'),
          Buffer.from(shadow.png.split(',')[1]!, 'base64')
        );
      }
    } finally {
      await page.close();
    }
  });

  it('renders a textured GLB and changes actual depth of field and material pixels', async () => {
    const page = await open();
    try {
      const model = await render(page, {
        source: 'model',
        upload: { url: '/duck.glb', name: 'duck.glb' },
      });
      assert.equal(model.state, 'ready');
      const sharp = await render(page, {
        source: 'primitive',
        atmosphere: true,
        materialMode: 'pair',
        colorB: '#90ebcd',
      });
      const depth = await render(page, {
        source: 'primitive',
        atmosphere: true,
        depthOfField: true,
        aperture: 0.18,
        materialMode: 'pair',
        colorB: '#90ebcd',
      });
      assert.notEqual(sharp.png, depth.png);
      assert.notEqual(depth.png, model.png);
      const plain = await render(page, { source: 'primitive', floor: 'cove' });
      assert.equal(plain.state, 'ready');
      if (process.env.STUDIO_SHOTS) {
        await mkdir(process.env.STUDIO_SHOTS, { recursive: true });
        for (const [name, frame] of [
          ['model', model],
          ['depth', depth],
          ['cove', plain],
        ] as const)
          await writeFile(
            join(process.env.STUDIO_SHOTS, name + '.png'),
            Buffer.from(frame.png.split(',')[1]!, 'base64')
          );
      }
    } finally {
      await page.close();
    }
  });

  it('rejects broken sources and stale loads without exporting a placeholder', async () => {
    const page = await open();
    try {
      await assert.rejects(
        render(page, { source: 'model', upload: { url: '/bad.glb', name: 'bad.glb' } }),
        /incomplete|self-contained/
      );
      await assert.rejects(
        page.evaluate(() => window.studioTest!.prepare()),
        /incomplete|self-contained/
      );
      assert.equal(await page.evaluate(() => window.studioTest!.race()), 'ready');
      await page.evaluate(() => window.studioTest!.destroy());
      assert.equal(await page.locator('canvas').count(), 0);
    } finally {
      await page.close();
    }
  });

  it('renders ASCII and binary STL consistently and samples turntable frames reproducibly', async () => {
    const page = await open();
    try {
      const ascii = await render(page, {
        source: 'model',
        modelAsset: { url: '/tetra.stl', name: 'tetra.stl' },
      });
      const binary = await render(page, {
        source: 'model',
        modelAsset: { url: '/binary.stl', name: 'binary.stl' },
      });
      assert.equal(ascii.png, binary.png);
      assert.match(binary.info, /print dimensions are not inferred/);
      await render(page, { source: 'primitive', motion: 'turntable', duration: 5 });
      const at = (t: number) => page.evaluate((t) => window.studioTest!.sample(t), t);
      const first = await at(0.25),
        next = await at(0.5),
        repeated = await at(0.25);
      assert.notEqual(first, next);
      assert.equal(first, repeated);
      for (const lightMotion of ['orbit', 'breathe']) {
        await render(page, {
          source: 'primitive',
          motion: 'still',
          lightMotion,
          lightMotionAmount: 0.6,
          duration: 5,
        });
        const start = await at(0),
          moving = await at(0.25),
          again = await at(0.25),
          end = await at(1);
        assert.notEqual(moving, start, `${lightMotion} must change the actual lighting`);
        assert.equal(moving, again, `${lightMotion} must reproduce the same frame`);
        assert.equal(start, end, `${lightMotion} must close the loop`);
      }
    } finally {
      await page.close();
    }
  });

  it('arranges SVG, GLB and STL objects in one scene, sharing loads and keeping objects independent', async () => {
    const page = await open();
    try {
      const objects = [
        { name: 'Badge', kind: 'artwork', asset: { url: '/fixture.svg' }, x: -1.3, scale: 0.55 },
        { name: 'Duck', kind: 'model', asset: { url: '/duck.glb', name: 'duck.glb' }, x: 1.2, scale: 0.6, rotY: -30 },
        { name: 'Part', kind: 'model', asset: { url: '/tetra.stl', name: 'tetra.stl' }, x: 0.3, z: -2.6, scale: 0.4 },
      ];
      const base = { source: 'arrangement', outputMode: 'object-shadow', shadowOpacity: 0.4 };
      const first = await render(page, { ...base, objects });
      assert.equal(first.state, 'ready');
      assert.equal(first.reads, 3, 'each distinct source is read once');
      assert.match(first.info, /3 of 3 objects visible/);
      assert.match(first.info, /Part: STL has no standard units/);
      // A fourth object that reuses the badge shares its loaded geometry: no new read.
      const twin = { name: 'Twin', kind: 'artwork', asset: { url: '/fixture.svg' }, x: 0, z: 1.4, scale: 0.35, rotY: 40 };
      const four = await render(page, { ...base, objects: [...objects, twin] });
      assert.equal(four.reads, 3);
      assert.match(four.info, /4 of 4 objects visible/);
      assert.notEqual(four.png, first.png);
      // Hiding one object changes the picture and the count; the row itself stays.
      const hidden = await render(page, {
        ...base,
        objects: [...objects, { ...twin, visible: false }],
      });
      assert.match(hidden.info, /3 of 4 objects visible/);
      assert.equal(hidden.png, first.png, 'a hidden object contributes nothing');
      // A row that still has no file waits: the others render, the notes name it, and
      // selection keeps addressing rows, not loaded objects.
      const waiting = await render(page, {
        ...base,
        activeObject: 3,
        objects: [{ name: 'Later', kind: 'model' }, ...objects],
      });
      assert.equal(waiting.state, 'ready');
      assert.match(waiting.info, /3 of 4 objects visible/);
      assert.match(waiting.info, /Later: no file yet\. Choose a GLB or STL model/);
      assert.match(waiting.info, /Selected object slots: 1: Material/, 'the third row is the duck');
      assert.equal(waiting.reads, 3);
      // Overlap guidance names both objects; touching objects are not reported.
      const stacked = await render(page, {
        ...base,
        objects: [objects[0], { ...objects[0], name: 'Copy', x: -1.2 }],
      });
      assert.match(stacked.info, /Badge and Copy overlap by about \d+%/);
      assert.doesNotMatch(first.info, /overlap/);
      // Alpha stays bounded across several shadow casters and clear pixels remain.
      let clear = 0,
        maxShadow = 0,
        solid = 0;
      const object = await render(page, { ...base, objects, outputMode: 'object' });
      for (let i = 0; i < four.pixels.length; i += 4) {
        if (first.pixels[i + 3] === 0) clear++;
        if (object.pixels[i + 3] === 255) solid++;
        if (object.pixels[i + 3] === 0 && first.pixels[i + 3]! > 2)
          maxShadow = Math.max(maxShadow, first.pixels[i + 3]!);
      }
      assert.ok(clear > 1000 && solid > 1000, JSON.stringify({ clear, solid }));
      assert.ok(maxShadow > 0 && maxShadow <= 104, `Shadow alpha ${maxShadow}`);
      // The same arrangement reproduces exactly; a group turntable turns about the footprint.
      const again = await render(page, { ...base, objects });
      assert.equal(again.png, first.png);
      await render(page, { ...base, objects, motion: 'turntable', duration: 5 });
      const at = (t: number) => page.evaluate((t) => window.studioTest!.sample(t), t);
      const quarter = await at(0.25),
        half = await at(0.5),
        repeat = await at(0.25);
      assert.notEqual(quarter, half);
      assert.equal(quarter, repeat);
      // A broken object names itself and the arrangement does not export a placeholder.
      await assert.rejects(
        render(page, {
          ...base,
          objects: [objects[0], { name: 'Broken', kind: 'model', asset: { url: '/bad.glb', name: 'bad.glb' } }],
        }),
        /Broken: The GLB file is incomplete/
      );
      await assert.rejects(page.evaluate(() => window.studioTest!.prepare()), /Broken: /);
      if (process.env.STUDIO_SHOTS) {
        await mkdir(process.env.STUDIO_SHOTS, { recursive: true });
        await writeFile(
          join(process.env.STUDIO_SHOTS, 'arrangement.png'),
          Buffer.from(four.png.split(',')[1]!, 'base64')
        );
        const scene = await render(page, { ...base, objects: [...objects, twin], outputMode: 'scene', atmosphere: true });
        await writeFile(
          join(process.env.STUDIO_SHOTS, 'arrangement-scene.png'),
          Buffer.from(scene.png.split(',')[1]!, 'base64')
        );
      }
    } finally {
      await page.close();
    }
  });

  it('lights and reflects imported .hdr and .exr radiance maps, turns them, and refuses display images', async () => {
    const page = await open();
    try {
      // A polished metal sphere lit by the environment alone: one custom light at zero strength.
      const base = {
        source: 'primitive',
        primitive: 'sphere',
        materialMode: 'pair',
        colorA: '#e6e6e6',
        finishA: 'metal',
        studio: 'custom',
        lights: [{ kind: 'directional', color: '#ffffff', x: 0, y: 6, z: 4, intensity: 0, size: 1, shadows: false }],
        outputMode: 'object',
        environmentIntensity: 1,
        camera: { azimuth: 0, elevation: 0, fov: 29, zoom: 1 },
      };
      const sides = (frame: { pixels: number[]; width: number; height: number }) => {
        const sums = [0, 0],
          counts = [0, 0];
        for (let y = 0; y < frame.height; y++)
          for (let x = 0; x < frame.width; x++) {
            const i = (y * frame.width + x) * 4;
            if (frame.pixels[i + 3] !== 255) continue;
            const side = x < frame.width / 2 ? 0 : 1;
            sums[side]! += frame.pixels[i]! + frame.pixels[i + 1]! + frame.pixels[i + 2]!;
            counts[side]!++;
          }
        return [sums[0]! / Math.max(1, counts[0]!), sums[1]! / Math.max(1, counts[1]!), counts[0]!, counts[1]!];
      };
      const hdr = await render(page, {
        ...base,
        environment: 'image',
        environmentImage: { url: '/light.hdr', id: 'light.hdr' },
      });
      assert.equal(hdr.state, 'ready');
      assert.doesNotMatch(hdr.info, /twice as wide as tall/, 'a 2:1 map needs no stretch note');
      const [left, right, leftCount, rightCount] = sides(hdr);
      assert.ok(Math.abs(left! - right!) > 25, `the lit side must read: ${left} vs ${right} (${leftCount}/${rightCount} opaque pixels, info ${hdr.info})`);
      const turned = await render(page, {
        ...base,
        environment: 'image',
        environmentImage: { url: '/light.hdr', id: 'light.hdr' },
        environmentRotation: 180,
      });
      const [turnedLeft, turnedRight] = sides(turned);
      assert.ok(
        Math.sign(left! - right!) === -Math.sign(turnedLeft! - turnedRight!),
        `turning the map swaps the lit side: ${[left, right, turnedLeft, turnedRight]}`
      );
      const exr = await render(page, {
        ...base,
        environment: 'image',
        environmentImage: { url: '/light.exr', id: 'light.exr' },
      });
      const [exrLeft, exrRight] = sides(exr);
      assert.equal(Math.sign(exrLeft! - exrRight!), Math.sign(left! - right!));
      assert.ok(Math.abs(exrLeft! - left!) < 12 && Math.abs(exrRight! - right!) < 12, `EXR matches HDR: ${[exrLeft, exrRight, left, right]}`);
      // Generated studios each light differently and reproduce exactly.
      const room = await render(page, { ...base, environment: 'room' });
      const softbox = await render(page, { ...base, environment: 'softbox' });
      const window = await render(page, { ...base, environment: 'window' });
      assert.notEqual(room.png, softbox.png);
      assert.notEqual(softbox.png, window.png);
      assert.equal((await render(page, { ...base, environment: 'window' })).png, window.png);
      // The map shows behind a scene image only; transparent output never draws it.
      const shown = await render(page, {
        ...base,
        outputMode: 'scene',
        environment: 'image',
        environmentImage: { url: '/light.hdr', id: 'light.hdr' },
        environmentBackground: true,
      });
      const plain = await render(page, {
        ...base,
        outputMode: 'scene',
        environment: 'image',
        environmentImage: { url: '/light.hdr', id: 'light.hdr' },
      });
      assert.notEqual(shown.png, plain.png);
      let clear = 0;
      for (let i = 3; i < shown.pixels.length; i += 4) if (shown.pixels[i] === 0) clear++;
      assert.equal(clear, 0, 'a scene image with the map behind it is fully opaque');
      const cutout = await render(page, {
        ...base,
        environment: 'image',
        environmentImage: { url: '/light.hdr', id: 'light.hdr' },
        environmentBackground: true,
      });
      clear = 0;
      for (let i = 3; i < cutout.pixels.length; i += 4) if (cutout.pixels[i] === 0) clear++;
      assert.ok(clear > 1000, 'transparent output keeps the map for lighting only');
      assert.equal(plain.reads, shown.reads, 'the same map is decoded once while it stays selected');
      await assert.rejects(
        render(page, {
          ...base,
          environment: 'image',
          environmentImage: { url: '/fixture.svg', id: 'photo.svg' },
        }),
        /display image and cannot light a scene/
      );
      if (process.env.STUDIO_SHOTS) {
        await mkdir(process.env.STUDIO_SHOTS, { recursive: true });
        for (const [name, frame] of [['hdr', hdr], ['hdr-turned', turned], ['hdr-scene', shown], ['window', window]] as const)
          await writeFile(join(process.env.STUDIO_SHOTS, `environment-${name}.png`), Buffer.from(frame.png.split(',')[1]!, 'base64'));
      }
    } finally {
      await page.close();
    }
  });

  it('fills the depth with copies of the subject or spheres, spread by a seeded, reproducible amount', async () => {
    const page = await open();
    try {
      const base = { source: 'artwork', artwork: { url: '/fixture.svg' }, atmosphere: true, depthOfField: true, aperture: 0.14 };
      const copies = await render(page, base);
      const spheres = await render(page, { ...base, atmosphereForms: 'spheres' });
      assert.notEqual(copies.png, spheres.png, 'copies and spheres are different pictures');
      const near = await render(page, { ...base, atmosphereSpread: 0 });
      const far = await render(page, { ...base, atmosphereSpread: 1 });
      assert.notEqual(near.png, far.png, 'the spread moves the forms');
      assert.notEqual(near.png, copies.png);
      const fewer = await render(page, { ...base, atmosphereCount: 2 });
      assert.notEqual(fewer.png, copies.png);
      const reseeded = await render(page, { ...base, seed: 77 });
      assert.notEqual(reseeded.png, copies.png);
      assert.equal((await render(page, base)).png, copies.png, 'the same seed reproduces the forms');
      // Transparent outputs keep the subject alone: no copy reaches a cutout.
      const cutout = await render(page, { ...base, outputMode: 'object' });
      const plain = await render(page, { ...base, atmosphere: false, outputMode: 'object' });
      assert.equal(cutout.png, plain.png);
      if (process.env.STUDIO_SHOTS) {
        await mkdir(process.env.STUDIO_SHOTS, { recursive: true });
        for (const [name, frame] of [['copies', copies], ['copies-far', far], ['spheres', spheres]] as const)
          await writeFile(join(process.env.STUDIO_SHOTS, `atmosphere-${name}.png`), Buffer.from(frame.png.split(',')[1]!, 'base64'));
      }
    } finally {
      await page.close();
    }
  });

  it('sets words in a brand font as extruded objects, alone and in an arrangement', async () => {
    const page = await open();
    try {
      const words = await render(page, { source: 'text', words: 'AB', wordFont: 'display', wordWeight: 800, outputMode: 'object' });
      assert.equal(words.state, 'ready');
      assert.match(words.info, /1: paint:words/);
      let solid = 0;
      for (let i = 3; i < words.pixels.length; i += 4) if (words.pixels[i] === 255) solid++;
      assert.ok(solid > 500, 'the letters are solid geometry');
      const shaped = await page.evaluate(() => window.shaped ?? []);
      assert.deepEqual(shaped[shaped.length - 1], ['AB', 'display', 800, 100]);
      const twoLines = await render(page, { source: 'text', words: 'AB\nCDE', wordAlign: 'right', outputMode: 'object' });
      assert.notEqual(twoLines.png, words.png);
      assert.equal((await render(page, { source: 'text', words: 'AB', wordFont: 'display', wordWeight: 800, outputMode: 'object' })).png, words.png);
      await assert.rejects(render(page, { source: 'text', words: 'AB', wordFont: 'missing' }), /not available on this device/);
      await assert.rejects(render(page, { source: 'text', words: 'AB', __noShaper: true }), /cannot outline text/);
      const mixed = await render(page, {
        source: 'arrangement',
        outputMode: 'object',
        objects: [
          { name: 'Words', kind: 'text', text: 'GO', x: -1.5, scale: 0.6 },
          { name: 'Badge', kind: 'primitive', primitive: 'badge', x: 1.5, scale: 0.5 },
        ],
      });
      assert.match(mixed.info, /2 of 2 objects visible/);
      assert.match(mixed.info, /Selected object slots: 1: paint:words/);
    } finally {
      await page.close();
    }
  });

  it('travels a camera path deterministically and holds the rest view when still', async () => {
    const page = await open();
    try {
      const keys = [
        { at: 0, azimuth: 0, elevation: 10, fov: 30, zoom: 1, panX: 0, panY: 1.6, panZ: 0 },
        { at: 100, azimuth: 120, elevation: 40, fov: 30, zoom: 0.8, panX: 0.4, panY: 1.6, panZ: 0 },
      ];
      const base = { source: 'primitive', outputMode: 'object', duration: 4 };
      const still = await render(page, { ...base, camera: { azimuth: 0, elevation: 10, fov: 30, zoom: 1 } });
      const at = (t: number) => page.evaluate((t) => window.studioTest!.sample(t), t);
      // A clip frame takes the clip sample count, so compare clip frames with clip frames.
      const stillFrame = await at(0);
      await render(page, { ...base, cameraMotion: 'keys', cameraKeys: keys, camera: { azimuth: 77 } });
      const start = await at(0),
        middle = await at(0.5),
        again = await at(0.5),
        end = await at(0.999);
      assert.equal(start, stillFrame, 'the first key is the first frame, not the live camera');
      assert.notEqual(middle, start);
      assert.equal(middle, again, 'a path frame reproduces');
      assert.notEqual(end, middle);
      await render(page, { ...base, cameraMotion: 'keys', cameraKeys: keys, cameraLoop: true, camera: { azimuth: 77 } });
      const loopEnd = await at(0.999);
      assert.notEqual(loopEnd, end, 'a closed loop heads back to the first key');
      const held = await render(page, { ...base, cameraMotion: 'still', cameraKeys: keys, camera: { azimuth: 0, elevation: 10, fov: 30, zoom: 1 } });
      assert.equal(held.png, still.png, 'still keeps the live camera even with keys saved');
    } finally {
      await page.close();
    }
  });

  it('generates painted environments that light, reflect, take the brand colours and show crisp behind the scene', async () => {
    const page = await open();
    try {
      const base = { source: 'primitive', primitive: 'sphere', materialMode: 'pair', finishA: 'chrome', colorA: '#e6e6e6', outputMode: 'object', environmentIntensity: 1 };
      const room = await render(page, { ...base, environment: 'room' });
      const seen = new Map<string, string>([['room', room.png]]);
      for (const kind of ['studio', 'gallery', 'warehouse', 'stage', 'desert', 'synthwave']) {
        const frame = await render(page, { ...base, environment: kind });
        assert.equal(frame.state, 'ready', kind);
        for (const [other, png] of seen) assert.notEqual(frame.png, png, `${kind} differs from ${other}`);
        seen.set(kind, frame.png);
      }
      assert.equal((await render(page, { ...base, environment: 'synthwave' })).png, seen.get('synthwave'), 'a painted map reproduces');
      const recoloured = await render(page, { ...base, environment: 'synthwave', colorB: '#00e5ff' });
      assert.notEqual(recoloured.png, seen.get('synthwave'), 'the brand colours reach the map');
      const stageRecoloured = await render(page, { ...base, environment: 'stage', colorB: '#00e5ff' });
      assert.notEqual(stageRecoloured.png, seen.get('stage'));
      const crisp = await render(page, { ...base, environment: 'synthwave', outputMode: 'scene', environmentBackground: true, environmentBlur: 0 });
      const soft = await render(page, { ...base, environment: 'synthwave', outputMode: 'scene', environmentBackground: true, environmentBlur: 0.4 });
      assert.notEqual(crisp.png, soft.png, 'zero blur shows the painted panorama itself');
      let clear = 0;
      for (let i = 3; i < crisp.pixels.length; i += 4) if (crisp.pixels[i] === 0) clear++;
      assert.equal(clear, 0);
      const cutout = await render(page, { ...base, environment: 'desert', environmentBackground: true });
      clear = 0;
      for (let i = 3; i < cutout.pixels.length; i += 4) if (cutout.pixels[i] === 0) clear++;
      assert.ok(clear > 1000, 'transparent output never draws the environment');
      if (process.env.STUDIO_SHOTS) {
        await mkdir(process.env.STUDIO_SHOTS, { recursive: true });
        for (const [kind, png] of seen) await writeFile(join(process.env.STUDIO_SHOTS, `env-${kind}.png`), Buffer.from(png.split(',')[1]!, 'base64'));
        await writeFile(join(process.env.STUDIO_SHOTS, 'env-synthwave-scene.png'), Buffer.from(crisp.png.split(',')[1]!, 'base64'));
      }
    } finally {
      await page.close();
    }
  });

  it('renders the richer finishes and keeps glass solid in a cutout', async () => {
    const page = await open();
    try {
      const base = { source: 'artwork', artwork: { url: '/fixture.svg' }, materialMode: 'pair', outputMode: 'object', environment: 'studio', environmentIntensity: 1 };
      const satin = await render(page, { ...base, finishA: 'satin', finishB: 'satin' });
      const seen = new Map<string, string>([['satin', satin.png]]);
      for (const finish of ['glow', 'neon', 'velvet', 'glass', 'frosted', 'chrome', 'clay', 'pearl', 'iridescent']) {
        const frame = await render(page, { ...base, finishA: finish, finishB: finish });
        assert.equal(frame.state, 'ready', finish);
        for (const [other, png] of seen) assert.notEqual(frame.png, png, `${finish} differs from ${other}`);
        seen.set(finish, frame.png);
      }
      const glass = await render(page, { ...base, finishA: 'glass', finishB: 'glass' });
      let solid = 0;
      for (let i = 3; i < glass.pixels.length; i += 4) if (glass.pixels[i] === 255) solid++;
      assert.ok(solid > 1000, 'a glass body still holds its alpha');
      assert.match(glass.info, /Glass shows as solid crystal/);
      const seeThrough = await render(page, { ...base, finishA: 'glass', finishB: 'glass', outputMode: 'scene' });
      assert.doesNotMatch(seeThrough.info, /solid crystal/);
      assert.notEqual(seeThrough.png, glass.png);
      const custom = await render(page, { ...base, materialMode: 'custom', materials: [{ slot: '1', color: '#ff4060', finish: 'neon' }] });
      assert.notEqual(custom.png, satin.png);
      if (process.env.STUDIO_SHOTS) {
        await mkdir(process.env.STUDIO_SHOTS, { recursive: true });
        for (const [finish, png] of seen) await writeFile(join(process.env.STUDIO_SHOTS, `finish-${finish}.png`), Buffer.from(png.split(',')[1]!, 'base64'));
      }
    } finally {
      await page.close();
    }
  });

  it('moves preset lights by saved position and keeps the export free of handles', async () => {
    const page = await open();
    try {
      const base = { source: 'primitive', outputMode: 'object', studio: 'dramatic' };
      const before = await render(page, base);
      const moved = await render(page, { ...base, keyPosition: { x: 5, y: 2, z: -4 } });
      assert.notEqual(moved.png, before.png, 'a moved key light changes the picture');
      const rim = await render(page, { ...base, rimPosition: { x: -6, y: 8, z: 2 } });
      assert.notEqual(rim.png, before.png);
      assert.notEqual(rim.png, moved.png);
      assert.equal((await render(page, base)).png, before.png, 'default positions reproduce');
    } finally {
      await page.close();
    }
  });

  it('resamples an export frame at the requested pixel size within the capture limits', async () => {
    const page = await open();
    try {
      await render(page, { source: 'primitive' });
      const resample = (size: { width: number; height: number }) =>
        page.evaluate((size) => window.studioTest!.resample(size), size);
      const large = await resample({ width: 1440, height: 1440 });
      assert.deepEqual(large, { width: 1440, height: 1440, cssWidth: 360, cssHeight: 360 });
      const wide = await resample({ width: 1200, height: 600 });
      assert.deepEqual([wide.width, wide.height], [1200, 600]);
      const capped = await resample({ width: 9000, height: 9000 });
      assert.ok(capped.width <= 4096 && capped.width * capped.height <= 12_000_000, JSON.stringify(capped));
      assert.equal(capped.width, capped.height);
      const back = await resample({ width: 360, height: 360 });
      assert.deepEqual([back.width, back.height], [360, 360]);
    } finally {
      await page.close();
    }
  });

  it('renders the private SUSE fixtures when explicitly requested', {
    skip: !process.env.STUDIO_SUSE && 'STUDIO_SUSE is not set; private SUSE fixtures are opt-in.',
  }, async () => {
    const page = await open();
    try {
      for (const id of ['geeko', 'geeko-branch', 'geeko-sitting']) {
        const frame = await render(page, {
          source: 'model',
          modelAsset: { url: '/geeko/' + id },
          materialMode: 'source',
          outputMode: 'object-shadow',
        });
        assert.equal(frame.state, 'ready');
        assert.ok(frame.pixels.filter((v, i) => i % 4 === 3 && v === 255).length > 500);
        if (process.env.STUDIO_SHOTS)
          await writeFile(
            join(process.env.STUDIO_SHOTS, id + '.png'),
            Buffer.from(frame.png.split(',')[1]!, 'base64')
          );
      }
      for (const id of ['security', 'database', 'linux', 'brain', 'lightbulb', 'network']) {
        const frame = await render(page, {
          source: 'artwork',
          artwork: { url: '/suse/' + id },
          controls: 'expert',
          surfaceFinishes: true,
          faceFinishA: 'matte',
          bevelFinishA: 'enamel',
          sideFinishA: 'metal',
          faceFinishB: 'enamel',
          outputMode: 'object-shadow',
        });
        assert.equal(frame.state, 'ready');
        assert.match(frame.info, /paint:#30ba78/);
        assert.match(frame.info, /paint:#0c322c/);
        if (process.env.STUDIO_SHOTS)
          await writeFile(
            join(process.env.STUDIO_SHOTS, id + '.png'),
            Buffer.from(frame.png.split(',')[1]!, 'base64')
          );
      }
    } finally {
      await page.close();
    }
  });

  it('has no browser or shader errors', () => assert.deepEqual(studio().errors, []));
});
