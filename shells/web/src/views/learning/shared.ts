// SPDX-License-Identifier: MPL-2.0
import type { LearningBlock } from '@lolly-tools/core/learning-v1';
import type { LearningRendition } from '../../../../../engine/src/learning/delivery.ts';
import { escape as esc } from '../../utils.ts';
import {
  contentIcon,
  contentLabels,
  courseButton as button,
  courseField as field,
  courseDate,
} from '../../lib/learning-ui.ts';

export function sourceLabel(block: LearningBlock): string {
  const source = block.source;
  const name = source?.asset?.meta?.name || source?.values?.title || source?.values?.name;
  return typeof name === 'string' && name
    ? name
    : source?.toolId
      ? `${source.toolId} creation`
      : 'Imported file';
}
export function blockMarkup(
  block: LearningBlock,
  index: number,
  count: number,
  choices: LearningRendition[],
  open: boolean
): string {
  const id = esc(block.id),
    type = contentLabels[block.kind] || block.kind;
  const excerpt =
    block.kind === 'text'
      ? block.text?.trim().slice(0, 100) || 'Write an explanation or instruction'
      : sourceLabel(block);
  const fields =
    block.kind === 'text'
      ? field(
          `text-${block.id}`,
          'Lesson text',
          block.text || '',
          'data-block-field="text" placeholder="Explain this part of the lesson..."',
          true
        )
      : `${
          block.source?.kind === 'session'
            ? `<div class="learning-source">
        <label>Render as<select data-block-field="render">${choices.map((r) => `<option value="${r.kind}" ${block.kind === r.kind ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}${!choices.some((r) => r.kind === block.kind) ? `<option selected disabled value="${block.kind}">Unavailable rendition</option>` : ''}</select></label>
        ${block.source.slot ? `<div class="learning-toolbar">${button('edit-source', 'Edit source', block.id)}${button('refresh-source', 'Update from source', block.id)}</div>` : ''}
        <p class="learning-hint">${block.source.slot ? 'Source changes appear here when you choose Update from source.' : 'To refresh a batch row, add it again from Projects.'}</p>
        ${block.source.capturedAt ? `<details data-disclosure="source-${id}"><summary>Source details</summary><p class="learning-hint">Captured ${esc(courseDate(block.source.capturedAt))}</p></details>` : ''}</div>`
            : ''
        }
      ${field(`description-${block.id}`, block.kind === 'resource' ? 'Resource label' : 'Description or equivalent explanation', block.description || '', 'data-block-field="description"', block.kind !== 'resource')}
      ${['image', 'slides'].includes(block.kind) ? `<label class="learning-check"><input type="checkbox" aria-label="Decorative image" data-block-field="decorative" ${block.decorative ? 'checked' : ''}><span>Decorative image<small>No explanation is needed for this image.</small></span></label>` : ''}
      ${['video', 'audio'].includes(block.kind) ? `${field(`transcript-${block.id}`, 'Read as text', block.transcript || '', 'data-block-field="transcript" placeholder="Add a written version of the media..."', true)}${block.kind === 'video' ? `<details data-disclosure="captions-${id}"><summary>Video captions</summary><p class="learning-hint">Paste reviewed WebVTT captions, then check their timing in preview.</p>${field(`captions-${block.id}`, 'Captions (WebVTT)', block.captions || '', 'data-block-field="captions" placeholder="WEBVTT"', true)}</details>` : ''}` : ''}`;
  return `<article class="learning-block" data-block="${id}">
    <details data-disclosure="block-${id}" ${open ? 'open' : ''}><summary><span class="learning-content-icon">${contentIcon(block.kind)}</span><span class="learning-block-heading"><strong>${index + 1}. ${esc(type)}</strong><span>${esc(excerpt)}</span></span></summary><div class="learning-block-body">${fields}</div></details>
    <div class="learning-block-actions" role="group" aria-label="${esc(type)} content actions">${button('block-up', 'Move content up', block.id, { icon: 'chevronDown', iconOnly: true, disabled: index === 0, className: 'learning-move-up' })}${button('block-down', 'Move content down', block.id, { icon: 'chevronDown', iconOnly: true, disabled: index === count - 1 })}${button('remove-block', 'Remove content', block.id, { icon: 'trash', iconOnly: true, className: 'learning-remove' })}</div>
  </article>`;
}

import type { LearningModule, LearningTarget } from '@lolly-tools/core/learning-v1';
import { LEARNING_TARGETS, learningSummary } from '../../../../../engine/src/learning/delivery.ts';
import { checkLearningModule } from '../../../../../engine/src/learning/module.ts';
import { learningHandoff } from '../../../../../engine/src/learning/preflight.ts';
import { icon } from '../../lib/icons.ts';
import { targetLabel } from '../../lib/learning-ui.ts';

interface ExportView {
  module: LearningModule;
  target: LearningTarget;
  destination: string;
  maxMB: number;
  step: number;
  active: boolean;
  checking: boolean;
  saving: boolean;
  saved: boolean;
  original: boolean;
  ready: boolean;
  bytes: number;
  note: string;
  message: string;
  tone: string;
}
export function exportMarkup(v: ExportView): string {
  const summary = learningSummary(v.module),
    findings = checkLearningModule(v.module);
  const errors = findings.filter((f) => f.severity === 'error');
  const reviews = findings.filter((f) => f.severity !== 'error');
  const findingList = (items: typeof findings) =>
    `<ul class="learning-findings">${items.map((f) => `<li><span>${esc(f.message)}</span>${f.lessonId && !v.original ? `<button type="button" class="btn btn--ghost" data-delivery-lesson="${esc(f.lessonId)}">Open lesson</button>` : ''}</li>`).join('')}</ul>`;
  const destination = `<h3>Where will learners take this course?</h3>
    <label>Delivery format<select data-delivery-target ${v.active ? 'disabled' : ''}>${LEARNING_TARGETS.map((t) => `<option value="${t.id}" ${v.target === t.id ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select></label>
    <p class="learning-notice">${esc(LEARNING_TARGETS.find((t) => t.id === v.target)!.description)}</p>
    <div class="learning-export-grid"><label>Website or LMS name (optional)<input data-delivery-name maxlength="200" placeholder="For your handoff report" value="${esc(v.destination)}" ${v.active ? 'disabled' : ''}></label><label>Upload limit (MB, optional)<input data-delivery-limit type="number" min="0" step="any" placeholder="No limit supplied" value="${v.maxMB || ''}" ${v.active ? 'disabled' : ''}></label></div>
    <p class="learning-hint">Use the format and upload limit supplied by the receiving platform.</p>`;
  const review = `<h3>Review the course</h3><div class="learning-export-overview"><div><strong>${summary.lessons}</strong><span>Lessons</span></div><div><strong>${summary.required}</strong><span>Required</span></div><div><strong>${summary.optional}</strong><span>Optional</span></div></div>
    <dl><dt>Delivery</dt><dd>${esc(targetLabel(v.target))}${v.destination ? ` / ${esc(v.destination)}` : ''}</dd><dt>Completion</dt><dd>${esc(summary.completion)}</dd><dt>Media</dt><dd>${summary.videos} video, ${summary.audio} audio, ${summary.resources} resources</dd><dt>Language</dt><dd>${esc(summary.language)} <span class="learning-hint">(player controls in English)</span></dd></dl>
    ${errors.length ? `<section class="learning-notice" data-tone="error"><h3>${errors.length} ${errors.length === 1 ? 'item to fix' : 'items to fix'}</h3>${findingList(errors)}</section>` : '<p class="learning-notice">The course structure is ready. The next check prepares the media and measures the final ZIP.</p>'}
    ${reviews.length ? `<details class="learning-handoff" data-delivery-reviews><summary>${reviews.length} ${reviews.length === 1 ? 'accessibility item' : 'accessibility items'} to review</summary>${findingList(reviews)}</details>` : '<p class="learning-hint">Use learner preview to check explanations, captions and reading order.</p>'}
    ${v.checking ? '<div><progress aria-label="Preparing course"></progress><p class="learning-hint">Preparing the package. You can continue editing; a content change cancels this check.</p></div>' : ''}`;
  const download = `<div class="learning-package-ready"><span class="learning-content-icon">${icon('check', { size: 24 })}</span><div><strong>${v.saved ? 'Version saved' : 'Your package is ready'}</strong><p class="learning-hint">${esc(targetLabel(v.target))} / ${(v.bytes / 1_000_000).toFixed(2)} MB (${v.bytes.toLocaleString()} bytes)</p></div></div>
    <p class="learning-notice" data-tone="success">${v.saved ? 'The version is saved on this device. Check your downloads folder for the ZIP.' : `The ZIP includes every selected lesson and its finished content.${v.maxMB ? ' It is within your destination upload limit.' : ''}`}</p>
    ${!v.original && !v.saved ? `<label>Version notes<textarea data-delivery-note placeholder="What changed in this version?" ${v.active ? 'disabled' : ''}>${esc(v.note)}</textarea></label>` : ''}
    <section class="learning-handoff"><h3>${v.target === 'static' ? 'Publish on your website' : 'Import into your LMS'}</h3><p>${v.target === 'static' ? 'Extract the ZIP and upload all files together to your website. Link to index.html. Progress stays in the learner’s browser.' : 'Upload the unopened ZIP to a test course. Verify launch, resume and completion before assigning learners.'}</p><details data-delivery-handoff><summary>Full handoff instructions</summary><p class="learning-hint">${esc(learningHandoff(v.target))}</p></details></section>
    ${v.saved ? '<button type="button" class="btn btn--ghost" data-delivery-report>Download handoff report</button>' : ''}`;
  const next =
    v.step === 0
      ? '<button type="button" class="btn btn--primary" data-delivery-next>Review course</button>'
      : v.step === 1
        ? v.checking
          ? '<button type="button" class="btn btn--ghost" data-delivery-cancel>Cancel check</button>'
          : `<button type="button" class="btn btn--primary" data-delivery-check ${errors.length || v.active ? 'disabled' : ''}>Check and prepare package</button>`
        : v.saved
          ? '<button type="button" class="btn btn--primary" data-delivery-download>Download ZIP again</button>'
          : `<button type="button" class="btn btn--primary" data-delivery-save ${!v.ready || v.active ? 'disabled' : ''}>${v.saving ? 'Saving version...' : 'Save version and download ZIP'}</button>`;
  return `<header class="learning-modal-header"><h2>Export course${v.original ? ' version' : ''}</h2><p>${esc(v.module.title)}${v.original ? ' / Saved course content' : ''}</p><nav aria-label="Export steps"><ol class="learning-export-steps">${['Destination', 'Review', 'Download'].map((label, i) => `<li><button type="button" data-delivery-step="${i}" ${i === v.step ? 'aria-current="step"' : ''} ${v.active || (i === 2 && !v.ready) ? 'disabled' : ''}><span>${i + 1}</span>${label}</button></li>`).join('')}</ol></nav></header>
    <div class="learning-modal-body" data-delivery-body>${[destination, review, download][v.step]}</div>
    <p class="learning-notice" data-tone="${esc(v.tone)}" role="status" data-delivery-status ${!v.message ? 'hidden' : ''}>${esc(v.message)}</p>
    <footer class="learning-modal-footer"><div class="learning-toolbar"><button type="button" class="btn btn--ghost" data-delivery-close>${v.checking ? 'Continue editing' : v.saved ? 'Done' : 'Continue editing'}</button>${v.step > 0 && !v.active && !v.saved ? '<button type="button" class="btn btn--ghost" data-delivery-back>Back</button>' : ''}</div>${next}</footer>`;
}
