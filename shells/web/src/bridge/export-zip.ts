// SPDX-License-Identifier: MPL-2.0
import { crc32, buildEncryptedZip } from '@lolly/engine';
import type { ExportOpts } from './export.ts';

// Pack already-rendered members into the archive. Split out of renderZip so the
// contact sheet (bridge/sequence-cuts.ts) gets the identical container - including
// both password tiers - without a second zip implementation.
export async function packZip(
  members: Array<{ name: string; bytes: Uint8Array }>,
  opts: ExportOpts
): Promise<Blob> {
  const password = opts.strongPassword || opts.password;

  // Encrypted bundle: standard = PKWARE ZipCrypto (opens anywhere, incl. Windows
  // Explorer; weak); strong = WinZip AES-256 (7-Zip / Keka / macOS; strong). Mirrors
  // the two-tier PDF lock. The shell compresses each member with fflate + hands the
  // engine bytes + CRC; buildEncryptedZip does the crypto + framing.
  if (password) {
    const { deflateSync } = await import('fflate');
    const entries = members.map(({ name, bytes }) => {
      const deflated = deflateSync(bytes);
      // Store (method 0) when deflate doesn't help (already-compressed png/jpg/webp).
      const stored = deflated.length >= bytes.length;
      return {
        name,
        compressed: stored ? bytes : deflated,
        method: (stored ? 0 : 8) as 0 | 8,
        crc32: crc32(bytes),
        uncompressedSize: bytes.length,
      };
    });
    const out = await buildEncryptedZip(entries, {
      tier: opts.strongPassword ? 'strong' : 'standard',
      password,
    });
    return new Blob([out as BlobPart], { type: 'application/zip' });
  }

  const { zipSync } = await import('fflate');
  const files: Record<string, Uint8Array> = {};
  for (const { name, bytes } of members) files[name] = bytes;
  return new Blob([zipSync(files)], { type: 'application/zip' });
}
