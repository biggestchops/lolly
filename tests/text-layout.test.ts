// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { TextLayoutRequestV1 } from '@lolly-tools/core';
import { createPinnedTextShaper } from '../packages/node-shell/src/text-fonts.ts';
import { createTextStory } from '../engine/src/text-story-document.ts';
import { composeText } from '../engine/src/text-layout.ts';
const bytes = readFileSync('shells/web/public/fonts/SUSE[wght].ttf');
const services = createPinnedTextShaper(async () => bytes);
function fixture(source: string): TextLayoutRequestV1 {
  const story = createTextStory('story',source,i=>`p${i}`); story.frameIds=['frame']; story.defaultStyle='body';
  return { storyId:'story', document:{ version:1,stories:[story],fonts:[{id:'font',family:'SUSE',faceIndex:0,
    sha256:createHash('sha256').update(bytes).digest('hex'),source:{kind:'bundled',path:'/fonts/SUSE[wght].ttf'}}],
    styles:[{id:'body',name:'Body',kind:'paragraph',paragraph:{character:{font:'font',size:24,weight:400},lineHeight:1.2}}]},
    frames:[{id:'frame',storyId:'story',width:180,height:100,mode:'auto-height',inset:{top:8,right:8,bottom:8,left:8},columns:{count:1,gutter:0,balance:false},verticalAlign:'top'}] };
}
test('wrapped source ranges, source breaks and final blank paragraphs survive settled layout',async()=>{
  const request=fixture('The quick brown fox jumps over the lazy dog.\r\nAnother\u2028line\n');
  const original=structuredClone(request),layout=await composeText(request,services);
  assert.deepEqual(request,original);
  assert.ok(layout.lines.length>4);assert.equal(layout.overset,null);
  assert.equal(layout.lines.at(-1)!.start,request.document.stories[0]!.source.length);
  assert.equal(layout.frames[0]!.end,request.document.stories[0]!.source.length);
  assert.ok(layout.lines.every(line=>line.width<=164));
  assert.deepEqual(await composeText(request,services),layout);
  const soft=request.document.stories[0]!.breaks.find(item=>item.kind==='soft')!;
  assert.ok(layout.lines.some(line=>line.end===soft.start+soft.length));
  assert.ok(layout.lines.some(line=>line.start===soft.start+soft.length));
});
test('fixed frames retain overset source; auto width keeps authored font size and manual lines',async()=>{
  const request=fixture('Some words repeat. Some words repeat. Some words repeat.');
  request.frames[0]!.mode='fixed';request.frames[0]!.height=45;
  const clipped=await composeText(request,services);
  assert.ok(clipped.overset);assert.equal(clipped.frames[0]!.end,clipped.overset.start);
  assert.equal(clipped.overset.end,request.document.stories[0]!.source.length);
  assert.ok(clipped.diagnostics.some(item=>item.code==='overset'));
  request.frames[0]!.mode='auto-width';
  const wide=await composeText(request,services);
  assert.equal(wide.lines.length,1);assert.ok(wide.frames[0]!.width>180);
  assert.ok(wide.lines.flatMap(line=>line.runs).every(run=>run.shape.size===24));
});
test('no-break constraints fail visibly without rewriting text or silently squeezing glyphs',async()=>{
  const request=fixture('Keep all these words together');request.document.stories[0]!.spans=[{start:0,end:request.document.stories[0]!.source.length,noBreak:true}];
  const layout=await composeText(request,services);
  assert.equal(layout.lines.length,1);assert.ok(layout.diagnostics.some(item=>item.code==='line-width'));
  assert.equal(request.document.stories[0]!.source,'Keep all these words together');
});
test('Balanced keeps the line count and reduces heading imbalance without rewriting the source', async () => {
  const request = fixture('Make beautiful typography for everyone'); request.frames[0]!.width = 346;
  const standard = await composeText(request, services);
  request.document.styles[0]!.paragraph!.composition = 'balanced';
  const before = structuredClone(request), balanced = await composeText(request, services);
  const unevenness = (lines: typeof standard.lines) => Math.max(...lines.map(line => line.width)) - Math.min(...lines.map(line => line.width));
  assert.equal(balanced.lines.length, standard.lines.length); assert.ok(unevenness(balanced.lines) < unevenness(standard.lines));
  assert.deepEqual(request, before); assert.deepEqual(await composeText(request, services), balanced);
});
test('short final lines pull a word back while forced lines and two-word headings stay valid', async () => {
  const request = fixture('Make beautiful typography for everyone'); request.frames[0]!.width = 346;
  request.document.styles[0]!.paragraph!.shortLastLine = { enabled: true, words: 2, fraction: .2 };
  let layout = await composeText(request, services);
  assert.equal(request.document.stories[0]!.source.slice(layout.lines.at(-1)!.start), 'for everyone');
  const forced = fixture('Make beautiful typography\u2028for everyone'); forced.frames[0]!.width = 346;
  forced.document.styles[0]!.paragraph!.composition = 'balanced';
  layout = await composeText(forced, services); assert.equal(layout.lines[0]!.end, 26);
  const short = fixture('Hello world'); short.frames[0]!.width = 90;
  short.document.styles[0]!.paragraph!.shortLastLine = { enabled: true, words: 2, fraction: .7 };
  layout = await composeText(short, services); assert.equal(layout.lines.length, 2); assert.ok(!layout.diagnostics.some(item => item.code === 'short-last-line'));
});
test('hyphenation is pinned, source-preserving and reports an unavailable language', async () => {
  const request = fixture('Extraordinary composition hyphenation'); request.frames[0]!.width = 146;
  const paragraph = request.document.styles[0]!.paragraph!;
  paragraph.composition = 'best'; paragraph.language = 'en-us';
  paragraph.hyphenation = { mode: 'auto', minWord: 5, minBefore: 2, minAfter: 3, consecutive: 2 };
  const before = structuredClone(request), layout = await composeText(request, services);
  assert.ok(layout.lines.some(line => line.hyphen)); assert.ok(layout.lines.every(line => line.width <= 130));
  assert.ok(layout.resources.some(item => item.id === 'hyphen:en-us' && /^[a-f0-9]{64}$/.test(item.sha256)));
  assert.deepEqual(request, before); assert.deepEqual(await composeText(request, services), layout);
  paragraph.language = 'xx';
  const unavailable = await composeText(request, services); assert.ok(unavailable.diagnostics.some(item => item.code === 'hyphenation-language')); assert.ok(!unavailable.lines.some(line => line.hyphen));
  const manual = fixture('hy\u00adphenation'); manual.frames[0]!.width = 116;
  const visible = await composeText(manual, services); assert.ok(visible.lines[0]!.hyphen); assert.equal(visible.lines[0]!.end, 3);
  manual.frames[0]!.width = 400; const unbroken = await composeText(manual, services); assert.ok(!unbroken.lines[0]!.hyphen); assert.equal(unbroken.lines.length, 1);
});
test('justification moves word-space advances and carets without scaling glyphs', async () => {
  const request = fixture('The quick brown fox jumps over the lazy dog.'); request.frames[0]!.width = 228;
  const paragraph = request.document.styles[0]!.paragraph!; paragraph.align = 'justify'; paragraph.wordSpacing = { min: .8, ideal: 1, max: 4 };
  const layout = await composeText(request, services), first = layout.lines[0]!;
  assert.ok(Math.abs(first.width - 212) < .001); assert.ok(layout.lines.at(-1)!.width < 212);
  for (const line of layout.lines) for (const run of line.runs) {
    assert.equal(run.shape.size, 24);
    for (const cluster of run.shape.clusters) for (const caret of cluster.carets) assert.ok(line.carets.some(stop => stop.offset === caret.offset && Math.abs(stop.x-run.x-caret.x)<.001));
  }
  paragraph.wordSpacing.max = 1; const constrained = await composeText(request, services); assert.ok(constrained.diagnostics.some(item => item.code === 'word-spacing'));
});
test('fixed-frame alignment, first baseline and inherited grid move ink and native carets together', async () => {
  const request = fixture('First line\nSecond line'), frame = request.frames[0]!;
  frame.mode = 'fixed'; frame.height = 240; frame.firstBaseline = 40; frame.grid = { step: 30, offset: 8 };
  request.document.styles[0]!.paragraph!.baselineGrid = true;
  const top = await composeText(request, services); assert.ok(top.lines[0]!.baseline >= 48);
  assert.ok(top.lines.every(line => Math.abs((line.baseline - 8)/30-Math.round((line.baseline - 8)/30)) < .0001));
  frame.verticalAlign = 'bottom'; const bottom = await composeText(request, services);
  const offset = bottom.lines[0]!.y - top.lines[0]!.y; assert.ok(offset > 0); assert.ok(Math.abs(offset/30-Math.round(offset/30)) < .0001);
  for (let i=0;i<top.lines.length;i++) {
    assert.ok(Math.abs(bottom.lines[i]!.carets[0]!.y-top.lines[i]!.carets[0]!.y-offset) < .0001);
    assert.ok(Math.abs(bottom.lines[i]!.runs[0]!.y-top.lines[i]!.runs[0]!.y-offset) < .0001);
  }
});

