// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { loadTool } from '../engine/src/loader.ts';
import { createRuntime } from '../engine/src/runtime.ts';
import { buildStudioScene, studioTime } from '../engine/src/studio3d.ts';
import { parseUrlState, serializeUrlState } from '../engine/src/url-mode.ts';
import { baseHost } from './helpers/host.ts';

describe('3D Studio scene contract', () => {
  it('bounds numerical inputs and rejects unknown versions and missing sources', () => {
    const scene = buildStudioScene({
      version: 1,
      values: {
        samples: 100000,
        aperture: -1,
        exposure: Infinity,
        camera: { zoom: 0 },
        depthOfField: true,
      },
    });
    assert.equal(scene.quality.exportSamples, 256);
    assert.equal(scene.camera.aperture, 0.01);
    assert.equal(scene.exposure, 1.1);
    assert.equal(scene.camera.zoom, 0.05);
    assert.throws(() => buildStudioScene({ version: 2 }), /version/);
    assert.throws(
      () => buildStudioScene({ version: 1, values: { source: 'artwork' } }),
      /Choose an SVG/
    );
  });
  it('keeps alpha output separate from the lighting and source settings', () => {
    const beauty = buildStudioScene({
      version: 1,
      values: { source: 'model', upload: { name: 'part.stl', url: 'blob:part' }, studio: 'warm' },
    });
    const cutout = buildStudioScene({
      version: 1,
      values: {
        source: 'model',
        upload: { name: 'part.stl', url: 'blob:part' },
        studio: 'warm',
        outputMode: 'object-shadow',
      },
    });
    assert.equal(cutout.source.kind, 'stl');
    assert.deepEqual(cutout.lights, beauty.lights);
    assert.deepEqual(cutout.materials, beauty.materials);
    assert.equal(cutout.stage.output, 'object-shadow');
  });
  it('does not apply perspective aperture to an orthographic camera', () => {
    assert.equal(
      buildStudioScene({
        version: 1,
        values: { projection: 'orthographic', depthOfField: true, aperture: 0.4 },
      }).camera.aperture,
      0
    );
  });
  it('validates expert material and light declarations', () => {
    assert.throws(
      () => buildStudioScene({ version: 1, values: { materials: [{ slot: '1' }, { slot: '1' }] } }),
      /more than one/
    );
    assert.throws(
      () => buildStudioScene({ version: 1, values: { studio: 'custom', lights: [] } }),
      /at least one/
    );
    const scene = buildStudioScene({
      version: 1,
      values: {
        studio: 'custom',
        lights: [{ kind: 'area', shadows: true, color: '#fe7c3f', x: 4, intensity: 8 }],
      },
    });
    assert.equal(scene.lights[0]!.shadows, false);
    assert.equal(scene.lights[0]!.color, '#fe7c3f');
    assert.equal(scene.lights[0]!.position[0], 4);
  });
  it('samples turntable time independently of the preview clock', () => {
    const scene = buildStudioScene({
      version: 1,
      values: { motion: 'turntable', duration: 10, turnDegrees: 360 },
    });
    assert.equal(studioTime(scene, 0.5, 10), Math.PI);
    assert.equal(studioTime(scene, 1, 5), Math.PI);
    assert.equal(studioTime(scene, 0), 0);
    assert.equal(studioTime(scene, 0.5, 10), Math.PI);
  });
  it('runs the real tool and preserves expert settings through a URL round trip', async () => {
    const tool = await loadTool('3d-studio', (p) => readFile(join('community', p), 'utf8'));
    const host = baseHost({
      assets: { get: async (id: string) => ({ id, url: '/catalog/' + id + '.svg' }) },
    });
    const values = {
      controls: 'expert',
      source: 'artwork',
      artwork: 'test/icon',
      outputMode: 'object-shadow',
      samples: 128,
      camera: { azimuth: 42, elevation: 20, fov: 35, zoom: 1.4 },
      materials: [{ slot: '1', color: '#123456', roughness: 0.18, metalness: 0.8, clearcoat: 0.5 }],
    };
    const runtime = await createRuntime(tool, host, values);
    const encoded = serializeUrlState(runtime.getModel());
    const parsed = parseUrlState(encoded, tool.manifest);
    const reopened = await createRuntime(tool, host, parsed.values);
    assert.deepEqual(
      reopened.getModel().find((i) => i.id === 'camera')?.value,
      runtime.getModel().find((i) => i.id === 'camera')?.value
    );
    assert.match(reopened.getHydrated(), /data-lolly-studio/);
    assert.match(reopened.getHydrated(), /object-shadow/);
    await reopened.setInput('controls', 'guided');
    const sceneOf = (rt: typeof runtime) =>
      buildStudioScene({
        version: 1,
        values: Object.fromEntries(rt.getModel().map((i) => [i.id, i.value])),
      });
    assert.deepEqual(sceneOf(reopened), sceneOf(runtime));
    await reopened.setInput('motion', 'turntable');
    await reopened.setInput('duration', 2.5);
    assert.match(reopened.getHydrated(), /data-clip-ms="2500"/);
    runtime.destroy();
    reopened.destroy();
  });
  it('keeps separate sample counts for stills and clip frames', () => {
    const scene = buildStudioScene({ version: 1, values: { samples: 120, videoSamples: 4 } });
    assert.deepEqual(scene.quality, { previewSamples: 8, exportSamples: 120, clipSamples: 4 });
    const defaults = buildStudioScene({ version: 1, values: {} }).quality;
    assert.equal(defaults.clipSamples, 16);
    assert.equal(buildStudioScene({ version: 1, values: { videoSamples: 0 } }).quality.clipSamples, 1);
  });
  it('bounds the glow halo strength', () => {
    assert.equal(buildStudioScene({ version: 1, values: {} }).materials.glow, 0.45);
    assert.equal(buildStudioScene({ version: 1, values: { glow: 7 } }).materials.glow, 1);
    assert.equal(buildStudioScene({ version: 1, values: { glow: -1 } }).materials.glow, 0);
  });
});
