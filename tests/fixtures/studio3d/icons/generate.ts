// SPDX-License-Identifier: MPL-2.0
/**
 * Writes the twelve public icon fixtures (plan 265 milestone 2, lane T0).
 *
 * Run it from the repo root and commit what it writes:
 *   node tests/fixtures/studio3d/icons/generate.ts
 *
 * The set is the studio's stand-in for a real brand icon family, so the collection
 * work has twelve unrelated silhouettes to arrange without reaching for the private
 * SUSE pack. Each icon is one 40 unit square, at most two fills, no strokes and no
 * transforms, well inside the admission limits in
 * shells/web/src/lib/studio3d/source.ts (1 MB, 512 elements, 128 paths, 2048 curves,
 * 256 boolean steps, 16 colours).
 *
 * The weight classes are deliberate, three icons each, so a later occupancy check has
 * something to correct: thin (a ring-like outer with a hole), solid (a heavy filled
 * silhouette), tall and wide.
 *
 * Every shape is authored so the studio can extrude it with the full bevel at both the
 * 0.025 and 0.05 requests:
 *   - no detail narrower than about three units, which is several times the widest
 *     bevel either request asks for;
 *   - no corner sharper than about 45 degrees, so the cap inset never folds a tip;
 *   - where two parts of one colour meet, they overlap deeply, so the boundaries cross
 *     steeply. A grazing crossing leaves a needle-thin notch whose inset travels far
 *     enough to reverse the short curve segment beside it, and the studio answers that
 *     with a smaller bevel and a note.
 * Coordinates are rounded to two decimals, so a rebuild on another machine writes the
 * same bytes.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const GREEN = '#30ba78';
const DARK = '#0c322c';

type Point = [number, number];

/** Two decimals, with no trailing zeros, so the files stay short and stable. */
function n(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

/** A full circle as two half arcs; `hole` draws it the other way round. */
function disc(cx: number, cy: number, r: number, hole = false): string {
  const sweep = hole ? 0 : 1;
  const a = `A${n(r)} ${n(r)} 0 1 ${sweep} `;
  return `M${n(cx)} ${n(cy - r)}${a}${n(cx)} ${n(cy + r)}${a}${n(cx)} ${n(cy - r)}Z`;
}

/** An outer circle with a concentric hole. */
function ring(cx: number, cy: number, outer: number, inner: number): string {
  return disc(cx, cy, outer) + disc(cx, cy, inner, true);
}

/**
 * A closed polygon, always wound the way `disc` draws its outer circle. Winding matters:
 * the loader unions each colour under the nonzero rule, so a contour drawn the other way
 * round would cancel where it overlaps instead of joining.
 */
function poly(points: Point[]): string {
  let twice = 0;
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i]!,
      [x1, y1] = points[(i + 1) % points.length]!;
    twice += x0 * y1 - x1 * y0;
  }
  const ordered = twice < 0 ? [...points].reverse() : points;
  return ordered.map(([x, y], i) => `${i ? 'L' : 'M'}${n(x)} ${n(y)}`).join('') + 'Z';
}

/** A rectangle with four equal rounded corners, drawn clockwise from the top edge. */
function roundRect(x0: number, y0: number, x1: number, y1: number, r: number): string {
  const a = `A${n(r)} ${n(r)} 0 0 1 `;
  return (
    `M${n(x0 + r)} ${n(y0)}L${n(x1 - r)} ${n(y0)}${a}${n(x1)} ${n(y0 + r)}` +
    `L${n(x1)} ${n(y1 - r)}${a}${n(x1 - r)} ${n(y1)}` +
    `L${n(x0 + r)} ${n(y1)}${a}${n(x0)} ${n(y1 - r)}` +
    `L${n(x0)} ${n(y0 + r)}${a}${n(x0 + r)} ${n(y0)}Z`
  );
}

/** A point on a circle at an angle in degrees, measured from the top and going right. */
function at(cx: number, cy: number, r: number, degrees: number): Point {
  const radians = ((degrees - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(radians), cy + r * Math.sin(radians)];
}

/** A straight bar of a given width between two points, as four corners. */
function bar(from: Point, to: Point, width: number): string {
  const dx = to[0] - from[0],
    dy = to[1] - from[1];
  const length = Math.hypot(dx, dy);
  const nx = (-dy / length) * (width / 2),
    ny = (dx / length) * (width / 2);
  return poly([
    [from[0] + nx, from[1] + ny],
    [to[0] + nx, to[1] + ny],
    [to[0] - nx, to[1] - ny],
    [from[0] - nx, from[1] - ny],
  ]);
}

/** A cog: alternating tooth tips and roots, joined by straight flanks and valleys. */
function gearOutline(cx: number, cy: number, tip: number, root: number, teeth: number): string {
  const step = 360 / teeth;
  const points: Point[] = [];
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    points.push(at(cx, cy, root, a - 16), at(cx, cy, tip, a - 9));
    points.push(at(cx, cy, tip, a + 9), at(cx, cy, root, a + 16));
  }
  return poly(points);
}

/** A star with `points` tips, drawn point up. */
function star(cx: number, cy: number, outer: number, inner: number, points: number): string {
  const step = 180 / points;
  const corners: Point[] = [];
  for (let i = 0; i < points * 2; i++)
    corners.push(at(cx, cy, i % 2 ? inner : outer, i * step));
  return poly(corners);
}

