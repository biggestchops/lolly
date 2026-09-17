// SPDX-License-Identifier: MPL-2.0
/**
 * The studio and document halves of a 3D Studio document (plan 265 step 2, lane A).
 *
 * The first test is the one that keeps the feature honest: every input id in
 * `community/3d-studio/tool.json` is in exactly one of the two lists, read from the
 * manifest rather than from a copy here, so an input added later cannot quietly fall
 * between them. A vector input may be split field by field, and then every one of its
 * fields must be covered exactly once; the camera is the only input that needs it.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import {
  STUDIO_INSTANCE_KEYS,
  STUDIO_LOOK_INPUT_IDS,
  STUDIO_LOOK_KEYS,
  studioApplyLook,
  studioFormatOverrides,
  studioFormatRef,
  studioKeyField,
  studioKeyInput,
  studioLookOf,
  studioParseOverrides,
  studioParseRef,
  studioRecordOverride,
} from '../engine/src/studio3d-look.ts';
import { createUserTemplateStore } from '../shells/web/src/lib/user-templates.ts';
import * as lib from '../shells/web/src/lib/studio-library.ts';

const root = resolve(import.meta.dirname, '..');

interface ManifestInput {
  id: string;
  type?: string;
  fields?: { id: string }[];
}

const manifest: { inputs: ManifestInput[] } = JSON.parse(
  readFileSync(join(root, 'community/3d-studio/tool.json'), 'utf8')
);
const hooks = readFileSync(join(root, 'community/3d-studio/hooks.js'), 'utf8');

const ALL_KEYS = [...STUDIO_LOOK_KEYS, ...STUDIO_INSTANCE_KEYS];

describe('the studio and document halves', () => {
  it('puts every 3D Studio input in exactly one list', () => {
    const counted = new Map<string, string[]>();
    for (const key of ALL_KEYS) {
      const id = studioKeyInput(key);
      counted.set(id, [...(counted.get(id) ?? []), key]);
    }
    const missing: string[] = [];
    const twice: string[] = [];
    for (const input of manifest.inputs) {
      const keys = counted.get(input.id);
      if (!keys) {
        missing.push(input.id);
        continue;
      }
      if (keys.length === 1 && studioKeyField(keys[0]!) === null) continue;
      // Split by field: every field of the input, once each.
      const fields = (input.fields ?? []).map((f) => f.id);
      const named = keys.map((key) => studioKeyField(key));
      if (named.some((field) => field === null) || new Set(named).size !== named.length)
        twice.push(input.id);
      else if (fields.length !== named.length || fields.some((f) => !named.includes(f)))
        twice.push(input.id);
    }
    assert.deepEqual(
      missing,
      [],
      'these 3D Studio inputs are in neither STUDIO_LOOK_KEYS nor STUDIO_INSTANCE_KEYS ' +
        '(engine/src/studio3d-look.ts): add each one to whichever half it belongs to'
    );
    assert.deepEqual(twice, [], 'these inputs are split by field, but not once per field');
  });

  it('names no key the manifest does not have', () => {
    const ids = new Set(manifest.inputs.map((i) => i.id));
    const unknown = [...new Set(ALL_KEYS.map(studioKeyInput))].filter((id) => !ids.has(id));
    assert.deepEqual(unknown, [], 'these keys name inputs 3d-studio no longer declares');
  });

  it('keeps the hook list of studio controls in step with the engine', () => {
    const block = /const STUDIO_LOOK_INPUTS = \[([\s\S]*?)\];/.exec(hooks);
    assert.ok(block, 'community/3d-studio/hooks.js declares STUDIO_LOOK_INPUTS');
    const listed = [...block[1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
    assert.deepEqual(
      listed,
      [...STUDIO_LOOK_INPUT_IDS],
      'hooks.js records overrides against its own copy of the list, so it must match ' +
        'STUDIO_LOOK_INPUT_IDS exactly, in order'
    );
  });

  it('gives the camera its field of view and keeps the rest of the framing', () => {
    assert.ok(STUDIO_LOOK_KEYS.includes('camera.fov'));
    for (const field of ['azimuth', 'elevation', 'zoom', 'panX', 'panY', 'panZ'])
      assert.ok(STUDIO_INSTANCE_KEYS.includes(`camera.${field}`), field);
    assert.ok(STUDIO_INSTANCE_KEYS.includes('focusDistance'));
    assert.ok(STUDIO_LOOK_KEYS.includes('projection'));
  });
});

describe('reading a studio out of a document', () => {
  it('takes the look and leaves the subject and the framing', () => {
    const look = studioLookOf({
      studio: 'dramatic',
      colorA: '#30ba78',
      source: 'model',
      modelAsset: { id: 'duck', url: '/duck.glb', name: 'duck' },
      camera: { azimuth: 40, elevation: 20, fov: 35, zoom: 1.4, panX: 0.5 },
      focusDistance: 7,
      subjects: [{ name: 'one' }],
    });
    assert.equal(look.studio, 'dramatic');
    assert.equal(look.colorA, '#30ba78');
    assert.deepEqual(look.camera, { fov: 35 });
    assert.equal(look.source, undefined);
    assert.equal(look.modelAsset, undefined);
    assert.equal(look.focusDistance, undefined);
    assert.equal(look.subjects, undefined);
  });

  it('leaves out a control the document never set', () => {
    const look = studioLookOf({ studio: 'soft' });
    assert.deepEqual(Object.keys(look), ['studio']);
    assert.ok(!('camera' in look));
  });

  it('copies deeply, so a saved studio cannot be edited through the document', () => {
    const values = { lights: [{ kind: 'point' }] };
    const look = studioLookOf(values);
    (values.lights[0] as { kind: string }).kind = 'spot';
    assert.deepEqual(look.lights, [{ kind: 'point' }]);
  });
});

describe('applying a studio', () => {
  const look = studioLookOf({
    studio: 'dramatic',
    colorA: '#30ba78',
    colorB: '#0c322c',
    exposure: 1.4,
    camera: { fov: 35 },
  });
  const document = {
    source: 'model',
    modelAsset: { id: 'duck' },
    studio: 'soft',
    colorA: '#ffffff',
    exposure: 1.1,
    camera: { azimuth: 90, elevation: 5, fov: 29, zoom: 2, panX: 1 },
  };

  it('writes the look into ordinary values', () => {
    const next = studioApplyLook(document, look);
    assert.equal(next.studio, 'dramatic');
    assert.equal(next.colorA, '#30ba78');
    assert.equal(next.colorB, '#0c322c');
    assert.equal(next.exposure, 1.4);
  });

  it('changes the field of view and leaves the orbit, zoom and pan alone', () => {
    const next = studioApplyLook(document, look);
    assert.deepEqual(next.camera, { azimuth: 90, elevation: 5, fov: 35, zoom: 2, panX: 1 });
  });

  it('keeps the subject and the document it was applied to', () => {
    const next = studioApplyLook(document, look);
    assert.equal(next.source, 'model');
    assert.deepEqual(next.modelAsset, { id: 'duck' });
    assert.deepEqual(document.camera, { azimuth: 90, elevation: 5, fov: 29, zoom: 2, panX: 1 });
  });

  it('leaves every control the document owns', () => {
    const next = studioApplyLook(document, look, ['colorA', 'camera']);
    assert.equal(next.colorA, '#ffffff', 'the reader chose this colour');
    assert.deepEqual(next.camera, document.camera, 'an orbit protects the field of view too');
    assert.equal(next.studio, 'dramatic', 'everything else still follows the studio');
  });
});

describe('recording what the reader changed', () => {
  it('records a studio control and nothing else', () => {
    assert.deepEqual(studioRecordOverride('', 'colorA'), ['colorA']);
    assert.deepEqual(studioRecordOverride('["colorA"]', 'exposure'), ['colorA', 'exposure']);
    assert.deepEqual(studioRecordOverride('["colorA"]', 'artwork'), ['colorA']);
    assert.deepEqual(studioRecordOverride('["colorA"]', 'colorA'), ['colorA']);
  });

  it('reads a camera field as the camera, because the hook is told the input', () => {
    assert.deepEqual(studioRecordOverride('', 'camera.fov'), ['camera']);
  });

  it('survives anything a reader may have typed into the field', () => {
    assert.deepEqual(studioParseOverrides('not json'), []);
    assert.deepEqual(studioParseOverrides('{"colorA":true}'), []);
    assert.deepEqual(studioParseOverrides('["colorA","colorA","nonsense"]'), ['colorA']);
    assert.deepEqual(studioParseOverrides(undefined), []);
    assert.equal(studioFormatOverrides([]), '');
    assert.equal(studioFormatOverrides(['exposure', 'colorA']), '["colorA","exposure"]');
  });
});

describe('the reference a document keeps', () => {
  it('reads and writes <templateId>@<lookVersion>', () => {
    assert.deepEqual(studioParseRef('ut-7@3'), { id: 'ut-7', version: 3 });
    assert.equal(studioFormatRef({ id: 'ut-7', version: 3 }), 'ut-7@3');
  });

  it('answers null for anything that is not one', () => {
    for (const bad of ['', 'ut-7', '@3', 'ut-7@', 'ut-7@0', 'ut-7@x', 'ut-7@1.5', undefined])
      assert.equal(studioParseRef(bad), null, String(bad));
  });

  it('keeps an id that has an @ in it', () => {
    assert.deepEqual(studioParseRef('a@b@2'), { id: 'a@b', version: 2 });
  });

  it('is a note, not a failure, when the studio is gone', () => {
    // A stale reference names a studio nobody can load. The document still holds every
    // value the studio wrote, so applying "nothing" changes nothing.
    const values = { studio: 'dramatic', studioRef: 'ut-gone@2' };
    assert.deepEqual(studioApplyLook(values, {}), values);
    assert.deepEqual(studioParseRef(values.studioRef), { id: 'ut-gone', version: 2 });
  });
});

/**
 * The saved-studio operations, over the real template store and a stand-in runtime.
 * The web modules import cleanly under Node, so the semantics of save, apply, update
 * and detach are checked here rather than only in the browser suite.
 */
