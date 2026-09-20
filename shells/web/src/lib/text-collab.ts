// SPDX-License-Identifier: MPL-2.0
/** Keep split transport deliveries out of the authored text projection. */
import type { CanvasOp } from '@lolly-tools/core/canvas-op-v1';
import { readDesignText } from '../../../../engine/src/text-design.ts';
import type { CollabRuntime } from './collab-plumbing.ts';
export interface TextSyncRecovery { values:Record<string,unknown>; label:string }
export interface TextSyncState { pending:string; recoveries:TextSyncRecovery[] }
const states=new WeakMap<object,{value:TextSyncState;listeners:Set<()=>void>}>();
function state(runtime:object){let item=states.get(runtime);if(!item){item={value:{pending:'',recoveries:[]},listeners:new Set()};states.set(runtime,item);}return item;}
export function textSyncState(runtime:object):TextSyncState{return structuredClone(state(runtime).value);}
export function subscribeTextSync(runtime:object,changed:()=>void):()=>void{const item=state(runtime);item.listeners.add(changed);return()=>{item.listeners.delete(changed);};}
export function assertTextSyncReady(runtime:object):void{if(state(runtime).value.pending)throw new Error('Text changes are still syncing. Wait for the complete frame update, or save a recovery copy.');}
export function retainTextRecovery(runtime: object, values: Record<string, unknown>, label: string): void {
  const store = state(runtime), serialized = JSON.stringify(values);
  if (serialized.length * 2 > 16 * 1024 * 1024 || store.value.recoveries.some(item => JSON.stringify(item.values) === serialized)) return;
  store.value.recoveries.push({ values: structuredClone(values), label: label.slice(0, 80) });
  let total = store.value.recoveries.reduce((sum, item) => sum + JSON.stringify(item.values).length * 2, 0);
  while (store.value.recoveries.length > 8 || total > 16 * 1024 * 1024) total -= JSON.stringify(store.value.recoveries.shift()!.values).length * 2;
  for (const listener of store.listeners) listener();
}
export function createTextSyncProjection(runtime:CollabRuntime){
  const collection=runtime.getModel().find(item=>item.type==='blocks'&&typeof item.canvas?.textDocumentInput==='string');
  if(!collection)return null;
  const input=String(collection.canvas!.textDocumentInput),config=collection.canvas!,store=state(runtime);
  const snapshot=()=>Object.fromEntries(runtime.getModel().filter(item=>item.id===input||item.id===collection.id).map(item=>[item.id,structuredClone(item.value)]));
  function read(values:Record<string,unknown>){
    const rows=values[collection!.id];if(!Array.isArray(rows))throw new Error('The text frame collection is missing.');
    return readDesignText(values[input],rows.map(raw=>{const row=raw as Record<string,unknown>;return {...row,id:row[String(config.idField??'id')],w:row[String(config.wField??'w')],h:row[String(config.hField??'h')],text:row[String(config.textField??'text')],textStory:row[String(config.textStoryField??'textStory')],textFrame:row[String(config.textFrameField??'textFrame')]};}));
  }
  function changed(){for(const listener of store.listeners)listener();}
  function retain(values:Record<string,unknown>){
    if(typeof values[input]!=='string'||!values[input])return;
    let label='Previous text';try{label=read(values).document.stories.map(story=>story.source).join(' ').slice(0,80)||label;}catch{/* Incomplete source is still recoverable as authored JSON. */}
    retainTextRecovery(runtime, values, label);
  }
  return {
    validate(values:Record<string,unknown>,ops:readonly CanvasOp[]):boolean{
      const before=snapshot(),next={...before,...values};
      // Preserve both authored versions when whole-document registers compete.
      // Text remains an LWW register; this does not claim character-level merging.
      for(const op of ops)if(op.k==='param'&&op.key===input&&op.value!==next[input])retain({...before,[input]:op.value});
      try{read(next);}catch(error){retain(next);store.value.pending=error instanceof Error?error.message:String(error);changed();return false;}
      if(next[input]!==before[input])retain(before);
      store.value.pending='';changed();return true;
    },
    assertReady(){assertTextSyncReady(runtime);},
    clearPending(){store.value.pending='';changed();},
  };
}
