// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { createTextCompositionAPI } from '../packages/node-shell/src/text-composition.ts';
import { createTextStory } from '../engine/src/text-story-document.ts';
import { textLayoutSvg } from '../engine/src/text-layout-svg.ts';
import type { TextLayoutRequestV1 } from '@lolly-tools/core';
const bytes=readFileSync('shells/web/public/fonts/SUSE[wght].ttf');
const parser=new (new JSDOM('').window.DOMParser)(),parseXml=(source:string)=>parser.parseFromString(source,'image/svg+xml');
const service=createTextCompositionAPI(async()=>bytes,parseXml);
function fixture(source='Office & <literal>\u00a0\r\n'):TextLayoutRequestV1 {
  const story=createTextStory('story',source,i=>`p${i}`);story.frameIds=['frame'];story.defaultStyle='body';
  return {storyId:'story',includeSvg:true,document:{version:1,stories:[story],fonts:[{id:'sans',family:'SUSE',sha256:createHash('sha256').update(bytes).digest('hex'),faceIndex:0,source:{kind:'bundled',path:'/fonts/SUSE[wght].ttf'}}],styles:[{id:'body',name:'Body',kind:'paragraph',paragraph:{character:{font:'sans',size:24,weight:400,color:'#224466',underline:true}}}]},frames:[{id:'frame',storyId:'story',width:230,height:100,mode:'auto-height',inset:{top:4,right:4,bottom:4,left:4},columns:{count:1,gutter:0,balance:false},verticalAlign:'top'}]};
}
test('vector markup carries the exact settled paths, colour, decoration and literal source',async()=>{
  const request=fixture(),layout=await service.layoutRuns(request),svg=layout.frames[0]!.svg!,dom=parseXml(svg);
  assert.equal(dom.querySelector('parsererror'),null);assert.equal(dom.querySelector('title')!.textContent,request.document.stories[0]!.source);
  assert.deepEqual([...dom.querySelectorAll('path')].map(path=>path.getAttribute('d')),layout.lines.flatMap(line=>line.runs.flatMap(run=>run.shape.clusters.map(cluster=>cluster.d))));
  assert.ok(dom.querySelector('rect'));assert.equal(dom.querySelector('g')!.getAttribute('fill'),'#224466');
  assert.equal(await textLayoutSvg(layout,request.document.stories[0]!,'frame',parseXml),svg);
  await assert.rejects(()=>textLayoutSvg({...layout,revision:1},request.document.stories[0]!,'frame',parseXml),/revision/);
});
test('inline gradients, clips and shape dimensions survive fitting with unique local ids',async()=>{
  const request=fixture('\ufffc \ufffc'),story=request.document.stories[0]!;
  const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 20"><defs><linearGradient id="paint"><stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/></linearGradient><clipPath id="cut"><rect width="10" height="20"/></clipPath></defs><rect width="10" height="20" fill="url(#paint)" clip-path="url(#cut)"/></svg>';
  story.inlines=[0,2].map((offset,i)=>({id:`inline${i}`,offset,label:'Artwork',originalText:'😀',svg,width:20,ascent:30,descent:10}));
  const layout=await service.layoutRuns(request),dom=parseXml(layout.frames[0]!.svg!);
  const nested=[...dom.querySelectorAll('svg svg')];assert.equal(nested.length,2);assert.ok(nested.every(svg=>svg.getAttribute('width')==='20'&&svg.getAttribute('height')==='40'));
  const ids=[...dom.querySelectorAll('[id]')].map(el=>el.id);assert.equal(new Set(ids).size,4);
  assert.ok([...dom.querySelectorAll('clipPath rect')].every(rect=>rect.getAttribute('width')==='10'&&rect.getAttribute('height')==='20'));
});
test('authored text and inline vector paints retain wide-gamut and HDR component values', async () => {
  const request = fixture('HDR \ufffc');
  request.document.styles[0]!.paragraph!.character!.color = 'color(srgb-linear 2.4 0.1 0.4 / 0.5)';
  request.document.stories[0]!.inlines = [{ id: 'inline', offset: 4, label: 'Colour', originalText: 'x', width: 24, ascent: 24, descent: 0,
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path fill="color(display-p3 1 0.1 0.2)" d="M0 0H10V10H0Z"/></svg>' }];
  const layout = await service.layoutRuns(request), svg = layout.frames[0]!.svg!;
  assert.match(svg, /fill="color\(srgb-linear 2\.4 0\.1 0\.4 \/ 0\.5\)"/);
  assert.match(svg, /fill="color\(display-p3 1 0\.1 0\.2\)"/);
  for (const color of ['url(https://invalid.test/image)', 'var(--secret)', '#000000" onload="bad()']) {
    request.document.styles[0]!.paragraph!.character!.color = color;
    await assert.rejects(() => service.layoutRuns(request), /colour/);
  }
});
test('hostile or unsupported inline artwork fails the whole vector result',async()=>{
  for(const child of ['<script>alert(1)</script>','<image href="https://example.invalid/leak" width="10" height="20"/>','<path onload="alert(1)" d="M0 0L1 1"/>','<foreignObject width="10" height="20"/>']){
    const request=fixture('\ufffc');request.document.stories[0]!.inlines=[{id:'inline',offset:0,label:'Artwork',originalText:'x',width:10,ascent:20,descent:0,svg:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 20">${child}</svg>`}];
    await assert.rejects(()=>service.layoutRuns(request),/Unsupported/);
  }
});
