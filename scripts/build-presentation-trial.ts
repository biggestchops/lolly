// SPDX-License-Identifier: MPL-2.0
/** Build the portable, three-slide M1 acceptance fixture through the normal .lolly writer. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { ENGINE_VERSION } from '../engine/src/version.ts';
import { buildLollyFile, readLollyFile } from '../shells/web/src/lib/lolly-pack.ts';
import { readScene, readSceneSettings } from '../shells/web/src/views/present-production/scene.ts';

const output = resolve(process.argv[2] ?? '/tmp/lolly-presentation-260/m1-acceptance/kit');
const tool = JSON.parse(await readFile(new URL('../community/design/tool.json', import.meta.url), 'utf8'));
const logo = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="80" viewBox="0 0 240 80"><rect width="240" height="80" rx="16" fill="#fffdf5"/><circle cx="40" cy="40" r="18" fill="#174b42"/><path d="M35 26h10v28H35z" fill="#d8eb93"/><text x="72" y="52" font-family="sans-serif" font-size="36" font-weight="700" fill="#174b42">LOLLY</text></svg>';
const version = createHash('sha256').update(logo).digest('hex');
const asset = { id: 'user/presentation-trial-logo', source: 'user', format: 'svg', version };
const scene = readScene({ version: 1, layout: 'inset', logo: { asset, width: 144 },
  camera: { box: { x: 928, y: 424, w: 304, h: 228 }, radius: 24, border: 3 },
  lower: { title: 'Alex Presenter', subtitle: 'Lolly presentation trial' } });
const settings = readSceneSettings(scene);
scene.prepared = [
  { id: 'slides', name: 'Slides', scene: structuredClone(settings) },
  { id: 'conversation', name: 'Conversation', scene: { ...structuredClone(settings), layout: 'camera' } },
];

const pages = [
  { name: 'Opening', title: 'One clear picture.', subtitle: 'Slides, camera and identity.',
    bg: '#174b42', fg: '#fffdf5', accent: '#d8eb93',
    lines: ['A camera crop that stays in place.', 'A logo that stays visible.', 'A caption that enters on cue.'] },
  { name: 'Readability', title: 'Every detail counts.', subtitle: 'Inspect this slide on the receiving device.',
    bg: '#f4f0e6', fg: '#173f38', accent: '#527b6d',
    lines: ['Large: The quick brown fox 0123456789', 'Medium: Clear text, clean edges, full frame.', 'Small: Small type reveals call compression.'] },
  { name: 'Closing', title: 'Keep control private.', subtitle: 'One composition, one deliberate output.',
    bg: '#25294d', fg: '#fffdf5', accent: '#d8eb93',
    lines: ['Prepare a scene, then Apply.', 'Keep notes and controls private.', 'Stop sharing before ending.'] },
];
const boxes: Record<string, unknown>[] = [];
for (const [index, page] of pages.entries()) {
  const x = index * 2000, frame = `trial-slide-${index + 1}`;
  boxes.push({ id: frame, name: `${index + 1}. ${page.name}`, kind: 'frame', x, y: 0,
    w: 1920, h: 1080, rot: 0, shape: 'rect', bg: page.bg, order: index, clipChildren: true,
    notes: `PRIVATE NOTES ${index + 1}: This sentence must appear only in Speaker view.` });
  const text = (id: string, value: string, y: number, fontSize: number, weight = '400') => {
    boxes.push({ id: `${frame}-${id}`, kind: 'text', frame, x: x + 96, y, w: 1260, h: fontSize * 2.4,
      rot: 0, shape: 'rect', text: value, fg: page.fg, fontSize, font: 'sans', weight,
      align: 'left', valign: 'top', lineHeight: 1.15 });
  };
  text('number', `0${index + 1} / ${page.name.toUpperCase()}`, 92, 28, '700');
  text('title', page.title, 232, 108, '700');
  text('subtitle', page.subtitle, 414, 38);
  for (const [row, line] of page.lines.entries()) {
    text(`line-${row}`, line, 540 + row * 72, index === 1 ? ([48, 36, 27][row] ?? 38) : 38);
  }
  for (const [edge, left, top, w, h] of [
    ['top', 18, 18, 1884, 3], ['bottom', 18, 1059, 1884, 3],
    ['left', 18, 18, 3, 1044], ['right', 1899, 18, 3, 1044],
  ] as const) boxes.push({ id: `${frame}-${edge}`, kind: 'box', frame, x: x + left, y: top,
    w, h, rot: 0, shape: 'rect', bg: page.accent });
}
const session = { boxes, __toolId: 'design', __toolVersion: tool.version,
  __label: 'Lolly presentation trial', __presentation: scene };
await mkdir(output, { recursive: true });
const built = await buildLollyFile({ toolId: 'design', toolVersion: tool.version, session,
  name: 'Lolly presentation trial', engineVersion: ENGINE_VERSION,
  userAssets: [{ id: asset.id, version, type: 'vector', format: 'svg', width: 240, height: 80,
    blob: new Blob([logo], { type: 'image/svg+xml' }) }] });
const bytes = new Uint8Array(await built.blob.arrayBuffer());
const readback = await readLollyFile(bytes);
assert.deepEqual(readback.session, session);
assert.equal(readback.manifest.counts.assets, 1);
assert.equal(readback.manifest.counts.byReference, 0);
await writeFile(resolve(output, built.filename), bytes);
await writeFile(resolve(output, 'trial-logo.svg'), logo);
await writeFile(resolve(output, 'trial-session.json'), JSON.stringify(session, null, 2) + '\n');
await writeFile(resolve(output, 'fixture.json'), JSON.stringify({ engineVersion: ENGINE_VERSION,
  toolVersion: tool.version, slides: pages.length, embeddedAssets: 1, cameraAutoStart: false,
  sha256: createHash('sha256').update(bytes).digest('hex') }, null, 2) + '\n');
console.log(resolve(output, built.filename));
