// SPDX-License-Identifier: MPL-2.0
/** Paint chosen artwork over a native text field without taking over editing. */
type TextField = HTMLInputElement | HTMLTextAreaElement;
type Paint = (node: HTMLElement) => Promise<unknown>;
const typography = ['font-family', 'font-size', 'font-weight', 'font-style', 'font-stretch',
  'font-variant', 'font-feature-settings', 'font-variation-settings', 'line-height',
  'letter-spacing', 'word-spacing', 'text-transform', 'text-indent', 'text-align',
  'direction', 'tab-size', 'text-rendering'] as const;

export function mountInputEmojiDisplay(field: TextField, wrapper: HTMLElement, paint: Paint): {
  refresh: () => void; dispose: () => void;
} {
  const doc = field.ownerDocument;
  const win = doc.defaultView!;
  const clip = doc.createElement('span');
  clip.className = 'input-emoji-display';
  clip.setAttribute('aria-hidden', 'true');
  clip.hidden = true;
  wrapper.append(clip);
  const fill = field.style.getPropertyValue('-webkit-text-fill-color');
  const priority = field.style.getPropertyPriority('-webkit-text-fill-color');
  let disposed = false;
  let composing = false;
  let generation = 0;
  let frame = 0;
  let content: HTMLElement | undefined;
  const restore = () => {
    if (fill) field.style.setProperty('-webkit-text-fill-color', fill, priority);
    else field.style.removeProperty('-webkit-text-fill-color');
    clip.hidden = true;
  };

  function layout() {
    if (!content || disposed || clip.hidden) return;
    const style = win.getComputedStyle(field);
    const box = field.getBoundingClientRect();
    const parent = wrapper.getBoundingClientRect();
    Object.assign(clip.style, {
      left: `${box.left - parent.left + field.clientLeft}px`,
      top: `${box.top - parent.top + field.clientTop}px`,
      width: `${field.clientWidth}px`, height: `${field.clientHeight}px`,
      color: style.color,
    });
    for (const property of typography) content.style.setProperty(property, style.getPropertyValue(property));
    const multiline = field.tagName === 'TEXTAREA';
    Object.assign(content.style, {
      boxSizing: 'border-box', width: `${field.clientWidth}px`,
      paddingLeft: style.paddingLeft, paddingRight: style.paddingRight,
      paddingTop: multiline ? style.paddingTop : '0px', paddingBottom: multiline ? style.paddingBottom : '0px',
      whiteSpace: multiline && (field as HTMLTextAreaElement).wrap !== 'off' ? 'pre-wrap' : 'pre',
      overflowWrap: multiline ? 'break-word' : 'normal',
      top: multiline ? '0px' : '50%',
      transform: `translate(${-field.scrollLeft}px, ${-field.scrollTop}px)${multiline ? '' : ' translateY(-50%)'}`,
    });
    // Keep the browser's character advances so its caret, selection and wraps
    // still line up. The artwork keeps its aspect ratio inside that advance.
    const measure = doc.createElement('span');
    measure.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;letter-spacing:inherit;';
    content.append(measure);
    const widths = new Map<string, number>();
    for (const glyph of content.querySelectorAll<HTMLElement>('.lolly-emoji')) {
      const text = glyph.dataset.emoji ?? '';
      if (!widths.has(text)) { measure.textContent = text; widths.set(text, measure.getBoundingClientRect().width); }
      glyph.style.width = `${widths.get(text)}px`;
    }
    measure.remove();
  }

  function scheduleLayout() {
    if (disposed || frame) return;
    frame = win.requestAnimationFrame(() => { frame = 0; layout(); });
  }

  function refresh() {
    const current = ++generation;
    const value = field.value;
    // ASCII needs no artwork and should never load the Unicode tables.
    if (disposed || composing || !value || !/[\u00a9-\uffff]/.test(value)) { restore(); return; }
    const next = doc.createElement('span');
    next.className = 'input-emoji-display-text';
    next.textContent = value;
    // A pending pass must not cover a newer edit with stale text.
    if (content?.textContent !== value) restore();
    void paint(next).then(() => {
      if (disposed || composing || current !== generation || !field.isConnected) return;
      if (!next.querySelector('.lolly-emoji')) { restore(); return; }
      content = next;
      clip.replaceChildren(next);
      clip.hidden = false;
      layout();
      // The native field retains focus, caret, selection, form value and undo.
      // Only its glyph paint is hidden; the mirror is absent from the a11y tree.
      field.style.setProperty('-webkit-text-fill-color', 'transparent', 'important');
    }).catch(() => { if (!disposed && current === generation) restore(); });
  }

  const beginComposition = () => { composing = true; ++generation; restore(); };
  const endComposition = () => { composing = false; refresh(); };
  const select = () => { if (doc.activeElement === field || field.getRootNode() === doc.activeElement?.shadowRoot) scheduleLayout(); };
  field.addEventListener('input', refresh);
  field.addEventListener('change', refresh);
  field.addEventListener('compositionstart', beginComposition);
  field.addEventListener('compositionend', endComposition);
  field.addEventListener('scroll', scheduleLayout);
  field.addEventListener('focus', scheduleLayout);
  field.addEventListener('keyup', scheduleLayout);
  doc.addEventListener('selectionchange', select);
  const resize = win.ResizeObserver ? new win.ResizeObserver(scheduleLayout) : undefined;
  resize?.observe(field);
  const theme = new win.MutationObserver(scheduleLayout);
  theme.observe(doc.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-a11y-text', 'data-a11y-contrast'] });
  doc.fonts?.addEventListener('loadingdone', scheduleLayout);
  refresh();
  return {
    refresh,
    dispose() {
      disposed = true; ++generation;
      if (frame) win.cancelAnimationFrame(frame);
      resize?.disconnect(); theme.disconnect();
      doc.fonts?.removeEventListener('loadingdone', scheduleLayout);
      doc.removeEventListener('selectionchange', select);
      field.removeEventListener('input', refresh);
      field.removeEventListener('change', refresh);
      field.removeEventListener('compositionstart', beginComposition);
      field.removeEventListener('compositionend', endComposition);
      field.removeEventListener('scroll', scheduleLayout);
      field.removeEventListener('focus', scheduleLayout);
      field.removeEventListener('keyup', scheduleLayout);
      restore(); clip.remove();
    },
  };
}
