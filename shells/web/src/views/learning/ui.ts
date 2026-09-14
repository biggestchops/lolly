// SPDX-License-Identifier: MPL-2.0
import type { LearningCtx } from './context.ts';
import { escape as esc } from '../../utils.ts';
import { checkLearningModule } from '../../../../../engine/src/learning/module.ts';
import {
  courseButton as button,
  courseField as field,
  courseFocus,
  courseDate,
  targetLabel,
} from '../../lib/learning-ui.ts';
import { blockMarkup } from './shared.ts';

interface ViewState {
  disclosures: Map<string, boolean>;
  knownBlocks: Set<string>;
}
export function uiOps(ctx: LearningCtx): LearningCtx['ui'] {
  const state: ViewState = {
    disclosures: new Map(),
    knownBlocks: new Set(ctx.module.lessons.flatMap((l) => l.blocks.map((b) => b.id))),
  };
  return {
    render: (focus) => render(ctx, state, focus),
    checks: () => refreshChecks(ctx),
    status: (message) => {
      const el = ctx.root.querySelector('[data-status]');
      if (el) el.textContent = message;
      const retry = ctx.root.querySelector<HTMLButtonElement>('[data-action=retry]');
      if (retry) retry.hidden = !message.includes('Retry save');
    },
  };
}
function render(ctx: LearningCtx, state: ViewState, focus?: string): void {
  for (const el of ctx.root.querySelectorAll<HTMLDetailsElement>('details[data-disclosure]'))
    state.disclosures.set(el.dataset.disclosure!, el.open);
  const restoreFocus = focus || courseFocus(ctx.root, 'data-');
  const status = ctx.root.querySelector('[data-status]')?.textContent || 'Saved on this device';
  const lesson = ctx.module.lessons.find((l) => l.id === ctx.selected);
  const lessonIndex = ctx.module.lessons.findIndex((l) => l.id === ctx.selected);
  const open = (key: string, initial = false) => state.disclosures.get(key) ?? initial;
  ctx.publishing.closePreview();
  ctx.root.innerHTML = `<div class="learning-ui learning-author">
    <header class="learning-header"><div class="learning-heading"><a href="#/p${ctx.module.projectId ? `/${encodeURIComponent(ctx.module.projectId)}` : ''}">Projects</a><h1>Course editor</h1></div><div class="learning-toolbar">${button('preview', 'Preview as learner', '', { disabled: !ctx.module.lessons.length || ctx.checking })}${button('build', ctx.checking ? 'View export check' : 'Export course', '', { primary: true })}</div></header>
    <div class="learning-course-title">${field('learning-title', 'Course title', ctx.module.title, 'data-module="title" maxlength="500"')}<div class="learning-save"><span role="status" data-status>${esc(status)}</span>${button('undo', 'Undo edit', '', { icon: 'undo', disabled: !ctx.undo.length })}${button('retry', 'Retry save')}</div></div>
    <details class="learning-settings" data-disclosure="settings" ${open('settings') ? 'open' : ''}><summary>Module details<span>Description, objectives and language</span></summary><div class="learning-settings-body">
      ${field('learning-description', 'Description', ctx.module.description, 'data-module="description"', true)}
      ${field('learning-objectives', 'Learning objectives', ctx.module.objectives, 'data-module="objectives"', true)}
      ${field('learning-language', 'Content language', ctx.module.language, 'data-module="language" maxlength="50" aria-describedby="learning-language-help"')}
      <p class="learning-hint" id="learning-language-help">Use a language tag such as en or de. Player controls are currently in English.</p></div></details>
    <div class="learning-editor"><aside class="learning-outline"><nav aria-label="Course outline"><div class="learning-section-heading"><h2>Lessons <span data-lesson-count>${ctx.module.lessons.length}</span></h2></div><p class="learning-hint">Arrange lessons in teaching order.</p><ol class="learning-lesson-list">
      ${ctx.module.lessons.map((l, i) => `<li>${l.sectionId && (i === 0 || ctx.module.lessons[i - 1]?.sectionId !== l.sectionId) ? `<p class="learning-section-label">${esc(ctx.module.sections.find((s) => s.id === l.sectionId)?.title || '')}</p>` : ''}<button type="button" class="learning-lesson-tab" data-action="lesson" data-id="${esc(l.id)}" aria-current="${l.id === ctx.selected ? 'true' : 'false'}" aria-label="${i + 1}. ${esc(l.title || 'Untitled lesson')}${l.required ? '' : ' (optional)'}"><span class="learning-lesson-number">${i + 1}</span><span><strong>${esc(l.title || 'Untitled lesson')}</strong><small>${l.blocks.length} ${l.blocks.length === 1 ? 'item' : 'items'}${l.required ? '' : ' / Optional'}</small></span></button></li>`).join('')}
    </ol>${button('add-lesson', 'Add lesson', '', { icon: 'plus' })}</nav><div class="learning-outline-help"><p data-checks></p><a href="#/docs/create/training-creators">Course creator guide</a></div></aside>
    <section class="learning-lesson" aria-label="Lesson editor">
    ${
      lesson
        ? `<header class="learning-section-heading"><h2>Lesson ${lessonIndex + 1}</h2><div class="learning-toolbar" role="group" aria-label="Lesson actions">${button('up', 'Move lesson up', '', { icon: 'chevronDown', iconOnly: true, disabled: lessonIndex === 0, className: 'learning-move-up' })}${button('down', 'Move lesson down', '', { icon: 'chevronDown', iconOnly: true, disabled: lessonIndex === ctx.module.lessons.length - 1 })}${button('remove-lesson', 'Remove lesson', '', { icon: 'trash', iconOnly: true, className: 'learning-remove' })}</div></header>
      ${field('learning-lesson-title', 'Lesson title', lesson.title, 'data-lesson="title" maxlength="500"')}
      <div class="learning-lesson-settings">${field('learning-section', 'Section (optional)', ctx.module.sections.find((s) => s.id === lesson.sectionId)?.title || '', 'data-lesson="section" maxlength="500" list="learning-sections"')}<datalist id="learning-sections">${ctx.module.sections.map((s) => `<option value="${esc(s.title)}"></option>`).join('')}</datalist><label class="learning-check"><input type="checkbox" aria-label="Required for completion" data-lesson="required" ${lesson.required ? 'checked' : ''}><span>Required for completion<small>Learners acknowledge this lesson.</small></span></label></div>
      <div class="learning-content-heading"><h3>Lesson content <span>${lesson.blocks.length}</span></h3><p class="learning-hint">Open an item to edit it. Use the arrows to change its order.</p></div>
      <div class="learning-content-list">${lesson.blocks.map((block, index) => blockMarkup(block, index, lesson.blocks.length, ctx.sourceChoices[block.source?.toolId || ''] || [], open(`block-${block.id}`, !state.knownBlocks.has(block.id) || index === 0))).join('')}</div>
      ${!lesson.blocks.length ? '<div class="learning-empty"><h3>What should this lesson teach?</h3><p>Add an explanation, choose saved designs or media, or attach a reference file.</p></div>' : ''}
      <div class="learning-add-content" role="group" aria-label="Add lesson content">${button('add-text', 'Add text', '', { icon: 'font' })}${button('add-source', 'Add content', '', { icon: 'image' })}${button('add-resource', 'Add resource', '', { icon: 'filePlus' })}<input type="file" data-resource accept=".pdf,.txt" aria-label="Resource file" hidden></div><p class="learning-hint">Resources are PDF or text downloads, up to 50 MB.</p>`
        : '<div class="learning-empty learning-empty-course"><h2>Your course starts with a lesson</h2><p>Use Add lesson to create the first step, then add text, designs or media.</p></div>'
    }
    </section></div>
    <details class="learning-publish" data-disclosure="versions" ${open('versions') ? 'open' : ''}><summary>Saved versions <span>${ctx.releases.length ? `${ctx.releases.length} on this device` : 'No exports yet'}</span></summary><div class="learning-versions-body"><p class="learning-hint">A saved version keeps its finished files. Later edits do not change its ZIP.</p>
      ${ctx.releases.length ? `<ol class="learning-version-list">${ctx.releases.map((r, i) => `<li><div class="learning-section-heading"><h3>Version ${i + 1}</h3><time datetime="${esc(r.createdAt)}">${esc(courseDate(r.createdAt))}</time></div>${r.note ? `<p>${esc(r.note)}</p>` : ''}<div class="learning-toolbar">${r.artifacts.map((a) => button('download', `Download ${targetLabel(a.target)} ZIP`, `${r.id}/${a.target}`, { icon: 'download' })).join('')}${button('variant', 'Export this version for another destination', r.id)}</div><details data-disclosure="hash-${esc(r.id)}"><summary>Package details</summary>${r.artifacts.map((a) => `<p>${esc(targetLabel(a.target))}</p><code>${esc(a.hash)}</code>`).join('')}</details></li>`).join('')}</ol>` : '<p>Choose Export course when you are ready to check and save your first version.</p>'}</div></details>
    </div>`;
  for (const el of ctx.root.querySelectorAll<HTMLDetailsElement>('details[data-disclosure]'))
    if (state.disclosures.has(el.dataset.disclosure!))
      el.open = state.disclosures.get(el.dataset.disclosure!)!;
  for (const block of ctx.module.lessons.flatMap((l) => l.blocks)) state.knownBlocks.add(block.id);
  refreshChecks(ctx);
  ctx.ui.status(status);
  if (restoreFocus) {
    const control = ctx.root.querySelector<HTMLElement>(restoreFocus);
    const target =
      control instanceof HTMLButtonElement && control.disabled
        ? control.closest('[data-block]')?.querySelector<HTMLElement>('summary') ||
          ctx.root.querySelector<HTMLElement>('[data-lesson=title]')
        : control;
    target?.focus({ preventScroll: !focus });
  }
}
function refreshChecks(ctx: LearningCtx): void {
  const errors = checkLearningModule(ctx.module).filter((f) => f.severity === 'error').length;
  const region = ctx.root.querySelector('[data-checks]');
  if (region)
    region.textContent = errors
      ? `${errors} ${errors === 1 ? 'item needs' : 'items need'} attention before export.`
      : 'Preview your course before exporting.';
  for (const el of ctx.root.querySelectorAll<
    HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  >('button,input,textarea,select'))
    el.disabled = ctx.busy || el.hasAttribute('data-unavailable');
  const undo = ctx.root.querySelector<HTMLButtonElement>('[data-action=undo]');
  if (undo) undo.disabled = ctx.busy || !ctx.undo.length;
  const preview = ctx.root.querySelector<HTMLButtonElement>('[data-action=preview]');
  if (preview) preview.disabled = ctx.busy || ctx.checking || !ctx.module.lessons.length;
  for (const [i, lesson] of ctx.module.lessons.entries()) {
    const tab = ctx.root.querySelector<HTMLButtonElement>(
      `[data-action=lesson][data-id="${CSS.escape(lesson.id)}"]`
    );
    if (!tab) continue;
    const section =
      lesson.sectionId && (i === 0 || ctx.module.lessons[i - 1]?.sectionId !== lesson.sectionId)
        ? ctx.module.sections.find((s) => s.id === lesson.sectionId)?.title
        : undefined;
    let label = tab.parentElement?.querySelector<HTMLElement>('.learning-section-label');
    if (section) {
      if (!label) {
        label = document.createElement('p');
        label.className = 'learning-section-label';
        tab.before(label);
      }
      label.textContent = section;
    } else label?.remove();
    tab.querySelector('strong')!.textContent = lesson.title || 'Untitled lesson';
    tab.setAttribute(
      'aria-label',
      `${i + 1}. ${lesson.title || 'Untitled lesson'}${lesson.required ? '' : ' (optional)'}`
    );
  }
}
