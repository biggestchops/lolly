// SPDX-License-Identifier: MPL-2.0
/**
 * 3D Studio alpha quality (plan 265, D2.1): the transparent outputs of the badge and of a
 * real GLB stay clear outside the subject and its shadow, keep the shadow within its
 * opacity, and show no halo on the silhouette. The checks live in
 * tests/helpers/studio3d-alpha.ts, which the live shell export case also runs.
 *
 * Each subject renders twice over. The lit scenes use the default studio: clear outside and
 * the shadow bound are asserted there, and the silhouette colour is only measured, because
 * sub-pixel side walls, bevels and grazing angles make lit edge pixels darker or lighter
 * than the faces beside them. The flat scenes give the subject one constant colour (the
 * glow finish with every light and the environment at zero, shadows kept), so any colour
 * change at the silhouette can only come from compositing: the halo check is asserted there.
 *
 * With STUDIO_SHOTS set, the lit outputs are saved with their composites over white, black
 * and #30ba78 (drawn in the page with a 2D canvas, source-over); the flat outputs are saved
 * as they are.
 *
 * The last case measures what a flat #30ba78 backdrop becomes after the output pass (ACES
 * tone mapping at the default exposure, then sRGB encoding). It prints the value and, with
 * STUDIO_WRITE_BASELINE=1, records it per backend in
 * tests/fixtures/studio3d/alpha/flat-backdrop.json. The value is not asserted.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { Page } from 'playwright';
import { buildStudioScene } from '../engine/src/studio3d.ts';
import {
  HALO_TOLERANCE,
  type StudioAlphaReport,
  type StudioCutout,
  studioAlphaReport,
} from './helpers/studio3d-alpha.ts';
import {
  type StudioFrame,
  type StudioHarness,
  type StudioValues,
  saveShot,
  startStudioHarness,
  studioSkip,
} from './helpers/studio3d-browser.ts';

const SIZE = 256;
const BACKDROP = '#30ba78';
const COMPOSITES = { white: '#ffffff', black: '#000000', green: BACKDROP } as const;
const FIXTURE = join(import.meta.dirname, 'fixtures', 'studio3d', 'alpha', 'flat-backdrop.json');

let harness: StudioHarness | undefined;

function studio(): StudioHarness {
  if (!harness) throw new Error('The 3D Studio harness did not start.');
  return harness;
}

const subjects: { name: string; values: StudioValues }[] = [
  { name: 'badge', values: { source: 'primitive', primitive: 'badge' } },
  { name: 'duck', values: { source: 'model', upload: { url: '/duck.glb', name: 'duck.glb' } } },
];

/**
 * One constant colour on the subject: glow on both roles, no light or environment, shadows
 * kept. The glow halo is off, because a halo draws colour outside the silhouette on purpose.
 */
const FLAT: StudioValues = {
  materialMode: 'pair',
  finishA: 'glow',
  finishB: 'glow',
  glow: 0,
  studio: 'custom',
  lights: [{ kind: 'directional', intensity: 0, shadows: true }],
  environmentIntensity: 0,
};

const lightings = [
  { name: 'lit', values: {}, halo: false },
  { name: 'flat', values: FLAT, halo: true },
] as const;

/** A PNG data URL drawn over a solid colour in the page, returned as a PNG data URL. */
function composite(page: Page, png: string, color: string): Promise<string> {
  return page.evaluate(
    async ({ png, color }) => {
      const image = new Image();
      image.src = png;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('No 2D context for the composite.');
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(image, 0, 0);
      return canvas.toDataURL('image/png');
    },
    { png, color }
  );
}

async function saveWithComposites(page: Page, name: string, png: string): Promise<void> {
  if (!process.env.STUDIO_SHOTS) return;
  await saveShot(`alpha-${name}.png`, png);
  for (const [label, color] of Object.entries(COMPOSITES))
    await saveShot(`alpha-${name}-over-${label}.png`, await composite(page, png, color));
}

function summary(report: StudioAlphaReport): string {
  const worst = report.haloWorst;
  return [
    `stray ${report.strayAlpha} (${report.strayPixels} px)`,
    `border ${report.borderAlpha}`,
    `shadow max ${report.shadowAlpha} of ${report.shadowLimit} (${report.shadowPixels} px)`,
    `halo darker ${report.haloDarker}, lighter ${report.haloLighter}`,
    `worst ${worst ? `${worst.excess} at ${worst.x},${worst.y} alpha ${worst.alpha} (object ${worst.objectAlpha}) rgb ${worst.rgb} range ${worst.low}..${worst.high}` : 'none'}`,
    `checked ${report.haloChecked}, skipped ${report.haloSkipped}`,
  ].join('; ');
}

