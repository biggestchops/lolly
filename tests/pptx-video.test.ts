// SPDX-License-Identifier: MPL-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPptxParts } from '../engine/src/pptx.ts';
test('MP4 has video, media and poster relationships plus looped autoplay timing',()=>{
 const movie=new Uint8Array([1,2,3]),poster=new Uint8Array([4,5]);
 const parts=buildPptxParts([{shapes:[],media:[],notes:'Recorded programme',video:{bytes:movie,poster,ext:'mp4',durationMs:10000,autoplay:true,loop:true}}]);
 assert.equal(parts['ppt/media/video1.mp4'],movie);assert.equal(parts['ppt/media/video1.png'],poster);
 const rels=String(parts['ppt/slides/_rels/slide1.xml.rels']);assert.match(rels,/relationships\/video/);assert.match(rels,/office\/2007\/relationships\/media/);assert.match(rels,/Id="rId5"/);
 const slide=String(parts['ppt/slides/slide1.xml']);assert.match(slide,/<a:videoFile r:link="rId3"/);assert.match(slide,/<p14:media[^>]+r:embed="rId4"/);assert.match(slide,/<p:video>/);assert.match(slide,/repeatCount="indefinite"/);assert.match(slide,/spid="2"/);assert.match(String(parts['[Content_Types].xml']),/video\/mp4/);
});
test('silent slides can advance independently of narration',()=>{
 const parts=buildPptxParts([{shapes:[],media:[],advanceAfterMs:12500}]);assert.match(String(parts['ppt/slides/slide1.xml']),/<p:transition advTm="12500"\/>/);
});
test('invalid video fails rather than creating an incomplete media package',()=>{
 assert.throws(()=>buildPptxParts([{shapes:[],media:[],video:{bytes:new Uint8Array(),poster:new Uint8Array(),ext:'mp4',durationMs:1}}]),/requires MP4/);
});

test('autoplay video is a direct child of the root clock, outside effect sequences',()=>{
 const p=buildPptxParts([{shapes:[],media:[],video:{bytes:new Uint8Array([1]),poster:new Uint8Array([2]),ext:'mp4',durationMs:1000,autoplay:true,loop:true}}]);
 const xml=String(p['ppt/slides/slide1.xml']);assert.doesNotMatch(xml,/<p:seq/);assert.match(xml,/nodeType="tmRoot"><p:childTnLst><p:video>/);assert.match(xml,/display="0"/);
});
