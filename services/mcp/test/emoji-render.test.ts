// SPDX-License-Identifier: MPL-2.0
/**
 * An MCP render can choose the set its emoji are drawn from, and records what it
 * drew (plan 252).
 *
 * Before this, `lolly_render` took no emoji argument and the render path never
 * called `setEmojiStyle`, so every emoji in every MCP render came back as the
 * neutral placeholder and no licence was recorded for artwork nobody could get.
 * What this pins, over the real handlers and the real registered pack:
 *
 *   - a chosen set draws the pack's own vector artwork, and a render without one
 *     draws the placeholder, so the two are different bytes
 *   - the result's rights answer carries the pack's credit and its licence
 *   - the browser tier's census, which is the same hydrate-and-draw the
 *     browser-free render does, records one source per distinct glyph, and those
 *     sources reach the credential the server stamps afterwards
 *   - a set nobody registers is a usage error naming the registered sets, and a
 *     bare id resolves to the one version that is registered
 *   - a treatment named with no set is reported, the way the CLI reports it
 *   - `lolly_describe_tool` lists the sets, so an agent chooses instead of guessing
 *
 * The pack is the shared one every profile mounts, so this tracks what actually
 * ships. It skips by name where no set is registered in the checkout.
 *
 * Run with: node --test services/mcp/test/emoji-render.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Resvg } from '@resvg/resvg-js';
import { render, emojiCensus, emojiSets, resolveEmojiSetName, stampC2pa } from '../src/render.ts';
import { callTool } from '../src/tools.ts';
import type { ToolManifest } from '../../../engine/src/loader.ts';
import { verifyC2pa } from '../../../engine/src/c2pa-verify.ts';

/** An HTML-layout community tool with a text input: the emoji pass walks text
 *  nodes, and `html` is a format the browser-free tier renders for every host. */
const TOOL = 'jump';
const PACK = 'community/emoji/twemoji/color';
const GRINNING = 'Field notes \u{1f600}';

const sets = await emojiSets();
const pinned = sets.find((set) => set.pin.id === PACK) ?? sets[0];
const SKIP_NO_PACK = pinned ? false : 'No emoji set is registered in this checkout - nothing to draw from.';
const PIN = pinned ? `${pinned.pin.id}@${pinned.pin.pin.version}` : '';

/** The two text blocks a meta-tool returns, joined. */
function say(result: Awaited<ReturnType<typeof callTool>>): string {
  return (result.content ?? []).filter((b) => b.type === 'text').map((b) => (b as { text?: string }).text ?? '').join('\n');
}

async function html(query: string): Promise<string> {
  const result = await render(TOOL, query, { format: 'html', noBrowser: true });
  return new TextDecoder().decode(result.bytes);
}

const heading = (text: string): string => `heading=${encodeURIComponent(text)}`;

/** A literal to match inside a URL, with the regex metacharacters taken out. */
const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('a chosen set overrides Fluent High Contrast, and explicit none clears the default', { skip: SKIP_NO_PACK }, async () => {
  const drawn = await html(`${heading(GRINNING)}&emoji=${PIN}`);
  const implicit = await html(heading(GRINNING));
  const bare = await html(`${heading(GRINNING)}&emoji=none`);

  assert.notEqual(drawn, implicit);
  assert.match(implicit, /fill="currentColor"/);
  assert.doesNotMatch(implicit, /lolly-emoji--unset/);
  assert.notEqual(drawn, bare, 'choosing a set has to change the bytes');
  assert.match(drawn, /<span class="lolly-emoji[\s"]/, 'the cluster is placed');
  assert.match(drawn, /<(?:path|circle|ellipse|rect|polygon)/, 'the placement carries real geometry');
  assert.doesNotMatch(drawn, /lolly-emoji--unset/, 'a carried glyph is not the placeholder');
  assert.match(bare, /lolly-emoji--unset/, 'with no set chosen the placeholder is what draws');
});

test('the rights answer names the pack credit and its licence', { skip: SKIP_NO_PACK }, async () => {
  const result = await render(TOOL, `${heading(GRINNING)}&emoji=${PIN}`, { format: 'html', noBrowser: true });

  assert.equal(result.tier, 'A');
  assert.ok(result.rights, 'a browser-free render always answers');
  assert.equal(result.rights.status, 'ready');
  assert.match(result.rights.credits, /grinning face/);
  assert.match(result.rights.credits, /CC[ -]BY[ -]4\.0/);
  // html carries no credential, so the credit is not in the file and must not
  // be reported as delivered.
  assert.equal(result.rights.creditsInFile, false);
});

