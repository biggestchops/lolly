// SPDX-License-Identifier: MPL-2.0
import type { LearningCtx } from './context.ts';
import { escape as htmlEscape } from '../../utils.ts';
import { checkLearningModule } from '../../../../../engine/src/learning/module.ts';

export function uiOps(ctx: LearningCtx): LearningCtx['ui'] {
  return {
    render: () => render(ctx),
    checks: () => refreshChecks(ctx),
    status: (message) => {
      const el = ctx.root.querySelector('[data-status]');
      if (el) el.textContent = message;
    },
  };
}
function button(action: string, label: string, id = ''): string {
  return `<button type="button" class="btn" data-action="${action}" data-id="${htmlEscape(id)}">${htmlEscape(label)}</button>`;
}
let fieldSequence = 0;
function field(label: string, value: string, attributes: string, multiline = false): string {
  const id = `learning-field-${++fieldSequence}`;
  return `<div class="learning-field"><label for="${id}">${label}</label>${multiline ? `<textarea id="${id}" ${attributes}>${htmlEscape(value)}</textarea>` : `<input id="${id}" ${attributes} value="${htmlEscape(value)}">`}</div>`;
}
export function render(ctx: LearningCtx): void {
  fieldSequence = 0;
  const status = ctx.root.querySelector('[data-status]')?.textContent || 'Saved on this device';
  const note = ctx.root.querySelector<HTMLTextAreaElement>('[data-release-note]')?.value || '';
  const lesson = ctx.module.lessons.find((l) => l.id === ctx.selected);
  const findings = checkLearningModule(ctx.module);
  ctx.publishing.closePreview();
  ctx.root.innerHTML = `<div class="learning-author">
    <header class="learning-header"><a class="btn" href="#/p${ctx.module.projectId ? `/${encodeURIComponent(ctx.module.projectId)}` : ''}">Projects</a><h1>Learning module</h1><a class="btn" href="#/docs/create/training-creators">Creator guide</a></header>
    ${field('Course title', ctx.module.title, 'data-module="title" maxlength="500"')}
    <p role="status" data-status>${htmlEscape(status)}</p>
    <div class="learning-toolbar">${button('undo', 'Undo edit')}${button('retry', 'Retry save')}${button('preview', 'Preview as learner')}</div>
    <details class="learning-settings"><summary>Module details</summary>
    ${field('Description', ctx.module.description, 'data-module="description"', true)}
    ${field('Learning objectives', ctx.module.objectives, 'data-module="objectives"', true)}
    ${field('Content language', ctx.module.language, 'data-module="language" maxlength="50"')}
    <p>Learners complete each required lesson, then select Finish. No score or pass mark is sent. Player controls are currently in English.</p></details>
    <div class="learning-editor"><nav aria-label="Course outline"><h2>Lessons</h2>${button('add-lesson', 'Add lesson')}
      ${ctx.module.lessons.map((l, i) => `<button type="button" class="btn" data-action="lesson" data-id="${htmlEscape(l.id)}" aria-current="${l.id === ctx.selected ? 'true' : 'false'}">${i + 1}. ${htmlEscape(l.title || 'Untitled lesson')}${l.required ? '' : ' (optional)'}</button>`).join('')}
    </nav><section class="learning-lesson" aria-label="Lesson editor">
    ${
      lesson
        ? `<h2>Edit lesson</h2>${field('Lesson title', lesson.title, 'data-lesson="title" maxlength="500"')}${field('Section (optional)', ctx.module.sections.find((s) => s.id === lesson.sectionId)?.title || '', 'data-lesson="section" maxlength="500"')}
      <label><input type="checkbox" data-lesson="required" ${lesson.required ? 'checked' : ''}> Required for completion</label>
      <div class="learning-toolbar">${button('up', 'Move lesson up')}${button('down', 'Move lesson down')}${button('remove-lesson', 'Remove lesson')}</div>
      ${lesson.blocks
        .map(
          (
            block,
            index
          ) => `<fieldset data-block="${htmlEscape(block.id)}"><legend>${index + 1}. ${htmlEscape(block.kind)}</legend>
        ${
          block.kind === 'text'
            ? field('Lesson text', block.text || '', 'data-block-field="text"', true)
            : `<p>${htmlEscape(block.source?.toolId || block.source?.asset?.meta?.name || block.source?.asset?.id || 'No source')}</p>
          ${field('Description or equivalent explanation', block.description || '', 'data-block-field="description"', true)}
          ${['image', 'slides'].includes(block.kind) ? `<label><input type="checkbox" data-block-field="decorative" ${block.decorative ? 'checked' : ''}> Decorative image</label>` : ''}
          ${block.source?.kind === 'session' ? `<label>Render as<select data-block-field="render">${(ctx.sourceChoices[block.source.toolId || ''] || []).map((r) => `<option value="${r.kind}" ${block.kind === r.kind ? 'selected' : ''}>${htmlEscape(r.label)}</option>`).join('')}${!ctx.sourceChoices[block.source.toolId || '']?.some((r) => r.kind === block.kind) ? `<option selected disabled value="${block.kind}">Unavailable rendition</option>` : ''}</select></label><p>Source captured ${htmlEscape(block.source.capturedAt || '')}. Use Update from source after editing.</p>${block.source.slot ? `${button('edit-source', 'Edit source', block.id)}${button('refresh-source', 'Update from source', block.id)}` : '<p>Captured from a batch row. Add it again from Projects to use later changes.</p>'}` : ''}
          ${['video', 'audio'].includes(block.kind) ? `${field('Read as text', block.transcript || '', 'data-block-field="transcript"', true)}${field('Captions (WebVTT)', block.captions || '', 'data-block-field="captions"', true)}` : ''}`
        }
        <div class="learning-toolbar">${button('block-up', 'Move content up', block.id)}${button('block-down', 'Move content down', block.id)}${button('remove-block', 'Remove content', block.id)}</div>
      </fieldset>`
        )
        .join('')}
      <div class="learning-toolbar">${button('add-text', 'Add text')}${button('add-source', 'Add content')}<label class="btn">Add resource<input type="file" data-resource accept=".pdf,.txt" class="learning-file"></label></div>`
        : '<h2>Build your course outline</h2><p>Add a lesson, then choose saved creations, imported images, video or audio using Add content. Use Add text for accessible instructions and explanations.</p>'
    }
    </section></div>
    <section class="learning-publish"><h2>Export course</h2>
      <p>Choose a website or LMS destination, check the content and package size, then download a version. Website progress stays in each learner's browser.</p>
      <h3>Checks</h3><div data-checks>${findings.length ? `<ul>${findings.map((f) => `<li>${htmlEscape(f.severity === 'error' ? 'Fix' : 'Review')}: ${htmlEscape(f.message)} ${f.lessonId ? button('lesson', 'Open lesson', f.lessonId) : ''}</li>`).join('')}</ul>` : '<p>The module structure is ready. Preview the content and review its accessibility before publishing.</p>'}</div>
      ${field('Version notes', note, 'data-release-note', true)}
      ${button('build', ctx.checking ? 'View export check' : 'Export course')}
      <h3>Saved versions</h3>${ctx.releases.length ? `<ol>${ctx.releases.map((r, i) => `<li><strong>Version ${i + 1}</strong> ${htmlEscape(r.artifacts[0]?.target || '')} · ${htmlEscape(r.createdAt)}<p>${htmlEscape(r.note)}</p>${r.artifacts.map((a) => `${button('download', `Download ${a.target} ZIP`, `${r.id}/${a.target}`)}<details><summary>${htmlEscape(a.target)} checksum</summary><code>${htmlEscape(a.hash)}</code></details>`).join('')}${button('variant', 'Export this version for another destination', r.id)}</li>`).join('')}</ol>` : '<p>No packages built yet. Each build saves a new version on this device.</p>'}
    </section></div>`;
  if (ctx.busy)
    ctx.root
      .querySelectorAll<
        HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >('button,input,textarea,select')
      .forEach((el) => {
        el.disabled = true;
      });
  if (ctx.checking)
    ctx.root.querySelector<HTMLButtonElement>('[data-action=preview]')!.disabled = true;
}

function refreshChecks(ctx: LearningCtx): void {
  const findings = checkLearningModule(ctx.module);
  const region = ctx.root.querySelector('[data-checks]');
  if (region)
    region.innerHTML = findings.length
      ? `<ul>${findings.map((f) => `<li>${htmlEscape(f.severity === 'error' ? 'Fix' : 'Review')}: ${htmlEscape(f.message)} ${f.lessonId ? button('lesson', 'Open lesson', f.lessonId) : ''}</li>`).join('')}</ul>`
      : '<p>The module structure is ready. Preview the content and review its accessibility before publishing.</p>';
  const build = ctx.root.querySelector<HTMLButtonElement>('[data-action=build]');
  if (build) build.disabled = ctx.busy;
}
