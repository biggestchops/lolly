// SPDX-License-Identifier: MPL-2.0
import { parentPort, workerData } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import { createJxlCodec, runJxlCodec } from './jxl-codec.ts';
try {
  const wasm = await readFile(new URL('../lolly-jxl.wasm', import.meta.url));
  const result = runJxlCodec(await createJxlCodec(wasm), workerData);
  parentPort?.postMessage({ result }, [result.bytes.buffer as ArrayBuffer]);
} catch (error) { parentPort?.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