describe('saving and using a studio', () => {
  function profileHost() {
    let profile: Record<string, unknown> = {};
    return {
      profile: {
        get: async () => profile,
        set: async (next: Record<string, unknown>) => {
          profile = next;
        },
      },
    };
  }

  /**
   * A runtime that applies a patch the way `applyPatch` does: every value enters the
   * model first, then the tool's hook runs per changed id. The hook here is the one rule
   * lane A adds to hooks.js, which is why studio-library.ts writes in two batches.
   */
  function fakeRuntime(values: Record<string, unknown>) {
    const state = { ...values };
    return {
      getModel: () => Object.entries(state).map(([id, value]) => ({ id, value })),
      applyPatch: async (patch: Record<string, unknown>) => {
        const changed = Object.keys(patch).filter((id) => state[id] !== patch[id]);
        Object.assign(state, patch);
        for (const id of changed) {
          const next = studioRecordOverride(state.studioOverrides, id);
          if (String(state.studioRef ?? '').trim() && next.length)
            state.studioOverrides = studioFormatOverrides(next);
        }
      },
      values: () => state,
    };
  }

  const badge = {
    source: 'primitive',
    primitive: 'badge',
    studio: 'dramatic',
    colorA: '#30ba78',
    exposure: 1.4,
    camera: { azimuth: 25, elevation: 14, fov: 35, zoom: 1 },
    studioRef: '',
    studioOverrides: '',
  };

  it('saves the look, attaches the document and leaves the subject out', async () => {
    const store = createUserTemplateStore(profileHost());
    const runtime = fakeRuntime(badge);
    const saved = await lib.saveStudio(runtime, store, { toolId: '3d-studio', name: 'Bright' });
    assert.equal(saved.scope, 'look');
    assert.equal(saved.lookVersion, 1);
    assert.equal(saved.values.source, undefined);
    assert.equal(saved.values.studio, 'dramatic');
    assert.equal(runtime.values().studioRef, `${saved.id}@1`);
    assert.equal(runtime.values().studioOverrides, '', 'an apply is not an override');
    assert.deepEqual(await store.list('3d-studio'), [], 'a studio is not a starting point');
    assert.equal((await store.listLooks('3d-studio')).length, 1);
  });

  it('applies a studio to another document and keeps its framing', async () => {
    const store = createUserTemplateStore(profileHost());
    const source = fakeRuntime(badge);
    const studio = await lib.saveStudio(source, store, { toolId: '3d-studio', name: 'Bright' });
    const duck = fakeRuntime({
      source: 'model',
      modelAsset: { id: 'duck' },
      studio: 'soft',
      colorA: '#ffffff',
      camera: { azimuth: 120, elevation: 30, fov: 29, zoom: 1.8 },
      studioRef: '',
      studioOverrides: '',
    });
    await lib.applyStudio(duck, studio);
    assert.equal(duck.values().studio, 'dramatic');
    assert.equal(duck.values().colorA, '#30ba78');
    assert.equal(duck.values().source, 'model');
    assert.deepEqual(duck.values().camera, { azimuth: 120, elevation: 30, fov: 35, zoom: 1.8 });
    assert.equal(duck.values().studioRef, `${studio.id}@1`);
    assert.equal(duck.values().studioOverrides, '');
  });

  it('holds an edit back until the reader takes the update, then keeps what they changed', async () => {
    const host = profileHost();
    const store = createUserTemplateStore(host);
    const source = fakeRuntime(badge);
    const studio = await lib.saveStudio(source, store, { toolId: '3d-studio', name: 'Bright' });
    const duck = fakeRuntime({ source: 'model', studio: 'soft', colorA: '#ffffff', exposure: 1.1, studioRef: '', studioOverrides: '' });
    await lib.applyStudio(duck, studio);
    // The reader changes one studio control themselves; the hook records it.
    await duck.applyPatch({ colorA: '#ff0000' });
    assert.equal(duck.values().studioOverrides, '["colorA"]');
    // The studio is saved again from the other document.
    await source.applyPatch({ studio: 'electric', exposure: 2 });
    const again = await lib.saveStudioOver(source, store, studio.id);
    assert.equal(again?.lookVersion, 2);
    assert.equal(duck.values().studio, 'dramatic', 'the other document has not moved');
    const state = await lib.studioLinkState(duck.values(), store);
    assert.equal(state.outdated, true);
    assert.equal(await lib.updateFromStudio(duck, store), 'updated');
    assert.equal(duck.values().studio, 'electric');
    assert.equal(duck.values().exposure, 2);
    assert.equal(duck.values().colorA, '#ff0000', 'the control the reader changed is theirs');
    assert.equal(duck.values().studioRef, `${studio.id}@2`);
    assert.equal(duck.values().studioOverrides, '["colorA"]');
  });

  it('reports a studio that is gone, and changes nothing', async () => {
    const store = createUserTemplateStore(profileHost());
    const runtime = fakeRuntime(badge);
    const studio = await lib.saveStudio(runtime, store, { toolId: '3d-studio', name: 'Bright' });
    await store.remove(studio.id);
    const before = { ...runtime.values() };
    assert.equal(await lib.updateFromStudio(runtime, store), 'missing');
    assert.deepEqual(runtime.values(), before);
    const state = await lib.studioLinkState(runtime.values(), store);
    assert.equal(state.stale, true);
    assert.equal(state.template, null);
  });

  it('detaches without touching a value', async () => {
    const store = createUserTemplateStore(profileHost());
    const runtime = fakeRuntime(badge);
    await lib.saveStudio(runtime, store, { toolId: '3d-studio', name: 'Bright' });
    await lib.detachStudio(runtime);
    assert.equal(runtime.values().studioRef, '');
    assert.equal(runtime.values().studioOverrides, '');
    assert.equal(runtime.values().studio, 'dramatic');
    assert.equal(await lib.updateFromStudio(runtime, store), 'none');
  });
});
