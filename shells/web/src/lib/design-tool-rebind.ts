// SPDX-License-Identifier: MPL-2.0
import type { ArtboardVariantV1, DesignToolDraftV1 } from '@lolly-tools/core/design-tool-v1';
/** Only unique names or unchanged literal content are offered as suggestions. */
export function suggestDesignRebind(old: Record<string, unknown>, boxes: Array<Record<string, unknown>>): string | undefined {
  const compatible = boxes.filter(b => b.kind === old.kind);
  const named = old.name ? compatible.filter(b => b.name === old.name) : [];
  if (named.length === 1) return String(named[0]!.id);
  const text = old.text ? compatible.filter(b => b.text === old.text) : [];
  return text.length === 1 ? String(text[0]!.id) : undefined;
}
export function designLinkedObjects(draft: DesignToolDraftV1): Array<{variantId: string; layerId: string}> {
  const refs = [...draft.inputs.flatMap(f => f.targets),...draft.recipes.map(r=>r.target),...draft.choices.flatMap(c=>c.options.flatMap(o=>o.writes))];
  return [...new Map(refs.map(t=>[`${t.variantId}/${t.layerId}`,{variantId:t.variantId,layerId:t.layerId}])).values()];
}
/** Rebinding preserves public ids, choice ownership and authored rules together. */
export function rebindDesignTool(draft: DesignToolDraftV1, variants: ArtboardVariantV1[], mapping: Record<string,string>): DesignToolDraftV1 {
  const next = structuredClone(draft); next.variants = structuredClone(variants);
  for (const variant of next.variants) {
    const used = new Set<string>();
    for (const ref of designLinkedObjects(draft).filter(t=>t.variantId===variant.id)) {
      const id = mapping[`${ref.variantId}/${ref.layerId}`];
      if (!id || used.has(id) || !variant.boxes.some(b=>b.id===id)) throw new Error('Choose a different replacement for every linked object.');
      used.add(id);
    }
    for (const box of variant.boxes) {
      const ref = designLinkedObjects(draft).find(t=>t.variantId===variant.id && mapping[`${t.variantId}/${t.layerId}`]===box.id);
      if (ref) box.id = ref.layerId;
    }
  }
  return next;
}
