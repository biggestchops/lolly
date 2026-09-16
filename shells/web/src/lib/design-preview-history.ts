// SPDX-License-Identifier: MPL-2.0
import type { DesignToolDraftV1 } from '@lolly-tools/core/design-tool-v1';
/** Sample edits are independent of the designer's rules and canvas history. */
export class DesignPreviewHistory {
  values: Record<string, unknown> = {};
  private past: Array<Record<string, unknown>> = [];
  private future: Array<Record<string, unknown>> = [];
  private last = '';
  private at = 0;
  edit(id: string, value: unknown): void {
    if (JSON.stringify(this.values[id]) === JSON.stringify(value)) return;
    if (this.last !== id || Date.now() - this.at > 600) this.past.push(structuredClone(this.values));
    this.values = {...this.values, [id]: structuredClone(value)};
    this.future = []; this.last = id; this.at = Date.now();
  }
  replace(values: Record<string, unknown>): void {
    this.past.push(structuredClone(this.values)); this.values = structuredClone(values); this.future = []; this.last = '';
  }
  undo(redo = false): boolean {
    const from = redo ? this.future : this.past;
    if (!from.length) return false;
    (redo ? this.past : this.future).push(structuredClone(this.values));
    this.values = from.pop()!; this.last = ''; return true;
  }
}

/** Private packaged font names never become editable source defaults. */
export function designPreviewValue(draft:DesignToolDraftV1, compiled:Array<{id:string;options?:Array<{value:string}>}>, id:string, value:unknown, toCompiled:boolean):unknown {
  const field=draft.inputs.find(f=>f.input.id===id);
  if(!field?.targets.some(target=>target.property==='font'))return value;
  const publicOptions=field.input.options || [];const privateOptions=compiled.find(input=>input.id===id)?.options || [];
  const index=(toCompiled?publicOptions:privateOptions).findIndex(option=>option.value===value);
  return (toCompiled?privateOptions:publicOptions)[index]?.value ?? value;
}
