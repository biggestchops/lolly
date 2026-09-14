// SPDX-License-Identifier: MPL-2.0
import type { LearningCtx } from './context.ts';
import type {
  LearningModule,
  LearningRelease,
  LearningTarget,
} from '@lolly-tools/core/learning-v1';
import { LEARNING_TARGETS, learningSummary } from '../../../../../engine/src/learning/delivery.ts';
import {
  checkLearningExportSize,
  learningExportKey,
  learningHandoff,
} from '../../../../../engine/src/learning/preflight.ts';
import { checkLearningModule } from '../../../../../engine/src/learning/module.ts';
import {
  compileLearningModule,
  type CompiledLearning,
} from '../../../../../engine/src/learning/compile.ts';
import { buildLearningPackage } from '../../../../../packages/learning-player/src/package.ts';
import { mountModal, type ModalHandle } from '../../components/modal.ts';
import { escape as esc } from '../../utils.ts';
import { resolveLearningBlock } from '../../lib/learning-render.ts';
import { startJob, cancelJob, type JobHandle } from '../../lib/jobs.ts';
import { deliverBatchFile } from '../../lib/background-delivery.ts';
import { getExportPolicy, exportAffordance } from '../../lib/export-policy.ts';
import { unzipSync } from 'fflate';
import '../../lib/learning-entry.css';

