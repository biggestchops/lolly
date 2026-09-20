// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createPinnedTextShaper } from '../packages/node-shell/src/text-fonts.ts';
import { createTextStory } from '../engine/src/text-story-document.ts';
import { composeText } from '../engine/src/text-layout.ts';
import { removeTextFrames, placeTextStory, splitTextThread, linkTextFrames, duplicateTextFrames, type TextThreadSnapshot } from '../engine/src/text-thread-commands.ts';
const bytes = readFileSync('shells/web/public/fonts/SUSE[wght].ttf'), services = createPinnedTextShaper(async () => bytes);
let serial = 0; const fresh = () => `new${++serial}`;
function fixture(): TextThreadSnapshot {
  const story = createTextStory('story','One paragraph keeps its source. '.repeat(10),i=>`p${i}`); story.frameIds = ['a','b','c'];
  story.paragraphs[0]!.paragraph = { character:{font:'font',size:20,color:'#123456'} };
  return { document:{version:1,stories:[story],styles:[],fonts:[{id:'font',family:'SUSE',sha256:createHash('sha256').update(bytes).digest('hex'),faceIndex:0,source:{kind:'bundled',path:'/fonts/SUSE[wght].ttf'}}]},
    frames:story.frameIds.map(id=>({id,storyId:story.id,width:200,height:100,mode:'fixed',inset:{top:4,right:4,bottom:4,left:4},columns:{count:1,gutter:0,balance:false},verticalAlign:'top'})) };
}
test('deleting containers reconnects their neighbours and deleting the last retains a placeable story', () => {
  const initial = fixture(), saved = structuredClone(initial);
  let result = removeTextFrames(initial,['b']); assert.deepEqual(result.document.stories[0]!.frameIds,['a','c']);
  result = removeTextFrames(result,['a','c']); assert.equal(result.frames.length,0); assert.equal(result.document.stories[0]!.source,initial.document.stories[0]!.source);
  result = placeTextStory(result,'story',{...initial.frames[0]!,id:'recover'});
  assert.deepEqual(result.document.stories[0]!.frameIds,['recover']); assert.deepEqual(initial,saved);
});
test('splitting uses the settled boundary and rejects stale source, styles and frame geometry', async () => {
  const initial = fixture(), layout = await composeText({...initial,storyId:'story'},services);
  const result = await splitTextThread(initial,'a',layout,fresh);
  assert.equal(result.document.stories.map(story=>story.source).join(''),initial.document.stories[0]!.source);
  assert.equal(result.document.stories[0]!.source.length,layout.frames[0]!.end);
  assert.deepEqual(result.document.stories[1]!.frameIds,['b','c']); assert.ok(result.frames.slice(1).every(frame=>frame.storyId===result.document.stories[1]!.id));
  initial.frames[0]!.inset.left = 12; await assert.rejects(splitTextThread(initial,'a',layout,fresh),{code:'layout-stale'}); initial.frames[0]!.inset.left = 4;
  initial.document.stories[0]!.paragraphs[0]!.paragraph!.character!.color = '#654321'; await assert.rejects(splitTextThread(initial,'a',layout,fresh),{code:'layout-stale'});
});
test('joining explicitly preserves both sources; ordinary links refuse nonempty targets and cycles', async () => {
  const initial = fixture(), layout = await composeText({...initial,storyId:'story'},services), split = await splitTextThread(initial,'a',layout,fresh);
  assert.throws(()=>linkTextFrames(split,'a','b',false,fresh),{code:'join-required'});
  const joined = linkTextFrames(split,'a','b',true,fresh);
  assert.equal(joined.document.stories[0]!.source,split.document.stories.map(story=>story.source).join('\n'));
  assert.equal(joined.document.stories.length,1); assert.deepEqual(joined.document.stories[0]!.frameIds,['a','b','c']);
  assert.throws(()=>linkTextFrames(joined,'a','c',true,fresh),{code:'thread-cycle'});
  split.frames[1]!.locked = true; assert.throws(()=>linkTextFrames(split,'a','b',true,fresh),{code:'frame-locked'});
});
test('complete-chain copies retain overset; subset copies contain only independent settled visible ranges', async () => {
  const initial = fixture(), layout = await composeText({...initial,storyId:'story'},services); assert.ok(layout.overset);
  const whole = await duplicateTextFrames(initial,new Map([['a','aa'],['b','bb'],['c','cc']]),new Map(),fresh);
  assert.equal(whole.document.stories[1]!.source,initial.document.stories[0]!.source); assert.deepEqual(whole.document.stories[1]!.frameIds,['aa','bb','cc']);
  const part = await duplicateTextFrames(initial,new Map([['a','aa'],['c','cc']]),new Map([['story',layout]]),fresh);
  assert.equal(part.document.stories.length,3);
  assert.equal(part.document.stories[1]!.source,initial.document.stories[0]!.source.slice(layout.frames[0]!.start,layout.frames[0]!.end));
  assert.equal(part.document.stories[2]!.source,initial.document.stories[0]!.source.slice(layout.frames[2]!.start,layout.frames[2]!.end));
  assert.ok(part.document.stories.slice(1).every(story=>story.frameIds.length===1));
  await assert.rejects(duplicateTextFrames(initial,new Map([['a','aa']]),new Map(),fresh),{code:'layout-stale'});
});


test('detaching a middle frame freezes exactly its settled range and conserves remaining source',async()=>{
  const {detachTextFrame}=await import('../engine/src/text-thread-commands.ts');
  const initial=fixture(),saved=structuredClone(initial),layout=await composeText({...initial,storyId:'story'},services),frame=layout.frames[1]!;
  const detached=await detachTextFrame(initial,'b',layout,fresh),source=initial.document.stories[0]!.source;
  assert.equal(detached.document.stories[1]!.source,source.slice(frame.start,frame.end));assert.equal(detached.document.stories[0]!.source,source.slice(0,frame.start)+source.slice(frame.end));assert.deepEqual(detached.document.stories[0]!.frameIds,['a','c']);assert.deepEqual(detached.document.stories[1]!.frameIds,['b']);assert.deepEqual(initial,saved);
  initial.frames[2]!.locked=true;await assert.rejects(detachTextFrame(initial,'b',layout,fresh),{code:'frame-locked'});
});
