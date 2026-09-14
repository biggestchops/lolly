// SPDX-License-Identifier: MPL-2.0
import { icon, type IconName } from './icons.ts';
import { escape as esc } from '../utils.ts';
import { LEARNING_TARGETS } from '../../../../engine/src/learning/delivery.ts';

export const contentLabels: Record<string, string> = {
  text: 'Text',
  image: 'Image',
  slides: 'Slides',
  video: 'Video',
  audio: 'Audio',
  resource: 'Resource',
};
const contentIcons: Record<string, IconName> = {
  text: 'font',
  image: 'image',
  slides: 'photos',
  video: 'filmStrip',
  audio: 'music',
  resource: 'filePlus',
};
export function contentIcon(kind: string): string {
  return icon(contentIcons[kind] || 'layersStack', { size: 20 });
}
export function courseButton(
  action: string,
  label: string,
  id = '',
  options: {
    primary?: boolean;
    disabled?: boolean;
    icon?: IconName;
    iconOnly?: boolean;
    className?: string;
  } = {}
): string {
  return `<button type="button" class="btn ${options.primary ? 'btn--primary' : 'btn--ghost'} ${options.iconOnly ? 'learning-icon-button' : ''} ${options.className || ''}" data-action="${action}" data-id="${esc(id)}" ${options.disabled ? 'disabled data-unavailable' : ''} ${options.iconOnly ? `aria-label="${esc(label)}" title="${esc(label)}"` : ''}>${options.icon ? icon(options.icon, { size: 18 }) : ''}${options.iconOnly ? '' : esc(label)}</button>`;
}
export function courseField(
  id: string,
  label: string,
  value: string,
  attributes: string,
  multiline = false
): string {
  return `<div class="learning-field"><label for="${esc(id)}">${esc(label)}</label>${multiline ? `<textarea class="field-input" id="${esc(id)}" ${attributes}>${esc(value)}</textarea>` : `<input class="field-input" id="${esc(id)}" ${attributes} value="${esc(value)}">`}</div>`;
}
export function targetLabel(target: string): string {
  return LEARNING_TARGETS.find((t) => t.id === target)?.label || target;
}
export function courseDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
/** Remember the actual control, including its content or row, across a repaint. */
export function courseFocus(root: HTMLElement, prefix: string): string | undefined {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !root.contains(active)) return;
  const attr = [...active.attributes].find((a) => a.name.startsWith(prefix));
  if (!attr) return active.id ? `#${CSS.escape(active.id)}` : undefined;
  const scope = active.closest<HTMLElement>('[data-block],[data-candidate]');
  const owner = scope?.hasAttribute('data-block') ? 'data-block' : 'data-candidate';
  return `${scope ? `[${owner}="${CSS.escape(scope.getAttribute(owner)!)}"] ` : ''}[${attr.name}="${CSS.escape(attr.value)}"]${active.hasAttribute('data-id') ? `[data-id="${CSS.escape(active.dataset.id!)}"]` : ''}`;
}
