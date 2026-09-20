// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {getBrowser,closeBrowser} from '../packages/node-shell/src/browsers.ts';
import {createTextStory} from '../engine/src/text-story-document.ts';
import type {TextDocumentV1} from '@lolly-tools/core';
import type {DesignToolDraftV1} from '@lolly-tools/core/design-tool-v1';
import {journeyDiagnostics} from './helpers/journey-diagnostics.ts';
const origin=process.env.LOLLY_EXPORT_TEST_URL;
test('generated composed templates package selectable fonts across artboard variants',{skip:origin?false:'set LOLLY_EXPORT_TEST_URL',timeout:120000},async()=>{
 const story=createTextStory('story','Office title',i=>`p${i}`);story.frameIds=['title'];story.defaultStyle='body';
 const doc:TextDocumentV1={version:1,stories:[story],styles:[{id:'body',kind:'paragraph',name:'Body',paragraph:{character:{font:'suse',size:32}}}],fonts:[{id:'suse',family:'SUSE',sha256:createHash('sha256').update(readFileSync('shells/web/public/fonts/SUSE[wght].ttf')).digest('hex'),faceIndex:0,source:{kind:'bundled',path:'/fonts/SUSE[wght].ttf'}}]};
 const box={id:'title',kind:'text',text:'',textStory:'story',textFrame:JSON.stringify({mode:'fixed',inset:{top:0,right:0,bottom:0,left:0},columns:{count:1,gutter:0,balance:false},verticalAlign:'top'}),x:20,y:20,w:380,h:100};
 const draft:DesignToolDraftV1={schemaVersion:1,id:'composed-font-options',name:'Composed font options',version:'1.0.0',presentation:'sidebar',formats:['svg','png','pdf'],defaultVariant:'main',variants:[{id:'main',label:'Wide',width:420,height:140,background:'#ffffff',boxes:[box],textDocument:doc},{id:'tall',label:'Tall',width:280,height:200,background:'#ffffff',boxes:[{...box,w:240,h:160}],textDocument:structuredClone(doc)}],inputs:[{input:{id:'face',label:'Font',type:'select',default:'SUSE',options:[{value:'SUSE',label:'SUSE'},{value:'mono',label:'Mono'}]},targets:[{variantId:'main',layerId:'title',property:'font'},{variantId:'tall',layerId:'title',property:'font'}]},{input:{id:'layout',label:'Layout',type:'select',default:'main',options:[{value:'main',label:'Wide'},{value:'tall',label:'Tall'}]},targets:[]}],choices:[{inputId:'layout',options:[{value:'main',label:'Wide',variantId:'main',writes:[]},{value:'tall',label:'Tall',variantId:'tall',writes:[]}]}],recipes:[]};
 const browser=await getBrowser(),context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),diagnose=journeyDiagnostics(context,'design-text-template');
 try{
  await page.goto(`${origin}/design?${new URLSearchParams({boxes:JSON.stringify([box]),textDocument:JSON.stringify(doc),width:'420',height:'140'})}`);await page.locator('#tool-canvas svg[data-text-frame="title"]').waitFor();
  const result=await page.evaluate(async({draft,loaderPath})=>{
   const compilePath='/src/lib/design-tool-compile.ts',bridgePath='/src/bridge/index.ts',runtimePath='/src/lib/mount-runtime.ts';
   const [{prepareDesignTool},{createBridge},{loadTool},{createToolRuntime}]=await Promise.all([import(compilePath),import(bridgePath),import(loaderPath),import(runtimePath)]);
   const host=await createBridge(),compiled=await prepareDesignTool(draft,document.querySelector('#tool-canvas')!,host);
   const tool=await loadTool(draft.id,async(path:string)=>String(compiled.files[path.slice(draft.id.length+1)]||''),{trustClass:'sideloaded-consented'});
   const options=compiled.manifest.inputs.find((input:{id:string})=>input.id==='face').options;
   const runtime=await createToolRuntime(tool,host,{}),pictures:Array<{layout:string;face:string;paths:string[];width:string|null;source:string}>=[];
   try{
    for(const layout of ['main','tall'])for(const option of options){
     await runtime.applyPatch({layout,face:option.value});if(runtime.hookErrors.length)throw new Error(JSON.stringify(runtime.hookErrors));
     const dom=new DOMParser().parseFromString(runtime.getHydrated(),'text/html');
     pictures.push({layout,face:option.label,width:dom.querySelector('[data-design-width]')?.getAttribute('data-design-width')??null,source:dom.querySelector('title')?.textContent??'',paths:[...dom.querySelectorAll('[data-text-start]')].map(path=>path.getAttribute('d')||'')});
    }
    return {pictures,assets:Object.keys(compiled.files).filter(name=>name.endsWith('.ttf'))};
   }finally{runtime.destroy();}
  },{draft,loaderPath:`/@fs${resolve('engine/src/loader.ts')}`});
  assert.ok(result.assets.length>=2,'both font files are embedded');assert.equal(result.pictures.length,4);
  for(const picture of result.pictures){assert.equal(picture.source,'Office title');assert.equal(picture.width,picture.layout==='main'?'420':'280');assert.ok(picture.paths.length>5);}
  assert.notDeepEqual(result.pictures[0]!.paths,result.pictures[1]!.paths,'choosing the alternate font changes the composed glyphs');
  assert.deepEqual(result.pictures[0]!.paths,result.pictures[2]!.paths,'the same pinned face shapes identically across artboards');
 }catch(error){await diagnose(error);throw error;}finally{await context.close();await closeBrowser();}
});
