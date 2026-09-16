// SPDX-License-Identifier: MPL-2.0
/**
 * host.scan - the web shell's on-device code reader (plans/162 Part 2).
 *
 * Two rungs behind one ScanAPI:
 *   1. native `BarcodeDetector` (Chromium/Android WebView; covers qr/dm/aztec/
 *      pdf417/ean/upc/code39/93/128/codabar/itf) - WP-A, this file's core;
 *   2. a lazy zxing-wasm chunk (WP-B) as the fallback where native is absent and
 *      for the formats native lacks (Micro QR, DataBar, MaxiCode).
 *
 * The engine never sees a DOM type: detect() takes a plain RGBA frame (a live
 * MediaFrame or a still RasterFrame) and returns plain hits. The frame becomes
 * an ImageData - which BarcodeDetector accepts and which is itself just
 * {data,width,height} - so no canvas is needed for the native path.
 *
 * Nothing here reaches the network; the whole point is a reader that never phones
 * home. The zxing wasm asset (WP-B) ships with the shell and is PWA-precached.
 */

import type { ScanAPI, ScanHit } from '@lolly-tools/core/host-v1';

import { nativeBarcodeDetector, ZXING_TO_BD, ZXING_NAMES, ZXING_BD_NAMES, type BarcodeDetectorInstance, type DetectedBarcode } from './scan-support.ts';
export { nativeBarcodeDetector, scanAvailable } from './scan-support.ts';

function zxToBd(z: string): string { return ZXING_TO_BD[z] ?? z.toLowerCase(); }

/** True when `text` is exactly the UTF-8 decoding of `bytes` (a clean round-trip). */
function utf8RoundTrips(text: string, bytes: Uint8Array): boolean {
  const enc = new TextEncoder().encode(text);
  if (enc.length !== bytes.length) return false;
  for (let i = 0; i < enc.length; i++) if (enc[i] !== bytes[i]) return false;
  return true;
}

// The zxing-wasm reader, loaded lazily so Chromium (native) never pays for the
// wasm. The wasm asset is bundled via Vite's ?url and PWA-precached, so the
// offline promise holds; nothing is fetched from a CDN.
let zxingReady: Promise<typeof import('zxing-wasm/reader')> | null = null;
function loadZxing(): Promise<typeof import('zxing-wasm/reader')> {
  if (!zxingReady) {
    zxingReady = (async () => {
      const [mod, wasmUrl] = await Promise.all([
        import('zxing-wasm/reader'),
        import('zxing-wasm/reader/zxing_reader.wasm?url').then((m) => m.default as string),
      ]);
      mod.prepareZXingModule({ overrides: { locateFile: () => wasmUrl } });
      return mod;
    })();
  }
  return zxingReady;
}

async function zxingDetect(
  frame: { data: Uint8ClampedArray; width: number; height: number },
  formats?: string[],
): Promise<ScanHit[]> {
  // Take ownership before loading the decoder; live-frame buffers are reusable.
  const imageData = { data: new Uint8ClampedArray(frame.data), width: frame.width, height: frame.height, colorSpace: 'srgb' as const };
  let zxFormats: string[] = [];
  if (formats && formats.length) {
    zxFormats = ZXING_NAMES.filter((z) => formats.includes(zxToBd(z)));
    if (!zxFormats.length) return []; // a filter matching nothing means decode nothing, not everything
  }
  let mod: Awaited<ReturnType<typeof loadZxing>>;
  try { mod = await loadZxing(); } catch { return []; }
  let results;
  try {
    results = await mod.readBarcodes(imageData as ImageData, { formats: zxFormats as never, tryHarder: true, maxNumberOfSymbols: 20 });
  } catch { return []; }
  const hits: ScanHit[] = [];
  for (const r of results) {
    if (!r.format || r.format === 'None') continue;
    const p = (r as { position?: { topLeft: { x: number; y: number }; topRight: { x: number; y: number }; bottomRight: { x: number; y: number }; bottomLeft: { x: number; y: number } } }).position;
    const corners = p ? ([[p.topLeft.x, p.topLeft.y], [p.topRight.x, p.topRight.y], [p.bottomRight.x, p.bottomRight.y], [p.bottomLeft.x, p.bottomLeft.y]] as [number, number][]) : undefined;
    const text = (r as { text?: string }).text ?? '';
    const bytes = (r as { bytes?: Uint8Array }).bytes;
    hits.push({ format: zxToBd(r.format), rawValue: text, rawBytes: bytes && !utf8RoundTrips(text, bytes) ? bytes : undefined, corners });
  }
  return hits;
}

function toImageData(frame: { data: Uint8ClampedArray; width: number; height: number }): ImageData | null {
  if (!frame || !frame.width || !frame.height) return null;
  try {
    // Copy: the caller may reuse/release a live MediaFrame buffer synchronously.
    return new ImageData(new Uint8ClampedArray(frame.data), frame.width, frame.height);
  } catch {
    return null;
  }
}

function mapHit(b: DetectedBarcode): ScanHit {
  const corners = Array.isArray(b.cornerPoints) && b.cornerPoints.length
    ? (b.cornerPoints.map((p) => [p.x, p.y]) as [number, number][])
    : undefined;
  return { format: b.format, rawValue: b.rawValue, corners };
}

/**
 * The native rung. `ready` resolves once the supported-format list is known;
 * `formats()` returns [] until then and the real set afterwards (it may widen
 * again once WP-B's wasm chunk loads, which is why the contract says "at least").
 */
export function createScanAPI(): ScanAPI & { ready: Promise<void> } {
  const Ctor = nativeBarcodeDetector();
  let supported: string[] = [];
  let shared: BarcodeDetectorInstance | null = null;

  const ready: Promise<void> = (async () => {
    if (!Ctor?.getSupportedFormats) return;
    try { supported = await Ctor.getSupportedFormats(); } catch { supported = []; }
  })();

  function detector(formats?: string[]): BarcodeDetectorInstance | null {
    if (!Ctor) return null;
    // A fresh detector when a subset is requested; a cached all-formats one otherwise.
    if (formats && formats.length) {
      try { return new Ctor({ formats }); } catch { return null; }
    }
    if (!shared) { try { shared = new Ctor(); } catch { shared = null; } }
    return shared;
  }

  return {
    ready,
    // What detect() will ACTUALLY decode: native's own supported set where native
    // is present (detect uses only native there), or the full zxing set where it
    // is absent (the wasm fallback reads every format). Not the union - advertising
    // formats native won't decode and this rung won't fall back for is a false promise.
    formats: () => (Ctor ? supported.slice() : ZXING_BD_NAMES.slice()),
    async detect(frame, opts) {
      // Native rung where present - fast, no wasm, and authoritative for its
      // formats (an empty result means "no code", NOT "load the wasm and re-scan"
      // - doing that on every empty camera frame would thrash). Where native is
      // absent, the zxing fallback works on every browser and covers every
      // format. (Decoding the formats native lacks - Micro QR, DataBar, MaxiCode
      // - via zxing on a native-capable browser is a follow-up: it needs the
      // still-vs-frame distinction detect() does not carry.)
      if (Ctor) {
        const det = detector(opts?.formats);
        const img = det ? toImageData(frame) : null;
        if (!det || !img) return [];
        try {
          return (await det.detect(img)).map(mapHit);
        } catch {
          return [];
        }
      }
      return zxingDetect(frame, opts?.formats);
    },
  };
}
