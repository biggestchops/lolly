// SPDX-License-Identifier: MPL-2.0
/** Real PDF recipient checks against full-font embedding, plus WASM cold/warm costs. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { createPdfDoc } from '../shells/web/src/bridge/export-pdf-doc.ts';
import { subsetWithSkera, type SkeraWasm } from '../packages/node-shell/src/font-subset-wasm.ts';

const directory = resolve(process.argv.find(arg => arg.startsWith('--out='))?.slice(6) ?? '/tmp/lolly-skera-pdf');
mkdirSync(directory, { recursive: true });
const wasmBytes = readFileSync(new URL('../packages/node-shell/wasm/skera/skera.wasm', import.meta.url));
const coldStart = performance.now();
const { instance } = await WebAssembly.instantiate(wasmBytes);
const coldMs = performance.now() - coldStart;
const wasm = instance.exports as unknown as SkeraWasm;
const reports = [];
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
for (const [file, text] of [
  ['Outfit[wght].ttf', 'Hi Aé Ångström 123'],
  ['SUSE[wght].ttf', 'A readable PDF with a small embedded font.'],
] as const) {
  const font = new Uint8Array(readFileSync(new URL(`../shells/web/public/fonts/${file}`, import.meta.url)));
  const outputs: { mode: string; pdfBytes: number; embeddedFontBytes: number; subsetMs: number; exportMs: number; pixelSha256: string; extracted: string }[] = [];
  for (const mode of ['full', 'skera']) {
    let embeddedFontBytes = 0, subsetMs = 0;
    const start = performance.now();
    const doc = await createPdfDoc({ format: [500, 100], fontSubset: async (bytes, ids) => {
      const before = performance.now();
      const output = mode === 'full' ? bytes : subsetWithSkera(wasm, bytes, ids);
      subsetMs += performance.now() - before; embeddedFontBytes += output.length;
      return output;
    } });
    doc.addFileToVFS('face.ttf', Buffer.from(font).toString('base64'));
    doc.addFont('face.ttf', 'face', 'normal'); doc.setFont('face');
    doc.setFontSize(18); doc.text(text, 10, 50);
    const bytes = new Uint8Array(await doc.output('arraybuffer') as ArrayBuffer);
    const exportMs = performance.now() - start;
    const stem = resolve(directory, `${file}-${mode}`);
    writeFileSync(`${stem}.pdf`, bytes);
    execFileSync('pdftoppm', ['-singlefile', '-r', '144', '-png', `${stem}.pdf`, stem]);
    const extracted = execFileSync('pdftotext', [`${stem}.pdf`, '-'], { encoding: 'utf8' }).trim();
    assert.equal(extracted, text);
    outputs.push({ mode, pdfBytes: bytes.length, embeddedFontBytes, subsetMs, exportMs,
      pixelSha256: hash(readFileSync(`${stem}.png`)), extracted });
  }
  assert.equal(outputs[0]!.pixelSha256, outputs[1]!.pixelSha256, `${file}: recipient pixels match`);
  assert.ok(outputs[1]!.embeddedFontBytes < outputs[0]!.embeddedFontBytes / 2);
  reports.push({ font: file, sourceSha256: hash(font), outputs });
}
const report = { date: new Date().toISOString(), node: process.version, recipient: spawnSync('pdftoppm', ['-v'], { encoding: 'utf8' }).stderr.trim(),
  wasm: { bytes: wasmBytes.length, gzipBytes: gzipSync(wasmBytes).length, sha256: hash(wasmBytes), coldCompileMs: coldMs }, reports };
writeFileSync(resolve(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
