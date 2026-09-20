// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { TextLayoutRequestV1 } from '@lolly-tools/core';
import { createPinnedTextShaper } from '../packages/node-shell/src/text-fonts.ts';
import { createTextStory } from '../engine/src/text-story-document.ts';
import { composeText } from '../engine/src/text-layout.ts';
const bytes = readFileSync('shells/web/public/fonts/SUSE[wght].ttf'), services = createPinnedTextShaper(async () => bytes);
function fixture(source = 'An article flows across its ordered frames. '.repeat(12)): TextLayoutRequestV1 {
  const story = createTextStory('story',source,i=>`p${i}`); story.frameIds = ['a','b','c']; story.defaultStyle = 'body';
  return { storyId:story.id,document:{version:1,stories:[story],fonts:[{id:'font',family:'SUSE',sha256:createHash('sha256').update(bytes).digest('hex'),faceIndex:0,source:{kind:'bundled',path:'/fonts/SUSE[wght].ttf'}}],
    styles:[{id:'body',name:'Body',kind:'paragraph',paragraph:{character:{font:'font',size:20},lineHeight:1.2}}]},
    frames:story.frameIds.map((id,i)=>({id,storyId:story.id,width:[200,260,320][i]!,height:[200,200,500][i]!,mode:'fixed',inset:{top:8,right:8,bottom:8,left:8},columns:{count:1,gutter:12,balance:false},verticalAlign:'top'})) };
}
test('one story flows through differently sized frames in authored order without duplicate or lost source', async () => {
  const request = fixture(), original = structuredClone(request), layout = await composeText(request,services);
  assert.equal(layout.overset,null); assert.equal(layout.frames.at(-1)!.end,request.document.stories[0]!.source.length);
  assert.ok(layout.frames.every(frame => frame.end > frame.start));
  assert.equal(layout.frames.map(frame => request.document.stories[0]!.source.slice(frame.start,frame.end)).join(''),request.document.stories[0]!.source);
  for (const line of layout.lines) assert.ok(line.width <= request.frames.find(frame => frame.id === line.frameId)!.width-16+.001);
  request.frames.reverse(); assert.deepEqual(await composeText(request,services),layout); request.frames.reverse(); assert.deepEqual(request,original);
  request.frames[1]!.width = 180;
  const resized = await composeText(request,services); assert.notEqual(resized.frames[1]!.end,layout.frames[1]!.end);
  assert.equal(resized.frames.at(-1)!.end,request.document.stories[0]!.source.length);
});
test('columns follow story direction, share exact continuation offsets and balance the last frame', async () => {
  const request = fixture('First line\u2028Second line\u2028Third line\u2028Fourth line\u2028Fifth line\u2028Sixth line');
  request.frames = [request.frames[0]!]; request.document.stories[0]!.frameIds = ['a'];
  const frame = request.frames[0]!; frame.width = 400; frame.height = 300; frame.columns.count = 2;
  request.document.styles[0]!.paragraph!.direction = 'rtl';
  const unbalanced = await composeText(request,services); assert.ok(unbalanced.lines.every(line => line.column === 0));
  frame.columns.balance = true; const balanced = await composeText(request,services);
  assert.equal(balanced.overset,null); assert.equal(balanced.lines.filter(line => line.column === 0).length,3);
  assert.equal(balanced.lines.filter(line => line.column === 1).length,3);
  assert.ok(balanced.lines[0]!.x > balanced.lines[3]!.x);
  assert.equal(balanced.frames[0]!.columnEnds[0],balanced.lines[2]!.end);
  assert.equal(balanced.frames[0]!.columnEnds[1],request.document.stories[0]!.source.length);
});
test('paragraph keeps move whole ranges and impossible constraints report without losing text', async () => {
  const request = fixture('Intro\nA\u2028B\u2028C\u2028D'); request.frames.forEach(frame => { frame.width = 200; frame.height = 400; });
  let layout = await composeText(request,services); const height = layout.lines[0]!.height;
  request.frames.forEach(frame => { frame.height = 16+height*3+.001; });
  request.document.stories[0]!.paragraphs[1]!.paragraph = { keep:{startLines:1,endLines:3,together:false,nextLines:0} };
  layout = await composeText(request,services);
  assert.deepEqual(layout.lines.filter(line => line.paragraphId === 'p1').map(line => line.frameId),['a','b','b','b']);
  assert.ok(!layout.diagnostics.some(item => item.code === 'keep-impossible'));
  request.document.stories[0]!.paragraphs[1]!.paragraph!.keep!.together = true;
  layout = await composeText(request,services); assert.ok(layout.diagnostics.some(item => item.code === 'keep-impossible'));
  assert.equal(layout.frames.at(-1)!.end,request.document.stories[0]!.source.length);
  request.frames[2]!.height = 16+height*5;
  layout = await composeText(request,services); assert.deepEqual(layout.lines.filter(line => line.paragraphId === 'p1').map(line => line.frameId),['c','c','c','c']);
});
test('hidden and locked frames retain flow ownership; an unplaced story remains recoverable', async () => {
  const request = fixture(); request.frames[1]!.hidden = true; request.frames[2]!.locked = true;
  const layout = await composeText(request,services); assert.equal(layout.overset,null);
  assert.ok(layout.diagnostics.some(item => item.code === 'frame-hidden')); assert.ok(layout.diagnostics.some(item => item.code === 'frame-locked'));
  request.frames = []; request.document.stories[0]!.frameIds = [];
  const unplaced = await composeText(request,services); assert.deepEqual(unplaced.overset,{start:0,end:request.document.stories[0]!.source.length});
  assert.equal(unplaced.diagnostics[0]!.code,'story-unplaced');
});
test('overset is the exact remaining source and invalid ownership never silently drops a frame', async () => {
  const request = fixture(); request.frames.forEach(frame => { frame.height = 60; });
  const layout = await composeText(request,services); assert.ok(layout.overset);
  assert.equal(layout.frames.map(frame => request.document.stories[0]!.source.slice(frame.start,frame.end)).join('')+request.document.stories[0]!.source.slice(layout.overset.start),request.document.stories[0]!.source);
  request.document.stories[0]!.frameIds.push('a'); await assert.rejects(composeText(request,services),{code:'frame-owner'});
});
