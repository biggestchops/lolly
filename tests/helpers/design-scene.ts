// SPDX-License-Identifier: MPL-2.0
/**
 * The two Design scene fixtures, ready to use (plan 265 milestone 3, lane T0).
 *
 * `tests/fixtures/design/scene` holds two Design documents written by `generate.ts`
 * in that folder: `still.json` (an artboard with a text box, a catalog logo and one
 * 3D box) and `lane.json` (a sequence-lane document whose 3D box runs from 0.5 s for
 * 3 s beside a timed caption and a music bed). Each file carries the `boxes` value,
 * the scene query of every `kind: '3d'` row, the readable document query and the
 * packed `z=` form. This module reads them and adds the three things a test needs on
 * top of the data.
 *
 * Node API:
 *   designSceneStill, designSceneLane, designSceneFixtures
 *                               the parsed files; `designSceneFixture(id)` looks one up.
 *   designSceneDocumentHtml(f)  the document rendered through the real engine: the shipped
 *                               community/design tool, loaded and mounted the way every
 *                               other Design suite mounts it, returning the hydrated HTML.
 *   sceneMarkers(html)          every `[data-lolly-scene]` marker in that HTML, with the
 *                               box it sits in, its decoded scene query and its state.
 *                               Empty until lane A's hook branch is in the shipped
 *                               hooks.js, so a test can call it either way.
 *   serveDesignSceneAssets(routes)
 *                               the fixture routes for the studio browser harness, merged
 *                               into the caller's own. Additive: nothing in
 *                               studio3d-browser.ts changes, and a key the caller set wins.
 *   designSceneAssetUrls()      the catalog URL of each asset id the fixtures name, so a
 *                               host stub can answer host.assets.get with a real file.
 *
 * The catalog is pinned to the `lolly-start` profile, like the documentation captures:
 * `lolly/logo/primary` is a blank-brand asset and a SUSE checkout must serve the same
 * bytes as a public clone.
 */
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { contentRoots, contentUrlFile, readAssetIndex } from '@lolly-tools/node-shell/content-roots';

import { loadTool } from '../../engine/src/loader.ts';
import { createRuntime } from '../../engine/src/runtime.ts';
import type { InputValue } from '../../engine/src/inputs.ts';
import type { DesignSceneFixture } from '../fixtures/design/scene/generate.ts';
import { designSceneFixturePath } from '../fixtures/design/scene/generate.ts';
import { baseHost } from './host.ts';
import type { StudioRoute } from './studio3d-browser.ts';

export type { DesignSceneEntry, DesignSceneFixture } from '../fixtures/design/scene/generate.ts';

function read(id: string): DesignSceneFixture {
  return JSON.parse(readFileSync(designSceneFixturePath(id), 'utf8')) as DesignSceneFixture;
}

/** The still document: a text box, a catalog logo and one 3D box on one artboard. */
export const designSceneStill: DesignSceneFixture = read('still');

/** The sequence-lane document: a timed 3D box, a timed caption and a music bed. */
export const designSceneLane: DesignSceneFixture = read('lane');

/** Both, in the order `generate.ts` writes them. */
export const designSceneFixtures: readonly DesignSceneFixture[] = [designSceneStill, designSceneLane];

/** One fixture by id, with a clear error rather than undefined. */
export function designSceneFixture(id: string): DesignSceneFixture {
  const found = designSceneFixtures.find((f) => f.id === id);
  if (!found) throw new Error(`No Design scene fixture named "${id}"`);
  return found;
}

const COMMUNITY = join(import.meta.dirname, '..', '..', 'community');

/**
 * Render one fixture through the engine and return the hydrated HTML.
 *
 * The real shipped tool, loaded from `community/design` and driven by `createRuntime`,
 * so what comes back is what a CLI render and a web paint both start from. `overrides`
 * are host overrides (an asset stub, a log spy); the default host answers every asset id
 * with `asset:<id>`.
 */
