// SPDX-License-Identifier: MPL-2.0
/** Capability metadata shared by the lazy facade and decoder. */
// Minimal shapes for the platform BarcodeDetector (not in lib.dom yet).
export interface DetectedBarcode {
  rawValue: string;
  format: string;
  cornerPoints?: Array<{ x: number; y: number }>;
}
export interface BarcodeDetectorInstance {
  detect(source: ImageData): Promise<DetectedBarcode[]>;
}
interface BarcodeDetectorCtor {
  new (opts?: { formats?: string[] }): BarcodeDetectorInstance;
  getSupportedFormats?: () => Promise<string[]>;
}

/** The platform BarcodeDetector constructor, or null where the shell lacks it. */
export function nativeBarcodeDetector(): BarcodeDetectorCtor | null {
  const g = globalThis as { BarcodeDetector?: BarcodeDetectorCtor };
  return typeof g.BarcodeDetector === 'function' ? g.BarcodeDetector : null;
}

/**
 * Always true: with the zxing-wasm fallback the web shell can decode on any
 * browser (native BarcodeDetector where present, wasm otherwise). Kept as a
 * function so the attach site reads the same as media/recorder.
 */
export function scanAvailable(): boolean {
  return true;
}

// zxing canonical name -> BarcodeDetector naming (mirror of node-shell/scan.ts).
export const ZXING_TO_BD: Record<string, string> = {
  QRCode: 'qr_code', MicroQRCode: 'micro_qr_code', RMQRCode: 'rm_qr_code',
  DataMatrix: 'data_matrix', Aztec: 'aztec', PDF417: 'pdf417',
  EAN13: 'ean_13', EAN8: 'ean_8', UPCA: 'upc_a', UPCE: 'upc_e',
  Code39: 'code_39', Code93: 'code_93', Code128: 'code_128',
  Codabar: 'codabar', ITF: 'itf', DataBar: 'databar', DataBarExp: 'databar_expanded',
  MaxiCode: 'maxi_code',
};
export const ZXING_NAMES = Object.keys(ZXING_TO_BD);
export const ZXING_BD_NAMES = Object.values(ZXING_TO_BD);