function assertClean(
  report: StudioAlphaReport,
  kind: StudioCutout,
  label: string,
  halo: boolean
): void {
  const detail = `${label}: ${summary(report)}`;
  assert.ok(report.objectPixels > 1000, `${detail}: the subject is in frame`);
  assert.equal(report.strayAlpha, 0, `${detail}: clear outside`);
  if (kind === 'object-shadow') {
    assert.ok(report.shadowPixels > 100, `${detail}: a shadow is drawn`);
    assert.ok(report.shadowAlpha <= report.shadowLimit, `${detail}: shadow bound`);
  } else {
    assert.equal(report.borderAlpha, 0, `${detail}: the subject stays inside the frame`);
    assert.equal(report.shadowPixels, 0, `${detail}: no shadow pixels`);
  }
  assert.ok(report.haloChecked > 50, `${detail}: silhouette pixels were checked`);
  if (halo) assert.ok((report.haloWorst?.excess ?? 0) <= HALO_TOLERANCE, `${detail}: no halo`);
}

/**
 * Shadow-only alpha at two opacities: ShadowMaterial writes opacity times the shadow
 * amount, so the lower opacity matches the higher one scaled down, within rounding.
 */
function shadowScaling(
  low: StudioFrame,
  high: StudioFrame,
  object: StudioFrame,
  ratio: number
): { pixels: number; worst: number } {
  let pixels = 0,
    worst = 0;
  for (let i = 3; i < object.pixels.length; i += 4) {
    if (object.pixels[i] !== 0 || (!low.pixels[i] && !high.pixels[i])) continue;
    pixels++;
    worst = Math.max(worst, Math.abs(low.pixels[i]! - Math.round(high.pixels[i]! * ratio)));
  }
  return { pixels, worst };
}

/** three.js 0.186's ACESFilmicToneMapping and sRGB encoding, for one linear colour. */
function acesSrgb(hex: string, exposure: number): string {
  const decode = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const encode = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
  const linear = [1, 3, 5].map((at) => decode(Number.parseInt(hex.slice(at, at + 2), 16) / 255));
  const scaled = linear.map((c) => (c * exposure) / 0.6);
  // Row-major forms of the column-major matrices in tonemapping_pars_fragment.
  const input = [
    [0.59719, 0.35458, 0.04823],
    [0.076, 0.90834, 0.01566],
    [0.0284, 0.13383, 0.83777],
  ];
  const output = [
    [1.60475, -0.53108, -0.07367],
    [-0.10208, 1.10813, -0.00605],
    [-0.00327, -0.07276, 1.07602],
  ];
  const apply = (m: number[][], v: number[]) =>
    m.map((row) => row.reduce((sum, k, i) => sum + k * v[i]!, 0));
  const fit = (v: number) =>
    (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081);
  const mapped = apply(output, apply(input, scaled).map(fit)).map((c) =>
    Math.min(1, Math.max(0, c))
  );
  return (
    '#' +
    mapped
      .map((c) =>
        Math.round(encode(c) * 255)
          .toString(16)
          .padStart(2, '0')
      )
      .join('')
  );
}

const hexOf = (pixels: number[], i: number) =>
  '#' + [0, 1, 2].map((c) => pixels[i + c]!.toString(16).padStart(2, '0')).join('');

