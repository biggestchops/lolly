// SPDX-License-Identifier: MPL-2.0
import type { HostV1 } from '@lolly-tools/core/host-v1';

/** Thumbnail sizes are an optimisation; vectors and pinned formats still resolve. */
export function withThumbAssets(host: HostV1): HostV1 {
  const assets = host.assets;
  return {
    ...host,
    assets: {
      ...assets,
      async get(id, opts = {}) {
        if (opts.format) return assets.get(id, opts);
        try { return await assets.get(id, { ...opts, format: 'thumb' }); }
        catch { return assets.get(id, opts); }
      },
    },
  };
}
