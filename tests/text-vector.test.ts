// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { Resvg } from '@resvg/resvg-js';
import type { TextLayoutRequestV1 } from '@lolly-tools/core';
import { createTextCompositionAPI } from '../packages/node-shell/src/text-composition.ts';
import { createTextStory,parseTextDocument } from '../engine/src/text-story-document.ts';
import { textFrameVectors,textInlineVectors } from '../engine/src/text-vector.ts';
import { textSemanticSource } from '../engine/src/text-semantic.ts';
import { renderVectorPaint } from '../engine/src/vector-paint.ts';
const font=readFileSync('shells/web/public/fonts/SUSE[wght].ttf'),arabic=readFileSync('tests/fixtures/text-composition/fonts/notosansarabic/NotoSansArabic[wdth,wght].ttf');
const parser=new(new JSDOM('').window.DOMParser)(),parse=(source:string)=>parser.parseFromString(source,'image/svg+xml'),service=createTextCompositionAPI(async resource=>resource.id==='arabic'?arabic:font,parse);
function fixture(source='Office blue 😀 and another line of words.'):TextLayoutRequestV1{
  const story=createTextStory('story',source,i=>`p${i}`);story.frameIds=['frame'];story.defaultStyle='body';story.spans=[{start:0,end:6,character:{underline:true,color:'#ee2266'}}];
  const offset=source.indexOf('😀');return {storyId:'story',includeSvg:true,document:{version:1,stories:[story],styles:[{id:'body',kind:'paragraph',name:'Body',paragraph:{character:{font:'font',fallbackFonts:['arabic'],size:26,axes:{wght:550}}}}],fonts:[{id:'font',family:'SUSE',faceIndex:0,sha256:createHash('sha256').update(font).digest('hex'),source:{kind:'bundled',path:'/fonts/SUSE[wght].ttf'}},{id:'arabic',family:'Arabic',faceIndex:0,sha256:createHash('sha256').update(arabic).digest('hex'),source:{kind:'bundled',path:'/fonts/arabic.ttf'}}]},frames:[{id:'frame',storyId:'story',mode:'fixed',width:300,height:220,inset:{top:8,right:8,bottom:8,left:8},columns:{count:1,gutter:0,balance:false},verticalAlign:'top'}],artwork:offset<0?[]:[{id:'emoji',sha256:'a'.repeat(64),start:offset,end:offset+2,width:26,ascent:21,descent:5,svg:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><defs><linearGradient id="g"><stop offset="0" stop-color="#ff8800"/><stop offset="1" stop-color="#8800ff"/></linearGradient><clipPath id="c"><circle cx="10" cy="10" r="10"/></clipPath></defs><g clip-path="url(#c)" opacity=".7"><rect width="15" height="20" fill="url(#g)"/><rect x="5" width="15" height="20" fill="#55aaff"/></g></svg>'}]};
}
function pixelError(a:string,b:string):number{const x=new Resvg(a).render().pixels,y=new Resvg(b).render().pixels;assert.equal(x.length,y.length);return x.reduce((sum,value,index)=>sum+Math.abs(value-y[index]!),0)/x.length;}
test('whole composed text becomes editable geometry with decorations and multicolour clipped artwork',async()=>{
  const request=fixture(),layout=await service.layoutRuns(request),converted=await textFrameVectors(layout,request.document.stories[0]!,'frame',parse);
  const svg=renderVectorPaint(converted.path,converted.paint,300,220,'placed');assert.ok(pixelError(layout.frames[0]!.svg!,svg)<.01);
  assert.equal(converted.label,request.document.stories[0]!.source);assert.ok(converted.path.length>100);assert.ok(JSON.stringify(converted.paint).includes('linearGradient'));
});
test('emoji-only inline conversion preserves placement, semantic source, resources and round-trip',async()=>{
  const request=fixture(),before=await service.layoutRuns(request),original=request.document.stories[0]!;let id=0;
  const converted=await textInlineVectors(before,original,{start:0,end:original.source.length},parse,'emoji',()=>`id-${id++}`);
  assert.equal(converted.count,1);assert.equal(textSemanticSource(converted.story).source,original.source);assert.ok(converted.story.source.includes('\ufffc'));
  request.document.stories[0]=converted.story;request.artwork=[];request.document=parseTextDocument(JSON.parse(JSON.stringify(request.document)));
  const after=await service.layoutRuns(request);assert.ok(pixelError(before.frames[0]!.svg!,after.frames[0]!.svg!)<.01);
});
test('text conversion retains line opportunities and bidi across fixed-advance inline clusters',async()=>{
  for(const source of ['Office with several words and another sentence to wrap.','مرحبا 123 عالم']){
    const request=fixture(source),before=await service.layoutRuns(request),story=request.document.stories[0]!;let id=0;
    const converted=await textInlineVectors(before,story,{start:0,end:story.source.length},parse,'text',()=>`id-${id++}`);
    request.document.stories[0]=converted.story;const after=await service.layoutRuns(request);
    assert.equal(textSemanticSource(converted.story).source,story.source);assert.equal(after.lines.length,before.lines.length);
    const error=pixelError(before.frames[0]!.svg!,after.frames[0]!.svg!);if(error>=.15){writeFileSync('/tmp/lolly-text-vector-before.svg',before.frames[0]!.svg!);writeFileSync('/tmp/lolly-text-vector-after.svg',after.frames[0]!.svg!);writeFileSync('/tmp/lolly-text-vector-layout.json',JSON.stringify({before,after},null,2));}assert.ok(error<.15,`${source}: ${error}`);
  }
});
test('conversion refuses a stale revision and an incomplete ligature without mutation',async()=>{
  const request=fixture('Office'),layout=await service.layoutRuns(request),story=request.document.stories[0]!,before=structuredClone(story);
  await assert.rejects(textInlineVectors({...layout,revision:99},story,{start:0,end:6},parse,'all',()=>''),{code:'layout-stale'});
  const cluster=layout.lines.flatMap(line=>line.runs.flatMap(run=>run.shape.clusters)).find(cluster=>cluster.end-cluster.start>1);assert.ok(cluster);
  await assert.rejects(textInlineVectors(layout,story,{start:cluster.start,end:cluster.start+1},parse,'all',()=>''),{code:'outline-cluster'});assert.deepEqual(story,before);
});

test('drop capitals, tab leaders and paragraph rules survive whole-frame conversion',async()=>{
  const request=fixture('An article starts here and runs beside a drop capital, then carries on below it.\nTotal\t12.50');request.frames[0]!.height=400;request.document.stories[0]!.spans=[];request.document.stories[0]!.paragraphs[0]!.paragraph={dropCap:{characters:1,lines:3,gap:8}};
  request.document.styles[0]!.paragraph!.tabs=[{position:200,align:'decimal',leader:'.'}];request.document.styles[0]!.paragraph!.ruleAfter={width:1,color:'#225588',offset:3};
  const layout=await service.layoutRuns(request),converted=await textFrameVectors(layout,request.document.stories[0]!,'frame',parse);assert.equal(layout.overset,null);assert.ok(pixelError(layout.frames[0]!.svg!,renderVectorPaint(converted.path,converted.paint,300,400,'converted'))<.02);
});


test('converted spaces retain their settled advance without applying word spacing twice',async()=>{
  const request=fixture('Several words with deliberate spacing and several more words to justify.');request.document.styles[0]!.paragraph!.wordSpacing={min:.8,ideal:1.3,max:3};request.document.styles[0]!.paragraph!.align='justify';
  const before=await service.layoutRuns(request),story=request.document.stories[0]!;let id=0;const converted=await textInlineVectors(before,story,{start:0,end:story.source.length},parse,'text',()=>`space-${id++}`);request.document.stories[0]=converted.story;
  const after=await service.layoutRuns(request);assert.equal(after.lines.length,before.lines.length);assert.ok(pixelError(before.frames[0]!.svg!,after.frames[0]!.svg!)<.1);
});

test('inherited drop capitals cannot be converted as independent inline glyphs',async()=>{
  const request=fixture('An article with a styled drop capital continues over several lines.');request.document.stories[0]!.spans=[];
  request.document.styles.push({id:'base',kind:'paragraph',name:'Base',paragraph:{dropCap:{characters:1,lines:2,gap:6}}});request.document.styles[0]!.basedOn='base';
  const layout=await service.layoutRuns(request),story=request.document.stories[0]!,before=structuredClone(story);
  assert.deepEqual(layout.lines[0]!.dropCap,{start:0,end:1});
  await assert.rejects(textInlineVectors(layout,story,{start:0,end:1},parse,'text',()=>''),{code:'outline-drop-cap'});assert.deepEqual(story,before);
});
