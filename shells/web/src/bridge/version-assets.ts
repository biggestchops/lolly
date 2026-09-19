// SPDX-License-Identifier: MPL-2.0
/**
 * version-assets.ts - copy-on-write preservation for pinned assets (plans/97 section 6a).
 *
 * A published design-system version records the assets its tokens document named
 * as `{id, version, sha256}`. Publishing copies NO bytes: the overwhelmingly
 * common case is that a logo published in v1 is still the logo, and paying for a
 * second copy of every file at every publish would make versioning a storage tax
 * rather than a safety net.
 *
 * Bytes are copied at the one moment they would otherwise be lost. Whenever
 * something is about to replace, restamp, re-import or delete the bytes at a user
 * asset id, the bridge calls this preserver first (the four chokepoint methods in
 * bridge/assets.ts, and nowhere else). If any published version pins those exact
 * bytes, they are written to a content-keyed frozen id and the version's pin
 * learns where they went. The version ASSET and its checksum are never touched - 
 * that is what keeps "a published version is immutable" literally true.
 *
 * The cost of all this on a system that never published is one head-document
 * read - memoised by the tokens bridge, so a property read after the first - and
 * then step 3 returns before any IndexedDB read or hashing. On an install with no
 * tokens document at all the bridge deliberately does not memoise (it retries),
 * so the ABSENCE is memoised here instead; see NO_HEAD_TTL_MS.
 *
 * Fonts are recorded in a version's manifest but never frozen - see step 6a for
 * why bytes nothing can resolve are not worth the user's storage.
 *
 * Re-entrancy terminates by construction: upload(logo) → preserve → upload(frozen)
 * returns at step 1 → installUserTokens → upload(user/tokens/brand) returns at
 * step 1.
 */

import type { PinPreserverHost } from './version-assets-contract.ts';
export { FROZEN_PREFIX, type PinPreserverHost } from './version-assets-contract.ts';

/** Load preservation before the first mutation; all later calls share its state. */
export function createPinPreserver(
  host: PinPreserverHost,
): (id: string, opts?: { reclaiming?: boolean }) => Promise<void> {
  let writer: Promise<ReturnType<typeof import('./version-assets-write.ts').createPinPreserverWriter>> | undefined;
  return async (id, opts) => {
    writer ??= import('./version-assets-write.ts').then(m => m.createPinPreserverWriter(host));
    await (await writer)(id, opts);
  };
}
