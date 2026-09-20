// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { TextDocumentV1 } from '@lolly-tools/core';
import type { Page } from 'playwright-core';
import type { CanvasCommitEl } from '../shells/web/src/lib/canvas-commit.ts';
import { getBrowser,closeBrowser } from '../packages/node-shell/src/browsers.ts';
import { createTextStory } from '../engine/src/text-story-document.ts';
import { textStyleResolver } from '../engine/src/text-styles.ts';
import { journeyDiagnostics } from './helpers/journey-diagnostics.ts';
const origin=process.env.LOLLY_EXPORT_TEST_URL;
async function state(page:Page):Promise<{document:TextDocumentV1;boxes:Array<Record<string,unknown>>}>{return page.evaluate(()=>{const model=(document.getElementById('tool-canvas') as CanvasCommitEl).__lollyModel!();return {document:JSON.parse(model.find(input=>input.id==='textDocument')!.value as string),boxes:model.find(input=>input.id==='boxes')!.value as Array<Record<string,unknown>>};});}
test('canvas type handles preview, cancel, commit and undo independently of frame resizing',{skip:origin?false:'set LOLLY_EXPORT_TEST_URL',timeout:150000},async()=>{
  const story=createTextStory('story','A variable heading',i=>`p${i}`);story.frameIds=['text'];story.defaultStyle='body';
  const doc:TextDocumentV1={version:1,stories:[story],styles:[{id:'body',kind:'paragraph',name:'Body',paragraph:{character:{font:'font',size:36,weight:400}}}],fonts:[{id:'font',family:'SUSE',sha256:createHash('sha256').update(readFileSync('shells/web/public/fonts/SUSE[wght].ttf')).digest('hex'),faceIndex:0,source:{kind:'bundled',path:'/fonts/SUSE[wght].ttf'}}]};
  const box={id:'text',kind:'text',text:'',textStory:'story',textFrame:JSON.stringify({mode:'fixed',inset:{top:8,right:8,bottom:8,left:8},columns:{count:1,gutter:0,balance:false},verticalAlign:'top'}),x:200,y:220,w:600,h:180};
  const browser=await getBrowser(),context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),page=await context.newPage(),diagnose=journeyDiagnostics(context,'design-text-type-handles');page.setDefaultTimeout(20000);
  try{
    await page.goto(`${origin}/design?${new URLSearchParams({boxes:JSON.stringify([box]),textDocument:JSON.stringify(doc),c2pa:'0',imprint:'0'})}`);await page.locator('svg[data-text-frame="text"]').waitFor();
    for(const id of ['navigator','inspector']){const toggle=page.locator(`[data-topbar="${id}"]`);if(await toggle.getAttribute('aria-pressed')==='true')await toggle.click();}
    const text=page.locator('#tool-canvas [data-box-id="text"]'),svg=()=>page.locator('svg[data-text-frame="text"]').evaluate(element=>element.outerHTML);
    await text.click({button:'right'});await page.getByRole('menuitem',{name:'Adjust type',exact:true}).click();const panel=page.getByRole('dialog',{name:'Adjust type',exact:true}),handle=page.locator('[data-text-type-handle]');await handle.waitFor();
    const original=await state(page),ink=await svg();await handle.focus();await handle.press('Shift+ArrowRight');await page.waitForFunction(old=>document.querySelector('svg[data-text-frame="text"]')?.outerHTML!==old,ink);assert.deepEqual(await state(page),original);
    await handle.press('Escape');assert.equal(await svg(),ink);await handle.press('Shift+ArrowRight');await handle.press('Enter');await page.waitForFunction(()=>JSON.parse((document.getElementById('tool-canvas') as CanvasCommitEl).__lollyModel!().find(input=>input.id==='textDocument')!.value as string).stories[0].revision>0);
    const adjusted=await state(page);assert.equal(adjusted.boxes[0]!.w,original.boxes[0]!.w);assert.equal(textStyleResolver(adjusted.document).character(adjusted.document.stories[0]!,adjusted.document.stories[0]!.paragraphs[0]!,0).axes?.wght,410);await panel.getByRole('button',{name:'Done',exact:true}).click();
    await page.locator('#tool-canvas').focus();await page.keyboard.press('ControlOrMeta+z');await page.waitForFunction(source=>JSON.stringify(JSON.parse((document.getElementById('tool-canvas') as CanvasCommitEl).__lollyModel!().find(input=>input.id==='textDocument')!.value as string))===source,JSON.stringify(original.document));
    await text.click({button:'right'});await page.getByRole('menuitem',{name:'Scale text and frame',exact:true}).click();const scale=page.getByRole('dialog',{name:'Scale text and frame',exact:true}),percent=scale.getByLabel('Text and frame scale (%)',{exact:true});await percent.fill('125');await percent.press('Tab');await page.waitForFunction(()=>Number(((document.getElementById('tool-canvas') as CanvasCommitEl).__lollyModel!().find(input=>input.id==='boxes')!.value as Array<Record<string,unknown>>)[0]!.w)===750);
    const enlarged=await state(page);assert.equal(enlarged.document.stories[0]!.source,story.source);assert.equal(textStyleResolver(enlarged.document).character(enlarged.document.stories[0]!,enlarged.document.stories[0]!.paragraphs[0]!,0).size,45);assert.equal(enlarged.boxes[0]!.h,225);await scale.getByRole('button',{name:'Done',exact:true}).click();
    await page.locator('#tool-canvas').focus();await page.keyboard.press('ControlOrMeta+z');await page.waitForFunction(()=>Number(((document.getElementById('tool-canvas') as CanvasCommitEl).__lollyModel!().find(input=>input.id==='boxes')!.value as Array<Record<string,unknown>>)[0]!.w)===600);
  }catch(error){await diagnose(error);throw error;}finally{await context.close();await closeBrowser();}
});