test('the census for a browser-tier render records the sources, and they reach the credential', { skip: SKIP_NO_PACK }, async () => {
  // The arguments a Tier B render hands the census: same tool, same values, same
  // set, and the format the browser produced. No browser is driven here - the
  // census is the Node half, and it is the half that was missing.
  const census = await emojiCensus(TOOL, { heading: GRINNING }, 'png', {}, { emoji: PIN });

  assert.equal(census.ingredients.length, 1, 'one source per distinct glyph');
  const source = census.ingredients[0]!;
  assert.equal(source.relationship, 'componentOf');
  assert.equal(source.credential, 'none', 'recorded by this exporter, not signed by the pack');
  assert.match(source.title ?? '', /grinning face/);
  assert.match(source.rights?.license ?? '', /CC[ -]BY[ -]4\.0/);
  assert.equal(census.rights.status, 'ready');
  assert.equal(census.rights.plan.required.length, 1, 'the glyph asks to be credited');

  // And what the census found is what the stamp writes, which is the point of
  // establishing it at all.
  const manifest = {
    id: TOOL, name: 'Jump', version: '1.0.0', engineVersion: '^1.0.0', status: 'community',
    render: { width: 32, height: 32, formats: ['png'] }, inputs: [],
  } as unknown as ToolManifest;
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#345"/></svg>';
  const bytes = new Uint8Array(new Resvg(svg, { font: { loadSystemFonts: false } }).render().asPng());
  const report = await verifyC2pa(await stampC2pa(bytes, 'png', manifest, {}, { c2pa: { on: true, days: null } }, census.ingredients));

  assert.equal(report.state, 'valid');
  assert.equal(report.ingredients?.length, 1, 'the browser tier no longer records a file that used nothing');
  assert.match(report.ingredients![0]!.rights?.license ?? '', /CC[ -]BY[ -]4\.0/);
});

test('a treatment named with no set is reported, not silently ignored', { skip: SKIP_NO_PACK }, async () => {
  const result = await render(TOOL, `${heading(GRINNING)}&emojifx=mono`, { format: 'html', noBrowser: true });

  assert.ok(
    result.warnings.some((w) => /names a treatment but no set/.test(w)),
    `expected the CLI's own warning, got ${JSON.stringify(result.warnings)}`,
  );
});

test('an unknown set id is a usage error naming the registered sets', { skip: SKIP_NO_PACK }, async () => {
  const result = await callTool('lolly_render', { toolId: TOOL, inputs: { heading: GRINNING }, format: 'html', emoji: 'not/a-set@1.0.0' });

  assert.equal(result.isError, true, 'a set nobody registers is a usage error, never a silent render');
  assert.match(say(result), /Unknown emoji set "not\/a-set@1\.0\.0"/);
  assert.match(say(result), new RegExp(`${PACK.replace(/\//g, '\\/')}@`), 'the error names what IS registered');
});

test('a bare set id resolves to the registered version and travels in the link', { skip: SKIP_NO_PACK }, async () => {
  const short = pinned!.pin.id.split('/').slice(-2).join('/');
  const result = await callTool('lolly_render', { toolId: TOOL, inputs: { heading: GRINNING }, format: 'html', emoji: short });
  const text = say(result);

  assert.notEqual(result.isError, true, text);
  assert.match(text, new RegExp(`emoji=${escaped(encodeURIComponent(PIN))}`), 'the editable link carries the full pin');
  assert.match(text, /Rights: ready/);
  assert.match(text, /CC[ -]BY[ -]4\.0/);
});

test('a link built without rendering carries the same resolved set', { skip: SKIP_NO_PACK }, async () => {
  const short = pinned!.pin.id.split('/').slice(-2).join('/');
  const result = await callTool('lolly_build_url', { toolId: TOOL, inputs: { heading: GRINNING }, format: 'html', emoji: short, emojifx: 'mono' });
  const text = say(result);

  assert.notEqual(result.isError, true, text);
  assert.match(text, new RegExp(`emoji=${escaped(encodeURIComponent(PIN))}`), 'the built URL carries the full pin');
  assert.match(text, /emojifx=mono/, 'and the treatment beside it');
  assert.equal(
    (await callTool('lolly_build_url', { toolId: TOOL, inputs: { heading: GRINNING }, emoji: 'not/a-set' })).isError,
    true,
    'a link to artwork nobody registers is the same usage error a render gives',
  );
});

test('lolly_describe_tool lists the sets an agent may choose from', { skip: SKIP_NO_PACK }, async () => {
  const doc = JSON.parse(say(await callTool('lolly_describe_tool', { toolId: TOOL }))) as {
    emojiSets: { id: string; label: string; glyphs: number; license: string }[];
  };

  assert.equal(doc.emojiSets.length, sets.length, 'one row per registered set');
  const row = doc.emojiSets.find((set) => set.id === PIN);
  assert.ok(row, `the registered pin is listed: ${JSON.stringify(doc.emojiSets)}`);
  assert.equal(row.label, pinned!.label);
  assert.ok(row.glyphs > 0, 'the glyph count is what says whether a set covers the text');
  assert.ok(row.license.length, 'choosing a set is choosing a licence');
});

test('a name is resolved against the registered sets, never guessed', () => {
  const listed = [
    { pin: { id: 'community/emoji/twemoji/color', pin: { version: '17.0.3' }, checksum: 'sha256:x' }, label: 'Twemoji Color' },
    { pin: { id: 'community/emoji/openmoji/color', pin: { version: '17.0.0' }, checksum: 'sha256:y' }, label: 'OpenMoji Color' },
  ] as unknown as Awaited<ReturnType<typeof emojiSets>>;

  assert.deepEqual(resolveEmojiSetName('twemoji/color', listed), { set: 'community/emoji/twemoji/color@17.0.3' });
  assert.deepEqual(resolveEmojiSetName('community/emoji/openmoji/color@17.0.0', listed), { set: 'community/emoji/openmoji/color@17.0.0' });
  assert.match((resolveEmojiSetName('twemoji/color@9.9.9', listed) as { error: string }).error, /Unknown emoji set/);
  assert.match((resolveEmojiSetName('twemoji/color', []) as { error: string }).error, /registers no emoji set/);
});
