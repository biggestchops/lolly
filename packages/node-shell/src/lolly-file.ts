// SPDX-License-Identifier: MPL-2.0
/**
 * The Node side of the `.lolly` share file, plus the one normalisation an SVG needs
 * before two renders of it can be compared byte for byte.
 *
 * WHY A SECOND READER. `shells/web/src/lib/lolly-pack.ts` owns the format and reads it in
 * the browser, but the web shell is its own workspace package with its own dependency
 * tree, and no shell may import from another: the terminal shells cannot use it. This is the reader half only - manifest, session, and
 * the integrity check that has to pass before either is believed - built on the engine's
 * own `readZip` (which already refuses ZIP64, refuses unknown compression methods and
 * CRC-checks every member) so there is no second zip implementation either.
 *
 * This is the SESSION reader. The CLI's `lolly package` writes the minimal
 * `lolly-share` form, while the shared node-shell design-system command writes
 * `lolly-brand`; neither changes which manifest family this reader accepts.
 *
 * INTEGRITY IS A GATE, NOT A REPORT. `manifest.integrity` is an SRI map over every payload
 * part. A file whose parts do not match it is refused here rather than handed on with a
 * warning: the whole point of a reproducibility receipt is that the receipt is trustworthy.
 */

import { createHash } from 'node:crypto';
import { readZip } from '@lolly/engine';

/** One font face the session's render depended on, by identity. Mirrors `LollyFontEntry`
 *  in shells/web/src/lib/lolly-pack.ts - `sha256` is the SRI digest of the WHOLE source
 *  font file, never of the subset that ends up embedded in an export. */
export interface LollyFont {
  family: string;
  weight: string;
  style: string;
  source: 'catalog' | 'user' | 'platform';
  file?: string;
  sha256?: string;
}

/** The manifest fields this side reads. The format carries more (assets, creator, thumb);
 *  nothing here needs them, and typing only what is used keeps the two copies honest. */
export interface LollyFileManifest {
  format: string;
  kind?: 'session' | 'tool' | 'project';
  formatVersion?: number;
  minReader?: number;
  app?: string;
  engineVersion?: string;
  tool: { id: string; version?: string };
  exportedAt?: string;
  fonts?: LollyFont[];
  bundledTool?: { id: string; version?: string; trust?: string; files?: Array<{ path: string }> };
  /** A project file's folder tree; only its session count is read here. */
  project?: { sessions?: unknown[] };
  integrity?: Record<string, string> | null;
}

export interface LollyFileContents {
  manifest: LollyFileManifest;
  /** `session.json` - the saved session's input values plus its `__`-prefixed markers. */
  session: Record<string, unknown>;
  /** Every unzipped part, keyed by zip path. */
  files: Map<string, Uint8Array>;
}

/** The format tag and reader gate, kept identical to lolly-pack.ts's constants. */
const LOLLY_FILE_FORMAT = 'lolly-share';
const LOLLY_READER_VERSION = 2;

/** SRI `sha256-<base64>` of some bytes, spelled exactly as the writer spells it. */
export function sriSha256(bytes: Uint8Array): string {
  return `sha256-${createHash('sha256').update(bytes).digest('base64')}`;
}

/**
 * Parse and verify a `.lolly`. Throws a plain, printable message on anything wrong:
 * not the format, written by a newer Lolly than this reader admits to understanding, or
 * a part that fails its digest.
 */
