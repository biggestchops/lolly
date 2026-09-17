// SPDX-License-Identifier: MPL-2.0
/**
 * Saved studios, rendered (plan 265 step 2, milestone 2 lane A).
 *
 * Run with:
 *   node --import ./tests/css-stub.mjs --test tests/studio3d-library.browser.test.ts
 *
 * The studio operations are headless, so they run here under Node against the real
 * template store and a stand-in runtime; the harness
 * (tests/helpers/studio3d-browser.ts) renders each resulting value set at 256 px and 8
 * samples. What the suite proves is the part only pixels can show:
 *
 *   1. a studio saved from a badge session applies to a duck session and leaves its
 *      framing alone;
 *   2. saving the studio again changes nothing in the duck document until the reader
 *      takes the update, and the byte comparison is exact;
 *   3. taking the update changes the render, and the values it changed are all studio
 *      controls;
 *   4. the duck document reopened from a serialised URL renders the same bytes as the
 *      first render.
 *
 * Each render gets its own page, so no comparison can be explained by what the page
 * rendered before it.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import {
  STUDIO_LOOK_INPUT_IDS,
  studioFormatOverrides,
  studioRecordOverride,
} from '../engine/src/studio3d-look.ts';
import { parseUrlState, serializeUrlState } from '../engine/src/url-mode.ts';
import * as lib from '../shells/web/src/lib/studio-library.ts';
import { createUserTemplateStore } from '../shells/web/src/lib/user-templates.ts';
import {
  type StudioHarness,
  type StudioValues,
  saveShot,
  startStudioHarness,
  studioSkip,
} from './helpers/studio3d-browser.ts';

const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(
  readFileSync(join(root, 'community/3d-studio/tool.json'), 'utf8')
) as {
  inputs: { id: string; type: string; fields?: { id: string }[]; urlKey?: string }[];
};

let harness: StudioHarness | undefined;

/** One render in a page of its own, closed again straight after. */
async function frameOf(values: StudioValues): Promise<{ png: string; info: string }> {
  const page = await harness!.open();
  try {
    const frame = await harness!.render(page, values);
    return { png: frame.png, info: frame.info };
  } finally {
    await page.close();
  }
}

/** A profile the template store can read and write, held in memory. */
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
 * A stand-in runtime with `applyPatch`'s order: every value enters the model, then the
 * tool's override rule runs once per changed id. That rule is the one lane A adds to
 * community/3d-studio/hooks.js.
 */
function fakeRuntime(values: StudioValues) {
  const state: StudioValues = { ...values };
  return {
    getModel: () => Object.entries(state).map(([id, value]) => ({ id, value })),
    applyPatch: async (patch: StudioValues) => {
      const changed = Object.keys(patch).filter((id) => state[id] !== patch[id]);
      Object.assign(state, patch);
      for (const id of changed) {
        if (!String(state.studioRef ?? '').trim()) continue;
        const next = studioRecordOverride(state.studioOverrides, id);
        if (next.length) state.studioOverrides = studioFormatOverrides(next);
      }
    },
    values: () => ({ ...state }),
  };
}

/** The same values a share link would carry, read back through url mode. */
function throughUrl(values: StudioValues): StudioValues {
  const model = manifest.inputs.map((input) => ({
    id: input.id,
    type: input.type,
    value: values[input.id] as never,
    ...(input.fields ? { fields: input.fields } : {}),
    ...(input.urlKey ? { urlKey: input.urlKey } : {}),
  }));
  const query = serializeUrlState(model as never);
  return parseUrlState(query, manifest as never).values as StudioValues;
}

const BADGE: StudioValues = {
  source: 'primitive',
  primitive: 'badge',
  studio: 'dramatic',
  materialMode: 'pair',
  colorA: '#30ba78',
  colorB: '#0c322c',
  background: '#0c322c',
  background2: '#30ba78',
  finishA: 'metal',
  finishB: 'enamel',
  exposure: 1.4,
  drama: 0.8,
  camera: { azimuth: 25, elevation: 14, fov: 35, zoom: 1, panX: 0, panY: 0, panZ: 0 },
  samples: 8,
  studioRef: '',
  studioOverrides: '',
};

const DUCK_ASSET = { id: 'duck', url: '/duck.glb', name: 'duck.glb' };
const DUCK: StudioValues = {
  source: 'model',
  modelAsset: DUCK_ASSET,
  modelFormat: 'glb',
  studio: 'soft',
  materialMode: 'pair',
  colorA: '#ffffff',
  colorB: '#8899aa',
  background: '#101018',
  background2: '#445566',
  finishA: 'satin',
  finishB: 'satin',
  exposure: 1.1,
  drama: 0.35,
  // The duck is framed its own way: a long orbit, high elevation and a closer zoom.
  camera: { azimuth: 120, elevation: 30, fov: 29, zoom: 1.6, panX: 0, panY: 0, panZ: 0 },
  samples: 8,
  studioRef: '',
  studioOverrides: '',
};

