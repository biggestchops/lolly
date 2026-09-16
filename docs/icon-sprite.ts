// SPDX-License-Identifier: MPL-2.0
import { createHash } from 'node:crypto';

/** Share trusted UI glyphs across pages while retaining SVG currentColor inheritance. */
export function createIconSprite(icons: Record<string, string>) {
  const symbols: string[] = [];
  const references = new Map<string, string>();
  for (const [key, svg] of Object.entries(icons)) {
    const match = /^<svg\b([^>]*)>([\s\S]*)<\/svg>$/.exec(svg.trim());
    // Self-contained illustrations with local references retain their own scope.
    if (!match || !/^[\w-]+$/.test(key) || /\bid\s*=/.test(svg)) continue;
    const attrs = match[1]!.replace(/\s+xmlns="[^"]*"/g, '');
    symbols.push(`<symbol id="${key}"${attrs}>${match[2]}</symbol>`);
    references.set(key, `<svg${attrs}><use href="__SPRITE__#${key}"/></svg>`);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg">${symbols.join('')}</svg>`;
  const hash = createHash('sha256').update(svg).digest('hex').slice(0, 16);
  const filename = `docs-icons.${hash}.svg`;
  return {
    filename, svg,
    icon: (key: string): string | undefined => references.get(key)?.replace('__SPRITE__', `/info/${filename}`) ?? icons[key],
    replaceIn(html: string): string {
      for (const [key, reference] of references) html = html.replaceAll(icons[key]!, reference.replace('__SPRITE__', `/info/${filename}`));
      return html;
    },
  };
}
