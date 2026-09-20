// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { TextLayoutRequestV1,TextWrapObjectV1 } from '@lolly-tools/core';
import { createTextStory } from '../engine/src/text-story-document.ts';
import { composeText } from '../engine/src/text-layout.ts';
import { prepareTextWrap,textWrapBand } from '../engine/src/text-wrap.ts';
import { createPinnedTextShaper } from '../packages/node-shell/src/text-fonts.ts';
const bytes=readFileSync('shells/web/public/fonts/SUSE[wght].ttf'),services=createPinnedTextShaper(async()=>bytes);
function fixture():TextLayoutRequestV1{
 const story=createTextStory('story','An article wraps around the picture, retaining its source and all of its words. '.repeat(8),i=>`p${i}`);story.frameIds=['frame'];story.defaultStyle='body';
 return {storyId:'story',document:{version:1,stories:[story],styles:[{id:'body',kind:'paragraph',name:'Body',paragraph:{character:{font:'font',size:20}}}],fonts:[{id:'font',family:'SUSE',faceIndex:0,sha256:createHash('sha256').update(bytes).digest('hex'),source:{kind:'bundled',path:'/fonts/SUSE[wght].ttf'}}]},frames:[{id:'frame',storyId:'story',width:400,height:1000,mode:'fixed',inset:{top:8,right:8,bottom:8,left:8},columns:{count:1,gutter:0,balance:false},verticalAlign:'top'}],wrap:{placements:[{id:'frame',scope:'page',x:100,y:100,width:400,height:1000,rotation:0}],objects:[]}};
}
const obstacle=(patch:Partial<TextWrapObjectV1>={}):TextWrapObjectV1=>({id:'image',scope:'page',x:100,y:130,width:140,height:130,rotation:0,mode:'box',offset:{top:8,right:8,bottom:8,left:8},geometry:{kind:'rect'},...patch});
test('explicit bounding-box wrap follows geometry, scope and frame opt-out without changing source',async()=>{
 const request=fixture(),plain=await composeText(request,services);request.wrap!.objects=[obstacle()];const original=structuredClone(request),wrapped=await composeText(request,services);assert.deepEqual(request,original);assert.equal(wrapped.overset,null);assert.ok(wrapped.lines.some(line=>line.x>=148));
 for(const line of wrapped.lines.filter(line=>line.y+line.height>22&&line.y<168))assert.ok(line.x>=148&&line.x+line.width<=392.001);
 assert.equal(wrapped.frames[0]!.end,request.document.stories[0]!.source.length);
 request.wrap!.objects[0]!.scope='other-page';assert.deepEqual((await composeText(request,services)).lines,plain.lines);
 request.wrap!.objects[0]!.scope='page';request.frames[0]!.honorWrap=false;assert.deepEqual((await composeText(request,services)).lines,plain.lines);
 request.frames[0]!.honorWrap=true;request.wrap!.objects[0]!.x=330;const moved=await composeText(request,services);assert.ok(moved.lines.filter(line=>line.y+line.height>22&&line.y<168).every(line=>line.x===8&&line.x+line.width<=222.001));
});
test('closed ellipse contour admits more space near its edge and transforms with the text frame',()=>{
 const request=fixture();request.wrap!.objects=[obstacle({x:100,y:100,width:160,height:160,mode:'contour',offset:{top:0,right:0,bottom:0,left:0},geometry:{kind:'ellipse'}})];
 const contours=prepareTextWrap(request.wrap,request.frames).get('frame')!,top=textWrapBand(contours,0,400,0,10,'ltr'),middle=textWrapBand(contours,0,400,75,10,'ltr');assert.ok(top.left<middle.left-20);assert.ok(middle.left>=160);assert.ok(middle.left<161);
 request.wrap!.placements[0]!.rotation=180;const rotated=prepareTextWrap(request.wrap,request.frames).get('frame')!;assert.ok(textWrapBand(rotated,0,400,915,10,'rtl').width<400);
});
test('full-width obstacles advance to a clear band and malformed contours fail before layout',async()=>{
 const request=fixture();request.wrap!.objects=[obstacle({x:90,y:100,width:440,height:120})];const layout=await composeText(request,services);assert.ok(layout.lines[0]!.y>=128);assert.equal(layout.overset,null);
 request.wrap!.objects[0]!.mode='contour';request.wrap!.objects[0]!.geometry={kind:'path',path:'garbage'};await assert.rejects(composeText(request,services),{code:'text-wrap'});
});
