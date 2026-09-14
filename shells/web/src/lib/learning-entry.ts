// SPDX-License-Identifier: MPL-2.0
import { mountModal } from '../components/modal.ts';
import { escape as htmlEscape } from '../utils.ts';
import { getExportPolicy, exportAffordance } from './export-policy.ts';
import { videoSupport, audioSupport } from '../bridge/format-support.ts';
import { getTool } from '../bridge/tool-loader.ts';
import { createFolderStore } from '../folders.ts';
import type { PickerHost } from '../views/picker.ts';
import {
  collectLearningSelection,
  moduleFromLearningCandidates,
  type LearningSelection,
  type LearningReader,
} from './learning-selection.ts';
import './learning-entry.css';

export function learningReader(host: PickerHost): LearningReader {
  return {
    load: (slot) => host.state.load(slot),
    asset: (id) => host.assets.get(id),
    tool: async (id) => {
      const manifest = (await getTool(id)).manifest;
      const policy = getExportPolicy(),
        allowed = policy?.formatsFor(id);
      const video = videoSupport(),
        audio = audioSupport();
      const formats =
        exportAffordance(policy) === 'download'
          ? manifest.render.formats.filter(
              (f) =>
                (!allowed || allowed.includes(f)) &&
                (!(f in video) || video[f as keyof typeof video]) &&
                (!(f in audio) || audio[f as keyof typeof audio])
            )
          : [];
      return { ...manifest, render: { ...manifest.render, formats } };
    },
  };
}
/** Shared tool, folder and selection handoff. Nothing is silently omitted. */
export async function startLearningCourse(
  host: PickerHost,
  selection: LearningSelection
): Promise<void> {
  let closed = false;
  const modal = mountModal<void>(
    '<h2>Export course</h2><p role="status">Collecting selected content...</p><button type="button" data-course-close>Cancel</button>',
    {
      className: 'learning-entry',
      ariaLabel: 'Review course content',
      onClose: () => {
        closed = true;
      },
    }
  );
  modal.el.addEventListener('click', (e) => {
    if ((e.target as Element).closest('[data-course-close]')) modal.close();
  });
  try {
    const candidates = await collectLearningSelection(selection, learningReader(host));
    if (closed) return;
    let title = selection.title || 'Learning module';
    const included = new Set(candidates.map((c) => c.id));
    const paint = () => {
      const active = document.activeElement as HTMLElement | null;
      const focusAttr =
        active && modal.el.contains(active)
          ? [...active.attributes].find((a) => a.name.startsWith('data-course-'))?.name
          : undefined;
      const focusIndex = active?.closest<HTMLElement>('[data-candidate]')?.dataset.candidate;
      const picked = candidates.filter((c) => included.has(c.id));
      modal.el.innerHTML = `<h2>Review course content</h2><p>Choose the teaching order. Each item becomes a lesson; existing modules contribute their lessons. The next screen lets you edit the course and export for a website or LMS.</p>
        <label>Course title<input data-course-title value="${htmlEscape(title)}" maxlength="500"></label>
        <p role="status">${picked.length} selected, ${candidates.length - picked.length} excluded. ${candidates.some((c) => c.problem) ? 'Unavailable items must be unselected or replaced.' : ''}</p>
        <ol>${candidates
          .map(
            (
              c,
              i
            ) => `<li data-candidate="${i}"><label><input type="checkbox" data-course-include ${included.has(c.id) ? 'checked' : ''}> ${htmlEscape(c.title)}</label>
          ${c.section ? `<p>${htmlEscape(c.section)}</p>` : ''}${c.problem ? `<p class="learning-entry-error">${htmlEscape(c.problem)}</p>` : ''}
          ${c.lessons ? `<p>${c.lessons.length} lessons from an existing module.</p><button type="button" data-course-open>Open existing module</button>` : ''}
          ${c.renditions?.length ? `<label>Use as<select data-course-rendition>${c.renditions.map((r) => `<option value="${r.kind}" ${c.block?.kind === r.kind ? 'selected' : ''}>${htmlEscape(r.label)}</option>`).join('')}</select></label>` : ''}
          <button type="button" data-course-up ${i === 0 ? 'disabled' : ''}>Move up</button><button type="button" data-course-down ${i === candidates.length - 1 ? 'disabled' : ''}>Move down</button></li>`
          )
          .join('')}</ol>
        ${!candidates.length ? '<p>No course content was found in this selection.</p>' : ''}
        <p data-course-error role="alert"></p><footer><button type="button" data-course-close>Cancel</button><button type="button" class="btn btn--primary" data-course-create ${!picked.length || picked.some((c) => c.problem) ? 'disabled' : ''}>Create course from selection</button></footer>`;
      if (focusAttr)
        modal.el
          .querySelector<HTMLElement>(
            `${focusIndex !== undefined ? `[data-candidate="${focusIndex}"] ` : ''}[${focusAttr}]`
          )
          ?.focus();
    };
    paint();
    modal.el.addEventListener('input', (e) => {
      const el = e.target as HTMLInputElement;
      if (el.matches('[data-course-title]')) title = el.value;
    });
    modal.el.addEventListener('change', (e) => {
      const el = e.target as HTMLInputElement;
      const c = candidates[Number(el.closest<HTMLElement>('[data-candidate]')?.dataset.candidate)];
      if (!c) return;
      if (el.matches('[data-course-include]')) {
        if (el.checked) included.add(c.id);
        else included.delete(c.id);
        paint();
      }
      if (el.matches('[data-course-rendition]') && c.block) {
        const option = c.renditions?.find((r) => r.kind === el.value);
        if (option) {
          c.block.kind = option.kind;
          if (c.block.source) c.block.source.motion = option.kind === 'video';
        }
      }
    });
    modal.el.addEventListener('click', (e) => {
      const el = (e.target as Element).closest<HTMLButtonElement>('button');
      if (!el) return;
      const i = Number(el.closest<HTMLElement>('[data-candidate]')?.dataset.candidate);
      if (el.matches('[data-course-open]') && candidates[i]?.moduleSlot) {
        const slot = candidates[i]!.moduleSlot!;
        modal.close();
        window.location.hash = `#/learning?slot=${encodeURIComponent(slot)}&export=1`;
        return;
      }
      if (el.matches('[data-course-up],[data-course-down]')) {
        const j = i + (el.matches('[data-course-up]') ? -1 : 1);
        if (candidates[i] && candidates[j])
          [candidates[i], candidates[j]] = [candidates[j]!, candidates[i]!];
        paint();
        return;
      }
      if (el.matches('[data-course-create]')) {
        el.disabled = true;
        void (async () => {
          try {
            const module = moduleFromLearningCandidates(
              title,
              candidates.filter((c) => included.has(c.id)),
              selection.projectId || null
            );
            const slot = `__learning__:${module.id}`;
            await host.state.save(slot, {
              __label: module.title,
              __learningModule: module,
              __learningReleases: [],
            });
            if (module.projectId)
              await createFolderStore(
                host as unknown as Parameters<typeof createFolderStore>[0]
              ).addItem(module.projectId, { type: 'session', ref: slot });
            if (closed) return;
            modal.close();
            window.location.hash = `#/learning?slot=${encodeURIComponent(slot)}&export=1`;
          } catch (error) {
            if (!closed) {
              modal.el.querySelector('[data-course-error]')!.textContent = String(
                error instanceof Error ? error.message : error
              );
              el.disabled = false;
            }
          }
        })();
      }
    });
  } catch (error) {
    if (!closed)
      modal.el.querySelector('[role=status]')!.textContent = String(
        error instanceof Error ? error.message : error
      );
  }
}
