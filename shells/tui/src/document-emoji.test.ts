// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockHost } from '@lolly-tools/core';
import type { EmojiStyleV1 } from '@lolly-tools/core/emoji-v1';
import { seedEmoji } from './document-emoji.ts';
import type { Runtime, MountResult } from './engine-render.ts';
const pin={id:'community/emoji/test/color',pin:{version:'1.0.0'},checksum:`sha256:${'a'.repeat(64)}`};
const selected:EmojiStyleV1={schemaVersion:1,primary:pin,fallbacks:[],metricsPolicy:'inline-em-v1',treatment:{mode:'original',strengthBps:0}};
test('terminal links select pinned artwork and explicit clearing overrides a saved style',async()=>{
  const host=createMockHost();host.emoji={sets:async()=>[{pin} as never],manifest:async()=>null,artwork:async()=>null,parseXml:()=>null};
  let actual:EmojiStyleV1|null=null;
  const runtime={setEmojiStyle:async(style:EmojiStyleV1|null)=>{actual=style;}} as Runtime;
  await seedEmoji(runtime,host,{emoji:`${pin.id}@1.0.0`} as MountResult['reserved']);
  assert.deepEqual(actual,selected);
  await seedEmoji(runtime,host,{emoji:'none'} as MountResult['reserved'],{__emoji:selected});
  assert.equal(actual,null);
  await seedEmoji(runtime,host,{} as MountResult['reserved'],{__emoji:selected});
  assert.deepEqual(actual,selected);
});
