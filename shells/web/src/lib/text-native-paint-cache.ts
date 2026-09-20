// SPDX-License-Identifier: MPL-2.0
/** Retain unchanged native holders and bound measurements of isolated graphemes. */
interface PaintState { context: string; keys: WeakMap<HTMLElement, string>; widths: Map<string, number>; bytes: number }
const states = new WeakMap<HTMLElement, PaintState>();
const fontEpochs = new WeakMap<Document, { value: number }>();
export function nativePaintState(element: HTMLElement): PaintState {
  const document = element.ownerDocument;
  let epoch = fontEpochs.get(document);
  if (!epoch) {
    epoch = { value: 0 }; fontEpochs.set(document, epoch);
    const current = epoch;
    document.fonts?.addEventListener('loadingdone', () => { current.value++; });
  }
  const css = document.defaultView!.getComputedStyle(element);
  const context = JSON.stringify([css.fontWeight, css.fontStyle, css.letterSpacing, css.wordSpacing, epoch.value, document.fonts?.status]);
  let state = states.get(element);
  if (!state || state.context !== context) {
    state = { context, keys: new WeakMap(), widths: new Map(), bytes: 0 }; states.set(element, state);
  }
  return state;
}
export function finishNativePaint(element: HTMLElement, desired: HTMLElement[], fresh: HTMLElement[], state: PaintState): void {
  let cursor = element.firstChild;
  for (const span of desired) {
    if (span !== cursor) element.insertBefore(span, cursor);
    cursor = span.nextSibling;
  }
  while (cursor) { const next = cursor.nextSibling; cursor.remove(); cursor = next; }
  if (!fresh.length) return;
  // Native caret advances can round differently from CSS widths in WebKit.
  const probe = element.ownerDocument.createElement('span');
  probe.setAttribute('aria-hidden', 'true');
  Object.assign(probe.style, { position: 'absolute', width: '1024px', height: '0', left: '0', top: '0', pointerEvents: 'none' });
  element.append(probe);
  const bounds = probe.getBoundingClientRect(), axisScale = Math.hypot(bounds.width, bounds.height) / 1024;
  probe.remove();
  const range = element.ownerDocument.createRange();
  const measured: Array<{ span: HTMLElement; ink: HTMLElement; natural: number }> = [];
  for (const span of fresh) {
    const ink = span.firstElementChild as HTMLElement, node = ink.firstChild!;
    const key = JSON.stringify([span.textContent, ink.dir, span.style.fontFamily, span.style.fontSize, span.style.fontVariationSettings, span.style.fontFeatureSettings, axisScale]);
    let natural = state.widths.get(key);
    if (natural === undefined) {
      range.setStart(node, 0); range.collapse(true);
      const a = range.getBoundingClientRect();
      range.setStart(node, node.textContent!.length); range.collapse(true);
      const b = range.getBoundingClientRect();
      natural = axisScale > 0 ? Math.hypot(b.x + b.width / 2 - a.x - a.width / 2, b.y + b.height / 2 - a.y - a.height / 2) / axisScale : 0;
      const bytes = key.length * 2 + 16;
      if (bytes <= 131072) {
        while (state.widths.size && (state.widths.size >= 1024 || state.bytes + bytes > 131072)) {
          const oldest = state.widths.keys().next().value!; state.widths.delete(oldest); state.bytes -= oldest.length * 2 + 16;
        }
        state.widths.set(key, natural); state.bytes += bytes;
      }
    }
    measured.push({ span, ink, natural });
  }
  // Finish geometry reads before transforms invalidate layout for the next read.
  for (const { span, ink, natural } of measured) {
    span.style.transform = span.dataset.textMatrix!;
    if (natural > 0) ink.style.transform = `scaleX(${Number(span.dataset.textAdvance) / natural})`;
  }
}