describe('saved studios, rendered', { skip: studioSkip }, () => {
  before(async () => {
    harness = await startStudioHarness({ size: 256 });
  });
  after(async () => {
    await harness?.close();
  });

  it('applies a saved studio to another document and holds an edit back until it is taken', async () => {
    const store = createUserTemplateStore(profileHost());

    // 1. A studio saved from the badge session.
    const badge = fakeRuntime(BADGE);
    const studio = await lib.saveStudio(badge, store, {
      toolId: '3d-studio',
      name: 'Dramatic metal',
    });
    assert.equal(studio.scope, 'look');
    assert.equal(studio.lookVersion, 1);
    assert.equal(studio.values.source, undefined, 'a studio carries no subject');
    assert.equal(studio.values.modelAsset, undefined);

    // 2. Applied to the duck session, which keeps its own framing.
    const duck = fakeRuntime(DUCK);
    await lib.applyStudio(duck, studio);
    const applied = duck.values();
    assert.equal(applied.studio, 'dramatic');
    assert.equal(applied.finishA, 'metal');
    assert.equal(applied.colorA, '#30ba78');
    assert.deepEqual(
      applied.camera,
      { azimuth: 120, elevation: 30, fov: 35, zoom: 1.6, panX: 0, panY: 0, panZ: 0 },
      'the field of view came from the studio; the orbit, elevation and zoom did not'
    );
    assert.equal(applied.studioRef, `${studio.id}@1`);
    assert.equal(applied.studioOverrides, '', 'applying a studio is not an override');

    const badgeFrame = await frameOf(badge.values());
    const first = await frameOf(applied);
    await saveShot('library-badge.png', badgeFrame.png);
    await saveShot('library-duck-applied.png', first.png);
    assert.notEqual(first.png, badgeFrame.png, 'two subjects under one studio are two images');

    // The same values render the same bytes in a page that never saw them before.
    const again = await frameOf(applied);
    assert.equal(again.png, first.png, 'the render is repeatable');

    // 3. The reader changes one studio control in the duck document; the rule records it.
    await duck.applyPatch({ colorB: '#ffcc00' });
    assert.equal(duck.values().studioOverrides, '["colorB"]');
    const owned = duck.values();

    // 4. The studio is saved again from the badge document.
    await badge.applyPatch({ studio: 'electric', exposure: 2, finishA: 'chrome' });
    const saved = await lib.saveStudioOver(badge, store, studio.id);
    assert.equal(saved?.lookVersion, 2);
    const state = await lib.studioLinkState(owned, store);
    assert.equal(state.outdated, true, 'the document can see there is a newer studio');

    // The duck document has not moved: same values, same bytes.
    const held = await frameOf(owned);
    const ownedFirst = await frameOf({ ...applied, colorB: '#ffcc00' });
    assert.equal(
      held.png,
      ownedFirst.png,
      'editing the saved studio changed nothing in the document that uses it'
    );

    // 5. The reader takes the update.
    assert.equal(await lib.updateFromStudio(duck, store), 'updated');
    const updated = duck.values();
    assert.equal(updated.studio, 'electric');
    assert.equal(updated.exposure, 2);
    assert.equal(updated.finishA, 'chrome');
    assert.equal(updated.colorB, '#ffcc00', 'the control the reader changed is still theirs');
    assert.equal(updated.studioRef, `${studio.id}@2`);
    assert.deepEqual(
      updated.camera,
      owned.camera,
      'an update does not reframe a document either'
    );

    // Everything the update changed is a studio control or the link itself.
    const link = ['studioRef', 'studioOverrides'];
    const moved = Object.keys(updated).filter(
      (id) => JSON.stringify(updated[id]) !== JSON.stringify(owned[id])
    );
    assert.ok(moved.length > 0, 'the update did something');
    assert.deepEqual(
      moved.filter((id) => !STUDIO_LOOK_INPUT_IDS.includes(id) && !link.includes(id)),
      [],
      'an update writes studio controls and nothing else'
    );

    const after = await frameOf(updated);
    await saveShot('library-duck-updated.png', after.png);
    assert.notEqual(after.png, held.png, 'taking the update changed the render');

    // 6. Reopened from a share link. The host resolves an asset ref back to its file,
    // which the harness has no library for, so the model asset is put back by hand;
    // every other value, the studio link included, comes from the query.
    const reopened = throughUrl(owned);
    assert.equal(reopened.studioRef, owned.studioRef, 'the studio reference travels');
    assert.equal(reopened.studioOverrides, owned.studioOverrides);
    reopened.modelAsset = DUCK_ASSET;
    const fromUrl = await frameOf(reopened);
    assert.equal(fromUrl.png, held.png, 'a reopened document renders the same bytes');
  });

  it('reopens a subject-free document from its link with the same bytes', async () => {
    const store = createUserTemplateStore(profileHost());
    const badge = fakeRuntime(BADGE);
    await lib.saveStudio(badge, store, { toolId: '3d-studio', name: 'Dramatic metal' });
    const values = badge.values();
    const first = await frameOf(values);
    const reopened = await frameOf(throughUrl(values));
    assert.equal(reopened.png, first.png);
  });
});
