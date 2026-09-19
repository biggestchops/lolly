// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { buildEmojiBundle } from '../engine/src/emoji-author.ts';
import { readEmojiBundle } from '../engine/src/emoji-bundle.ts';
import { fixture } from './helpers/emoji-fixtures.ts';
const dom=new JSDOM('');const parseXml=(source:string)=>new dom.window.DOMParser().parseFromString(source,'image/svg+xml');
test('custom set authoring retains exact artwork, source notices and Unicode meaning',async()=>{
  const {manifest,artwork}=await fixture();
  const draft={id:'user/emoji/authored',family:'Authored',style:'Color',version:'1.0.0',source:manifest.source,notices:manifest.notices,glyphs:[{meaning:{kind:'unicode' as const,key:'1f600'},label:'Grin',svg:new TextDecoder().decode(artwork)}]};
  const bundle=await buildEmojiBundle(draft,parseXml),read=await readEmojiBundle(new TextEncoder().encode(JSON.stringify(bundle)));
  assert.equal(read.manifest.id,draft.id);assert.equal(bundle.artwork['glyph-0.svg'],draft.glyphs[0]!.svg);assert.deepEqual(read.manifest.notices,manifest.notices);
  await assert.rejects(()=>buildEmojiBundle({...draft,glyphs:[...draft.glyphs,...draft.glyphs]},parseXml),/semantic identity/i);
  await assert.rejects(()=>buildEmojiBundle({...draft,glyphs:[{...draft.glyphs[0]!,svg:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script></svg>'}]},parseXml));
});
