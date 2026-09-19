// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createRuntime } from '../engine/src/runtime.ts';
import { createNodeEmojiAPI } from '../packages/node-shell/src/emoji.ts';
import { createNodeTextAPI } from '../packages/node-shell/src/text.ts';
import { createEmojiToolText } from '../engine/src/emoji-tool-text.ts';
import type { HostV1 } from '../packages/core/src/host-v1.ts';
import type { LoadedTool } from '../engine/src/loader.ts';
import type { EmojiStyleV1 } from '../packages/core/src/emoji-v1.ts';
const dom = new JSDOM(''), repoRoot = fileURLToPath(new URL('../',import.meta.url));
const emoji = await createNodeEmojiAPI({parseXml:source=>new dom.window.DOMParser().parseFromString(source,'image/svg+xml')});
const text = createNodeTextAPI({repoRoot});
const sets = await emoji.sets();
const style = (id:string):EmojiStyleV1 => ({schemaVersion:1,primary:sets.find(item=>item.pin.id===id)!.pin,fallbacks:[],metricsPolicy:'inline-em-v1',treatment:{mode:'original',strengthBps:0}});
const chosen = style('community/emoji/twemoji/color');
const host = {version:'1',shell:'test',profile:{get:async()=>({})},emoji,text,log:()=>{},tokens:{resolve:async()=> 'SUSE'},export:{render:async(node:Element)=>new Blob([node.outerHTML],{type:'image/svg+xml'})}} as unknown as HostV1;
async function tool(id:string):Promise<LoadedTool> {
  const root = new URL(`../community/${id}/`,import.meta.url);
  const [manifest,template,hooksSource,styles] = await Promise.all(['tool.json','template.html','hooks.js','styles.css'].map(file=>readFile(new URL(file,root),'utf8').catch(()=>'')));
  return {manifest:JSON.parse(manifest!),template:template!,hooksSource:hooksSource!,styles:styles!,hooksUrl:null,textTemplates:{},textTemplateErrors:{},trustClass:'builtin-verified'} as LoadedTool;
}
for (const id of ['work-avatar','wordmark']) test(`${id}: selected emoji survive shaping, set changes and SVG export`, async()=>{
  const runtime = await createRuntime(await tool(id),host,{text:'Hi 😀 ❤️',uppercase:false});
  await runtime.setEmojiStyle(chosen);
  const root=dom.window.document.createElement('div');root.innerHTML=runtime.getHydrated();
  const result=await runtime.applyEmojiToDom(root);
  assert.equal(result.replaced,2,root.querySelector('[data-emoji-layout-issue]')?.getAttribute('data-emoji-layout-issue') ?? runtime.hookErrors.map(e=>e.message).join(';'));
  assert.equal(result.unresolved,0);
  assert.equal(runtime.emojiIngredients().length,2);
  const before=root.innerHTML;
  await runtime.setEmojiStyle(style('community/emoji/openmoji/black'));
  assert.notEqual(root.innerHTML,before);
  assert.equal(runtime.emoji.unresolved,0);
  const blob=await runtime.export(root,'svg',{c2pa:false,watermark:false});
  assert.match(await blob.text(),/data-lolly-emoji-svg/);
  assert.equal(root.querySelectorAll('[data-emoji-layout-issue]').length,0);
  if(id==='work-avatar') assert.match(root.querySelector('[data-lolly-emoji-svg]')!.innerHTML,/rotate\(/);
  runtime.destroy();
});

test('canvas and shape tools receive selected artwork with an accurate source census',async()=>{
  let selected:EmojiStyleV1|null=chosen;
  const service=createEmojiToolText(emoji,text,()=>selected);
  const a=await service.renderText({text:'A 😀',fontFamily:'SUSE',fontSize:40});
  assert.ok(a.width>40);assert.equal(service.census.length,1);assert.match(a.svg,/<svg x=/);
  selected=style('community/emoji/openmoji/black');
  const b=await service.renderText({text:'A 😀',fontFamily:'SUSE',fontSize:40});
  assert.notEqual(a.svg,b.svg);assert.equal(service.census[0]!.pack.id,selected.primary.id);
  await assert.rejects(service.renderText({text:'a\nb'}),/left-to-right/);
});

test('generated SVG overlays resolve emoji before bitmap export',async()=>{
  const service=createEmojiToolText(emoji,text,()=>chosen);
  const svg=await service.renderSvg('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80"><text x="50%" y="50%" dominant-baseline="middle" font-size="32" font-family="SUSE">Hi 😀</text></svg>');
  assert.match(svg,/data-lolly-emoji-svg/);assert.doesNotMatch(svg,/data-emoji-layout-issue/);
  assert.equal(service.census.length,1);
  await assert.rejects(service.renderSvg('<!DOCTYPE svg><svg/>'),/budget/);
});
