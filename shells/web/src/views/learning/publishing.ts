// SPDX-License-Identifier: MPL-2.0
import type { LearningCtx } from './context.ts';
import {
  compileLearningModule,
  type CompiledLearning,
} from '../../../../../engine/src/learning/compile.ts';
import {
  learningPlayerStyles,
  learningPlayerJs,
} from '../../../../../packages/learning-player/src/bundle.ts';
import { resolveLearningBlock } from '../../lib/learning-render.ts';
import { deliverBatchFile } from '../../lib/background-delivery.ts';
import { mountModal } from '../../components/modal.ts';
import { escape as esc } from '../../utils.ts';
import {
  captureLearningPresentation,
  freezeLearningPresentation,
} from '../../lib/learning-presentation.ts';

export function publishingOps(ctx: LearningCtx): LearningCtx['publishing'] {
  return {
    preview: () => preview(ctx),
    build: () => build(ctx),
    variant: (id) => variant(ctx, id),
    download: (id, owner, surface) => download(ctx, id, owner, surface),
    closePreview: () => closePreview(ctx),
  };
}
export async function sha256(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer))]
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
}
export function closePreview(ctx: LearningCtx): void {
  ctx.previewModal?.close();
  ctx.previewModal = undefined;
  for (const url of ctx.previewUrls) URL.revokeObjectURL(url);
  ctx.previewUrls = [];
}
export async function preview(ctx: LearningCtx): Promise<void> {
  await ctx.flushTyping();
  ctx.busy = true;
  ctx.ui.render();
  const controller = new AbortController();
  const { signal } = controller;
  const close = document.createElement('button');
  close.textContent = 'Close preview';
  close.className = 'btn btn--ghost';
  close.onclick = () => closePreview(ctx);
  const heading = document.createElement('header');
  heading.className = 'learning-preview-header';
  const label = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = 'Learner preview';
  const hint = document.createElement('span');
  hint.textContent = 'Explore your draft. Unfinished content is marked; progress is only a test.';
  label.append(title, hint);
  heading.append(label, close);
  const loading = document.createElement('section');
  loading.className = 'learning-preview-loading';
  const loadingTitle = document.createElement('h2');
  loadingTitle.textContent = 'Opening your course';
  const progress = document.createElement('progress');
  progress.setAttribute('aria-label', 'Preparing learner preview');
  const loadingStatus = document.createElement('p');
  loadingStatus.setAttribute('role', 'status');
  loadingStatus.textContent = 'Preparing content…';
  loading.append(loadingTitle, progress, loadingStatus);
  const status = (message: string) => {
    loadingStatus.textContent = message;
    ctx.ui.status(message);
  };
  ctx.previewModal = mountModal('', {
    className: 'learning-ui learning-preview',
    ariaLabel: 'Learner preview',
    onClose: () => {
      controller.abort();
      ctx.previewModal = undefined;
      for (const url of ctx.previewUrls) URL.revokeObjectURL(url);
      ctx.previewUrls = [];
      ctx.busy = false;
      if (!ctx.disposed) {
        ctx.ui.checks();
        ctx.root
          .querySelector<HTMLElement>('[data-action=preview]')
          ?.focus({ preventScroll: true });
      }
    },
  });
  ctx.previewModal.el.prepend(heading, loading);
  close.focus();
  try {
    const presentation = captureLearningPresentation(ctx.root);
    await ctx.persistence.save();
    signal.throwIfAborted();
    const compiled: CompiledLearning = await compileLearningModule(
      ctx.module,
      `preview-${crypto.randomUUID()}`,
      (block) => resolveLearningBlock(ctx.host, block, signal),
      sha256,
      status,
      { preview: true, throwIfCancelled: () => signal.throwIfAborted() }
    );
    await freezeLearningPresentation(ctx, compiled, presentation, sha256, signal);
    signal.throwIfAborted();
    if (ctx.disposed) return;
    ctx.preview = compiled;
    const content = structuredClone(compiled.content);
    const url = (blob: Blob) => {
      const value = URL.createObjectURL(blob);
      ctx.previewUrls.push(value);
      return value;
    };
    const fileUrl = (path: string, mime: string) =>
      url(new Blob([compiled.files[path]!.slice().buffer], { type: mime }));
    for (const lesson of content.lessons)
      for (const block of lesson.blocks)
        for (const file of [
          ...(block.files || []),
          ...(block.captionFile ? [block.captionFile] : []),
        ])
          file.path = fileUrl(file.path, file.mime);
    const fonts = new Map(
      content.presentation?.fonts.map((font) => [
        font.file.path,
        fileUrl(font.file.path, font.file.mime),
      ])
    );
    const frame = document.createElement('iframe');
    frame.title = 'Learner preview';
    frame.hidden = true;
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-downloads');
    const script = url(
      new Blob([learningPlayerJs(content, 'preview')], { type: 'text/javascript' })
    );
    frame.onload = () => {
      if (signal.aborted) return;
      if (!frame.contentDocument?.querySelector('#learning-player main')) {
        loading.querySelector('h2')!.textContent = 'Preview could not start';
        loading.querySelector('progress')?.remove();
        status('Close preview and try again. Your course is saved on this device.');
        return;
      }
      frame.contentDocument.addEventListener(
        'keydown',
        (event) => {
          if (event.key !== 'Escape' || event.defaultPrevented) return;
          event.preventDefault();
          event.stopPropagation();
          closePreview(ctx);
        },
        { signal }
      );
      frame.hidden = false;
      loading.remove();
      status('Preview ready. Test progress is not sent to an LMS.');
    };
    frame.srcdoc = `<!doctype html><html lang="${esc(content.language)}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src blob:; style-src 'unsafe-inline'; img-src blob: data:; media-src blob: data:; font-src blob:"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${learningPlayerStyles(content, (path) => fonts.get(path)!)}</style></head><body><div id="learning-player"></div><script src="${script}"></script></body></html>`;
    ctx.previewModal!.el.append(frame);
  } catch (error) {
    if (signal.aborted || ctx.disposed) return;
    loading.querySelector('h2')!.textContent = 'Preview could not open';
    loading.querySelector('progress')?.remove();
    status(error instanceof Error ? error.message : 'Close preview and try again.');
  } finally {
    if (!signal.aborted) {
      ctx.busy = false;
      ctx.ui.checks();
    }
  }
}
export async function build(ctx: LearningCtx): Promise<void> {
  ctx.delivery.open();
}
export async function download(
  ctx: LearningCtx,
  id: string,
  owner?: HTMLElement,
  surface?: HTMLElement
): Promise<void> {
  const [releaseId, target] = id.split('/');
  const release = ctx.releases.find((r) => r.id === releaseId);
  const artifact = target
    ? release?.artifacts.find((a) => a.target === target)
    : release?.artifacts[0];
  if (!artifact) throw new Error('This package version is unavailable.');
  const ref = await ctx.host.assets.get(artifact.asset.id, {
    format: 'zip',
    version: artifact.asset.version,
  });
  const response = await fetch(ref.url);
  if (!response.ok) throw new Error('The saved package is unavailable on this device.');
  const blob = await response.blob();
  if ((await sha256(new Uint8Array(await blob.arrayBuffer()))) !== artifact.hash)
    throw new Error('The saved package checksum has changed. Restore it from a backup.');
  const delivery = await deliverBatchFile(
    owner,
    surface,
    { blob, filename: artifact.filename, label: 'Saved course version' },
    ctx.host
  );
  if (delivery.state === 'failed')
    throw new Error(
      delivery.error || 'The ZIP could not be downloaded. Use Download help to retry.'
    );
}

export async function variant(ctx: LearningCtx, id: string): Promise<void> {
  ctx.delivery.open(id);
}
