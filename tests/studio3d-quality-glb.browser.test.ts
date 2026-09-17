// SPDX-License-Identifier: MPL-2.0
/**
 * 3D Studio textured GLB override (plan 265, D2.2). A generated model with three textured
 * materials (tests/helpers/studio3d-glb.ts), served at /multi.glb, proves that a material
 * override on one slot leaves the other slots alone and that imported maps keep the colour
 * space glTF gives them.
 *
 * The page loads the model with the studio's own loadStudioSource, places a copy as the
 * renderer does (instantiateStudioAsset) and applies each material mode with
 * applyStudioMaterials, then reports what every material and map looks like. The model then
 * goes through the normal mount twice with the override, and once in source mode.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import * as THREE from 'three';
import {
  type StudioHarness,
  type StudioValues,
  saveShot,
  startStudioHarness,
  studioSkip,
} from './helpers/studio3d-browser.ts';
import { buildMultiMaterialGlb, MULTI_GLB_MATERIALS } from './helpers/studio3d-glb.ts';

const MAPS = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'aoMap',
  'emissiveMap',
  'alphaMap',
] as const;
type MapKey = (typeof MAPS)[number];

interface MapFact {
  colorSpace: string;
  /** The same texture object as the loaded material's map of this name. */
  same: boolean;
}

interface MaterialFact {
  name: string;
  type: string;
  /** The same material object as the loaded one. */
  same: boolean;
  color: string;
  emissive: string;
  emissiveIntensity: number;
  transparent: boolean;
  opacity: number;
  depthWrite: boolean;
  roughness: number;
  metalness: number;
  clearcoat: number | null;
  maps: Record<MapKey, MapFact | null>;
}

interface ModeFacts {
  materials: MaterialFact[];
  /** Every mesh holds its loaded material again after the restore function ran. */
  restored: boolean;
}

interface GlbProbe {
  slots: string[];
  warnings: string[];
  triangles: number;
  colorSpaces: { srgb: string; none: string; linear: string };
  loaded: MaterialFact[];
  modes: Record<string, ModeFacts>;
  /** The loaded materials once every mode has been applied and restored. */
  after: MaterialFact[];
}

declare global {
  interface Window {
    /** Loads the model named in `values` and applies each named mode (see extraSource). */
    glbProbe?: (values: StudioValues, modes: Record<string, StudioValues>) => Promise<GlbProbe>;
  }
}

const extraSource = `
import * as PROBE_THREE from 'three';
import { loadStudioSource as probeLoad, instantiateStudioAsset as probeInstance } from './shells/web/src/lib/studio3d/source.ts';
import { applyStudioMaterials as probeApply } from './shells/web/src/lib/studio3d/materials.ts';
import { buildStudioScene as probeScene } from './engine/src/studio3d.ts';

const PROBE_MAPS = ${JSON.stringify(MAPS)};
const probeFacts = (material, loaded) => ({
  name: material.name,
  type: material.type,
  same: material === loaded,
  color: '#' + material.color.getHexString(),
  emissive: '#' + material.emissive.getHexString(),
  emissiveIntensity: material.emissiveIntensity,
  transparent: material.transparent,
  opacity: material.opacity,
  depthWrite: material.depthWrite,
  roughness: material.roughness,
  metalness: material.metalness,
  clearcoat: typeof material.clearcoat === 'number' ? material.clearcoat : null,
  maps: Object.fromEntries(
    PROBE_MAPS.map((key) => [
      key,
      material[key] ? { colorSpace: material[key].colorSpace, same: material[key] === loaded[key] } : null,
    ])
  ),
});
window.glbProbe = async (values, modes) => {
  const recipe = probeScene({ version: 1, values: { ...studioDefaults, ...values } });
  const shared = await probeLoad(recipe, read, new AbortController().signal);
  try {
    const loaded = [...shared.originals.values()].map((material) => {
      if (Array.isArray(material)) throw new Error('The model uses one material per mesh.');
      return material;
    });
    const result = {
      slots: shared.info.slots.map((slot) => slot.id),
      warnings: shared.info.warnings,
      triangles: shared.info.triangles,
      colorSpaces: {
        srgb: PROBE_THREE.SRGBColorSpace,
        none: PROBE_THREE.NoColorSpace,
        linear: PROBE_THREE.LinearSRGBColorSpace,
      },
      loaded: loaded.map((material) => probeFacts(material, material)),
      modes: {},
    };
    for (const [name, mode] of Object.entries(modes)) {
      const scene = probeScene({ version: 1, values: { ...studioDefaults, ...values, ...mode } });
      const copy = probeInstance(shared);
      const pairs = [...copy.originals];
      const restore = probeApply(copy, scene);
      const materials = pairs.map(([mesh], i) => probeFacts(mesh.material, loaded[i]));
      restore();
      const restored = pairs.every(([mesh], i) => mesh.material === loaded[i]);
      copy.dispose();
      result.modes[name] = { materials, restored };
    }
    result.after = loaded.map((material) => probeFacts(material, material));
    return result;
  } finally {
    shared.dispose();
  }
};
`;