test('decimal tabs, leaders and paragraph rules are settled geometry without source rewrites',async()=>{
  const request=fixture('Tea\t12.50\nCoffee\t3.25');request.frames[0]!.width=400;
  const settings=request.document.styles[0]!.paragraph!;settings.tabs=[{position:200,align:'decimal',leader:'.'}];settings.ruleBefore={width:1,color:'#aa0000',offset:2};settings.ruleAfter={width:2,color:'#0000aa',offset:3};
  const original=structuredClone(request),layout=await composeText(request,services);assert.deepEqual(request,original);assert.equal(layout.lines.length,2);
  for(const line of layout.lines){const at=request.document.stories[0]!.source.indexOf('.',line.start),caret=line.carets.find(caret=>caret.offset===at)!;assert.ok(Math.abs(caret.x-208)<.01,JSON.stringify(line.carets));assert.ok(line.leaders?.[0]?.count);assert.equal(line.rules?.length,2);}
  assert.equal(layout.overset,null);assert.deepEqual(layout.diagnostics,[]);
});

test('drop capitals reserve authored lines and preserve source and caret ownership',async()=>{
  const request=fixture('An article starts here with enough words to flow beside a drop capital and resume the full measure below it.\nNext paragraph.');request.frames[0]!.width=300;
  request.document.stories[0]!.paragraphs[0]!.paragraph={dropCap:{characters:1,lines:3,gap:8}};
  const settings=request.document.stories[0]!.paragraphs[0]!.paragraph;
  const original=structuredClone(request),layout=await composeText(request,services);assert.deepEqual(request,original);assert.equal(layout.overset,null);
  const lines=layout.lines.filter(line=>line.paragraphId==='p0');assert.ok(lines.length>3);assert.ok(lines[0]!.x>lines[3]!.x+10);assert.equal(lines[0]!.x,lines[2]!.x);
  const cap=lines[0]!.runs.find(run=>run.shape.start===0)!;assert.ok(cap.shape.size>60);assert.equal(cap.shape.end,1);assert.ok(lines[0]!.carets.some(caret=>caret.offset===0&&caret.height>60));
  const next=layout.lines.find(line=>line.paragraphId==='p1')!;assert.ok(next.y>=lines[0]!.y+lines[0]!.carets.find(caret=>caret.offset===0)!.height);
  Object.assign(settings.dropCap!,{enabled:false});const plain=await composeText(request,services);assert.equal(plain.lines[0]!.x,8);assert.ok(plain.lines[0]!.runs.every(run=>run.shape.size===24));
});


