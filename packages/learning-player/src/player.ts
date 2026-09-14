// SPDX-License-Identifier: MPL-2.0
import type { LearningContent, LearningAttempt } from '@lolly-tools/core/learning-v1';
import type { LearningTracking } from './tracking.ts';
import type {
  learningProgress,
  encodeLearningAttempt,
  decodeLearningAttempt,
} from '../../../engine/src/learning/progress.ts';

/** Receives every dependency explicitly so its compiled source is portable. */
export async function bootLearningPlayer(
  w: Window,
  content: LearningContent,
  target: string,
  progress: typeof learningProgress,
  connect: (
    w: Window,
    target: string,
    activity: string,
    releaseId?: string
  ) => Promise<LearningTracking>,
  encodeAttempt: typeof encodeLearningAttempt,
  decodeAttempt: typeof decodeLearningAttempt
): Promise<void> {
  const d = w.document;
  const root = d.getElementById('learning-player');
  if (!root) throw new Error('The learning player could not start.');
  let state: LearningAttempt = progress(content, null, { kind: 'restore' });
  let tracking: LearningTracking | null = null;
  let busy = false;
  let ended = false;
  let saved = false;
  const make = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    text?: string
  ): HTMLElementTagNameMap[K] => {
    const el = d.createElement(tag);
    if (text !== undefined) el.textContent = text;
    return el;
  };
  const header = make('header');
  header.append(make('h1', content.title), make('p', content.description));
  if (content.objectives)
    header.append(make('h2', 'Learning objectives'), make('p', content.objectives));
  const status = make(
    'p',
    target === 'preview'
      ? 'Test preview. Progress is not sent to an LMS.'
      : target === 'static'
        ? 'Opening this course. Progress stays in your browser.'
        : 'Connecting to your LMS.'
  );
  status.setAttribute('role', 'status');
  const layout = make('div');
  layout.className = 'learning-layout';
  const nav = make('nav');
  nav.setAttribute('aria-label', 'Lessons');
  const lessonView = make('main');
  lessonView.tabIndex = -1;
  const controls = make('footer');
  const previous = make('button', 'Previous');
  const next = make('button', 'Complete lesson and continue');
  const finish = make('button', 'Finish');
  const exit = make('button', 'Save and exit');
  const retry = make('button', 'Retry saving');
  retry.hidden = true;
  for (const b of [previous, next, finish, exit, retry]) b.type = 'button';
  controls.append(previous, next, finish, exit, retry);
  layout.append(nav, lessonView);
  root.append(header, status, layout, controls);

  const encode = () => encodeAttempt(content, state);
  const restore = (raw: string) => {
    state = decodeAttempt(content, raw, progress);
  };
  let displayed = '';
  const refresh = () => {
    nav.replaceChildren();
    let section = '';
    for (const lesson of content.lessons) {
      if (lesson.sectionId && section !== lesson.sectionId) {
        section = lesson.sectionId;
        nav.append(make('h2', content.sections.find((s) => s.id === section)?.title || ''));
      }
      if (!lesson.sectionId) section = '';
      const button = make(
        'button',
        `${state.acknowledged.includes(lesson.id) ? '✓ ' : ''}${lesson.title}${lesson.required ? '' : ' (optional)'}`
      );
      button.type = 'button';
      button.setAttribute('aria-current', lesson.id === state.lessonId ? 'step' : 'false');
      button.disabled = busy || ended;
      button.onclick = () => {
        state = progress(content, state, { kind: 'open', lessonId: lesson.id });
        refresh();
        lessonView.focus();
        void save();
      };
      nav.append(button);
    }
    if (displayed !== state.lessonId) {
      displayed = state.lessonId;
      lessonView.replaceChildren();
      const lesson = content.lessons.find((l) => l.id === state.lessonId);
      if (lesson) {
        lessonView.append(make('h2', lesson.title));
        for (const block of lesson.blocks) {
          const sectionEl = make('section');
          if (block.kind === 'text') {
            const text = make('p', block.text);
            text.className = 'learning-text';
            sectionEl.append(text);
          }
          for (const file of block.files || []) {
            if (block.kind === 'image' || block.kind === 'slides') {
              const img = make('img');
              img.src = file.path;
              img.alt = block.decorative ? '' : block.description || '';
              img.loading = 'lazy';
              sectionEl.append(img);
            } else if (block.kind === 'video' || block.kind === 'audio') {
              const media = block.kind === 'video' ? make('video') : make('audio');
              media.src = file.path;
              media.controls = true;
              media.preload = 'metadata';
              media.setAttribute('aria-label', block.description || lesson.title);
              if (block.captionFile) {
                const track = make('track');
                track.kind = 'captions';
                track.src = block.captionFile.path;
                track.srclang = content.language;
                track.label = 'Captions';
                track.default = true;
                media.append(track);
              }
              sectionEl.append(media);
            } else {
              const link = make('a', block.description || file.path.split('/').pop());
              link.href = file.path;
              link.download = '';
              sectionEl.append(link);
            }
          }
          if (block.description && !block.decorative && block.kind !== 'resource')
            sectionEl.append(make('p', block.description));
          if (block.transcript) {
            const details = make('details');
            details.append(make('summary', 'Read as text'), make('p', block.transcript));
            sectionEl.append(details);
          }
          lessonView.append(sectionEl);
        }
      }
    }
    const index = content.lessons.findIndex((l) => l.id === state.lessonId);
    const required = content.lessons.filter((l) => l.required);
    previous.disabled = busy || ended || index <= 0;
    next.disabled = busy || ended || !tracking || tracking.readOnly;
    finish.disabled =
      state.completed ||
      busy ||
      ended ||
      !tracking ||
      tracking.readOnly ||
      !required.length ||
      required.some((l) => !state.acknowledged.includes(l.id));
    exit.disabled = busy || ended || !tracking;
    next.textContent =
      index === content.lessons.length - 1 ? 'Complete lesson' : 'Complete lesson and continue';
  };
  const save = async (terminate = false) => {
    if (!tracking || busy || ended) return;
    busy = true;
    saved = false;
    retry.hidden = true;
    refresh();
    try {
      await tracking.save(encode(), state.completed, state.lessonId);
      if (terminate) {
        await tracking.finish();
        ended = true;
      }
      saved = true;
      status.textContent =
        target === 'preview'
          ? `Test preview. ${state.completed ? 'Module completed.' : 'Test progress saved.'} Nothing is sent to an LMS.`
          : target === 'static'
            ? `${state.completed ? 'Module completed. ' : ''}${tracking.persistence === 'session' ? 'Browser storage is unavailable. Progress lasts only while this page stays open.' : 'Progress saved in this browser. It is not sent to a server.'}${ended ? ' You can close this page.' : ''}`
            : tracking.readOnly
              ? 'Review mode. Your learning record is unchanged.'
              : state.completed
                ? 'Module completed. Progress saved to your LMS.'
                : ended
                  ? 'Progress saved. You can close this window.'
                  : 'Progress saved to your LMS.';
      if (target === 'static') {
        const event = w.document.createEvent('CustomEvent');
        event.initCustomEvent('lolly:learning-progress', false, false, {
          version: 1,
          moduleId: content.moduleId,
          releaseId: content.releaseId,
          lessonId: state.lessonId,
          acknowledged: [...state.acknowledged],
          completed: state.completed,
          persistence: tracking.persistence || 'session',
        });
        w.dispatchEvent(event);
      }
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'Progress could not be saved.';
      retry.hidden = false;
    } finally {
      busy = false;
      refresh();
    }
  };
  previous.onclick = () => {
    const index = content.lessons.findIndex((l) => l.id === state.lessonId);
    const lesson = content.lessons[index - 1];
    if (lesson) {
      state = progress(content, state, { kind: 'open', lessonId: lesson.id });
      refresh();
      void save();
    }
  };
  next.onclick = () => {
    const index = content.lessons.findIndex((l) => l.id === state.lessonId);
    state = progress(content, state, { kind: 'acknowledge', lessonId: state.lessonId });
    const following = content.lessons[index + 1];
    if (following) state = progress(content, state, { kind: 'open', lessonId: following.id });
    refresh();
    lessonView.focus();
    void save();
  };
  finish.onclick = () => {
    state = progress(content, state, { kind: 'finish' });
    void save(true);
  };
  exit.onclick = () => {
    void save(true);
  };
  retry.onclick = () => {
    void save(state.completed);
  };
  refresh();
  try {
    tracking = await connect(
      w,
      target,
      `urn:lolly:learning:${content.moduleId}`,
      content.releaseId
    );
    restore(await tracking.read());
    if (target === 'static')
      status.textContent =
        tracking.persistence === 'session'
          ? 'Browser storage is unavailable. Progress lasts only while this page stays open.'
          : `${state.completed ? 'Module completed. ' : ''}Progress stays in this browser. Shared devices share this progress.`;
    else if (target !== 'preview')
      status.textContent = tracking.readOnly
        ? 'Review mode. Your learning record is unchanged.'
        : 'Connected to your LMS.';
  } catch (error) {
    tracking = null;
    status.textContent = error instanceof Error ? error.message : 'The LMS connection failed.';
  }
  refresh();
  const timer = w.setInterval(() => {
    if (!ended) void save();
  }, 30000);
  w.addEventListener(
    'pagehide',
    () => {
      w.clearInterval(timer);
      if (!busy && !ended) void save(true);
    },
    { once: true }
  );
  w.addEventListener('beforeunload', (event) => {
    if (!ended && !saved && target !== 'preview') event.preventDefault();
  });
}
