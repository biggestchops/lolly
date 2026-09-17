// SPDX-License-Identifier: MPL-2.0
/**
 * The twelve public icon fixtures (plan 265 milestone 2, lane T0).
 *
 * `tests/fixtures/studio3d/icons` holds twelve unrelated two-colour SVG icons written by
 * `generate.ts` in that folder. They are the studio's stand-in for a brand icon family,
 * so a collection test can arrange twelve subjects under one studio without the private
 * SUSE pack, which a public clone does not have.
 *
 * The weight of each silhouette is recorded rather than measured, because the point of
 * the set is that the twelve do NOT sit alike in their frames: three are thin (a ring
 * around a hole), three are heavy solids, three are taller than they are wide and three
 * are wider than they are tall. An occupancy check therefore has something real to
 * correct, which is what plan 265's twelve-icons step asks for.
 *
 * The browser harness serves the folder at `/icons/<file>`, so a page can read one with
 * `fetch('/icons/gear.svg')` (see `studio3d-browser.ts`, default routes).
 */
import { join, resolve } from 'node:path';

/** How the icon sits in its frame, chosen when it was drawn. */
export type StudioIconWeight = 'thin' | 'solid' | 'tall' | 'wide';

export interface StudioIcon {
  /** Stable id, also the file name without the extension. */
  id: string;
  /** File name inside the icons folder, and the last part of its harness route. */
  file: string;
  /** Short label for a contact sheet or a test name. */
  name: string;
  weight: StudioIconWeight;
}

/** The twelve, in the order plan 265 lists them. */
export const STUDIO_ICONS: readonly StudioIcon[] = [
  { id: 'bolt-ring', file: 'bolt-ring.svg', name: 'Bolt in a ring', weight: 'thin' },
  { id: 'gear', file: 'gear.svg', name: 'Gear', weight: 'thin' },
  { id: 'leaf', file: 'leaf.svg', name: 'Leaf', weight: 'solid' },
  { id: 'play', file: 'play.svg', name: 'Play', weight: 'solid' },
  { id: 'cloud', file: 'cloud.svg', name: 'Cloud', weight: 'wide' },
  { id: 'padlock', file: 'padlock.svg', name: 'Padlock', weight: 'tall' },
  { id: 'magnifier', file: 'magnifier.svg', name: 'Magnifier', weight: 'thin' },
  { id: 'bell', file: 'bell.svg', name: 'Bell', weight: 'tall' },
  { id: 'house', file: 'house.svg', name: 'House', weight: 'wide' },
  { id: 'pin', file: 'pin.svg', name: 'Pin', weight: 'tall' },
  { id: 'chat', file: 'chat.svg', name: 'Chat bubble', weight: 'wide' },
  { id: 'star', file: 'star.svg', name: 'Star', weight: 'solid' },
];

/** The folder the twelve files live in. */
export function studioIconsDir(): string {
  return resolve(import.meta.dirname, '..', 'fixtures', 'studio3d', 'icons');
}

/** The full path of one icon file. */
export function studioIconPath(file: string): string {
  return join(studioIconsDir(), file);
}
