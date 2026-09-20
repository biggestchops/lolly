// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { thaiTextBreaks, TEXT_THAI_RESOURCE } from '../engine/src/text-thai.ts';
import { textBoundaries } from '../engine/src/text-source.ts';
import { createTextStory } from '../engine/src/text-story-document.ts';
import { createTextCompositionAPI } from '../packages/node-shell/src/text-composition.ts';
import { defaultTextFrameSettings } from '../engine/src/text-design.ts';
test('pinned Thai dictionary breaks words without splitting marks or unknown runs',()=>{
  const source='ภาษาไทยยินดีต้อนรับ',breaks=thaiTextBreaks(source);
  assert.deepEqual(breaks,[4,7,12,19]);
  for(const value of [source,'เก้าอี้ประเทศไทย','กฺขฺคฺ','ไทย😀ภาษาไทย'])assert.ok(thaiTextBreaks(value).every(at=>textBoundaries(value).has(at)));
  assert.deepEqual(thaiTextBreaks('กฺขฺคฺ'),[6]);
});
test('Thai paragraphs wrap at dictionary words and record the exact resource identity',async()=>{
  const bytes=readFileSync('tests/fixtures/text-composition/fonts/notosansthai/NotoSansThai[wdth,wght].ttf'),story=createTextStory('thai','ภาษาไทยยินดีต้อนรับ',index=>`p${index}`);story.frameIds=['frame'];story.paragraphs[0]!.paragraph={language:'th',character:{font:'thai',size:24,weight:400}};
  const document={version:1 as const,stories:[story],styles:[],fonts:[{id:'thai',family:'Noto Sans Thai',sha256:createHash('sha256').update(bytes).digest('hex'),faceIndex:0,source:{kind:'bundled' as const,path:'/fonts/thai.ttf'}}]};
  const api=createTextCompositionAPI(async()=>bytes),request={document,storyId:'thai',frames:[{...defaultTextFrameSettings('fixed'),id:'frame',storyId:'thai',width:100,height:300}]};
  const result=await api.layoutRuns(request);assert.ok(result.lines.length>1);assert.equal(result.overset,null);
  assert.ok(result.lines.every(line=>thaiTextBreaks(story.source).includes(line.end)));assert.ok(result.resources.some(resource=>resource.id===TEXT_THAI_RESOURCE.id&&resource.sha256===TEXT_THAI_RESOURCE.sha256));
  assert.deepEqual(await api.layoutRuns(request),result);assert.equal(document.stories[0]!.source,'ภาษาไทยยินดีต้อนรับ');
});