export async function designSceneDocumentHtml(
  fixture: DesignSceneFixture,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const tool = await loadTool('design', (path: string) => readFile(join(COMMUNITY, path), 'utf8'));
  const runtime = await createRuntime(tool, baseHost(overrides), {
    boxes: fixture.boxes as unknown as InputValue,
  });
  const errors = runtime.hookErrors ?? [];
  if (errors.length) throw new Error(`design hooks failed: ${JSON.stringify(errors)}`);
  return runtime.getHydrated();
}

/** One scene marker as the Design hook writes it. */
export interface DesignSceneMarker {
  /** The `data-box-id` of the `.lolly-box` the marker sits in, or '' when there is none. */
  boxId: string;
  /** The marker's scene query, HTML-unescaped. */
  scene: string;
  /** `data-scene-state`, which is `poster` until a renderer takes the box. */
  state: string;
}

const UNESCAPE: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };

function unescapeAttr(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|#39);/g, (m) => UNESCAPE[m] ?? m);
}

/**
 * Every `[data-lolly-scene]` marker in a rendered document, in document order.
 *
 * Read with a regular expression rather than a DOM, so a Node test needs no jsdom and
 * a browser test can pass `page.content()` to the same function. The box id is the last
 * `data-box-id` written before the marker, which is the wrapper the hook emits it inside.
 * Returns an empty list when the shipped hook writes no markers yet.
 */
export function sceneMarkers(html: string): DesignSceneMarker[] {
  const out: DesignSceneMarker[] = [];
  const marker = /<[a-z]+[^>]*\bdata-lolly-scene="([^"]*)"[^>]*>/gi;
  for (let hit = marker.exec(html); hit; hit = marker.exec(html)) {
    const tag = hit[0];
    const before = html.slice(0, hit.index);
    const box = /.*\bdata-box-id="([^"]*)"/s.exec(before);
    const state = /\bdata-scene-state="([^"]*)"/i.exec(tag);
    out.push({
      boxId: box ? unescapeAttr(box[1] ?? '') : '',
      scene: unescapeAttr(hit[1] ?? ''),
      state: state ? unescapeAttr(state[1] ?? '') : '',
    });
  }
  return out;
}

/** The blank starter brand, whatever profile the machine running the test prefers. */
function startRoots(): ReturnType<typeof contentRoots> {
  return contentRoots({ profile: 'lolly-start' });
}

/**
 * The catalog URL of every asset id the fixtures name, keyed by id.
 *
 * An id with no catalog entry is left out: the lane document's music bed is a
 * procedural source with no file behind it, so it never appears here.
 */
export function designSceneAssetUrls(): Record<string, string> {
  const index = readAssetIndex(startRoots());
  const wanted = new Set(designSceneFixtures.flatMap((f) => f.assetIds));
  const out: Record<string, string> = {};
  for (const asset of index.assets) {
    if (!wanted.has(asset.id)) continue;
    const url = (asset as { formats?: { url?: string }[] }).formats?.[0]?.url;
    if (url) out[asset.id] = url;
  }
  return out;
}

/**
 * Add the fixture routes to a studio harness route map and return it.
 *
 * `/catalog/*` serves the blank starter brand's catalog from disk, which is how the
 * still document's logo reaches the page. Registration is additive, in the shape the
 * icons route uses: a key the caller already set is kept, and the harness itself needs
 * no change.
 *
 *   const harness = await startStudioHarness({ routes: serveDesignSceneAssets() });
 */
export function serveDesignSceneAssets(
  routes: Record<string, StudioRoute> = {},
): Record<string, StudioRoute> {
  const ours: Record<string, StudioRoute> = {
    '/catalog/*': async (path: string) => {
      const file = contentUrlFile(path, startRoots());
      if (!file) throw new Error(`No catalog file for ${path}`);
      return readFile(file);
    },
  };
  return { ...ours, ...routes };
}