describe('3D Studio alpha quality', { skip: studioSkip }, () => {
  before(async () => {
    harness = await startStudioHarness({ size: SIZE });
  });
  after(async () => {
    await harness?.close();
  });

  for (const subject of subjects)
    it(`keeps the ${subject.name} cutouts clear, the shadow bounded and the silhouette free of halos`, async (t) => {
      const page = await studio().open();
      try {
        for (const lighting of lightings) {
          const frames: Record<string, { object: StudioFrame; shadow: StudioFrame }> = {};
          for (const shadowOpacity of [0.4, 1]) {
            const base = { ...subject.values, ...lighting.values, shadowOpacity };
            const object = await studio().render(page, { ...base, outputMode: 'object' });
            const shadow = await studio().render(page, { ...base, outputMode: 'object-shadow' });
            for (const frame of [object, shadow]) {
              assert.equal(frame.state, 'ready', frame.info);
              assert.equal(frame.width, SIZE);
            }
            frames[shadowOpacity] = { object, shadow };
            for (const [kind, frame] of [
              ['object', object],
              ['object-shadow', shadow],
            ] as const) {
              const label = `${subject.name} ${lighting.name} ${kind} at shadow opacity ${shadowOpacity}`;
              const report = studioAlphaReport(frame, object, kind, shadowOpacity);
              t.diagnostic(`${label}: ${summary(report)}`);
              assertClean(report, kind, label, lighting.halo);
            }
            const name = `${subject.name}-${lighting.name}-object-shadow-${shadowOpacity}`;
            if (lighting.halo) await saveShot(`alpha-${name}.png`, shadow.png);
            else await saveWithComposites(page, name, shadow.png);
          }
          const low = frames['0.4']!,
            high = frames['1']!;
          assert.equal(
            low.object.png,
            high.object.png,
            'shadow opacity does not change the object output'
          );
          const name = `${subject.name}-${lighting.name}-object`;
          if (lighting.halo) await saveShot(`alpha-${name}.png`, low.object.png);
          else await saveWithComposites(page, name, low.object.png);
          const scaling = shadowScaling(low.shadow, high.shadow, low.object, 0.4);
          t.diagnostic(
            `${subject.name} ${lighting.name}: shadow-only alpha at 0.4 against 0.4 times the alpha at 1: worst difference ${scaling.worst} over ${scaling.pixels} px`
          );
          assert.ok(scaling.pixels > 100, 'both opacities draw a shadow');
          assert.ok(scaling.worst <= 2, 'shadow alpha scales with the shadow opacity');
        }
      } finally {
        await page.close();
      }
    });

  it('records the flat backdrop colour after tone mapping', async (t) => {
    const page = await studio().open();
    try {
      // The subject moves to the left, so the top right of the frame shows only the backdrop.
      const values = {
        source: 'primitive',
        primitive: 'badge',
        outputMode: 'scene',
        backdrop: 'solid',
        background: BACKDROP,
        position: { x: -2.4, y: 0.1, z: 0 },
      };
      const frame = await studio().render(page, values);
      assert.equal(frame.state, 'ready', frame.info);
      const exposure = buildStudioScene({ version: 1, values }).exposure;
      assert.equal(exposure, 1.1, 'the default exposure');
      const counts = new Map<string, number>();
      for (let i = 0; i < frame.pixels.length; i += 4) {
        const key = hexOf(frame.pixels, i) + ':' + frame.pixels[i + 3];
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const [modal, modalCount] = [...counts].reduce((best, entry) =>
        entry[1] > best[1] ? entry : best
      );
      const block = new Set<string>();
      for (let y = 4; y < 20; y++)
        for (let x = SIZE - 20; x < SIZE - 4; x++) {
          const i = (y * SIZE + x) * 4;
          block.add(hexOf(frame.pixels, i) + ':' + frame.pixels[i + 3]);
        }
      const share = modalCount / (SIZE * SIZE);
      const renderer = await studio().rendererName(page);
      const [output] = modal.split(':') as [string];
      const predicted = acesSrgb(BACKDROP, exposure);
      t.diagnostic(
        `flat backdrop ${BACKDROP} at exposure ${exposure} renders as ${output} (predicted from three's ACES formula: ${predicted}); ${Math.round(share * 100)}% of the frame; top right block ${[...block].join(', ')}; backend ${renderer}`
      );
      assert.ok(share > 0.5, 'the backdrop fills most of the frame');
      assert.deepEqual([...block], [modal], 'the sampled block is the backdrop colour');
      await saveShot('alpha-flat-backdrop.png', frame.png);

      if (process.env.STUDIO_WRITE_BASELINE === '1') {
        let record: { description: string; entries: Record<string, unknown> } = {
          description: '',
          entries: {},
        };
        try {
          record = JSON.parse(await readFile(FIXTURE, 'utf8'));
        } catch {
          /* The first backend writes a new file. */
        }
        record.description =
          'What a flat 3D Studio backdrop colour becomes in the rendered output, per backend. Written by tests/studio3d-quality-alpha.browser.test.ts with STUDIO_WRITE_BASELINE=1; measured, not asserted.';
        record.entries[`${process.platform}:${renderer}`] = {
          platform: process.platform,
          renderer,
          backdrop: 'solid',
          background: BACKDROP,
          exposure,
          toneMapping: 'ACESFilmic',
          output,
          predicted,
          frameShare: Math.round(share * 1000) / 1000,
        };
        record.entries = Object.fromEntries(
          Object.entries(record.entries).sort(([a], [b]) => a.localeCompare(b))
        );
        await mkdir(dirname(FIXTURE), { recursive: true });
        await writeFile(FIXTURE, JSON.stringify(record, null, 2) + '\n');
      }
    } finally {
      await page.close();
    }
  });
});
