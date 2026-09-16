// SPDX-License-Identifier: MPL-2.0
import { isSkeraWasm, subsetWithSkera } from '@lolly-tools/node-shell/font-subset-wasm';
import wasmUrl from '@lolly-tools/node-shell/skera.wasm?url';

addEventListener('message', async (event: MessageEvent<{ font: Uint8Array; glyphs: number[] }>) => {
  try {
    const response = await fetch(wasmUrl);
    if (!response.ok) throw new Error(`Font subset runtime failed to load (${response.status})`);
    const { instance } = await WebAssembly.instantiate(await response.arrayBuffer());
    if (!isSkeraWasm(instance.exports)) throw new Error('Font subset runtime is incompatible');
    const result = subsetWithSkera(instance.exports, event.data.font, event.data.glyphs);
    postMessage({ bytes: result }, { transfer: [result.buffer] });
  } catch (error) {
    postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
});
