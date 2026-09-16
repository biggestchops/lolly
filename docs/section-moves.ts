// SPDX-License-Identifier: MPL-2.0
/** Preserve section bookmarks when a reference guide is split into task pages. */
import { readFileSync } from 'node:fs';
export interface SectionMove { slug: string; anchor: string; label: string }
export const SECTION_MOVES = JSON.parse(readFileSync(new URL('./section-moves.json',import.meta.url),'utf8')) as Record<string,Record<string,SectionMove>>;
const escapeHtml = (text: string): string => text.replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function movedSectionLinks(source: string, href: (slug:string) => string): string {
  const moved = SECTION_MOVES[source]; if (!moved) return '';
  const targets = Object.fromEntries(Object.entries(moved).map(([anchor,to]) => [anchor,`${href(to.slug)}#${to.anchor}`]));
  const links = Object.entries(moved).map(([anchor,to]) => `<li id="${escapeHtml(anchor)}"><a href="${escapeHtml(targets[anchor]!)}">${escapeHtml(to.label)}</a></li>`).join('');
  const data = JSON.stringify(targets).replace(/</g,'\\u003c');
  return `<details class="doc-section-moves"><summary>Section links from the earlier guide</summary><ul>${links}</ul></details><script>(function(){var targets=${data};function follow(){var key=location.hash.slice(1);if(Object.prototype.hasOwnProperty.call(targets,key))location.replace(targets[key]);}follow();addEventListener('hashchange',follow);})();</script>`;
}