const MODEL: StudioValues = { source: 'model', upload: { url: '/multi.glb', name: 'multi.glb' } };
const OVERRIDE = {
  slot: 'Rubber',
  color: '#ff4060',
  roughness: 0.7,
  metalness: 0.2,
  clearcoat: 0.5,
};
const MODES: Record<string, StudioValues> = {
  custom: { materialMode: 'custom', materials: [OVERRIDE] },
  source: { materialMode: 'source' },
  pair: { materialMode: 'pair' },
  // Recorded only: an override on the blended, emissive slot.
  customTrim: { materialMode: 'custom', materials: [{ ...OVERRIDE, slot: 'Trim' }] },
};

let harness: StudioHarness | undefined;

function studio(): StudioHarness {
  if (!harness) throw new Error('The 3D Studio harness did not start.');
  return harness;
}

function byName(materials: MaterialFact[]): Record<string, MaterialFact> {
  return Object.fromEntries(materials.map((material) => [material.name, material]));
}

const present = (material: MaterialFact) => MAPS.filter((key) => material.maps[key]);

describe('3D Studio textured GLB builder', () => {
  it('returns the same self-contained glTF 2.0 binary on every call', () => {
    const bytes = buildMultiMaterialGlb();
    assert.deepEqual(bytes, buildMultiMaterialGlb());
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    assert.equal(view.getUint32(0, true), 0x46546c67, 'glTF magic');
    assert.equal(view.getUint32(4, true), 2, 'version 2');
    assert.equal(view.getUint32(8, true), bytes.length, 'declared length');
    const jsonLength = view.getUint32(12, true);
    assert.equal(view.getUint32(16, true), 0x4e4f534a, 'JSON chunk first');
    const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
    const binLength = view.getUint32(20 + jsonLength, true);
    assert.equal(view.getUint32(24 + jsonLength, true), 0x004e4942, 'BIN chunk second');
    assert.equal(28 + jsonLength + binLength, bytes.length);
    assert.equal(json.buffers[0].byteLength, binLength);
    assert.deepEqual(
      json.materials.map((material: { name: string }) => material.name),
      [...MULTI_GLB_MATERIALS]
    );
    assert.equal(json.extensionsRequired, undefined);
    assert.equal(json.extensionsUsed, undefined);
    for (const image of json.images) {
      assert.equal(image.uri, undefined, 'images are embedded');
      assert.equal(image.mimeType, 'image/png');
      const viewDef = json.bufferViews[image.bufferView];
      const png = bytes.subarray(
        28 + jsonLength + viewDef.byteOffset,
        28 + jsonLength + viewDef.byteOffset + viewDef.byteLength
      );
      assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    }
    assert.equal(
      new Set(json.images.map((image: { bufferView: number }) => image.bufferView)).size,
      json.images.length
    );
  });
});

