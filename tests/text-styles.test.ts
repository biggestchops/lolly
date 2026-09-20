// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { createTextStory, parseTextDocument } from '../engine/src/text-story-document.ts';
import { styleTextRange } from '../engine/src/text-style-commands.ts';
import { textStyleResolver } from '../engine/src/text-styles.ts';
import { formatStoryRange } from '../engine/src/text-edits.ts';
test('style inheritance and partial override reset retain source and explicit no-break/literal spans', () => {
  let story = createTextStory('story', 'One two\nThree', i => `p${i}`); story.defaultStyle = 'body';
  const document = parseTextDocument({ version: 1, stories: [story], fonts: [], styles: [
    { id: 'body', kind: 'paragraph', name: 'Body', paragraph: { character: { size: 16, color: '#000000' }, lineHeight: 1.2 } },
    { id: 'heading', kind: 'paragraph', name: 'Heading', basedOn: 'body', paragraph: { character: { size: 32 }, composition: 'balanced' } },
    { id: 'emphasis', kind: 'character', name: 'Emphasis', character: { weight: 700 } },
  ] });
  story = styleTextRange(document, story, { start: 0, end: 8 }, { kind: 'paragraph', style: 'heading' });
  assert.equal(story.paragraphs[0]!.style, 'heading'); assert.equal(story.paragraphs[1]!.style, undefined);
  story = formatStoryRange(story, { start: 0, end: 7 }, { style: 'emphasis', character: { size: 40 }, literal: true, noBreak: true });
  story = styleTextRange(document, story, { start: 4, end: 7 }, { kind: 'character', reset: true });
  const resolver = textStyleResolver(document);
  assert.equal(resolver.character(story, story.paragraphs[0]!, 4).size, 32);
  assert.equal(resolver.character(story, story.paragraphs[0]!, 4).weight, 700);
  assert.equal(resolver.character(story, story.paragraphs[0]!, 0).size, 40);
  assert.deepEqual(story.spans[1], { start: 4, end: 7, style: 'emphasis', literal: true, noBreak: true });
  assert.equal(story.source, 'One two\nThree'); parseTextDocument({ ...document, stories: [story] });
  assert.throws(() => styleTextRange(document, story, { start: 0, end: 3 }, { kind: 'paragraph', style: 'emphasis' }), { code: 'style-kind' });
});

test('style definitions update dependent stories and Enter follows the next style without changing old source',async()=>{
  const {defineTextStyle,nextParagraphStyle}=await import('../engine/src/text-style-commands.ts');const {replaceStoryRange}=await import('../engine/src/text-edits.ts');
  const story=createTextStory('story','Heading',i=>`p${i}`);story.defaultStyle='heading';const document=parseTextDocument({version:1,stories:[story],fonts:[],styles:[{id:'body',name:'Body',kind:'paragraph',paragraph:{character:{size:16}}},{id:'heading',name:'Heading',kind:'paragraph',basedOn:'body',next:'body',paragraph:{character:{size:32}}}]});
  const changed=defineTextStyle(document,{...document.styles[0]!,paragraph:{character:{size:18,color:'#aa0000'}}});assert.equal(changed.stories[0]!.revision,story.revision+1);assert.equal(textStyleResolver(changed).character(changed.stories[0]!,story.paragraphs[0]!,0).color,'#aa0000');assert.equal(story.source,'Heading');
  const inserted=replaceStoryRange(story,{start:7,end:7},{source:'\n'},{paragraphId:()=> 'new'}).story,next=nextParagraphStyle(document,story,inserted,7);assert.equal(next.paragraphs[1]!.style,'body');assert.equal(next.source,'Heading\n');
  const withOverride=formatStoryRange(story,{start:0,end:7},{character:{size:48}}),line=replaceStoryRange(withOverride,{start:7,end:7},{source:'\n'},{paragraphId:()=> 'new'}).story,body=nextParagraphStyle(document,withOverride,line,7),typed=replaceStoryRange(body,{start:8,end:8},{source:'Body'},{paragraphId:()=> 'unused'}).story;assert.equal(textStyleResolver(document).character(typed,typed.paragraphs[1]!,8).size,16,'new body text does not inherit the heading character override');
  assert.throws(()=>defineTextStyle(document,{...document.styles[0]!,basedOn:'heading'}),{code:'style-cycle'});
});
