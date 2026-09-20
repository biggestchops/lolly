// SPDX-License-Identifier: MPL-2.0
/**
 * Which fonts a rendered session actually used - the font half of a `.lolly`'s
 * reproducibility receipt (docs/reproducibility.md).
 *
 * A `.lolly` already carries the inputs, the assets and (optionally) the tool. Fonts were
 * the one dependency it named nowhere, so "rebuild this and tell me if it matches" could
 * not distinguish "the design changed" from "this machine has a different Inter".
 *
 * IDENTITY, NOT BYTES, and the distinction is the whole design:
 *
 *  - The receipt contains no font bytes. User font assets follow the session's
 *    asset packaging rules; catalog fonts keep their redistribution policy.
 *  - The identity is the SOURCE face - family, weight, style, and the sha256 of the whole
 *    file the registry read. Never the bytes that end up inside an export: subsetting is
 *    planned, so an embedded subset is a function of the text, and hashing it would make
 *    every edit look like a font change.
 *  - A face that resolves to no file at all is `platform` with no hash: the run drew in
 *    whatever the machine had, and that is exactly what the receipt should say.
 *
 * Best-effort throughout. A share must never fail because a font could not be walked, so
 * every step swallows its own error and the receipt simply carries fewer entries.
 */

import { resolveVectorFont, faceSourceBytes } from '../bridge/font-registry.ts';
import { sha256 } from './bundle.ts';
import type { LollyFontEntry } from './lolly-pack.ts';
import { parseTextDocument } from '../../../../engine/src/text-story-document.ts';
import { textStyleResolver } from '../../../../engine/src/text-styles.ts';

/** Enough of a run to rank subset coverage; a whole essay would only slow the walk. */
const SAMPLE_CHARS = 400;

/**
 * Walk a rendered canvas for the faces its text runs resolved to.
 *
 * Runs are grouped by their COMPUTED family/weight/style, because that triple is what
 * `resolveVectorFont` answers to - two paragraphs in the same style resolve identically,
 * and resolution is the expensive part (a user face is decompressed on first touch).
 */
export async function collectSessionFonts(root: Element | null | undefined, textDocument?: unknown): Promise<LollyFontEntry[]> {
  if (!root || typeof document === 'undefined' || typeof getComputedStyle !== 'function') return [];
  const runs = new Map<string, { fontFamily: string; fontWeight: string; fontStyle: string; text: string }>();
  try {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = (n.nodeValue ?? '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const el = n.parentElement;
      if (!el || el.closest('[data-composed-text]')) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const key = `${cs.fontFamily}|${cs.fontWeight}|${cs.fontStyle}`;
      const seen = runs.get(key);
      if (seen) {
        if (seen.text.length < SAMPLE_CHARS) seen.text += ` ${text}`;
      } else {
        runs.set(key, { fontFamily: cs.fontFamily, fontWeight: cs.fontWeight, fontStyle: cs.fontStyle, text });
      }
    }
  } catch { return []; }

  // family|weight|style of the SOURCE face → its entry. Several CSS stacks routinely land
  // on one face (a brand var and its literal spelling), and the receipt names dependencies.
  const byFace = new Map<string, LollyFontEntry>();
  if (textDocument) try {
    const doc = parseTextDocument(textDocument), resolver = textStyleResolver(doc);
    const visible = new Set([...root.querySelectorAll('[data-composed-text]')].filter(node => !node.closest('[data-export-hide]')).map(node => node.getAttribute('data-composed-text')));
    for (const story of doc.stories) if (visible.has(story.id)) for (const paragraph of story.paragraphs) {
      const points = new Set([paragraph.start, ...story.spans.flatMap(span => [span.start, span.end]).filter(at => at >= paragraph.start && at < paragraph.end)]);
      for (const at of points) {
        const character = resolver.character(story, paragraph, at);
        for (const id of [character.font, ...character.fallbackFonts ?? []]) {
          const font = doc.fonts.find(font => font.id === id); if (!font) continue;
          const entry: LollyFontEntry = { family: font.family, weight: String(character.axes?.wght ?? character.weight ?? 400), style: character.italic ? 'italic' : 'normal', source: font.source.kind === 'bundled' ? 'platform' : font.source.kind === 'asset' && !font.source.id.startsWith('user/') ? 'catalog' : 'user', sha256: font.sha256, faceIndex: font.faceIndex, ...(character.axes ? { axes: character.axes } : {}), ...(character.features ? { features: character.features } : {}), ...(font.source.kind === 'bundled' ? { file: font.source.path } : font.source.kind === 'asset' ? { file: font.source.id } : {}) };
          byFace.set(JSON.stringify(entry), entry);
        }
      }
    }
  } catch { /* Invalid authored text cannot invent a font receipt. */ }
  for (const run of runs.values()) {
    try {
      const resolved = await resolveVectorFont(
        { fontFamily: run.fontFamily, fontWeight: run.fontWeight, fontStyle: run.fontStyle },
        run.text.slice(0, SAMPLE_CHARS),
      );
      const face = resolved?.face;
      if (!face) {
        // Nothing resolvable: the run drew in a system fallback, so the receipt records
        // the family the design asked for and no hash. `platform` with no file is the
        // honest "this depended on whatever was installed".
        const asked = run.fontFamily.split(',')[0]?.replace(/["']/g, '').trim() || '';
        if (!asked) continue;
        const key = `${asked.toLowerCase()}|${run.fontWeight}|${run.fontStyle}`;
        if (!byFace.has(key)) {
          byFace.set(key, { family: asked, weight: run.fontWeight, style: run.fontStyle, source: 'platform' });
        }
        continue;
      }
      const key = `${face.family.toLowerCase()}|${face.weight}|${face.style}`;
      if (byFace.has(key)) continue;
      const entry: LollyFontEntry = {
        family: face.family,
        weight: face.weight,
        style: face.style,
        source: face.source,
        ...(face.file ? { file: face.file } : {}),
      };
      const bytes = await faceSourceBytes(face);
      if (bytes) {
        try { entry.sha256 = await sha256(bytes); }
        catch { /* no Web Crypto here - the face is still named, just unhashed */ }
      }
      byFace.set(key, entry);
    } catch { /* one unresolvable run never costs the rest of the receipt */ }
  }
  return [...byFace.values()];
}
