// SPDX-License-Identifier: MPL-2.0
/**
 * Writes the two Design scene fixtures (plan 265 milestone 3, lane T0).
 *
 * Run it from the repo root and commit what it writes:
 *   node tests/fixtures/design/scene/generate.ts
 *
 * The two documents are the shared input for the milestone's other lanes: a still
 * artboard with a text box, an image box and one 3D box, and a sequence-lane
 * document with a timed 3D box beside a timed caption and a music bed. Both are
 * written as the Design tool's `boxes` value, so a test can hand one straight to
 * createRuntime, to inspectDesignV1, or to a browser harness.
 *
 * Everything derived is BUILT here rather than typed by hand, so a fixture cannot
 * drift from the two manifests it depends on:
 *   - each scene query comes from the real 3D Studio manifest through
 *     serializeUrlState, so it carries only the values that differ from that
 *     manifest's defaults, with keepUserIds;
 *   - each document query comes from the real Design manifest through
 *     buildInputModel plus serializeUrlState, which is the same path a share link
 *     takes;
 *   - the packed form comes from packQuery, which is what `?z=` carries.
 * tests/design-scene-fixtures.test.ts rebuilds both from this module and compares
 * the bytes, so an edit to either manifest that moves a fixture is reported.
 *
 * Two notes for the lanes that read these files:
 *
 * 1. The `scene` field is field 101 of `boxes`, appended by lane A. While it is
 *    absent this module appends the pending field spec (text, empty default,
 *    `showFor: []`) to its own copy of the manifest, so the queries here are
 *    already the ones the shipped manifest produces. The field is `text` and not
 *    the `longtext` the plan names, because schemas/tool.schema.json allows only
 *    text, color, select, asset, number and boolean for a blocks sub-field; the
 *    two encode identically, so no query here depends on which one it is.
 *    `sceneFieldFromManifest` in each file records which of the two happened. The
 *    encoding holds only while lane A appends the field LAST and leaves its
 *    default empty: a non-empty default would be written into every other row's
 *    cell and every query here would move.
 * 2. `scene` keeps the contract's canonical form, so a value equal to a 3D Studio
 *    default is absent from it. `sceneFull` beside it carries every authored
 *    value, and `values` carries them as an object. A test that pins pixels
 *    should render from `values` or `sceneFull`: a later change to a studio
 *    default would quietly move what the canonical form draws.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildInputModel, type BlockFieldSpec, type InputManifest, type InputSpec, type InputValue } from '../../../../engine/src/inputs.ts';
import { serializeUrlState } from '../../../../engine/src/url-mode.ts';
import { packQuery } from '../../../../engine/src/url-pack.ts';

/** One 3D box's scene, in the three forms a reader or a test needs. */
export interface DesignSceneEntry {
  /** The `id` of the `kind: '3d'` row this scene belongs to. */
  boxId: string;
  /** The authored 3D Studio values, including any that match a manifest default. */
  values: Record<string, string | number>;
  /** The contract form: defaults omitted, user ids kept. This is the row's `scene` field. */
  scene: string;
  /** Every authored value, in manifest order. For reading, and for a pinned render. */
  sceneFull: string;
}

/** One fixture file. */
export interface DesignSceneFixture {
  id: string;
  name: string;
  description: string;
  /** The Design `boxes` value: one row per layer, in the manifest's field vocabulary. */
  boxes: Record<string, unknown>[];
  /** One entry per `kind: '3d'` row, in row order. */
  scenes: DesignSceneEntry[];
  /** Catalog asset ids the document refers to, for a fixture server to serve. */
  assetIds: string[];
  /** The readable query: the Design manifest defaults plus these boxes. */
  query: string;
  /** The same state packed: the `?z=` form, without the leading `?`. */
  packed: string;
  /** False while this module appends the pending `scene` field spec itself. */
  sceneFieldFromManifest: boolean;
}

const REPO = join(import.meta.dirname, '..', '..', '..', '..');

/** The pending field lane A appends to `boxes.fields` as position 101. The cast is
 *  for `default`, typed as a number on the shared vector-field spec; every reader of
 *  a blocks default reads it as an InputValue, the way encodeBlocksCompact does. */
