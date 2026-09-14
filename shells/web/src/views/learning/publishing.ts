// SPDX-License-Identifier: MPL-2.0
import type { LearningCtx } from './context.ts';
import {
  compileLearningModule,
  type CompiledLearning,
} from '../../../../../engine/src/learning/compile.ts';
import {
  learningPlayerCss,
  learningPlayerJs,
} from '../../../../../packages/learning-player/src/bundle.ts';
import { resolveLearningBlock } from '../../lib/learning-render.ts';
import { deliverBatchFile } from '../../lib/background-delivery.ts';

export function publishingOps(ctx: LearningCtx): LearningCtx['publishing'] {
  return {
    preview: () => preview(ctx),
    build: () => build(ctx),
    variant: (id) => variant(ctx, id),
    download: (id) => download(ctx, id),
    closePreview: () => closePreview(ctx),
  };
}
export async function sha256(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer))]
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
}
async function prepare(ctx: LearningCtx, releaseId: string): Promise<CompiledLearning> {
  await ctx.persistence.save();
  return compileLearningModule(
    ctx.module,
    releaseId,
    (block) => resolveLearningBlock(ctx.host, block),
    sha256,
    (message) => ctx.ui.status(message)
  );
}
export function closePreview(ctx: LearningCtx): void {
  ctx.root.querySelector('.learning-preview')?.remove();
  for (const url of ctx.previewUrls) URL.revokeObjectURL(url);
  ctx.previewUrls = [];
}
export async function preview(ctx: LearningCtx): Promise<void> {
  ctx.busy = true;
  ctx.ui.render();
  try {
    const compiled = await prepare(ctx, `preview-${ctx.module.id}`);
    if (ctx.disposed) return;
    closePreview(ctx);
    ctx.preview = compiled;
    const content = structuredClone(compiled.content);
    const url = (blob: Blob) => {
      const u = URL.createObjectURL(blob);
      ctx.previewUrls.push(u);
      return u;
    };
    for (const lesson of content.lessons)
      for (const block of lesson.blocks)
        for (const file of [
          ...(block.files || []),
          ...(block.captionFile ? [block.captionFile] : []),
        ])
          file.path = url(
            new Blob([compiled.files[file.path]!.slice().buffer], { type: file.mime })
          );
    const panel = document.createElement('dialog');
    panel.className = 'learning-preview';
    panel.setAttribute('aria-label', 'Learner preview');
    panel.addEventListener('cancel', (event) => {
      event.preventDefault();
      closePreview(ctx);
    });
    const close = document.createElement('button');
    close.textContent = 'Close preview';
    close.className = 'btn';
    close.onclick = () => {
      closePreview(ctx);
      ctx.root.querySelector<HTMLButtonElement>('[data-action=preview]')?.focus();
    };
    const frame = document.createElement('iframe');
    frame.title = 'Learner preview';
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-downloads');
    const script = url(
      new Blob([learningPlayerJs(content, 'preview')], { type: 'text/javascript' })
    );
    frame.srcdoc = `<!doctype html><html lang="en"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src blob:; style-src 'unsafe-inline'; img-src blob: data:; media-src blob: data:"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${learningPlayerCss}</style><div id="learning-player"></div><script src="${script}"></script></html>`;
    panel.append(close, frame);
    ctx.root.append(panel);
    panel.showModal();
    close.focus();
    ctx.ui.status('Preview ready. Test progress is not sent to an LMS.');
  } finally {
    ctx.busy = false;
    ctx.root
      .querySelectorAll<
        HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >('button,input,textarea,select')
      .forEach((b) => {
        b.disabled = false;
      });
  }
}
export async function build(ctx: LearningCtx): Promise<void> {
  ctx.delivery.open();
}
export async function download(ctx: LearningCtx, id: string): Promise<void> {
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
  await deliverBatchFile(
    undefined,
    undefined,
    { blob, filename: artifact.filename, label: 'Saved course version' },
    ctx.host
  );
}

export async function variant(ctx: LearningCtx, id: string): Promise<void> {
  ctx.delivery.open(id);
}
