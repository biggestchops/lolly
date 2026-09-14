// SPDX-License-Identifier: MPL-2.0

let nextLabel = 0;

/** Keep help and attachment buttons from taking a field's wrapping label. */
export function linkInputLabels(scope: HTMLElement): void {
  scope.querySelectorAll<HTMLLabelElement>('label.input-row').forEach((row) => {
    const caption = row.querySelector<HTMLElement>('.input-label-text');
    const control = row.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      'input:not([type="hidden"]), select, textarea',
    );
    if (!caption || !control) return;
    if (!caption.id) caption.id = `input-caption-${++nextLabel}`;
    if (!control.id) control.id = `${caption.id}-control`;
    row.htmlFor = control.id;
    if (!control.hasAttribute('aria-label') && !control.hasAttribute('aria-labelledby')) {
      control.setAttribute('aria-labelledby', caption.id);
    }
  });
}
