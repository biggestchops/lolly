// SPDX-License-Identifier: MPL-2.0
/** Document emoji styles for full tool views and embedded source editors. */
import type { HostV1 } from '@lolly-tools/core/host-v1';
import type { EmojiSetInfoV1, EmojiStyleV1 } from '@lolly-tools/core/emoji-v1';
import type { Runtime } from '../../../../engine/src/runtime.ts';
import { brandEmojiStyle } from '../../../../engine/src/emoji-default.ts';
import { emojiParams, parseEmojiParams } from '../../../../engine/src/emoji-style.ts';
import type { EmojiPaletteEntry } from '../../../../engine/src/emoji-style.ts';
import { currentEmojiPreference, emojiSeedParams } from './emoji-prefs.ts';
import type { EmojiParamPair } from './emoji-prefs.ts';

/** The style the two params name, pinned against the host's listing and the brand's colours. */
export function emojiStyleFrom(
  pair: EmojiParamPair | null,
  sets: readonly { pin: EmojiSetInfoV1['pin'] }[],
  palette: readonly EmojiPaletteEntry[],
): EmojiStyleV1 | null {
  if (!pair || (!pair.emoji && !pair.emojistyle)) return null;
  const parsed = parseEmojiParams(pair, sets, palette);
  if (!parsed.pin) return null;
  return parsed.style ?? {
    schemaVersion: 1,
    primary: parsed.pin,
    fallbacks: [],
    metricsPolicy: 'inline-em-v1',
    treatment: parsed.treatment ?? { mode: 'original', strengthBps: 0 },
  };
}

/** An embedded source has its own style, independent of the containing document. */
export async function seedEmojiRuntime(runtime: Runtime, host: HostV1, url: EmojiParamPair | null): Promise<void> {
  const [sets, swatches, preference] = await Promise.all([
    host.emoji?.sets().catch(() => []) ?? [], host.tokens?.colors().catch(() => []) ?? [], currentEmojiPreference(host),
  ]);
  const brand = await brandEmojiStyle(host);
  const seed = emojiSeedParams({ url, session: brand ? emojiParams(brand) : null, preference });
  if (seed) await runtime.setEmojiStyle(emojiStyleFrom(seed, sets, swatches.map(swatch => ({ id: swatch.ref, hex: swatch.value }))));
}

/** Keep the pinned set in the lossless source URL used for previews and re-apply. */
export function queryWithEmoji(query: string, style: EmojiStyleV1 | null): string {
  const params = new URLSearchParams(query);
  params.delete('emoji'); params.delete('emojifx'); params.delete('emojistyle');
  if (style) for (const [key, value] of Object.entries(emojiParams(style))) params.set(key, value);
  return params.toString();
}
