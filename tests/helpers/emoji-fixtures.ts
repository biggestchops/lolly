// SPDX-License-Identifier: MPL-2.0
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { EmojiPackManifestV1, EmojiPackPinV1, EmojiStyleV1 } from '../../packages/core/src/emoji-v1.ts';
import { readEmojiPack } from '../../engine/src/emoji-pack.ts';

export const fixtureRoot = new URL('../fixtures/emoji/', import.meta.url);
export const digest = (bytes: Uint8Array): string => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
export interface FixtureLock {
  directory: string;
  pin: EmojiPackPinV1;
  files: Record<string, { url: string; checksum: string }>;
}
export const fixtureLocks = JSON.parse(await readFile(new URL('packs.lock.json', fixtureRoot), 'utf8')) as FixtureLock[];

export async function fixture(name = 'twemoji') {
  const lock = fixtureLocks.find(entry => entry.directory === name)!;
  const bytes = await readFile(new URL(`${name}/manifest.json`, fixtureRoot));
  const result = await readEmojiPack(bytes, lock.pin);
  if (!result.ok) throw new Error(result.issue.message);
  const manifest = JSON.parse(bytes.toString('utf8')) as EmojiPackManifestV1;
  const artwork = await readFile(new URL(`${name}/1f600.svg`, fixtureRoot));
  return { lock, bytes, manifest, artwork, pack: result.pack };
}

export function encoded(manifest: EmojiPackManifestV1) {
  const bytes = new TextEncoder().encode(JSON.stringify(manifest));
  const pin: EmojiPackPinV1 = { id: manifest.id, pin: { version: manifest.version }, checksum: digest(bytes) };
  return { bytes, pin };
}

export async function admit(manifest: EmojiPackManifestV1) {
  const { bytes, pin } = encoded(manifest);
  const result = await readEmojiPack(bytes, pin);
  if (!result.ok) throw new Error(result.issue.message);
  return { pack: result.pack, pin };
}

export function style(primary: EmojiPackPinV1, fallbacks: EmojiPackPinV1[] = []): EmojiStyleV1 {
  return { schemaVersion: 1, primary: structuredClone(primary), fallbacks: structuredClone(fallbacks), metricsPolicy: 'inline-em-v1', treatment: { mode: 'original', strengthBps: 0 } };
}
