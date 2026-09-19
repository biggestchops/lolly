// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { getBrowser, closeBrowser } from '../packages/node-shell/src/browsers.ts';
const origin=process.env.LOLLY_EXPORT_TEST_URL;
test('Darkroom, Design and raw HDR video preserve headroom in the browser', {skip:origin?false:'set LOLLY_EXPORT_TEST_URL',timeout:120000},async()=>{
  const browser=await getBrowser(),context=await browser.newContext();
  try{
    const page=await context.newPage();
    await page.route('**/deep-editing-test',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><body style="margin:0"></body>'}));
    await page.goto(`${origin}/deep-editing-test`);
    const hooks=await readFile(new URL('../community/darkroom/hooks.js',import.meta.url),'utf8');
    const manifest=JSON.parse(await readFile(new URL('../community/darkroom/tool.json',import.meta.url),'utf8'));
    const result=await page.evaluate(async({hooks,manifest,root})=>{
      const web='/src/bridge/';
      const sequence = await (await import(root+'tests/helpers/deep-sequence-browser.ts')).sequenceHdrRoundtrip();
      const {packExr}=await import(root+'engine/src/exr.ts');
      const {createCodecAPI}=await import(web+'codec.ts');
      const {createRasterAPI}=await import(web+'raster.ts');
      const {buildInputModel}=await import(root+'engine/src/inputs.ts');
      const input={width:4,height:2,space:'srgb-linear',data:Float32Array.from({length:32},(_,i)=>[.25,.5,4,1][i%4]!)};
      const bytes=packExr(input,{pixelType:'float'}),url=URL.createObjectURL(new Blob([bytes],{type:'image/x-exr'}));
      const host={codec:createCodecAPI({bytes:async()=>bytes}),raster:createRasterAPI(),assets:{get:async()=>null},log(){}};
      const hooksApi=new Function('host',hooks+';return {onInit,exportStill};')(host);
      const model=buildInputModel(manifest,{initial:{editingRange:'hdr',width:4,height:2,image:{id:'test/exr',type:'raster',format:'exr',url}}});
      const preview=await hooksApi.onInit({model});
      const output=await hooksApi.exportStill({format:'png',opts:{hdr:true},host});
      if(!output?.frame)throw new Error(preview.note??'No HDR frame');
      const {createFloatCanvas}=await import(web+'deep-canvas.ts');
      const {pqEncode}=await import(root+'engine/src/hdr.ts');
      const code=Math.round(64+pqEncode(1000)*876),pixels=Uint16Array.of(code,code,code,code,512,512);
      const Frame=VideoFrame as unknown as new (data: Uint16Array, init: object) => VideoFrame;
      const raw=new Frame(pixels,{format:'I420P10',codedWidth:2,codedHeight:2,timestamp:0,colorSpace:{primaries:'bt2020',transfer:'pq',matrix:'bt2020-ncl',fullRange:false}});
      const float=createFloatCanvas(2,2);
      await float.context.drawDeepSample({toVideoFrame:()=>raw.clone(),rotation:90},0,0,2,2);raw.close();
      const {renderDeepDesign}=await import(web+'deep-design.ts');
      const stage=document.createElement('div');stage.className='artboard';stage.style.cssText='width:64px;height:32px;position:relative;background:transparent';
      stage.innerHTML='<div class="lolly-box" style="position:absolute;left:0;top:0;width:64px;height:32px;opacity:1"><img class="lolly-box-img" style="position:absolute;left:0;top:0;width:100%;height:100%;object-fit:fill" /></div>';
      const image=stage.querySelector('img')!;image.src=preview.outSrc;image.setAttribute('data-deep-source',JSON.stringify({id:'test/exr',type:'raster',format:'exr',url}));document.body.append(stage);await image.decode();
      const design=await renderDeepDesign(stage,{},host);
      const {convertSpace}=await import(root+'engine/src/pixels.ts');
      const {applyBrandFaces}=await import('/src/'+'brand-faces.ts');
      const brand=document.createElement('div'),chip=document.createElement('div');document.body.append(brand);brand.append(chip);
      applyBrandFaces(brand,[{ref:'{color.semantic.primary}',path:'color.semantic.primary',name:'Primary',value:'#008800',faces:{'display-p3':'color(display-p3 0 1 0)'}}]);
      chip.style.background='var(--brand-primary)';const standard=getComputedStyle(chip).backgroundColor;
      chip.dataset.editingRange='hdr';const wide=getComputedStyle(chip).backgroundColor;

      const srgb=convertSpace(design,'srgb-linear');
      return {standard,wide,sequence,darkroom:Array.from(output.frame.data.slice(0,4) as Float32Array),videoNits:float.frame.data[0]*203,design:Array.from(srgb.data.slice((16*64+32)*4,(16*64+32)*4+4) as Float32Array),preview:preview.outSrc.startsWith('data:image/png')};
    },{hooks,manifest,root:'/@fs'+fileURLToPath(new URL('../',import.meta.url))});
    assert.equal(result.standard,'rgb(0, 136, 0)');assert.equal(result.wide,'color(display-p3 0 1 0)');
    assert.ok(Math.abs(result.sequence.nits-1000)<35,JSON.stringify(result.sequence));
    assert.ok(Math.abs(result.sequence.duration-.5)<.05,JSON.stringify(result.sequence));
    assert.ok(result.preview);assert.ok(Math.abs(result.darkroom[2]!-4)<.001,JSON.stringify(result));
    assert.ok(Math.abs(result.videoNits-1000)<7,JSON.stringify(result));assert.ok(Math.abs(result.design[2]!-4)<.01,JSON.stringify(result));
  } finally{await context.close();await closeBrowser();}
});
