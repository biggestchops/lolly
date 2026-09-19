// SPDX-License-Identifier: MPL-2.0
/** Cold token discovery waits for an asset sync already filling the same store. */
let pending: Promise<unknown> | null = null;

export function duringAssetSync<T>(work: Promise<T>): Promise<T> {
  const settled = Promise.allSettled(pending ? [pending, work] : [work]);
  pending = settled;
  void settled.then(() => { if (pending === settled) pending = null; });
  return work;
}

export const pendingAssetSync = (): Promise<unknown> | null => pending;
