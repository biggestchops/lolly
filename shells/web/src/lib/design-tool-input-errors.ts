// SPDX-License-Identifier: MPL-2.0
import { designSelection } from '@lolly-tools/core/design-tool-v1';
import { matchesShowIf } from '@lolly/engine';
import type { InputModelItem, InputValue } from '../../../../engine/src/inputs.ts';
import type { Runtime } from '../../../../engine/src/runtime.ts';
import { announce } from '../a11y.ts';
interface RefusedInput { value: InputValue; message: string }
const refused = new WeakMap<Runtime,Map<string,RefusedInput>>();
const revisions = new WeakMap<Runtime,Map<string,number>>();
/** Bind validation feedback and the form model to the same retained edits. */
export function prepareDesignInputs(runtime: Runtime, model: InputModelItem[], panel: HTMLElement): [Runtime,InputModelItem[]] {
  const guarded = designInputErrors(runtime,panel);
  return [guarded,designDisplayModel(guarded,model)];
}
/** Keep the full entered text through unrelated asynchronous form refreshes. */
function designDisplayModel(runtime: Runtime, model: InputModelItem[]): InputModelItem[] {
  if (!runtime.manifest.designTool) return model;
  const errors = refused.get(runtime);
  return model.map(i => ({...i,...(i.type === 'text' || i.type === 'longtext' ? {maxLength:undefined} : {}),...(errors?.has(i.id) ? {value:errors.get(i.id)!.value} : {})}));
}
/** Shared controls retain refused values and explain why export is blocked. */
function designInputErrors(runtime: Runtime, panel: HTMLElement): Runtime {
  if (!runtime.manifest.designTool) return runtime;
  const errors = refused.get(runtime) || new Map<string,RefusedInput>(); refused.set(runtime,errors);
  const edits = revisions.get(runtime) || new Map<string,number>(); revisions.set(runtime,edits);
  const paint = (): void => {
    for (const input of runtime.manifest.inputs) {
      const control = panel.querySelector<HTMLElement>(`[data-input-id="${CSS.escape(input.id)}"]`);
      const row = control?.closest<HTMLElement>('.input-row') || control?.parentElement;
      const error = errors.get(input.id);
      if (!error) { control?.removeAttribute('aria-invalid'); row?.querySelector('[data-rule-error]')?.remove(); continue; }
      control?.setAttribute('aria-invalid','true');
      if (row) {
        let note = row.querySelector<HTMLElement>('[data-rule-error]');
        if (!note) { note = document.createElement('p'); note.dataset.ruleError = ''; note.className = 'input-notice'; note.setAttribute('role','alert'); row.append(note); }
        note.textContent = error.message;
      }
    }
  };
  queueMicrotask(paint);
  const proxy = new Proxy(runtime, {
    get(target, key) {
      if (key !== 'setInput') return Reflect.get(target,key);
      return async (id: string, value: InputValue): Promise<void> => {
        const edit = (edits.get(id) || 0) + 1; edits.set(id,edit);
        try { await target.setInput(id,value); if (edits.get(id) === edit) errors.delete(id); }
        catch (error) {
          if (edits.get(id) !== edit) return;
          const message = String((error as Error).message); errors.set(id,{value,message}); announce(message,{assertive:true});
        }
        paint();
      };
    },
  });
  refused.set(proxy,errors); revisions.set(proxy,edits); return proxy;
}

/** One visibility rule for the sidebar and contextual form, including inactive artboards. */
export function isDesignInputVisible(runtime: Runtime, input: InputModelItem, values: Record<string,InputValue>, hidden: boolean): boolean {
  if (input.group === 'export' || hidden || !matchesShowIf(input.showIf,values)) return false;
  const policy = runtime.manifest.designTool; if (!policy) return true;
  const selection = designSelection(policy,values);
  if (selection.fixed.has(input.id)) return false;
  const field = policy.inputs.find(f => f.input.id === input.id);
  return !field?.targets.length || field.targets.some(t => t.variantId === selection.variantId);
}

/** Restore refused Preview samples after recompiling updated designer rules. */
export async function restoreDesignInputErrors(runtime: Runtime, panel: HTMLElement, values: Record<string, unknown>): Promise<void> {
  const guarded = designInputErrors(runtime, panel);
  for (const [id, value] of Object.entries(values)) await guarded.setInput(id, value as InputValue);
  for (const [id, value] of Object.entries(values)) {
    const control = panel.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-input-id="${CSS.escape(id)}"]`);
    if (control && (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement)) control.value = String(value ?? '');
  }
}
