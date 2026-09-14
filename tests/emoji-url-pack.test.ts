// SPDX-License-Identifier: MPL-2.0
/**
 * A packed `?z=` link carries the emoji set and its treatment (plan 252, stage B4).
 *
 * The design tool serialises its whole document into one `z` token, so the two reserved
 * emoji params have to survive that trip or a shared Design link would reopen drawing
 * from whatever set the reader had. `url-pack` packs the canonical readable query
 * verbatim and strips nothing, which is what these tests pin: the params go in through
 * `serializeUrlState`, come back out of `expandQuery` unchanged, and `parseUrlState`
 * reads them as reserved params rather than as tool inputs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandQuery, packQuery, unpackToken, PACK_PARAM } from '../engine/src/url-pack.ts';
import { parseUrlState, serializeUrlState } from '../engine/src/url-mode.ts';
import type { InputManifest } from '../engine/src/inputs.ts';

const EMOJI = 'twemoji/color-starter@17.0.3';
const EMOJI_FX = 'influence:2500';

const MANIFEST: InputManifest = {
  inputs: [
    { id: 'headline', type: 'text', label: 'Headline' },
    { id: 'background', type: 'color', label: 'Background' },
  ],
} as unknown as InputManifest;

/** A Design-shaped document: enough text to be worth packing, plus the emoji params. */
function readableQuery(): string {
  return serializeUrlState(
    [
      { id: 'headline', type: 'text', value: `Party ${'\u{1F600}'.repeat(4)} time`, label: 'Headline' },
      { id: 'background', type: 'color', value: '#ffffff', label: 'Background' },
    ] as never,
    { emoji: EMOJI, emojiFx: EMOJI_FX },
  );
}

test('the canonical readable query carries both emoji params', () => {
  const params = new URLSearchParams(readableQuery());
  assert.equal(params.get('emoji'), EMOJI);
  assert.equal(params.get('emojifx'), EMOJI_FX);
});

test('packing and expanding a query keeps the emoji set and its treatment', async () => {
  const query = readableQuery();
  const token = await packQuery(query);
  assert.ok(token, 'the codec is available in this runtime');
  // Nothing is stripped on the way in: the token is the exact readable query.
  assert.equal(await unpackToken(token!), query);

  const expanded = await expandQuery(`${PACK_PARAM}=${token}`);
  const params = new URLSearchParams(expanded);
  assert.equal(params.get('emoji'), EMOJI, 'the set survives the packed link');
  assert.equal(params.get('emojifx'), EMOJI_FX, 'and so does the treatment');
});

test('a packed link reopens with the set the document chose, as reserved params', async () => {
  const token = await packQuery(readableQuery());
  const expanded = await expandQuery(`${PACK_PARAM}=${token}`);
  const state = parseUrlState(expanded, MANIFEST);
  assert.equal(state.emoji, EMOJI);
  assert.equal(state.emojiFx, EMOJI_FX);
  // Reserved means reserved: neither name may land in a tool's values.
  assert.equal('emoji' in state.values, false);
  assert.equal('emojifx' in state.values, false);
});

test('the packed choice wins over a duplicate riding beside the token', async () => {
  // `expandQuery` appends every other param AFTER the decoded base, and last-wins is an
  // INPUT rule: a reserved param is read with `params.get`, which answers the first
  // occurrence. So the set the document was packed with is the set it reopens at, the
  // same way `format` and the other reserved params behave. Pinned here because a
  // packed Design link is exactly where two copies of `emojifx` can meet.
  const token = await packQuery(readableQuery());
  const state = parseUrlState(await expandQuery(`${PACK_PARAM}=${token}&emojifx=mono`), MANIFEST);
  assert.equal(state.emoji, EMOJI);
  assert.equal(state.emojiFx, EMOJI_FX);
});
