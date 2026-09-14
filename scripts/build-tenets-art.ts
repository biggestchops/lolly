// SPDX-License-Identifier: MPL-2.0
// Render the tenets illustrations with Lolly Design and its native SVG export.
// Recipes stay beside the outputs. Sign through the standard docs art pipeline.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { artC2paOpts, signDocsArt } from './sign-docs-art.ts';
import { execFileSync } from 'node:child_process';
import { embedC2pa } from '../engine/src/c2pa.ts';
import { verifyC2pa } from '../engine/src/c2pa-verify.ts';
import { serialiseKf } from '../engine/src/keyframes.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const { PDFDocument } = createRequire(new URL('../packages/node-shell/package.json', import.meta.url))('pdf-lib');

const glyph = (x: number, y: number, w: number, h: number, fontSize: number, fg: string) => ({
  id: 'ampersand', kind: 'text', x, y, w, h, text: '&', fg, bg: 'transparent',
  font: 'SUSE', weight: '650', fontSize, align: 'center', valign: 'middle',
  pad: 0, tracking: 0, lineHeight: 1, fitText: true,
});
const bar = (id: string, x: number, y: number, w: number, h: number, bg: string) => ({
  id, kind: 'box', x, y, w, h, bg, shape: 'rect', radius: 0,
});
// The same brand glyph, colours and rule, composed for still and moving uses.
const recipes = {
  print: { width: '480', height: '640', background: '#f4f5ee', boxes: [
    bar('paper', 0, 0, 480, 640, '#f4f5ee'),
    bar('field', 28, 28, 424, 492, '#30ba78'),
    glyph(43, 55, 394, 426, 410, '#0c322c'),
    bar('rule', 28, 548, 424, 4, '#0c322c'),
    bar('signature', 28, 576, 48, 24, '#30ba78'),
  ] },
  screen: { width: '800', height: '450', background: '#30ba78', boxes: [
    bar('canvas', 0, 0, 800, 450, '#30ba78'),
    bar('field', 24, 24, 752, 402, '#0c322c'),
    glyph(358, 10, 380, 422, 410, '#f4f5ee'),
    bar('rule', 64, 90, 230, 4, '#30ba78'),
    bar('signature', 64, 326, 48, 24, '#30ba78'),
  ] },
  motion: { width: '800', height: '450', background: '#30ba78', seconds: '6', fps: '24', codec: 'h264', boxes: [
    bar('canvas', 0, 0, 800, 450, '#30ba78'),
    bar('field', 24, 24, 752, 402, '#0c322c'),
    { ...glyph(358, 10, 380, 422, 410, '#f4f5ee'), start: 0, dur: 6,
      kf: serialiseKf([
        { t: 0, ease: 'es', v: { x: -190, s: .72, r: -10 } },
        { t: 1600, ease: 'es', v: { x: 0, s: 1, r: 0 } },
        { t: 2800, ease: 'es', v: { x: 0, s: 1, r: 0 } },
        { t: 4400, ease: 'es', v: { x: -80, s: .88, r: 6 } },
        { t: 6000, ease: 'es', v: { x: 0, s: 1, r: 0 } },
      ]) },
    { ...bar('rule', 64, 90, 230, 4, '#30ba78'), start: 0, dur: 6,
      kf: serialiseKf([
        { t: 0, ease: 'es', v: { w: 48 } },
        { t: 1600, ease: 'es', v: { w: 230 } },
        { t: 2800, ease: 'es', v: { w: 230 } },
        { t: 4400, ease: 'es', v: { w: 120 } },
        { t: 6000, v: { w: 230 } },
      ]) },
    { ...bar('signature', 64, 326, 48, 24, '#30ba78'), start: 0, dur: 6,
      kf: serialiseKf([
        { t: 0, ease: 'es', v: { y: -60 } },
        { t: 1600, v: { y: 0 } },
      ]) },
  ] },
  vector: { width: '480', height: '480', background: 'transparent', boxes: [
    glyph(35, 2, 410, 424, 410, '#30ba78'),
    bar('rule', 70, 447, 340, 4, '#30ba78'),
  ] },
};
for (const [name, recipe] of Object.entries(recipes)) {
  writeFileSync(resolve(root, `docs/figures/tenets-${name}.inputs.json`), `${JSON.stringify(recipe, null, 2)}\n`);
  writeFileSync(resolve(root, `docs/figures/tenets-${name}.meta.json`), `${JSON.stringify({
    generator: { name: 'Lolly Design', version: '1.27.0' }, source: 'digitalCreation', author: { name: 'Andy Fitzsimon' },
  }, null, 2)}\n`);
}

