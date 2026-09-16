// SPDX-License-Identifier: MPL-2.0
import type { Runtime } from '../../../../engine/src/runtime.ts';
import type { CompiledDesignTool } from '../../../../engine/src/design-tool/compiler.ts';
import { designDigest } from './design-tool-compile.ts';
export interface DesignPublication { version: string; digest: string }
const receipts = new WeakMap<Runtime, DesignPublication>();
export const getDesignPublication = (runtime: Runtime): DesignPublication | undefined => receipts.get(runtime);
export const clearDesignPublication = (runtime: Runtime): void => { receipts.delete(runtime); };
export function restoreDesignPublication(runtime: Runtime, value: unknown): void {
  const receipt = value as DesignPublication | undefined;
  if (receipt && /^\d+\.\d+\.\d+$/.test(receipt.version) && /^[a-f\d]{64}$/.test(receipt.digest)) receipts.set(runtime, {...receipt});
}
export async function compiledDesignDigest(compiled: CompiledDesignTool): Promise<string> {
  const parts: string[] = [];
  for (const [path, value] of Object.entries(compiled.files).sort(([a],[b]) => a.localeCompare(b))) parts.push(`${path}:${await designDigest(typeof value === 'string' ? new TextEncoder().encode(value) : value)}`);
  return designDigest(new TextEncoder().encode(parts.join('\n')));
}
export function nextDesignVersion(version: string): string { const parts = version.split('.').map(Number); parts[2] = parts[2]! + 1; return parts.join('.'); }