describe('3D Studio textured GLB override', { skip: studioSkip }, () => {
  before(async () => {
    harness = await startStudioHarness({
      size: 256,
      routes: { '/multi.glb': buildMultiMaterialGlb() },
      extraSource,
    });
  });
  after(async () => {
    await harness?.close();
  });

  it('overrides one slot, keeps the other slots and keeps imported colour spaces', async (t) => {
    const page = await studio().open();
    try {
      const probe = await page.evaluate(({ values, modes }) => window.glbProbe!(values, modes), {
        values: MODEL,
        modes: MODES,
      });
      assert.deepEqual(probe.colorSpaces, {
        srgb: THREE.SRGBColorSpace,
        none: THREE.NoColorSpace,
        linear: THREE.LinearSRGBColorSpace,
      });
      const { srgb, none } = probe.colorSpaces;

      // 1. Slots, in model order.
      assert.deepEqual(probe.slots, [...MULTI_GLB_MATERIALS]);
      assert.equal(probe.triangles, 36);
      const loaded = byName(probe.loaded);
      t.diagnostic(`loaded: ${JSON.stringify(probe.loaded)}`);

      // 2. Colour data is sRGB; normal, roughness, metalness and occlusion data carry no colour space.
      assert.deepEqual(present(loaded.Paint!), ['map']);
      assert.equal(loaded.Paint!.maps.map?.colorSpace, srgb);
      assert.deepEqual(present(loaded.Rubber!), [
        'normalMap',
        'roughnessMap',
        'metalnessMap',
        'aoMap',
      ]);
      for (const key of ['normalMap', 'roughnessMap', 'metalnessMap', 'aoMap'] as const)
        assert.equal(loaded.Rubber!.maps[key]?.colorSpace, none, `Rubber ${key}`);
      assert.deepEqual(present(loaded.Trim!), ['emissiveMap']);
      assert.equal(loaded.Trim!.maps.emissiveMap?.colorSpace, srgb);
      assert.equal(loaded.Trim!.transparent, true, 'Trim blends');
      assert.equal(loaded.Trim!.opacity, 0.6);
      assert.notEqual(loaded.Trim!.emissive, '#000000');

      // 3. Custom mode with one override on Rubber.
      const custom = probe.modes.custom!;
      assert.equal(custom.restored, true);
      const changed = byName(custom.materials);
      const rubber = changed.Rubber!;
      assert.equal(rubber.same, false, 'Rubber gets its own material');
      assert.equal(rubber.color, OVERRIDE.color);
      assert.equal(rubber.roughness, OVERRIDE.roughness);
      assert.equal(rubber.metalness, OVERRIDE.metalness);
      assert.equal(rubber.clearcoat, OVERRIDE.clearcoat);
      for (const key of ['map', 'roughnessMap', 'metalnessMap'] as const)
        assert.equal(rubber.maps[key], null, `the override clears Rubber ${key}`);
      for (const key of ['normalMap', 'aoMap'] as const)
        assert.deepEqual(rubber.maps[key], { colorSpace: none, same: true }, `Rubber keeps ${key}`);
      t.diagnostic(`custom Rubber: ${JSON.stringify(rubber)}`);
      for (const name of ['Paint', 'Trim'] as const) {
        assert.equal(changed[name]!.same, true, `${name} keeps its material object`);
        assert.deepEqual(
          changed[name],
          loaded[name],
          `${name} keeps its maps, colour spaces, emissive and alpha`
        );
      }

      // 4. Source mode keeps every material.
      assert.equal(probe.modes.source!.restored, true);
      assert.deepEqual(probe.modes.source!.materials, probe.loaded);

      // 5. Pair mode: record what is cleared and kept; kept maps keep their colour space.
      const pair = probe.modes.pair!;
      assert.equal(pair.restored, true);
      const record: Record<string, Record<string, unknown>> = {};
      for (const material of pair.materials) {
        const before = loaded[material.name]!;
        assert.equal(material.same, false, `pair mode gives ${material.name} its own material`);
        const kept = present(before).filter((key) => material.maps[key]);
        record[material.name] = {
          cleared: present(before).filter((key) => !material.maps[key]),
          kept,
          emissive: material.emissive,
          transparent: material.transparent,
          opacity: material.opacity,
          depthWrite: material.depthWrite,
        };
        for (const key of kept)
          assert.deepEqual(
            material.maps[key],
            { colorSpace: before.maps[key]!.colorSpace, same: true },
            `pair mode keeps ${material.name} ${key} and its colour space`
          );
      }
      t.diagnostic(`pair mode: ${JSON.stringify(record)}`);
      assert.ok(
        (record.Rubber!.kept as MapKey[]).includes('normalMap'),
        'pair mode keeps the normal map'
      );

      // Recorded only: what an override does to a blended, emissive slot.
      const trim = byName(probe.modes.customTrim!.materials).Trim!;
      assert.equal(probe.modes.customTrim!.restored, true);
      t.diagnostic(
        `custom override on Trim: ${JSON.stringify({ kept: present(trim), emissive: trim.emissive, emissiveMap: trim.maps.emissiveMap, transparent: trim.transparent, opacity: trim.opacity, depthWrite: trim.depthWrite })}`
      );

      // Applying and restoring every mode leaves the loaded materials as they were.
      assert.deepEqual(probe.after, probe.loaded);
    } finally {
      await page.close();
    }
  });

  it('renders the override the same way twice and differently from source mode', async (t) => {
    const page = await studio().open();
    try {
      const values = { ...MODEL, outputMode: 'object' };
      const first = await studio().render(page, { ...values, ...MODES.custom });
      const source = await studio().render(page, { ...values, ...MODES.source });
      const second = await studio().render(page, { ...values, ...MODES.custom });
      for (const frame of [first, source, second]) {
        assert.equal(frame.state, 'ready', frame.info);
        assert.match(frame.info, /1: Paint \/ 2: Rubber \/ 3: Trim/);
      }
      assert.equal(second.reads, 1, 'the model is read once and reused');
      assert.equal(first.png, second.png, 'the override renders the same after a source render');
      assert.notEqual(first.png, source.png, 'the override changes the render');
      let changed = 0;
      for (let i = 0; i < first.pixels.length; i += 4)
        if ([0, 1, 2, 3].some((c) => first.pixels[i + c] !== source.pixels[i + c])) changed++;
      t.diagnostic(
        `pixels that differ between the override and source mode: ${changed} of ${first.width * first.height}`
      );
      await saveShot('glb-override.png', first.png);
      await saveShot('glb-source.png', source.png);
      await saveShot(
        'glb-pair.png',
        (await studio().render(page, { ...values, ...MODES.pair })).png
      );
      assert.deepEqual(studio().errors, []);
    } finally {
      await page.close();
    }
  });
});