const motionOnly = process.argv.includes('--motion-only');
for (const name of ['print', 'screen', 'vector', 'motion', 'infinity'].filter(name => !motionOnly || name === 'motion')) {
  const file = `tenets-${name}`;
  const inputs = JSON.parse(readFileSync(resolve(root, `docs/figures/${file}.inputs.json`), 'utf8'));
  const params = Object.fromEntries(Object.entries(inputs).map(([key, value]) =>
    [key, typeof value === 'string' ? value : JSON.stringify(value)]));
  if (name !== 'motion') {
    execFileSync(process.execPath, [resolve(root, 'shells/cli/bin/lolly.ts'), 'design',
    ...Object.entries(params).map(([key, value]) => `--${key}=${value}`),
    '--c2pa=off', '--meta=off', '--export=svg',
    `--output=${resolve(root, `docs/figures/${file}.svg`)}`],
  { stdio: 'inherit', env: { ...process.env, LOLLY_PROFILE: 'lolly-start' } });
  const output = resolve(root, `docs/figures/${file}.svg`);
  // The bank rejects URLs in prose too. Normalize the generator description and omit the redundant source URL.
  writeFileSync(output, readFileSync(output, 'utf8').replace(/<desc>Made with https:\/\/lolly\.tools : Design<\/desc>/, '<desc>Made with Lolly Design</desc>').replace(/<dc:source>https:\/\/lolly\.tools\/t\/design<\/dc:source>/, ''));
  }
  if (name === 'print' || name === 'screen' || name === 'motion') {
    const format = name === 'print' ? 'pdf' : name === 'motion' ? 'mp4' : 'png';
    const download = resolve(root, `docs/figures/${file}.${format}`);
    execFileSync(process.execPath, [resolve(root, 'shells/cli/bin/lolly.ts'), 'design',
      ...Object.entries(params).map(([key, value]) => `--${key}=${value}`),
      '--c2pa=off', '--meta=off', `--export=${format}`, `--output=${download}`],
    { stdio: 'inherit', env: { ...process.env, LOLLY_PROFILE: 'lolly-start' } });
    // Use the docs author metadata for every format, after the native export finishes.
    const meta = JSON.parse(readFileSync(resolve(root, `docs/figures/${file}.meta.json`), 'utf8'));
    let bytes: Uint8Array = new Uint8Array(readFileSync(download));
    // Match the web exporter's classic cross-reference table before C2PA embedding.
    if (format === 'pdf') bytes = await (await PDFDocument.load(bytes, { updateMetadata: false })).save({ useObjectStreams: false });
    writeFileSync(download, await embedC2pa(bytes, format,
      artC2paOpts(meta, { id: file, kind: 'figure', format,
        dims: { width: Number(inputs.width), height: Number(inputs.height) } })));
  }
}

const signed = await signDocsArt();
if (signed.violations.length) throw new Error('Tenets art failed the docs bank checks');
for (const file of ['print.pdf', 'screen.png', 'motion.mp4', 'print.svg', 'screen.svg', 'vector.svg', 'infinity.svg']) {
  const report = await verifyC2pa(new Uint8Array(readFileSync(resolve(root, `docs/figures/tenets-${file}`))));
  if (report.state !== 'valid' || report.author?.name !== 'Andy Fitzsimon') {
    throw new Error(`Tenets export has no valid author credential: ${file}`);
  }
}
