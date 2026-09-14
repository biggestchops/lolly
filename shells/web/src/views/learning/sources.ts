// SPDX-License-Identifier: MPL-2.0
import type { LearningCtx } from './context.ts';
import type { AssetRef } from '@lolly-tools/core/host-v1';
import { openPicker } from '../picker.ts';
import { armSessionReturn } from '../../lib/search/projects-source.ts';
import { learningRenditions } from '../../../../../engine/src/learning/delivery.ts';
import { learningReader } from '../../lib/learning-entry.ts';
import { learningAssetBlock, learningSessionCandidate } from '../../lib/learning-selection.ts';
import { isBatchSlot, isHiddenSlot } from '../../lib/batch-slots.ts';

export function sourcesOps(ctx: LearningCtx): LearningCtx['sources'] {
  return {
    inspect: () => inspect(ctx),
    pick: () => pick(ctx),
    refresh: (id) => refresh(ctx, id),
    edit: (id) => edit(ctx, id),
  };
}
export async function pick(ctx: LearningCtx): Promise<void> {
  const lesson = ctx.module.lessons.find((l) => l.id === ctx.selected);
  if (!lesson) {
    ctx.ui.status('Add or select a lesson first.');
    return;
  }
  const addAsset = async (asset: AssetRef): Promise<boolean> => {
    try {
      lesson.blocks.push(learningAssetBlock(asset));
    } catch (error) {
      pickerError(ctx, error instanceof Error ? error.message : 'This file is not supported.');
      return false;
    }
    ctx.edit.change();
    ctx.ui.render();
    return true;
  };
  await openPicker(ctx.host, {
    title: 'Add learning content',
    initialTab: 'projects',
    allowUpload: true,
    collect: {
      folderName: lesson.title,
      onAsset: addAsset,
      onSession: async (slot) => {
        if (slot.startsWith('__learning__:') || isBatchSlot(slot) || isHiddenSlot(slot))
          return false;
        const data = await ctx.host.state.load(slot);
        if (!data?.__toolId) return false;
        try {
          const candidate = await learningSessionCandidate(learningReader(ctx.host), slot, data);
          if (!candidate.block) return false;
          lesson.blocks.push(candidate.block);
          await inspect(ctx);
        } catch (error) {
          pickerError(ctx, error instanceof Error ? error.message : 'This source is unavailable.');
          return false;
        }
        ctx.edit.change();
        ctx.ui.render();
        return true;
      },
      onOpenTool: () => {
        ctx.ui.status('Save the creation in its tool, then add it from Projects.');
      },
      onQuickAddTool: async () => false,
    },
  });
}
export async function refresh(ctx: LearningCtx, blockId: string): Promise<void> {
  const block = ctx.module.lessons.flatMap((l) => l.blocks).find((b) => b.id === blockId);
  if (!block?.source?.slot) return;
  const data = await ctx.host.state.load(block.source.slot);
  if (!data?.__toolId) throw new Error('The source is unavailable. Replace it using Add content.');
  block.source.values = structuredClone(
    Object.fromEntries(Object.entries(data).filter(([key]) => !key.startsWith('__')))
  );
  block.source.toolId = data.__toolId;
  block.source.toolVersion = data.__toolVersion;
  block.source.capturedAt = new Date().toISOString();
  await inspect(ctx);
  ctx.edit.change();
  ctx.ui.render();
}
export async function edit(ctx: LearningCtx, blockId: string): Promise<void> {
  const source = ctx.module.lessons.flatMap((l) => l.blocks).find((b) => b.id === blockId)?.source;
  if (!source?.slot || !source.toolId) return;
  await ctx.persistence.save();
  armSessionReturn(`/#/learning?slot=${encodeURIComponent(ctx.slot)}`);
  window.location.hash = `#/tool/${encodeURIComponent(source.toolId)}?slot=${encodeURIComponent(source.slot)}`;
}

export async function inspect(ctx: LearningCtx): Promise<void> {
  const ids = [
    ...new Set(
      ctx.module.lessons
        .flatMap((l) => l.blocks)
        .map((b) => b.source?.toolId)
        .filter((id): id is string => !!id)
    ),
  ];
  for (const id of ids) {
    try {
      ctx.sourceChoices[id] = learningRenditions(await learningReader(ctx.host).tool(id));
    } catch {
      ctx.sourceChoices[id] = [];
    }
  }
}

function pickerError(ctx: LearningCtx, message: string): void {
  ctx.ui.status(message);
  const dialog = document.querySelector('.asset-picker-dialog');
  if (!dialog) return;
  let error = dialog.querySelector<HTMLElement>('[data-learning-source-error]');
  if (!error) {
    error = document.createElement('p');
    error.dataset.learningSourceError = '';
    error.setAttribute('role', 'alert');
    dialog.prepend(error);
  }
  error.textContent = message;
}