const PENDING_SCENE_FIELD = { id: 'scene', type: 'text', default: '', showFor: [] } as unknown as BlockFieldSpec;

/**
 * A fresh copy of a community manifest. The public pack is read directly rather
 * than through the profile resolver: `design` and `3d-studio` are single-sourced
 * there, so a SUSE checkout and a public clone build identical bytes.
 */
function manifest(toolId: string): InputManifest {
  return JSON.parse(readFileSync(join(REPO, 'community', toolId, 'tool.json'), 'utf8')) as InputManifest;
}

/** The Design manifest, with the pending `scene` field appended when it is absent. */
export function designManifest(): { manifest: InputManifest; sceneFieldFromManifest: boolean } {
  const m = manifest('design');
  const boxes = (m.inputs ?? []).find((i) => i.id === 'boxes');
  if (!boxes) throw new Error('community/design/tool.json has no boxes input');
  boxes.fields ??= [];
  const declared = boxes.fields.some((f) => f.id === 'scene');
  if (!declared) boxes.fields.push({ ...PENDING_SCENE_FIELD });
  return { manifest: m, sceneFieldFromManifest: declared };
}

/** The 3D Studio manifest, as the scene grammar's vocabulary. */
export function studioManifest(): InputManifest {
  return manifest('3d-studio');
}

function serializeOne(input: InputSpec, value: InputValue): string {
  return serializeUrlState([{ ...input, value }], { keepUserIds: true });
}

/**
 * A scene query from 3D Studio values. `full: true` keeps every authored value;
 * otherwise a value that serialises exactly as its manifest default is left out,
 * which is the contract form. Manifest order, so the same values always give the
 * same string.
 */
export function sceneQuery(
  values: Record<string, string | number>,
  opts: { full?: boolean } = {},
): string {
  const studio = studioManifest();
  const model = [];
  for (const input of studio.inputs ?? []) {
    if (!(input.id in values)) continue;
    const value = values[input.id] as InputValue;
    if (!opts.full && serializeOne(input, value) === serializeOne(input, (input.default ?? null) as InputValue)) continue;
    model.push({ ...input, value });
  }
  const unknown = Object.keys(values).filter((k) => !(studio.inputs ?? []).some((i) => i.id === k));
  if (unknown.length) throw new Error(`3D Studio has no input named ${unknown.join(', ')}`);
  return serializeUrlState(model, { keepUserIds: true });
}

/** The readable query for a document: the Design manifest defaults plus these boxes. */
export function documentQuery(boxes: Record<string, unknown>[], m: InputManifest): string {
  const model = buildInputModel(m, { initial: { boxes: boxes as unknown as InputValue } });
  return serializeUrlState(model, { keepUserIds: true });
}

/** The 3D Studio values each fixture's scene boxes are authored from. */
const STILL_SCENE_VALUES = { source: 'text', words: 'Lolly tools', studio: 'dramatic' } as const;
const LANE_SCENE_VALUES = { source: 'primitive', primitive: 'badge', motion: 'turntable', duration: 4 } as const;

function stillBoxes(scene: string): Record<string, unknown>[] {
  return [
    {
      id: 'board', name: 'Board', kind: 'frame',
      x: 0, y: 0, w: 1920, h: 1080,
      bg: 'var(--brand-surface, #ffffff)', clipChildren: true, order: 0,
    },
    {
      id: 'headline', name: 'Headline', kind: 'text', frame: 'board',
      x: 96, y: 140, w: 900, h: 240,
      text: 'Lolly tools', fg: 'var(--brand-text, #0f172a)',
      fontSize: 96, align: 'left', valign: 'top', weight: '700', order: 1,
    },
    {
      id: 'logo', name: 'Logo', kind: 'image', frame: 'board',
      x: 96, y: 470, w: 320, h: 120,
      image: 'lolly/logo/primary', fit: 'contain', order: 2,
    },
    {
      id: 'hero', name: 'Hero scene', kind: '3d', frame: 'board',
      x: 1120, y: 220, w: 640, h: 640,
      scene, order: 3,
    },
  ];
}

