// SPDX-License-Identifier: MPL-2.0
import { createJxlCodec, runJxlCodec } from '@lolly-tools/node-shell/jxl-codec';
import wasmUrl from '@lolly-tools/node-shell/jxl.wasm?url';
import type { JxlRequest } from '../../../../engine/src/jxl.ts';
const scope = globalThis;
scope.onmessage = async ({ data }: MessageEvent<JxlRequest>) => {
  try {
    const response = await fetch(wasmUrl);
    if (!response.ok) throw new Error('JPEG XL codec is unavailable. Connect once to download it for this device.');
    const module = await createJxlCodec(new Uint8Array(await response.arrayBuffer()));
    const result = runJxlCodec(module, data);
    scope.postMessage({ result }, { transfer: [result.bytes.buffer as ArrayBuffer] });
  } catch (error) { scope.postMessage({ error: error instanceof Error ? error.message : String(error) }, { transfer: [] }); }
};
