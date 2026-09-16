// SPDX-License-Identifier: MPL-2.0
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {interpretPdfPage} from '../../../../engine/src/pdf-map.ts';
import {finalizeBoxes} from '../../../../engine/src/design-map.ts';
import {pdfDesignNodes, type PdfDesignNotice} from './pdf-design-nodes.ts';

async function convert(content:string, image=async()=> 'data:image/png;base64,AA==') {
  const notices:PdfDesignNotice[]=[];const svgs:string[]=[];
  const nodes=interpretPdfPage({width:400,height:300,content,xobjects:{Im:{kind:'image',imageKey:'photo'}}});
  const mapped=await pdfDesignNodes(nodes,{width:400,height:300,image,notice:n=>notices.push(n),store:async svg=>{
    svgs.push(svg);return {id:`user/${svgs.length}`,source:'user',type:'vector',format:'svg',url:'data:image/svg+xml,'+encodeURIComponent(svg)};
  }});
  return {nodes,mapped,boxes:finalizeBoxes(mapped),notices,svgs};
}
test('page rectangle clips keep headings editable without padding',async()=>{
  const result=await convert('0 0 400 300 re W n BT /F 20 Tf 1 0 0 1 50 200 Tm (Heading) Tj ET');
  assert.equal(result.boxes[0]!.kind,'text');assert.equal(result.boxes[0]!.text,'Heading');assert.equal(result.boxes[0]!.pad,0);assert.equal(result.boxes[0]!.bg,'');assert.deepEqual(result.notices,[]);
});
test('cropped raster artwork retains its clip and has no editor background',async()=>{
  const result=await convert('50 80 100 120 re W n 200 0 0 200 0 0 cm /Im Do');
  const box=result.boxes[0]!;assert.equal(box.kind,'image');assert.equal(box.bg,'');assert.equal(box.pad,0);assert.equal(box.opacity,100);
  assert.match(result.svgs[0]!,/<clipPath/);assert.match(result.svgs[0]!,/data:image\/png;base64,AA==/);assert.equal(result.notices[0]!.kind,'fixed');
});
test('complex vector fill rules and strokes survive conversion',async()=>{
  const result=await convert('1 0 0 rg 0 0 1 RG 3 w 30 20 200 100 re 60 40 140 60 re B*');
  assert.match(result.svgs[0]!,/fill-rule="evenodd"/);assert.match(result.svgs[0]!,/stroke="#0000ff"/);assert.match(result.svgs[0]!,/stroke-width="3"/);assert.equal(result.boxes[0]!.bg,'');
});
test('stroked rectangles retain their border as vector artwork',async()=>{
  const result=await convert('1 0 0 rg 0 0 1 RG 3 w 30 20 200 100 re B');
  assert.match(result.svgs[0]!,/stroke="#0000ff"/);
});
test('unavailable artwork fails visibly instead of leaving an empty image',async()=>{
  await assert.rejects(convert('200 0 0 200 0 0 cm /Im Do',async()=>undefined as unknown as string),/could not be decoded/);
});
test('a true text crop stays artwork and carries a repair notice',async()=>{
  const result=await convert('50 80 10 120 re W n BT /F 20 Tf 1 0 0 1 50 190 Tm (Heading) Tj ET');
  assert.equal(result.boxes[0]!.kind,'image');assert.equal(result.notices[0]!.kind,'review');assert.equal(result.notices[0]!.object,'Heading');
});

test('four-curve decorative artwork is not replaced by its bounding ellipse',async()=>{
  const result=await convert('1 0.5 0 rg 20 100 m 80 140 100 150 120 100 c 120 70 100 40 90 20 c 80 70 50 50 40 80 c 35 90 25 95 20 100 c h f');
  assert.equal(result.nodes[0]!._vectorPath?.startsWith('M'),true);
  assert.match(result.svgs[0]!,/<path/);assert.doesNotMatch(result.svgs[0]!,/<ellipse/);
});