function laneBoxes(scene: string): Record<string, unknown>[] {
  return [
    {
      id: 'scene1', name: 'Scene 1', kind: 'frame',
      x: 0, y: 0, w: 1920, h: 1080,
      bg: 'var(--brand-primary, #1e293b)', clipChildren: true, order: 0,
    },
    {
      id: 'caption', name: 'Caption', kind: 'text', frame: 'scene1',
      x: 160, y: 760, w: 1120, h: 160,
      text: 'A badge, turning', fg: 'var(--brand-on-primary, #ffffff)',
      fontSize: 72, align: 'left', valign: 'top', weight: '700',
      lane: 'seq', start: 0, dur: 4, order: 1,
    },
    {
      id: 'badge', name: 'Badge scene', kind: '3d', frame: 'scene1',
      x: 1120, y: 220, w: 640, h: 640,
      lane: 'seq', start: 0.5, dur: 3,
      scene, order: 2,
    },
    {
      id: 'bed', name: 'Music bed', kind: 'audio', frame: 'scene1',
      x: 0, y: 940, w: 320, h: 120, bg: 'transparent',
      image: 'zzfxm:20260807',
      lane: 'seq', start: 0, dur: 4, mute: false, order: 3,
    },
  ];
}

/** Catalog asset ids a row refers to through its `image` field. */
function assetIdsOf(boxes: Record<string, unknown>[]): string[] {
  const out: string[] = [];
  for (const row of boxes) {
    const image = row.image;
    const id = typeof image === 'string' ? image : (image as { id?: string } | undefined)?.id;
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/** Build both fixtures from the two manifests. */
export async function buildDesignSceneFixtures(): Promise<DesignSceneFixture[]> {
  const { manifest: design, sceneFieldFromManifest } = designManifest();

  const build = async (
    id: string,
    name: string,
    description: string,
    boxesFor: (scene: string) => Record<string, unknown>[],
    sceneBoxId: string,
    values: Record<string, string | number>,
  ): Promise<DesignSceneFixture> => {
    const scene = sceneQuery(values);
    const boxes = boxesFor(scene);
    const query = documentQuery(boxes, design);
    const token = await packQuery(query);
    if (!token) throw new Error('packQuery returned nothing: this environment cannot pack');
    return {
      id, name, description, boxes,
      scenes: [{ boxId: sceneBoxId, values, scene, sceneFull: sceneQuery(values, { full: true }) }],
      assetIds: assetIdsOf(boxes),
      query,
      packed: `z=${token}`,
      sceneFieldFromManifest,
    };
  };

  return [
    await build(
      'still',
      'Still: a text scene beside a logo',
      'One artboard with a text box, a catalog logo and one 3D box. The scene is two words under the dramatic studio, which is the studio default, so the canonical query carries only the source and the words.',
      stillBoxes,
      'hero',
      { ...STILL_SCENE_VALUES },
    ),
    await build(
      'lane',
      'Sequence lane: a badge turning',
      'A sequence-lane document. The 3D box starts at 0.5 s and runs for 3 s beside a timed caption and a procedural music bed, and its scene turns a badge over 4 s. The public brand catalog has no video asset, so there is no video box here.',
      laneBoxes,
      'badge',
      { ...LANE_SCENE_VALUES },
    ),
  ];
}

/** Where one fixture is written and read. */
export function designSceneFixturePath(id: string): string {
  return join(import.meta.dirname, `${id}.json`);
}

async function main(): Promise<void> {
  for (const fixture of await buildDesignSceneFixtures()) {
    const path = designSceneFixturePath(fixture.id);
    writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`);
    console.log(`${fixture.id}.json: ${fixture.boxes.length} rows, query ${fixture.query.length} chars, packed ${fixture.packed.length} chars`);
    for (const s of fixture.scenes) console.log(`  ${s.boxId}: ${s.scene}`);
  }
}

if (process.argv[1]?.endsWith(join('design', 'scene', 'generate.ts'))) await main();
