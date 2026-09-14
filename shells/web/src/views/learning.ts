// SPDX-License-Identifier: MPL-2.0
import type { LearningCtx } from './learning/context.ts';
import type { LearningBlock, LearningRelease, LearningTarget } from '@lolly-tools/core/learning-v1';
import type { PickerHost } from './picker.ts';
import { newLearningModule, parseLearningModule } from '../../../../engine/src/learning/module.ts';
import { createFolderStore } from '../folders.ts';
import { uiOps } from './learning/ui.ts';
import { editOps } from './learning/edit.ts';
import { sourcesOps } from './learning/sources.ts';
import { deliveryOps } from './learning/delivery.ts';
import { publishingOps } from './learning/publishing.ts';
import { persistenceOps, LEARNING_SLOT_PREFIX } from './learning/store.ts';
import './learning/styles.css';

export async function mountLearning(
  root: HTMLElement & { _cleanup?: () => void; _beforeLeave?: () => Promise<boolean> },
  host: PickerHost,
  params = ''
): Promise<void> {
  const query = new URLSearchParams(params);
  const requested = query.get('slot');
  if (requested && !requested.startsWith(LEARNING_SLOT_PREFIX))
    throw new Error('Invalid learning module address.');
  const slot = requested || LEARNING_SLOT_PREFIX + crypto.randomUUID();
  const data = requested ? await host.state.load(slot) : null;
  if (requested && !data?.__learningModule)
    throw new Error('This module is unavailable on this device.');
  const module = data
    ? parseLearningModule(data.__learningModule)
    : newLearningModule(slot.slice(LEARNING_SLOT_PREFIX.length));
  if (!data) module.projectId = query.get('from');
  const storedSettings =
    data?.__learningExportSettings && typeof data.__learningExportSettings === 'object'
      ? (data.__learningExportSettings as Record<string, unknown>)
      : {};
  const ctx = {
    root,
    host,
    slot,
    module,
    undo: [],
    lastEdit: structuredClone(module),
    releases: (Array.isArray(data?.__learningReleases)
      ? data.__learningReleases
      : []) as LearningRelease[],
    selected: module.lessons[0]?.id || '',
    target: ['static', 'scorm12', 'scorm2004', 'tincan', 'cmi5'].includes(
      String(data?.__learningTarget)
    )
      ? data!.__learningTarget
      : 'scorm12',
    exportSettings: {
      destination: String(storedSettings.destination || '').slice(0, 200),
      maxMB: Math.max(0, Number(storedSettings.maxMB) || 0),
    },
    sourceChoices: {},
    checking: false,
    busy: false,
    disposed: false,
    dirty: false,
    savedRevision: data ? module.revision : 0,
    saving: Promise.resolve(),
    previewUrls: [],
    preview: null,
  } as unknown as LearningCtx;
  ctx.ui = uiOps(ctx);
  ctx.edit = editOps(ctx);
  ctx.sources = sourcesOps(ctx);
  ctx.publishing = publishingOps(ctx);
  ctx.persistence = persistenceOps(ctx);
  ctx.delivery = deliveryOps(ctx);
  await ctx.sources.inspect();
  ctx.ui.render();
  if (!data) {
    await ctx.persistence.save();
    if (module.projectId)
      await createFolderStore(host as unknown as Parameters<typeof createFolderStore>[0]).addItem(
        module.projectId,
        { type: 'session', ref: slot }
      );
    history.replaceState(history.state, '', `#/learning?slot=${encodeURIComponent(slot)}`);
  }
  const click = (event: Event) => {
    const target = (event.target as Element).closest<HTMLElement>('[data-action]');
    if (target)
      void ctx.edit
        .action(target.dataset.action!, target.dataset.id)
        .catch((error) =>
          ctx.ui.status(error instanceof Error ? error.message : 'The operation failed.')
        );
  };
  const change = async (event: Event) => {
    if (ctx.busy) return;
    const el = event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    const lesson = ctx.module.lessons.find((l) => l.id === ctx.selected);
    if (
      el.matches('[data-resource]') &&
      el instanceof HTMLInputElement &&
      el.files?.[0] &&
      lesson
    ) {
      const file = el.files[0],
        pdf = /\.pdf$/i.test(file.name);
      if (!/\.(pdf|txt)$/i.test(file.name) || file.size > 50 * 1024 * 1024)
        throw new Error('Choose a PDF or plain text resource smaller than 50 MB.');
      const id = `user/learning-resource/${crypto.randomUUID()}`,
        format = pdf ? 'pdf' : 'txt';
      await host.assets._uploadUserAsset({
        id,
        type: 'data',
        format,
        blob: new Blob([await file.arrayBuffer()], {
          type: pdf ? 'application/pdf' : 'text/plain',
        }),
        meta: { name: file.name },
      });
      lesson.blocks.push({
        id: crypto.randomUUID(),
        kind: 'resource',
        description: file.name,
        source: { kind: 'asset', asset: { source: 'user', id, type: 'data', format, url: '' } },
      });
    } else if (el.dataset.module) {
      const key = el.dataset.module;
      if (key === 'title' || key === 'description' || key === 'objectives' || key === 'language')
        ctx.module[key] = el.value;
    } else if (el.dataset.lesson && lesson) {
      if (el.dataset.lesson === 'required') lesson.required = (el as HTMLInputElement).checked;
      if (el.dataset.lesson === 'title') lesson.title = el.value;
      if (el.dataset.lesson === 'section') {
        const title = el.value.trim();
        let section = ctx.module.sections.find((s) => s.title === title);
        if (title && !section) {
          section = { id: crypto.randomUUID(), title };
          ctx.module.sections.push(section);
        }
        lesson.sectionId = section?.id;
        ctx.module.sections = ctx.module.sections.filter((s) =>
          ctx.module.lessons.some((l) => l.sectionId === s.id)
        );
      }
    } else if (el.dataset.blockField && lesson) {
      const block = lesson.blocks.find(
        (b) => b.id === el.closest<HTMLElement>('[data-block]')?.dataset.block
      );
      if (!block) return;
      const key = el.dataset.blockField;
      if (key === 'text' || key === 'description' || key === 'transcript' || key === 'captions')
        block[key] = el.value;
      if (key === 'decorative') block.decorative = (el as HTMLInputElement).checked;
      if (key === 'render') {
        if (!ctx.sourceChoices[block.source?.toolId || '']?.some((r) => r.kind === el.value))
          return;
        block.kind = el.value as LearningBlock['kind'];
        if (block.source) block.source.motion = block.kind === 'video';
      }
    } else if (el.matches('[data-target]')) {
      ctx.target = el.value as LearningTarget;
      return;
    } else return;
    ctx.edit.change();
    if (
      el.matches('[data-resource]') ||
      el.dataset.blockField === 'render' ||
      (el instanceof HTMLInputElement && el.type === 'checkbox')
    )
      ctx.ui.render();
    else {
      ctx.ui.checks();
    }
  };
  const onChange = (event: Event) => {
    void change(event).catch((error) =>
      ctx.ui.status(error instanceof Error ? error.message : 'The content could not be added.')
    );
  };
  const unload = (event: BeforeUnloadEvent) => {
    if (ctx.dirty || ctx.busy) event.preventDefault();
  };
  root._beforeLeave = async () => {
    if (!ctx.dirty && !ctx.busy) return true;
    if (!ctx.busy) {
      try {
        await ctx.persistence.save();
        return true;
      } catch {
        /* Keep recoverable edits visible. */
      }
    }
    history.replaceState(history.state, '', `#/learning?slot=${encodeURIComponent(ctx.slot)}`);
    ctx.ui.status(
      ctx.busy
        ? 'Wait for the package operation to finish before leaving.'
        : 'Your changes could not be saved. Use Retry save before leaving.'
    );
    return false;
  };
  root.addEventListener('click', click);
  root.addEventListener('change', onChange);
  window.addEventListener('beforeunload', unload);
  root._cleanup = () => {
    ctx.disposed = true;
    ctx.publishing.closePreview();
    ctx.delivery.close();
    root.removeEventListener('click', click);
    root.removeEventListener('change', onChange);
    window.removeEventListener('beforeunload', unload);
  };
  if (query.get('export') === '1') ctx.delivery.open();
}
