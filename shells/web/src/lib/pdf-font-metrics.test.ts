// SPDX-License-Identifier: MPL-2.0
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import {pdfFontMetrics} from './pdf-font-metrics.ts';

test('simple fonts retain zero advances and their character-code offset',async()=>{
  const {context:ctx}=await PDFDocument.create();
  const font=ctx.obj({Subtype:'TrueType',FirstChar:65,Widths:[600,0,700],FontDescriptor:{MissingWidth:500}});
  assert.deepEqual(pdfFontMetrics(ctx,font),{widths:{65:600,66:0,67:700},defaultWidth:500});
});
test('CID widths support array and range forms plus the default',async()=>{
  const {context:ctx}=await PDFDocument.create();
  const font=ctx.obj({Subtype:'Type0',DescendantFonts:[{DW:900,W:[1,[100,200],10,12,800]}]});
  assert.deepEqual(pdfFontMetrics(ctx,font),{widths:{1:100,2:200,10:800,11:800,12:800},defaultWidth:900});
});
test('missing and malformed metrics are bounded and safe',async()=>{
  const {context:ctx}=await PDFDocument.create();
  assert.deepEqual(pdfFontMetrics(ctx,ctx.obj({Subtype:'Type0',DescendantFonts:[]})),{widths:{},defaultWidth:1000});
  assert.deepEqual(pdfFontMetrics(ctx,ctx.obj({Subtype:'Type0',DescendantFonts:[{W:[0,1e9,600]}]})),{widths:{},defaultWidth:1000});
  assert.deepEqual(pdfFontMetrics(ctx,ctx.obj({Subtype:'Type1'})),{});
});
