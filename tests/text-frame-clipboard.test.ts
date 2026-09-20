// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createPinnedTextShaper } from '../packages/node-shell/src/text-fonts.ts';
import { composeText } from '../engine/src/text-layout.ts';
import { createTextStory } from '../engine/src/text-story-document.ts';
import { createTextLayoutCache, textLayoutKey } from '../engine/src/text-layout-cache.ts';
import { captureTextFrames, pasteTextFrames } from '../engine/src/text-frame-clipboard.ts';
import type { TextThreadSnapshot } from '../engine/src/text-thread-commands.ts';
let serial=0;const fresh=()=>`copy${++serial}`;
const bytes=readFileSync('shells/web/public/fonts/SUSE[wght].ttf'),services=createPinnedTextShaper(async()=>bytes);
function fixture(): TextThreadSnapshot {
  const story=createTextStory('story','Keep\u00a0spaces and exact words. '.repeat(15),fresh);story.frameIds=['a','b','c'];story.defaultStyle='body';
  return {document:{version:1,stories:[story],styles:[{id:'body',name:'Body',kind:'paragraph',paragraph:{character:{font:'font',size:20,color:'#345678'}}}],fonts:[{id:'font',family:'SUSE',faceIndex:0,sha256:createHash('sha256').update(bytes).digest('hex'),source:{kind:'bundled',path:'/fonts/SUSE[wght].ttf'}}]},
    frames:story.frameIds.map(id=>({id,storyId:'story',width:180,height:100,mode:'fixed',inset:{top:4,right:4,bottom:4,left:4},columns:{count:1,gutter:0,balance:false},verticalAlign:'top'}))};
}
test('frame clipboard takes exact settled ranges and refuses changed styles, geometry or resource choices',async()=>{
  const snapshot=fixture(),request={...snapshot,storyId:'story'},cache=createTextLayoutCache(),layout=await composeText(request,services);
  cache.remember(textLayoutKey(request),'emoji1',layout);
  const receipt=cache.peek({...request,frames:[...request.frames].reverse().map(frame=>({...frame,hidden:false,locked:false})),includeSvg:true},'emoji1')!;
  assert.ok(receipt);assert.equal(cache.peek(request,'emoji2'),null);
  const subset=captureTextFrames(snapshot,new Set(['b']),new Map([['story',receipt]]),fresh);
  assert.equal(subset.stories[0]!.source,snapshot.document.stories[0]!.source.slice(layout.frames[1]!.start,layout.frames[1]!.end));
  assert.deepEqual(subset.stories[0]!.frameIds,['b']);assert.equal(subset.stories[0]!.paragraphs[0]!.paragraph!.character!.color,'#345678');
  receipt.layout.frames[1]!.end=0;assert.notEqual(cache.peek(request,'emoji1')!.layout.frames[1]!.end,0);
  snapshot.document.styles[0]!.paragraph!.character!.size=30;
  assert.equal(cache.peek(request,'emoji1'),null);assert.throws(()=>captureTextFrames(snapshot,new Set(['b']),new Map([['story',receipt]]),fresh),{code:'layout-stale'});
});
test('whole story clipboard retains overflow and pastes independently into conflicting font and style ids',()=>{
  const source=fixture(),document=captureTextFrames(source,new Set(['a','b','c']),new Map(),fresh);
  assert.equal(document.stories[0]!.source,source.document.stories[0]!.source);
  const target=fixture();target.document.fonts[0]!.sha256='f'.repeat(64);target.document.styles[0]!.paragraph!.character!.color='#abcdef';
  const clipboard={document,frames:source.frames.map(frame=>({...frame,storyId:document.stories[0]!.id}))};
  const result=pasteTextFrames(target,clipboard,new Map([['a','aa'],['b','bb'],['c','cc']]),fresh),copied=result.document.stories[1]!;
  assert.notEqual(copied.id,source.document.stories[0]!.id);assert.deepEqual(copied.frameIds,['aa','bb','cc']);
  assert.equal(copied.source,source.document.stories[0]!.source);
  assert.equal(copied.paragraphs[0]!.paragraph!.character!.color,'#345678');
  assert.notEqual(copied.paragraphs[0]!.paragraph!.character!.font,'font');
  assert.equal(result.document.fonts.find(font=>font.id===copied.paragraphs[0]!.paragraph!.character!.font)!.sha256,source.document.fonts[0]!.sha256);
  assert.equal(result.document.stories[0]!.source,target.document.stories[0]!.source);
  assert.throws(()=>pasteTextFrames(target,clipboard,new Map([['a','a'],['b','bb'],['c','cc']]),fresh),{code:'duplicate-id'});
});
