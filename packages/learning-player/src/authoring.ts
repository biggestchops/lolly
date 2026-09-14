// SPDX-License-Identifier: MPL-2.0
import type { LearningRichNode } from '@lolly-tools/core/learning-v1';

/** Self-contained renderer, passed into the portable player with the other dependencies. */
export function renderLearningRichText(d: Document, node: LearningRichNode): Node {
  const tags: Record<string, string> = {
    doc: 'div',
    paragraph: 'p',
    heading: node.attrs?.level === 3 ? 'h3' : 'h2',
    bulletList: 'ul',
    orderedList: 'ol',
    listItem: 'li',
    blockquote: 'blockquote',
    hardBreak: 'br',
  };
  let el: Node;
  if (node.type === 'text') el = d.createTextNode(node.text || '');
  else {
    const container = d.createElement(tags[node.type] || 'span');
    if (node.type === 'orderedList' && node.attrs?.start)
      container.setAttribute('start', String(node.attrs.start));
    if (node.type === 'doc') container.className = 'learning-rich-text';
    for (const child of node.content || []) container.append(renderLearningRichText(d, child));
    el = container;
  }
  const marks: Record<string, string> = {
    bold: 'strong',
    italic: 'em',
    underline: 'u',
    code: 'code',
    link: 'a',
  };
  for (const mark of node.marks || []) {
    const wrap = d.createElement(marks[mark.type] || 'span');
    if (
      mark.type === 'link' &&
      mark.attrs?.href &&
      /^(https?:\/\/|mailto:)/i.test(mark.attrs.href) &&
      !Array.from(mark.attrs.href).some((c) => c.charCodeAt(0) <= 32 || c.charCodeAt(0) === 127)
    ) {
      wrap.setAttribute('href', mark.attrs.href);
      wrap.setAttribute('rel', 'noopener noreferrer');
      wrap.setAttribute('target', '_blank');
    }
    wrap.append(el);
    el = wrap;
  }
  return el;
}
