// SPDX-License-Identifier: MPL-2.0
/** Shared libjxl adapter. Call inside a disposable web or Node worker. */
import { isJxl, validateJxlRequest, type JxlInfo, type JxlRequest, type JxlResult } from '../../../engine/src/jxl.ts';

export interface JxlModule {
  HEAPU8: Uint8Array; HEAPF64: Float64Array;
  _malloc(length: number): number; _free(pointer: number): void;
  _lj_reset(): void; _lj_data(): number; _lj_size(): number; _lj_info(): number; _lj_error(): number;
  _lj_decode(pointer: number, length: number, mode: number): number;
  _lj_encode(pointer: number, length: number, width: number, height: number, lossless: number, quality: number, effort: number, sample: number, orientation: number): number;
  _lj_recompress(pointer: number, length: number, effort: number): number;
}
export async function createJxlCodec(wasmBinary: Uint8Array): Promise<JxlModule> {
  const { default: create } = await import('../wasm/jxl/vendor/lolly-jxl.mjs');
  return create({ wasmBinary, printErr: () => {} });
}
function facts(raw: Float64Array, oriented: boolean): JxlInfo {
  const [width, height, bitsPerSample, exponentBits, alphaBits, orientation, animated, extraChannels, intensityTarget, colorChannels, premultiplied, transferFunction, primaries, whitePoint, icc, reconstruction] = Array.from(raw) as [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
  const swaps = !oriented && orientation >= 5;
  return { width: swaps ? height : width, height: swaps ? width : height, encodedWidth: width, encodedHeight: height, bitsPerSample, exponentBits, alphaBits, orientation, animated: !!animated, extraChannels, intensityTarget, colorChannels, premultiplied: !!premultiplied, transferFunction, primaries, whitePoint, icc: !!icc, reconstruction: !!reconstruction, hdr: [16, 18].includes(transferFunction) || intensityTarget > 255 };
}
export function runJxlCodec(module: JxlModule, request: JxlRequest): JxlResult {
  validateJxlRequest(request);
  const pointer = module._malloc(request.bytes.length);
  if (!pointer) throw new Error('JPEG XL input allocation failed.');
  try {
    module.HEAPU8.set(request.bytes, pointer);
    let ok: number;
    if (request.operation === 'encode') {
      const opts = request.options ?? {};
      ok = module._lj_encode(pointer, request.bytes.length, request.width, request.height, Number(opts.lossless ?? false), opts.quality ?? 0.9, opts.effort ?? 5, request.sample ?? 0, request.orientation ?? 1);
    } else if (request.operation === 'recompress') ok = module._lj_recompress(pointer, request.bytes.length, request.effort ?? 5);
    else ok = module._lj_decode(pointer, request.bytes.length, { probe: 0, decode: 1, decode16: 2, decodeFloat: 3, restore: 4 }[request.operation]);
    if (!ok) {
      const at = module._lj_error(); let end = at;
      while (end < at + 1024 && module.HEAPU8[end]) end++;
      throw new Error(new TextDecoder().decode(module.HEAPU8.subarray(at, end)) || 'JPEG XL operation failed.');
    }
    const raw = module.HEAPF64.slice(module._lj_info() / 8, module._lj_info() / 8 + 20);
    const bytes = module.HEAPU8.slice(module._lj_data(), module._lj_data() + module._lj_size());
    if (['encode', 'recompress'].includes(request.operation) && !isJxl(bytes)) throw new Error('The encoder did not return JPEG XL bytes.');
    const result = { bytes, ...(raw[0] ? { info: facts(raw, request.operation === 'decode' || request.operation === 'decodeFloat') } : {}), peakCodecBytes: raw[18]!, heapBytes: module.HEAPU8.buffer.byteLength };
    if (request.operation === 'recompress') {
      const restored = runJxlCodec(module, { operation: 'restore', bytes });
      if (restored.bytes.length !== request.bytes.length || !restored.bytes.every((b, i) => b === request.bytes[i])) throw new Error('Original JPEG byte verification failed. No reversible output was accepted.');
      result.peakCodecBytes = Math.max(result.peakCodecBytes, restored.peakCodecBytes);
      result.heapBytes = Math.max(result.heapBytes, restored.heapBytes);
    }
    return result;
  } finally { module._free(pointer); module._lj_reset(); }
}