async function hash(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer))]
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
}
interface Checked {
  key: string;
  snapshot: LearningModule;
  compiled: CompiledLearning;
  bytes: Uint8Array;
  hash: string;
  target: LearningTarget;
  settings: LearningCtx['exportSettings'];
}
/** Destination, preflight and delivery share one retained snapshot and exact ZIP. */
export function deliveryOps(ctx: LearningCtx): LearningCtx['delivery'] {
  let modal: ModalHandle<void> | undefined;
  let checked: Checked | undefined;
  let original: LearningRelease | undefined;
  let job: JobHandle | undefined;
  let controller: AbortController | undefined;
  let message = '';
  let note = '';
  let saved: LearningRelease | undefined;
  let saving = false;
  const snapshot = () => original?.snapshot || ctx.module;
  const key = () => learningExportKey(snapshot(), ctx.target, ctx.exportSettings);
  const ready = () => !!checked && checked.key === key();
  const cancel = () => {
    if (job) cancelJob(job.id);
  };
  const invalidate = () => {
    if (original) return;
    checked = undefined;
    saved = undefined;
    cancel();
    message = 'The course changed. Check the updated version before downloading.';
    paint();
  };
  const close = () => {
    modal?.close();
    modal = undefined;
    if (ctx.disposed) {
      cancel();
      checked = undefined;
    }
  };
  const paint = () => {
    if (!modal || ctx.disposed) return;
    const focused = modal.el.contains(document.activeElement)
      ? [...(document.activeElement?.attributes || [])].find((a) =>
          a.name.startsWith('data-delivery-')
        )?.name
      : undefined;
    const summary = learningSummary(snapshot()),
      findings = checkLearningModule(snapshot());
    const blocked = findings.some((f) => f.severity === 'error');
    const active = ctx.checking || saving;
    modal.el.innerHTML = `<h2>Export course${original ? ' version' : ''}</h2>
      <p>${esc(snapshot().title)}${original ? ' · Saved content is used for this export.' : ''}</p>
      <h3>1. Destination</h3>
      <label>Delivery format<select data-delivery-target ${active ? 'disabled' : ''}>${LEARNING_TARGETS.map((t) => `<option value="${t.id}" ${ctx.target === t.id ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select></label>
      <p>${esc(LEARNING_TARGETS.find((t) => t.id === ctx.target)!.description)}</p>
      <label>Website or LMS name (optional)<input data-delivery-name maxlength="200" value="${esc(ctx.exportSettings.destination)}" ${active ? 'disabled' : ''}></label>
      <label>Destination upload limit in MB (0 if unknown)<input data-delivery-limit type="number" min="0" step="0.1" value="${ctx.exportSettings.maxMB}" ${active ? 'disabled' : ''}></label>
      <h3>2. Check the course</h3>
      <dl><dt>Lessons</dt><dd>${summary.lessons}: ${summary.required} required, ${summary.optional} optional</dd><dt>Media</dt><dd>${summary.videos} video, ${summary.audio} audio, ${summary.resources} resources</dd><dt>Language</dt><dd>${esc(summary.language)}; player controls are in English</dd><dt>Completion</dt><dd>${esc(summary.completion)} No score or pass mark.</dd></dl>
      ${findings.length ? `<ul>${findings.map((f) => `<li>${f.severity === 'error' ? 'Fix' : 'Review'}: ${esc(f.message)}${f.lessonId && !original ? ` <button type="button" data-delivery-lesson="${esc(f.lessonId)}">Open lesson</button>` : ''}</li>`).join('')}</ul>` : '<p>Structure checks passed. Review the learner preview, descriptions, captions and reading order.</p>'}
      <p role="status" data-delivery-status>${esc(message)}</p>
      ${ctx.checking ? '<progress aria-label="Preparing course"></progress><p>You can continue editing while this check runs. Changing the course cancels the check.</p><button type="button" data-delivery-cancel>Cancel check</button>' : `<button type="button" class="btn" data-delivery-check ${blocked || saving ? 'disabled' : ''}>${ready() ? 'Check again' : 'Check and prepare package'}</button>`}
      ${ready() ? `<p><strong>Ready: ${(checked!.bytes.length / 1_000_000).toFixed(2)} MB</strong> (${checked!.bytes.length.toLocaleString()} bytes). ${ctx.exportSettings.maxMB ? 'Within your destination limit.' : 'No destination upload limit was supplied.'}</p><p>These checked files will be saved as one course package. Optional lessons are included.</p>` : ''}
      <h3>3. Save and download</h3><p>${esc(learningHandoff(ctx.target))}</p>
      <label>Version notes<textarea data-delivery-note ${active ? 'disabled' : ''}>${esc(note)}</textarea></label>
      <footer><button type="button" data-delivery-close>${ctx.checking ? 'Continue editing' : 'Close'}</button><button type="button" class="btn btn--primary" data-delivery-save ${!ready() || active || saved ? 'disabled' : ''}>${saving ? 'Saving version...' : 'Save version and download ZIP'}</button>${saved ? '<button type="button" data-delivery-download>Download ZIP again</button><button type="button" data-delivery-report>Download handoff report</button>' : ''}</footer>`;
    if (focused) modal.el.querySelector<HTMLElement>(`[${focused}]`)?.focus();
  };
  const status = (text: string) => {
    message = text;
    const el = modal?.el.querySelector('[data-delivery-status]');
    if (el) el.textContent = text;
    ctx.ui.status(text);
  };
  const check = async () => {
    if (ctx.checking || saving) return;
    checked = undefined;
    saved = undefined;
    if (exportAffordance(getExportPolicy()) !== 'download')
      throw new Error('Course download is unavailable under the current export policy.');
    checkLearningExportSize(1, ctx.exportSettings.maxMB);
    const draft = structuredClone(snapshot()),
      target = ctx.target,
      settings = { ...ctx.exportSettings };
    const fingerprint = learningExportKey(draft, target, settings);
    const releaseId = original?.id || crypto.randomUUID();
    const frozen = original;
    controller = new AbortController();
    const signal = controller.signal;
    ctx.checking = true;
    job = startJob({
      title: `Checking course: ${draft.title}`,
      cancel: () => controller?.abort(),
      heavy: true,
    });
    const currentJob = job;
    paint();
    ctx.ui.render();
    try {
      await currentJob.started;
      signal.throwIfAborted();
      await ctx.persistence.save();
      signal.throwIfAborted();
      let compiled: CompiledLearning;
      let retainedBytes: Uint8Array | undefined;
      if (frozen) {
        const artifact = frozen.artifacts.find((a) => a.target === target) || frozen.artifacts[0];
        if (!artifact) throw new Error('The saved version has no package.');
        const ref = await ctx.host.assets.get(artifact.asset.id, {
          format: 'zip',
          version: artifact.asset.version,
        });
        const response = await fetch(ref.url, { signal });
        if (!response.ok) throw new Error('The saved package is unavailable on this device.');
        const bytes = new Uint8Array(await response.arrayBuffer());
        if ((await hash(bytes)) !== artifact.hash)
          throw new Error('The saved package checksum has changed. Restore a backup.');
        if (artifact.target === target) retainedBytes = bytes;
        compiled = {
          content: structuredClone(frozen.content),
          files: Object.fromEntries(
            Object.entries(unzipSync(bytes)).filter(([path]) => path.startsWith('media/'))
          ),
        };
      } else
        compiled = await compileLearningModule(
          draft,
          releaseId,
          (block) => resolveLearningBlock(ctx.host, block, signal),
          hash,
          (text) => {
            status(text);
            currentJob.progress(0, 0, text);
          },
          { throwIfCancelled: () => signal.throwIfAborted() }
        );
      signal.throwIfAborted();
      status('Checking package size and integrity...');
      // Yield before compression so Cancel can be handled after the final render.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      signal.throwIfAborted();
      const bytes = retainedBytes || buildLearningPackage(compiled, target);
      checkLearningExportSize(bytes.length, settings.maxMB);
      const digest = await hash(bytes);
      signal.throwIfAborted();
      if (fingerprint !== key())
        throw new Error('The course or destination changed. Check again before downloading.');
      checked = {
        key: fingerprint,
        snapshot: draft,
        compiled,
        bytes,
        hash: digest,
        target,
        settings,
      };
      status('Checks finished. Review the size and handoff instructions, then save this version.');
      currentJob.finish();
    } catch (error) {
      status(
        signal.aborted
          ? 'Check cancelled. No package version was saved.'
          : error instanceof Error
            ? error.message
            : 'The package could not be prepared.'
      );
      if (!signal.aborted) currentJob.fail(error);
    } finally {
      job = undefined;
      controller = undefined;
      ctx.checking = false;
      paint();
      if (!ctx.disposed) ctx.ui.render();
    }
  };
  const save = async () => {
    if (!ready() || !checked || saving || saved) return;
    if (exportAffordance(getExportPolicy()) !== 'download')
      throw new Error('Course download is unavailable under the current export policy.');
    const prepared = checked;
    saving = true;
    ctx.busy = true;
    paint();
    ctx.ui.render();
    try {
      if (!ready()) throw new Error('The course changed. Check again.');
      const id = prepared.compiled.content.releaseId;
      const filename = `${prepared.snapshot.title.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 70) || 'course'}-${id.slice(0, 8)}-${prepared.target}.zip`;
      const asset = {
        source: 'user' as const,
        id: `user/learning/${id}-${prepared.target}`,
        type: 'data' as const,
        format: 'zip',
        version: prepared.hash,
        url: '',
        meta: { name: filename },
      };
      const existing = original?.artifacts.find((a) => a.target === prepared.target);
      if (existing) {
        saved = original;
      } else {
        await ctx.host.assets._uploadUserAsset({
          ...asset,
          blob: new Blob([prepared.bytes.slice().buffer], { type: 'application/zip' }),
        });
        const artifact = {
          target: prepared.target,
          preset: prepared.target === 'static' ? 'browser-progress-v1' : 'unverified',
          filename,
          hash: prepared.hash,
          asset,
        };
        const release: LearningRelease = original || {
          id,
          createdAt: new Date().toISOString(),
          note,
          snapshot: prepared.snapshot,
          content: prepared.compiled.content,
          files: [],
          artifacts: [],
        };
        release.artifacts.push(artifact);
        if (!original) ctx.releases.push(release);
        try {
          await ctx.persistence.save();
        } catch (error) {
          release.artifacts.pop();
          if (!original) ctx.releases.pop();
          throw error;
        }
        saved = release;
      }
      status('Course version saved on this device. Download is ready.');
      await ctx.publishing.download(`${saved!.id}/${prepared.target}`);
    } finally {
      saving = false;
      ctx.busy = false;
      paint();
      if (!ctx.disposed) ctx.ui.render();
    }
  };
  const report = async () => {
    const artifact = saved?.artifacts.find((a) => a.target === ctx.target);
    if (!artifact || !saved) return;
    const text = JSON.stringify(
      {
        schemaVersion: 1,
        title: saved.snapshot.title,
        moduleId: saved.snapshot.id,
        releaseId: saved.id,
        createdAt: saved.createdAt,
        destination: ctx.exportSettings.destination,
        target: artifact.target,
        filename: artifact.filename,
        sha256: artifact.hash,
        packageBytes: checked?.bytes.length,
        summary: learningSummary(saved.snapshot),
        checks: checkLearningModule(saved.snapshot),
        handoff: learningHandoff(artifact.target),
        compatibility: 'Receiving website or LMS acceptance testing is required.',
      },
      null,
      2
    );
    await deliverBatchFile(
      undefined,
      undefined,
      {
        blob: new Blob([text], { type: 'application/json' }),
        filename: artifact.filename.replace(/\.zip$/, '-handoff.json'),
        label: 'Course handoff report',
      },
      ctx.host
    );
  };
  const open = (releaseId?: string) => {
    if (ctx.disposed || saving) return;
    if (modal) return;
    const next = releaseId ? ctx.releases.find((r) => r.id === releaseId) : undefined;
    if (next?.id !== original?.id) {
      cancel();
      checked = undefined;
      saved = undefined;
    }
    original = next;
    note = ctx.root.querySelector<HTMLTextAreaElement>('[data-release-note]')?.value || '';
    modal = mountModal<void>('', {
      className: 'learning-export',
      ariaLabel: 'Export course',
      onClose: () => {
        modal = undefined;
      },
    });
    paint();
    modal.el.querySelector<HTMLSelectElement>('[data-delivery-target]')?.focus();
    modal.el.addEventListener('change', (event) => {
      const el = event.target as HTMLInputElement;
      if (el.matches('[data-delivery-target]')) ctx.target = el.value as LearningTarget;
      else if (el.matches('[data-delivery-name]')) ctx.exportSettings.destination = el.value;
      else if (el.matches('[data-delivery-limit]')) ctx.exportSettings.maxMB = Number(el.value);
      else return;
      checked = undefined;
      saved = undefined;
      message = 'Destination changed. Check the package for this destination.';
      paint();
      void ctx.persistence
        .save()
        .catch((error) =>
          status(error instanceof Error ? error.message : 'Settings could not be saved.')
        );
    });
    modal.el.addEventListener('input', (event) => {
      const el = event.target as HTMLTextAreaElement;
      if (el.matches('[data-delivery-note]')) note = el.value;
    });
    modal.el.addEventListener('click', (event) => {
      const el = (event.target as Element).closest<HTMLButtonElement>('button');
      if (!el) return;
      if (el.hasAttribute('data-delivery-close')) {
        close();
        return;
      }
      if (el.hasAttribute('data-delivery-cancel')) {
        cancel();
        return;
      }
      if (el.dataset.deliveryLesson) {
        const id = el.dataset.deliveryLesson;
        close();
        void ctx.edit.action('lesson', id);
        return;
      }
      const action = el.hasAttribute('data-delivery-check')
        ? check
        : el.hasAttribute('data-delivery-save')
          ? save
          : el.hasAttribute('data-delivery-report')
            ? report
            : el.hasAttribute('data-delivery-download')
              ? () => ctx.publishing.download(`${saved!.id}/${ctx.target}`)
              : undefined;
      if (action)
        void action().catch((error) => {
          status(error instanceof Error ? error.message : 'The export failed.');
          paint();
        });
    });
  };
  return { open, close, invalidate };
}