export function readLollyFile(bytes: Uint8Array, opts: { allowTool?: boolean } = {}): LollyFileContents {
  const files = new Map<string, Uint8Array>();
  for (const entry of readZip(bytes)) { if (files.has(entry.name)) throw new Error('This .lolly file contains duplicate paths.'); files.set(entry.name, entry.bytes); }

  const manifest = parseJson(files.get('manifest.json')) as LollyFileManifest | null;
  if (!manifest || manifest.format !== LOLLY_FILE_FORMAT) {
    throw new Error('This does not look like a .lolly file (no lolly-share manifest.json).');
  }
  // A project file (a folder of sessions) asks for reader 3 so older readers stop;
  // this one knows what it is and says where it opens instead of "update".
  if (manifest.kind === 'project') {
    const sessions = Array.isArray(manifest.project?.sessions) ? manifest.project.sessions.length : 0;
    throw new Error(`This .lolly file is a project folder with ${sessions} saved sessions. Open it in the Lolly app (Open, or drop it on Projects) to add them.`);
  }
  if (typeof manifest.minReader === 'number' && manifest.minReader > LOLLY_READER_VERSION) {
    throw new Error(`This .lolly file needs a newer reader (minReader ${manifest.minReader}).`);
  }
  if (manifest.integrity) {
    for (const [path, expected] of Object.entries(manifest.integrity)) {
      const part = files.get(path);
      if (!part) throw new Error(`This .lolly file is incomplete - "${path}" is missing.`);
      if (sriSha256(part) !== expected) {
        throw new Error(`This .lolly file failed its integrity check - "${path}" does not match the manifest.`);
      }
    }
  }
  if (manifest.kind === 'tool') {
    if (!opts.allowTool) throw new Error('This is a reusable tool. Use lolly run file.lolly to render it.');
    const bundle = manifest.bundledTool;
    if (manifest.minReader !== 2 || !manifest.integrity || !bundle?.files?.length || bundle.id !== manifest.tool.id || files.has('session.json')) throw new Error('This tool file has an invalid payload.');
    const paths = new Set<string>();
    for (const entry of bundle.files) {
      if (!/^tool\/[\w./-]+$/.test(entry.path) || entry.path.split('/').some(p => p === '.' || p === '..') || paths.has(entry.path) || !files.has(entry.path) || !manifest.integrity[entry.path]) throw new Error('This tool file has an invalid or unverified part.');
      paths.add(entry.path);
    }
    if ([...files.keys()].some(path => path.startsWith('tool/') && !paths.has(path)) || !paths.has('tool/tool.json') || !paths.has('tool/template.html')) throw new Error('This tool file has an incomplete inventory.');
    const tool = parseJson(files.get('tool/tool.json')) as {id?:string;version?:string} | null;
    if (tool?.id !== bundle.id || bundle.version && tool.version !== bundle.version) throw new Error('This tool file has inconsistent identity.');
    return {manifest,session:{},files};
  }
  const session = parseJson(files.get('session.json'));
  if (!session || typeof session !== 'object') {
    throw new Error('This .lolly file carries no readable session.json.');
  }
  return { manifest, session: session as Record<string, unknown>, files };
}

/** The carried tool's files keyed by tool-dir-relative path, or null when none travelled. */
export function bundledToolFiles(contents: LollyFileContents): Map<string, Uint8Array> | null {
  const bt = contents.manifest.bundledTool;
  if (!bt?.files?.length) return null;
  const out = new Map<string, Uint8Array>();
  for (const f of bt.files) {
    const bytes = contents.files.get(f.path);
    if (bytes) out.set(f.path.replace(/^tool\//, ''), bytes);
  }
  return out.size ? out : null;
}

function parseJson(bytes: Uint8Array | undefined): unknown {
  if (!bytes) return null;
  try { return JSON.parse(Buffer.from(bytes).toString('utf8')); } catch { return null; }
}

/**
 * Remove the C2PA `<metadata><c2pa:manifest>` block (and its xmlns) from an SVG.
 *
 * A credential is signed with a fresh key at a fresh timestamp, so it can never be
 * byte-equal across two renders. Anything comparing two SVGs as documents - the docs-shot
 * baseline comparer, `lolly validate --rebuild` - has to drop it first, and both must drop
 * exactly the same thing, which is why this lives here rather than in either caller.
 *
 * GLOBAL, all three replacements. A document is not limited to one manifest: an SVG that
 * inlines credentialed artwork carries its own plus one per inlined piece, and stripping
 * only the first leaves the two sides stripping different blocks.
 */
export function stripSvgC2pa(svg: string): string {
  return svg
    .replace(/<metadata><c2pa:manifest>[^<]*<\/c2pa:manifest><\/metadata>/g, '')
    .replace(/<c2pa:manifest>[^<]*<\/c2pa:manifest>/g, '')
    .replace(/ xmlns:c2pa="[^"]*"/g, '');
}
