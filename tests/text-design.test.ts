// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { readDesignText, upgradeDesignText, defaultTextFrameSettings, resizeDesignTextFrames } from '../engine/src/text-design.ts';
const font={id:'sans',family:'Example',sha256:'a'.repeat(64),faceIndex:0,source:{kind:'bundled' as const,path:'/fonts/example.ttf'}};
test('resizing composed text authors container dimensions without changing its type size', () => {
  const result = upgradeDesignText('', [{ id: 'box', text: 'Heading', w: 300, h: 100, fs: 48 }], 'box', { storyId: 'story', source: 'Heading', character: { font: 'sans', size: 48 }, fonts: [font], settings: defaultTextFrameSettings('auto-width') });
  const width = resizeDesignTextFrames(result.boxes, [{ ...result.boxes[0]!, w: 150 }]);
  assert.equal(readDesignText(result.textDocument, width).frames[0]!.mode, 'auto-height');
  const height = resizeDesignTextFrames(width, [{ ...width[0]!, h: 200 }]);
  assert.equal(readDesignText(result.textDocument, height).frames[0]!.mode, 'fixed');
  assert.equal(height[0]!.fs, 48); assert.equal(result.boxes[0]!.w, 300);
});
test('legacy inputs retain source and geometry until an explicit atomic upgrade',()=>{
  for(const source of ['a\u00a0b\n','*literal*\r\n','Office 👨‍👩‍👧‍👦']){
    const boxes=[{id:'box',text:source,w:300,h:100,plainText:true,other:{keep:1}}],before=structuredClone(boxes);
    assert.deepEqual(readDesignText('',boxes).frames,[]);assert.deepEqual(boxes,before);
    const result=upgradeDesignText('',boxes,'box',{storyId:'story',source,character:{font:'sans',size:24},fonts:[font]});
    const model=readDesignText(result.textDocument,result.boxes),story=model.document.stories[0]!;
    assert.equal(story.source,source);assert.ok(story.breaks.every(item=>item.kind==='soft'));assert.deepEqual(boxes,before);
    assert.equal(result.boxes[0]!.text,'');assert.deepEqual(result.boxes[0]!.other,{keep:1});assert.equal(model.frames[0]!.width,300);
    assert.deepEqual(readDesignText(JSON.parse(result.textDocument),result.boxes),model);
  }
});
test('ownership, duplicate sources and malformed frame geometry cannot be silently repaired',()=>{
  const result=upgradeDesignText('',[{id:'box',text:'A',w:300,h:100}],'box',{storyId:'story',source:'A',character:{font:'sans'},fonts:[font]});
  assert.throws(()=>readDesignText(result.textDocument,[]),/missing/);
  assert.throws(()=>readDesignText(result.textDocument,[{...result.boxes[0],text:'second source'}]),/legacy/);
  assert.throws(()=>readDesignText(result.textDocument,[{...result.boxes[0],textStory:'other'}]),/ownership/);
  assert.throws(()=>readDesignText(result.textDocument,[{...result.boxes[0],w:NaN}]),/Invalid text frame/);
  assert.throws(()=>readDesignText(result.textDocument,[{...result.boxes[0],textFrame:JSON.stringify({...defaultTextFrameSettings(),width:200})}]),/belong/);
  assert.throws(()=>readDesignText(result.textDocument,[{...result.boxes[0],textFrame:JSON.stringify({...defaultTextFrameSettings(),columns:{count:3,gutter:200,balance:false}})}]),/room/);
});

test('path frame resizing changes the owned guide and interval without changing source or font size',()=>{
  const original=upgradeDesignText('',[{id:'a',text:'Around',w:200,h:100}], 'a',{storyId:'story',source:'Around',fonts:[],character:{size:32},settings:{...defaultTextFrameSettings('path'),path:{d:'M0 50L200 50',start:20,end:180,baseline:5,reverse:false,flip:false,fit:false,guide:false}}});
  const next=resizeDesignTextFrames(original.boxes,[{...original.boxes[0]!,w:400,h:200}]);
  const frame=readDesignText(original.textDocument,next).frames[0]!;
  assert.deepEqual(frame.path,{d:'M0,100L400,100',start:40,end:360,baseline:5,reverse:false,flip:false,fit:false,guide:false});
  assert.equal(readDesignText(original.textDocument,next).document.stories[0]!.source,'Around');
});