interface IconPath {
  fill: string;
  d: string;
}

interface Icon {
  file: string;
  /** What the icon is, and why its silhouette sits in its weight class. */
  note: string;
  paths: IconPath[];
}

const green = (d: string): IconPath => ({ fill: GREEN, d });
const dark = (d: string): IconPath => ({ fill: DARK, d });

const ICONS: Icon[] = [
  {
    file: 'bolt-ring.svg',
    note: 'A bolt inside a ring. Thin: a five unit ring wall and a bolt that never touches it.',
    paths: [
      green(ring(20, 20, 18, 13)),
      dark(
        poly([
          [23, 9],
          [13, 22],
          [19, 22],
          [17, 31],
          [27, 18],
          [21, 18],
        ])
      ),
    ],
  },
  {
    file: 'gear.svg',
    note: 'A cog with eight teeth and a free hub. Thin: the rim is five units across the root.',
    paths: [green(gearOutline(20, 20, 18, 13.5, 8) + disc(20, 20, 8.5, true)), dark(disc(20, 20, 5))],
  },
  {
    file: 'magnifier.svg',
    note: 'A rim and handle in one fill, over a separate lens. Thin: the rim is four units across.',
    paths: [
      green(disc(16.5, 16.5, 6)),
      dark(ring(16.5, 16.5, 11.5, 7.5) + bar([22.58, 22.58], [33.47, 33.47], 5)),
    ],
  },
  {
    file: 'play.svg',
    note: 'A play triangle cut out of a rounded square. Solid: a 28 unit square, 28 by 28.',
    paths: [
      dark(roundRect(6, 6, 34, 34, 6)),
      green(
        poly([
          [16, 12],
          [29, 20],
          [16, 28],
        ])
      ),
    ],
  },
  {
    file: 'cloud.svg',
    note: 'Three deeply overlapping puffs on a flat base, with an inner disc. Wide: 28 by 21.',
    paths: [
      dark(
        disc(12, 20, 7) +
          disc(27, 21, 6) +
          disc(19.5, 15.5, 8.5) +
          poly([
            [7, 20],
            [31, 20],
            [31, 28],
            [7, 28],
          ])
      ),
      green(disc(19, 20, 5)),
    ],
  },
  {
    file: 'padlock.svg',
    note: 'A shackle over a body with a keyhole. Tall: 24 across by 26 down.',
    paths: [
      green(roundRect(8, 19, 32, 37, 4) + disc(20, 27, 2.5, true)),
      dark(
        `M14 22L14 17A6 6 0 0 1 26 17L26 22L23 22L23 17A3 3 0 0 0 17 17L17 22Z`
      ),
    ],
  },
  {
    file: 'bell.svg',
    note: 'A bell over a loose clapper. Tall: 22 across by 28 down.',
    paths: [
      green(
        'M20 6C25.5 6 28 10 28 15L28 21L31 27L9 27L12 21L12 15C12 10 14.5 6 20 6Z'
      ),
      dark(disc(20, 31, 3)),
    ],
  },
  {
    file: 'house.svg',
    note: 'A gable over walls with a round window. Wide: 32 across by 24 down.',
    paths: [
      green(
        poly([
          [20, 8],
          [36, 20],
          [36, 32],
          [4, 32],
          [4, 20],
        ])
      ),
      dark(disc(20, 23, 4)),
    ],
  },
  {
    file: 'pin.svg',
    note: 'A map pin with a free centre. Tall: 26 across by 32 down.',
    paths: [
      green(
          'M20 4C27.2 4 33 9.8 33 17C33 24 26 30 20 36C14 30 7 24 7 17C7 9.8 12.8 4 20 4Z'
      ),
      dark(disc(20, 16, 5)),
    ],
  },
  {
    file: 'chat.svg',
    note: 'A bubble with a tail and three dots. Wide: 32 across by 26 down.',
    paths: [
      green(
        roundRect(4, 8, 36, 28, 6) +
          poly([
            [14, 24],
            [23, 26],
            [13, 34],
          ])
      ),
      dark(disc(13, 18, 2) + disc(20, 18, 2) + disc(27, 18, 2)),
    ],
  },
  {
    file: 'star.svg',
    note: 'A five point star with a hole at its middle. Solid: 34 across by 33 down.',
    paths: [green(star(20, 20, 18, 10, 5)), dark(disc(20, 20, 4))],
  },
  {
    file: 'leaf.svg',
    note: 'A leaf blade with a midrib cut through it. Solid: a 24 unit lens with two square tips.',
    paths: [
      green('M8 32C8 18 18 8 32 8C32 22 22 32 8 32Z'),
      dark(bar([12, 28], [28, 12], 2.6)),
    ],
  },
];

function render(icon: Icon): string {
  const paths = icon.paths.map((p) => `<path fill="${p.fill}" d="${p.d}"/>`).join('');
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">' +
    '<!-- SPDX-License-Identifier: MPL-2.0 -->' +
    `<!-- ${icon.note} -->` +
    paths +
    '</svg>\n'
  );
}

const dir = import.meta.dirname;
for (const icon of ICONS) {
  const text = render(icon);
  if (text.length > 2048) throw new Error(`${icon.file} is ${text.length} bytes, over the 2 KB cap.`);
  writeFileSync(join(dir, icon.file), text);
  process.stdout.write(`${icon.file}: ${text.length} bytes, ${icon.paths.length} paths\n`);
}
