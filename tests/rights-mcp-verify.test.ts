// SPDX-License-Identifier: MPL-2.0
/**
 * The MCP verify result answers the rights question separately from the
 * credential question (plan 253 section 9).
 *
 * An agent that receives a file is the party who delivers it onward, so the
 * machine result has to name the sources the file records, their licence and
 * who asserted each one. What this pins, over the real `lolly_verify` handler:
 *
 *   - a file whose credential records an unsigned CC BY-SA source comes back
 *     with a `rights` block naming the work, its licence and `recorded by the
 *     exporter` - never a claim that the source signed for itself
 *   - the credential verdict keeps its own fields: a licence with conditions
 *     does not change the integrity answer, and an intact credential does not
 *     make the rights block disappear
 *   - a file that records no source carries no `rights` block at all, so
 *     nothing is invented for a file that said nothing
 *
 * Run with: node --test tests/rights-mcp-verify.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Resvg } from '@resvg/resvg-js';
import type { C2paSourceIngredient } from '../engine/src/c2pa.ts';
import type { ToolManifest } from '../engine/src/loader.ts';

const manifest = {
  id: 'rights-mcp-verify', name: 'Rights verify', version: '1.0.0', engineVersion: '^1.0.0', status: 'official',
  render: { width: 32, height: 32, formats: ['png'] },
  inputs: [],
} as unknown as ToolManifest;

/** A real PNG container, because the credential is embedded into one. */
function png(): Uint8Array {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#2d6"/></svg>';
  return new Uint8Array(new Resvg(svg, { font: { loadSystemFonts: false } }).render().asPng());
}

const SOURCE_URL = 'https://raw.githubusercontent.com/hfg-gmuend/openmoji/v17.0.0/color/svg/1F30A.svg';

/** One recoloured CC BY-SA glyph, shaped the way `emojiSourceIngredients` writes it. */
const wave: C2paSourceIngredient = {
  credential: 'none',
  title: 'water wave (OpenMoji Color 17.0.0)',
  format: 'image/svg+xml',
  relationship: 'componentOf',
  url: SOURCE_URL,
  hash: new Uint8Array(32).fill(9),
  rights: {
    creator: 'Vanessa Boutzikoudi (OpenMoji)',
    license: 'CC-BY-SA-4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    attribution: 'OpenMoji, licensed CC BY-SA 4.0',
    sourceUrl: SOURCE_URL,
    modifications: ['Recoloured every paint with emoji-treatment-v1 in snap mode.'],
    sourceHash: `sha256:${'09'.repeat(32)}`,
    usedHash: `sha256:${'2b'.repeat(32)}`,
  },
};

interface VerifyBlock { type: string; text?: string }

/** The machine half of the result: the credential answer, and the rights answer beside it. */
interface VerifyPayload {
  verdict: string;
  resolved: { tone?: string };
  rights?: {
    summary: string;
    sources: Array<{ title: string; creator?: string; licence?: string; asserted: string; credit: string }>;
    limits: string[];
  };
}

/** The two text blocks `lolly_verify` returns: the readable verdict, then the machine payload. */
async function verify(bytes: Uint8Array): Promise<{ text: string; payload: VerifyPayload }> {
  const { callTool } = await import('../services/mcp/src/tools.ts');
  const result = await callTool('lolly_verify', { file: { base64: Buffer.from(bytes).toString('base64'), name: 'proof.png' } });
  const blocks = (result.content ?? []) as VerifyBlock[];
  const texts = blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '');
  assert.equal(texts.length, 2, 'the verdict text and the machine payload');
  return { text: texts[0]!, payload: JSON.parse(texts[1]!) as VerifyPayload };
}

async function stamped(ingredients: C2paSourceIngredient[]): Promise<Uint8Array> {
  const { stampC2pa } = await import('../services/mcp/src/render.ts');
  return stampC2pa(png(), 'png', manifest, {}, { c2pa: { on: true, days: null } }, ingredients);
}

test('an MCP verify names the recorded source, its licence and who asserted it', async () => {
  const { text, payload } = await verify(await stamped([wave]));

  const rights = payload.rights;
  assert.ok(rights, 'a file that records a source answers the rights question');
  assert.equal(rights.sources.length, 1);
  const source = rights.sources[0]!;
  assert.match(source.title, /water wave/);
  assert.equal(source.creator, 'Vanessa Boutzikoudi (OpenMoji)');
  assert.equal(source.licence, 'CC-BY-SA-4.0');
  assert.equal(source.asserted, 'recorded by the exporter', 'an unsigned source was described, not signed for');
  assert.match(source.credit, /creativecommons\.org\/licenses\/by-sa\/4\.0/);
  assert.match(source.credit, /changes: Recoloured/);
  assert.ok(rights.limits.length, 'the reading states what it did not check');

  // The credential question keeps its own answer, in its own fields.
  assert.equal(payload.verdict, 'made-with-lolly');
  assert.equal(payload.resolved.tone, 'good', 'a licence with conditions is not an integrity failure');
  assert.match(text, /Sources:/);
  assert.doesNotMatch(text, /signed by the source/);
});

test('a file that records no source carries no rights block', async () => {
  const { text, payload } = await verify(await stamped([]));

  assert.equal(payload.rights, undefined, 'nothing is invented for a file that recorded nothing');
  assert.equal(payload.verdict, 'made-with-lolly', 'the credential answer is unchanged');
  assert.doesNotMatch(text, /Sources:/);
});
