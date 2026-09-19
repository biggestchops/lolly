// SPDX-License-Identifier: MPL-2.0
import type { Runtime } from '../../../../engine/src/runtime.ts';

/** Load the full editor only when its summary button is used. */
export function wireTableWorkbench(
  wrap: HTMLElement,
  tid: string,
  runtime: Runtime,
  onDirty?: (id: string) => void
): boolean {
  if (wrap.querySelector('[data-table-workbench]')) {
    wrap.querySelector('[data-table-workbench]')!.addEventListener('click', () => {
      void import('./table-workbench.ts').then(({ openTableWorkbench }) =>
        openTableWorkbench({
          input: () => runtime.getModel().find((i) => i.id === tid)!,
          commit: async (value) => {
            await runtime.setInput(tid, value);
            onDirty?.(tid);
          },
          preview: async (id, value) => {
            await runtime.setInput(id, value);
            onDirty?.(id);
          },
          diagnostics: () => {
            const key = runtime.getModel().find((i) => i.id === tid)?.tableEditor?.diagnostics;
            return key && /^\w+$/.test(key)
              ? runtime.getHydratedText(`{{#each ${key}}}{{row}}: {{message}}; {{/each}}`)
              : '';
          },
        })
      );
    });
    return true;
  }
  return false;
}
