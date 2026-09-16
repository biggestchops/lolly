// SPDX-License-Identifier: MPL-2.0
import type { ScanAPI } from '@lolly-tools/core/host-v1';
import { nativeBarcodeDetector, ZXING_BD_NAMES } from './scan-support.ts';

/** Attaching an available capability does not initialize its decoder. */
export function createLazyScanAPI(
  load: () => Promise<ScanAPI & { ready?: Promise<void> }> = async () => (await import('./scan.ts')).createScanAPI(),
): ScanAPI {
  let api: ScanAPI | undefined;
  let pending: Promise<ScanAPI> | undefined;
  function get(): Promise<ScanAPI> {
    if (api) return Promise.resolve(api);
    if (!pending) {
      pending = Promise.resolve().then(load).then(async implementation => {
        await implementation.ready;
        api = implementation;
        return implementation;
      }).catch(error => { pending = undefined; throw error; });
    }
    return pending;
  }
  return {
    formats() {
      if (api) return api.formats();
      void get().catch(() => {});
      return nativeBarcodeDetector() ? [] : ZXING_BD_NAMES.slice();
    },
    detect(frame, opts) {
      if (api) return api.detect(frame, opts);
      // Frame ownership ends when the caller returns; snapshot before importing.
      const snapshot = { data: new Uint8ClampedArray(frame.data), width: frame.width, height: frame.height };
      const options = opts?.formats ? { formats: opts.formats.slice() } : opts;
      return get().then(implementation => implementation.detect(snapshot, options));
    },
  };
}
