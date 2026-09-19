// SPDX-License-Identifier: MPL-2.0
/** Artwork mirror for rich text editing. The original owns selection, IME and undo. */
export function mountEditableEmojiDisplay(field: HTMLElement, paint: (node: HTMLElement) => Promise<unknown>): () => void {
  let overlay: HTMLElement | undefined;
  let generation = 0, composing = false, disposed = false;
  const fill = field.style.getPropertyValue('-webkit-text-fill-color');
  const priority = field.style.getPropertyPriority('-webkit-text-fill-color');
  const restore = () => {
    if (fill) field.style.setProperty('-webkit-text-fill-color', fill, priority);
    else field.style.removeProperty('-webkit-text-fill-color');
    overlay?.remove(); overlay = undefined;
  };
  const refresh = () => {
    const mine = ++generation;
    if (disposed || composing || !/[\u00a9-\uffff]/.test(field.textContent ?? '')) { restore(); return; }
    const next = field.cloneNode(true) as HTMLElement;
    next.removeAttribute('id'); next.removeAttribute('contenteditable'); next.removeAttribute('role');
    next.setAttribute('aria-hidden', 'true'); next.setAttribute('data-emoji-editing-display', '1');
    next.style.setProperty('-webkit-text-fill-color', 'currentColor');
    Object.assign(next.style, { position: 'absolute', pointerEvents: 'none', userSelect: 'none', outline: 'none',
      left: `${field.offsetLeft}px`, top: `${field.offsetTop}px`, width: `${field.offsetWidth}px`, height: `${field.offsetHeight}px`, margin: '0' });
    for (const node of next.querySelectorAll('[id]')) node.removeAttribute('id');
    void paint(next).then(() => {
      if (disposed || composing || generation !== mine || !field.isConnected) return;
      if (!next.querySelector('.lolly-emoji')) { restore(); return; }
      overlay?.remove(); overlay = next; field.after(next);
      // Mirror each native advance to keep the caret aligned while its artwork is replaced.
      for (const glyph of next.querySelectorAll<HTMLElement>('.lolly-emoji')) {
        const measure = field.ownerDocument.createElement('span');
        measure.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;';
        measure.textContent = glyph.dataset.emoji ?? ''; glyph.parentElement!.append(measure);
        glyph.style.width = `${measure.offsetWidth}px`; measure.remove();
      }
      field.style.setProperty('-webkit-text-fill-color', 'transparent', 'important');
    }).catch(() => { if (generation === mine) restore(); });
  };
  const start = () => { composing = true; generation++; restore(); };
  const end = () => { composing = false; refresh(); };
  field.addEventListener('input', refresh); field.addEventListener('compositionstart', start); field.addEventListener('compositionend', end);
  const authoredStyle = (value: string | null) => (value ?? '').replace(/-webkit-text-fill-color:[^;]*;?/g, '').trim();
  const observer = new MutationObserver(records => {
    if (records.some(record => record.type !== 'attributes' || record.attributeName !== 'style' || record.target !== field
      || authoredStyle(record.oldValue) !== authoredStyle(field.getAttribute('style')))) refresh();
  });
  observer.observe(field, { subtree: true, childList: true, characterData: true, attributes: true, attributeOldValue: true });
  const size = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(refresh); size?.observe(field);
  refresh();
  return () => { disposed = true; generation++; observer.disconnect(); size?.disconnect();
    field.removeEventListener('input', refresh); field.removeEventListener('compositionstart', start); field.removeEventListener('compositionend', end); restore(); };
}
