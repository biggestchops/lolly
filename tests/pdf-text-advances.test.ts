// SPDX-License-Identifier: MPL-2.0
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {interpretPdfPage, type PdfFontInfo} from '../engine/src/pdf-map.ts';
import {pdfNodesToSvg} from '../engine/src/pdf-svg.ts';
import {finalizeBoxes} from '../engine/src/design-map.ts';

const font: PdfFontInfo = {family:'Example', defaultWidth:600, widths:{32:250,73:200,87:900}};
const parse=(content:string, fonts:Record<string,PdfFontInfo>={F:font})=>interpretPdfPage({width:600,height:400,content,fonts});
test('glyph advances join positioned fragments beyond three em into a whole heading',()=>{
  const nodes=parse('BT /F 20 Tf 1 0 0 1 40 300 Tm (ADVAN) Tj 1 0 0 1 100 300 Tm (CED) Tj ET');
  assert.equal(nodes.length,1);assert.equal(nodes[0]!.text,'ADVANCED');assert.equal(nodes[0]!.w,96);
});
test('widths use character codes before a CID Unicode mapping',()=>{
  const nodes=parse('BT /F 20 Tf 1 0 0 1 40 300 Tm <00010002> Tj ET',{F:{twoByte:true,decode:()=> 'Wi', widths:{1:900,2:200},defaultWidth:1000}});
  assert.equal(nodes[0]!.text,'Wi');assert.equal(nodes[0]!.w,22);
});
test('kerning, character spacing, word spacing and horizontal scale advance the pen',()=>{
  const nodes=parse('BT /F 20 Tf 2 Tc 3 Tw 50 Tz 1 0 0 1 40 300 Tm [(WI) 100 ( W)] TJ ET');
  // (18+2 +4+2 +5+2+3 +18+2 -2) / 2.
  assert.equal(nodes[0]!.w,27);assert.equal(nodes[0]!.tracking,1);
  assert.equal(finalizeBoxes(nodes)[0]!.tracking,1);
  assert.match(pdfNodesToSvg(nodes,{width:600,height:400}),/letter-spacing="1"/);
});
test('same-baseline columns remain separate and styled spans keep their positions',()=>{
  const nodes=parse('BT /F 20 Tf 1 0 0 1 40 300 Tm (Name) Tj 1 0 0 1 300 300 Tm (Other) Tj 1 0 0 rg (Red) Tj ET');
  assert.deepEqual(nodes.map(n=>n.text),['Name','Other','Red']);
  assert.deepEqual(nodes.map(n=>n.x),[40,300,360]);assert.equal(nodes[2]!.fg,'#ff0000');
});
