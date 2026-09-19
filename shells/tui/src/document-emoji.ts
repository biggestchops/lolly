// SPDX-License-Identifier: MPL-2.0
/** Restore the same pinned emoji typography used by a share link or saved document. */
import type { HostV1 } from '@lolly-tools/core/host-v1';
import type { EmojiStyleV1 } from '@lolly-tools/core/emoji-v1';
import type { Runtime, MountResult } from './engine-render.ts';
import { parseEmojiParams } from '../../../engine/src/emoji-style.ts';
import { brandEmojiStyle } from '../../../engine/src/emoji-default.ts';
export async function seedEmoji(runtime:Runtime,host:HostV1,reserved:MountResult['reserved'],values?:Record<string,unknown>):Promise<void> {
  if(!host.emoji)return;
  if(reserved.emoji==='none'){await runtime.setEmojiStyle(null);return;}
  if(reserved.emoji||reserved.emojiFx||reserved.emojiStyle) {
    const palette=(await host.tokens?.colors()??[]).map(color=>({id:color.ref,hex:color.value}));
    const parsed=parseEmojiParams({emoji:reserved.emoji,emojifx:reserved.emojiFx,emojistyle:reserved.emojiStyle},await host.emoji.sets(),palette);
    for(const issue of parsed.issues)host.log('warn',issue.message);
    if(parsed.pin)await runtime.setEmojiStyle(parsed.style??{schemaVersion:1,primary:parsed.pin,fallbacks:[],metricsPolicy:'inline-em-v1',treatment:parsed.treatment??{mode:'original',strengthBps:0}});
    else if(reserved.emoji||reserved.emojiStyle)await runtime.setEmojiStyle(null);
    return;
  }
  if(values&&Object.hasOwn(values,'__emoji')){await runtime.setEmojiStyle(values.__emoji as EmojiStyleV1|null);return;}
  const profile=await host.profile.get();
  const brand=await brandEmojiStyle(host);
  if(brand){await runtime.setEmojiStyle(brand);return;}
  const pref=profile.emoji;
  if(pref){
    const palette=(await host.tokens?.colors()??[]).map(color=>({id:color.ref,hex:color.value}));
    const parsed=parseEmojiParams({emojifx:pref.mode==='influence'?`influence:${pref.strengthBps}`:pref.mode},[],palette);
    await runtime.setEmojiStyle({schemaVersion:1,primary:pref.pin,fallbacks:[],metricsPolicy:'inline-em-v1',treatment:parsed.treatment??{mode:'original',strengthBps:0}});
  }
}
