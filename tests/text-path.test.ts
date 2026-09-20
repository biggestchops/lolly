// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import type { TextLayoutRequestV1, TextLayoutV1 } from '@lolly-tools/core';
import { createTextCompositionAPI } from '../packages/node-shell/src/text-composition.ts';
import { createTextStory } from '../engine/src/text-story-document.ts';
import { transformTextPath } from '../engine/src/text-spacing.ts';
import { textBoundaries } from '../engine/src/text-source.ts';
import { emojiTextPath } from '../engine/src/emoji-text-path.ts';
const bytes=readFileSync('shells/web/public/fonts/SUSE[wght].ttf'),arabic=readFileSync('tests/fixtures/text-composition/fonts/notosansarabic/NotoSansArabic[wdth,wght].ttf');
const parser=new(new JSDOM('').window.DOMParser)(),service=createTextCompositionAPI(async font=>font.id==='arabic'?arabic:bytes,source=>parser.parseFromString(source,'image/svg+xml'));
function fixture(source='Office & café'):TextLayoutRequestV1{
  const story=createTextStory('story',source,i=>`p${i}`);story.frameIds=['frame'];story.defaultStyle='body';
  return {storyId:'story',includeSvg:true,document:{version:1,stories:[story],styles:[{id:'body',name:'Body',kind:'paragraph',paragraph:{character:{font:'sans',fallbackFonts:['arabic'],size:28,color:'#123456',underline:true,axes:{wght:500}}}}],fonts:[{id:'sans',family:'SUSE',sha256:createHash('sha256').update(bytes).digest('hex'),faceIndex:0,source:{kind:'bundled',path:'/fonts/SUSE[wght].ttf'}},{id:'arabic',family:'Noto Sans Arabic',sha256:createHash('sha256').update(arabic).digest('hex'),faceIndex:0,source:{kind:'bundled',path:'/fonts/arabic.ttf'}}]},frames:[{id:'frame',storyId:'story',width:500,height:120,mode:'fixed',inset:{top:0,right:0,bottom:0,left:0},columns:{count:1,gutter:0,balance:false},verticalAlign:'top'}]};
}
function absolute(layout:TextLayoutV1):Map<number,string>{
  return new Map(layout.lines.flatMap(line=>line.runs.flatMap(run=>run.shape.clusters.map(cluster=>{const angle=run.angle*Math.PI/180;return [cluster.start,transformTextPath(cluster.d,{a:Math.cos(angle),b:Math.sin(angle),c:-Math.sin(angle),d:Math.cos(angle),e:run.x,f:run.y})] as const;}))));
}
test('straight guide shares rectangular glyph, decoration and caret geometry',async()=>{
  const request=fixture(),rectangle=await service.layoutRuns(request),baseline=rectangle.lines[0]!.baseline;
  request.frames[0]!.mode='path';request.frames[0]!.path={d:`M0 ${baseline}L500 ${baseline}`,start:0,end:500,baseline:0,reverse:false,flip:false,fit:false,guide:false};
  const curved=await service.layoutRuns(request),a=absolute(rectangle),b=absolute(curved);assert.deepEqual([...a.keys()],[...b.keys()]);
  for(const [id,path] of a){const coordinates=(path.match(/-?\d*\.?\d+/g)??[]).map(Number),other=(b.get(id)!.match(/-?\d*\.?\d+/g)??[]).map(Number);assert.equal(coordinates.length,other.length);coordinates.forEach((number,index)=>{assert.ok(Math.abs(number-other[index]!)<.0003);});}
  for(const caret of rectangle.lines[0]!.carets)assert.ok(curved.lines[0]!.carets.some(item=>item.offset===caret.offset&&Math.abs(item.x-caret.x)<.001&&Math.abs(item.y-caret.y)<.001));
  assert.equal(curved.overset,null);assert.ok(curved.frames[0]!.svg!.includes('<rect'));
});
test('endpoint overflow is a logical prefix; explicit fit preserves the complete source and scales all geometry',async()=>{
  const request=fixture('A longer heading with trailing words');request.frames[0]!.mode='path';request.frames[0]!.path={d:'M0 60L160 60',start:0,end:160,baseline:0,reverse:false,flip:false,fit:false,guide:false};
  const original=structuredClone(request.document),natural=await service.layoutRuns(request);assert.ok(natural.overset);assert.ok(textBoundaries(original.stories[0]!.source).has(natural.overset.start));
  assert.equal(natural.frames[0]!.end,natural.overset.start);assert.equal(natural.overset.end,original.stories[0]!.source.length);
  request.frames[0]!.path.fit=true;const fit=await service.layoutRuns(request);assert.equal(fit.overset,null);assert.equal(fit.frames[0]!.end,original.stories[0]!.source.length);assert.ok(fit.frames[0]!.appliedScale!<1);
  assert.ok(fit.lines[0]!.runs.every(run=>Math.abs(run.shape.size-28*fit.frames[0]!.appliedScale!)<.001));assert.deepEqual(request.document,original);
});
test('closed seams, reverse and flip place shaped bidi and emoji units without changing logical source',async()=>{
  const request=fixture('مرحبا 123 😀'),d='M250 30A200 200 0 1 1 250 430A200 200 0 1 1 250 30Z',length=emojiTextPath(d).length;
  const source=request.document.stories[0]!.source,offset=source.indexOf('😀');request.artwork=[{start:offset,end:offset+2,id:'emoji',sha256:'a'.repeat(64),width:28,ascent:23,descent:5,svg:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5" fill="#ff8800"/></svg>'}];
  request.frames[0]!.height=500;request.frames[0]!.mode='path';request.frames[0]!.path={d,start:length-120,end:length+500,baseline:4,reverse:false,flip:false,fit:false,guide:false};
  const natural=await service.layoutRuns(request);assert.equal(natural.overset,null);assert.equal(natural.lines[0]!.inlines.length,1);assert.ok(natural.lines[0]!.runs.some(run=>run.shape.direction==='rtl'));
  const starts=natural.lines[0]!.runs.map(run=>run.shape.start);assert.ok(starts.some((at,index)=>index>0&&at<starts[index-1]!));
  request.frames[0]!.path.reverse=true;const reverse=await service.layoutRuns(request);assert.notDeepEqual(absolute(natural),absolute(reverse));
  request.frames[0]!.path.flip=true;request.frames[0]!.path.guide=true;const flipped=await service.layoutRuns(request);assert.notDeepEqual(absolute(reverse),absolute(flipped));
  assert.equal(flipped.frames[0]!.guide,d);assert.equal(request.document.stories[0]!.source,source);
  assert.ok(flipped.lines[0]!.carets.every(caret=>textBoundaries(source).has(caret.offset)&&Number.isFinite(caret.x)&&Number.isFinite(caret.y)));
  assert.equal(parser.parseFromString(flipped.frames[0]!.svg!,'image/svg+xml').querySelector('title')!.textContent,source);
});
test('ambiguous guides, repeated traversals, frame chains and multiple paragraphs refuse atomically',async()=>{
  for(const d of ['M0 0L100 0M200 0L300 0','M0 0L0 0']){const request=fixture();request.frames[0]!.mode='path';request.frames[0]!.path={d,start:0,end:100,baseline:0,reverse:false,flip:false,fit:false,guide:false};await assert.rejects(service.layoutRuns(request),/path/i);}
  const request=fixture('First\nSecond');request.frames[0]!.mode='path';request.frames[0]!.path={d:'M0 30L500 30',start:0,end:500,baseline:0,reverse:false,flip:false,fit:false,guide:false};await assert.rejects(service.layoutRuns(request),{code:'path-paragraph'});
  request.document.stories[0]=createTextStory('story','A',i=>`p${i}`);request.document.stories[0]!.frameIds=['frame'];request.document.stories[0]!.defaultStyle='body';request.frames[0]!.path.end=501;await assert.rejects(service.layoutRuns(request),{code:'path-interval'});
  request.frames[0]!.path.end=500;request.frames[0]!.columns.count=2;await assert.rejects(service.layoutRuns(request),{code:'frame-mode'});
});
test('path carets follow visual advance and justification reports bounded spacing',async()=>{
  const request=fixture('مرحبا 123');request.frames[0]!.mode='path';request.frames[0]!.path={d:'M0 60L500 60',start:0,end:500,baseline:0,reverse:false,flip:false,fit:false,guide:false};
  const layout=await service.layoutRuns(request),carets=layout.lines[0]!.carets;
  assert.ok(carets.every((caret,index)=>!index||caret.x>=carets[index-1]!.x-.001));
  assert.ok(carets.some((caret,index)=>index>0&&caret.offset<carets[index-1]!.offset));
  request.document.styles[0]!.paragraph!.lastAlign='justify';request.frames[0]!.locked=true;request.frames[0]!.hidden=true;
  const spaced=await service.layoutRuns(request);assert.ok(spaced.diagnostics.some(item=>item.code==='word-spacing'));assert.ok(spaced.diagnostics.some(item=>item.code==='frame-locked'));assert.ok(spaced.diagnostics.some(item=>item.code==='frame-hidden'));
});