test('shrink to fit preserves source, geometry and receipts while respecting the smallest authored size',async()=>{
  const request=fixture('Some words repeat. Some words repeat. Some words repeat.');
  request.frames[0]!.mode='fixed';request.frames[0]!.height=64;request.frames[0]!.shrink={minSize:8};
  const original=structuredClone(request),layout=await composeText(request,services);
  assert.deepEqual(request,original);assert.equal(layout.overset,null);assert.ok(layout.frames[0]!.appliedScale!<1);assert.equal(layout.frames[0]!.height,64);
  assert.ok(layout.lines.flatMap(line=>line.runs).every(run=>run.shape.size>=8));
  const tiny=structuredClone(request);tiny.frames[0]!.height=18;
  const clipped=await composeText(tiny,services);assert.ok(clipped.overset);assert.ok(Math.abs(clipped.frames[0]!.appliedScale!-1/3)<.0001);
  const linked=structuredClone(request);linked.document.stories[0]!.frameIds.push('second');linked.frames.push({...linked.frames[0]!,id:'second'});
  await assert.rejects(()=>composeText(linked,services),{code:'frame-shrink'});
});

test('explicit text-and-frame scaling doubles geometry with the same source and line breaks',async()=>{
  const {scaleTextStory,scaleTextFrame}=await import('../engine/src/text-scale.ts');
  const request=fixture('Some words repeat. Some words repeat.');request.document.stories[0]!.spans=[{start:0,end:4,character:{size:26,tracking:.5}}];
  const original=structuredClone(request),before=await composeText(request,services),scaled={...request,document:scaleTextStory(request.document,'story',2),frames:request.frames.map(frame=>scaleTextFrame(frame,2))},after=await composeText(scaled,services);
  assert.deepEqual(request,original);assert.equal(scaled.document.stories[0]!.source,request.document.stories[0]!.source);assert.deepEqual(after.lines.map(line=>[line.start,line.end]),before.lines.map(line=>[line.start,line.end]));
  for(let i=0;i<before.lines.length;i++){assert.ok(Math.abs(after.lines[i]!.baseline-before.lines[i]!.baseline*2)<.01);assert.ok(Math.abs(after.lines[i]!.width-before.lines[i]!.width*2)<.02);}
});
