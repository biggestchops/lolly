// SPDX-License-Identifier: MPL-2.0
/** Adapt one runtime to every emoji insertion surface without loading the picker. */
import type { Runtime } from '../../../../engine/src/runtime.ts';
import type { HostV1 } from '@lolly-tools/core/host-v1';
import type { EmojiPopoverOptions } from '../components/emoji-picker.ts';

export function emojiPickerOptions(host: HostV1, runtime: Runtime): EmojiPopoverOptions {
  // The shared bulk-edit adapter has no single document style.
  if (!runtime.emoji) return {};
  return {
    selection: {
      host,
      value: () => runtime.emoji.style,
      set: (style) => runtime.setEmojiStyle(style),
    },
    emoji: {
      apply: (node) => runtime.applyEmojiToDom(node, { track: false, idScope: 'p' }),
      revert: (node) => runtime.revertEmojiDom(node),
      onSetChange: (fn) => {
        let last = JSON.stringify(runtime.emoji.style);
        return runtime.onEmojiChange((state) => {
          const next = JSON.stringify(state.style);
          if (last === next) return;
          last = next;
          fn();
        });
      },
    },
  };
}
