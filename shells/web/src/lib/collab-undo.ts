// SPDX-License-Identifier: MPL-2.0
import type { CanvasOp } from '@lolly-tools/core/canvas-op-v1';

type Fence = { clock: number; changed: Map<string, number>; floor: number };
const fences = new WeakMap<object, Fence>();
export function trackCollabUndo(runtime: object): () => void {
  const fence: Fence = { clock: 0, changed: new Map(), floor: 0 };
  fences.set(runtime, fence);
  return () => { if (fences.get(runtime) === fence) fences.delete(runtime); };
}
export const collabHistoryStamp = (runtime: object): number | undefined => fences.get(runtime)?.clock;
export function noteRemoteForUndo(runtime: object, ops: readonly CanvasOp[]): void {
  const fence = fences.get(runtime);
  if (!fence) return;
  const stamp = ++fence.clock;
  for (const op of ops) {
    const key = op.k === 'param' ? op.key : `${op.col ?? ''}\0${op.id}`;
    if (op.k === 'param') fence.changed.set(key, stamp);
    else if (op.k === 'field') fence.changed.set(`${key}\0${op.field}`, stamp);
    else if (op.k === 'geom') for (const field of Object.keys(op.fields)) fence.changed.set(`${key}\0${field}`, stamp);
    else {
      fence.changed.set(`${key}\0@${op.k === 'order' ? 'order' : 'exist'}`, stamp);
      if (op.k === 'add') for (const field of Object.keys(op.row)) fence.changed.set(`${key}\0${field}`, stamp);
    }
  }
  // Conservative overflow: older history becomes ineligible, never unsafe.
  if (fence.changed.size > 50_000) { fence.floor = stamp; fence.changed.clear(); }
}
const equal = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const row = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Reverse only the local delta, and only registers untouched by remote edits
 * since that gesture. This also protects against remote writes of the same value. */
export function collabHistoryValue(runtime: object, input: string, current: unknown, expected: unknown,
  desired: unknown, stamp: number | undefined, idField = 'id'): unknown {
  const fence = fences.get(runtime);
  if (!fence) return desired;
  if (stamp === undefined || stamp < fence.floor) return current;
  const changed = (key: string): boolean => (fence.changed.get(key) ?? 0) > stamp;
  if (!Array.isArray(current) || !Array.isArray(expected) || !Array.isArray(desired))
    return !changed(input) && equal(current, expected) ? desired : current;
  if (![...current, ...expected, ...desired].every(v => row(v) && typeof v[idField] === 'string')) return current;
  const map = (items: unknown[]): Map<string, Record<string, unknown>> => new Map(items.map(v => [String((v as Record<string,unknown>)[idField]), v as Record<string,unknown>]));
  const live = map(current), before = map(expected), after = map(desired);
  if (live.size !== current.length || before.size !== expected.length || after.size !== desired.length) return current;
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const key = `${input}\0${id}`, a = before.get(id), b = after.get(id), c = live.get(id);
    if (changed(`${key}\0@exist`)) continue;
    if (!b) {
      if (c && equal(c, a) && !Object.keys(c).some(f => changed(`${key}\0${f}`))) live.delete(id);
    } else if (!a) {
      if (!c) live.set(id, structuredClone(b));
    } else if (c) {
      const next = { ...c };
      for (const field of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (field === idField || equal(a[field], b[field]) || changed(`${key}\0${field}`) || !equal(c[field], a[field])) continue;
        if (Object.hasOwn(b, field)) next[field] = structuredClone(b[field]); else delete next[field];
      }
      live.set(id, next);
    }
  }
  const orderChangedRemotely = [...new Set([...live.keys(), ...before.keys(), ...after.keys()])]
    .some(id => changed(`${input}\0${id}\0@order`) || changed(`${input}\0${id}\0@exist`));
  const order = orderChangedRemotely ? [...live.keys()] : [...after.keys(), ...[...live.keys()].filter(id => !after.has(id))];
  return order.filter(id => live.has(id)).map(id => live.get(id));
}
