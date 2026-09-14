// SPDX-License-Identifier: MPL-2.0
import type { LearningCtx } from './context.ts';
import { parseLearningModule } from '../../../../../engine/src/learning/module.ts';

export const LEARNING_SLOT_PREFIX = '__learning__:';
export function persistenceOps(ctx: LearningCtx): LearningCtx['persistence'] {
  return { save: () => save(ctx) };
}

export async function save(ctx: LearningCtx): Promise<void> {
  const operation = async () => {
    const current = await ctx.host.state.load(ctx.slot);
    if (
      current?.__learningModule &&
      parseLearningModule(current.__learningModule).revision !== ctx.savedRevision
    )
      throw new Error(
        'This module changed in another window. Keep this window open and copy your edits before reopening the saved module.'
      );
    const snapshot = parseLearningModule(ctx.module);
    snapshot.revision = ctx.savedRevision + 1;
    const written = JSON.stringify(ctx.module);
    await ctx.host.state.save(ctx.slot, {
      __learningTarget: ctx.target,
      __learningExportSettings: { ...ctx.exportSettings },
      __label: snapshot.title,
      __learningModule: snapshot,
      __learningReleases: structuredClone(ctx.releases),
    });
    ctx.savedRevision = snapshot.revision;
    if (written === JSON.stringify(ctx.module)) {
      ctx.module.revision = snapshot.revision;
      ctx.dirty = false;
    }
    ctx.ui.status(ctx.dirty ? 'Saving changes...' : 'Saved on this device');
  };
  ctx.ui.status('Saving changes...');
  const pending = ctx.saving
    .catch(() => {})
    .then(async () => {
      if (navigator.locks) await navigator.locks.request(`lolly-learning:${ctx.slot}`, operation);
      else await operation();
    });
  ctx.saving = pending;
  return pending.catch((error) => {
    ctx.dirty = true;
    ctx.ui.status(`${error instanceof Error ? error.message : 'Save failed.'} Use Retry save.`);
    throw error;
  });
}
