// SPDX-License-Identifier: MPL-2.0
import type { LearningQuiz } from '@lolly-tools/core/learning-v1';
import type { LearningCtx } from './context.ts';

export function quizzesOps(ctx: LearningCtx): LearningCtx['quizzes'] {
  return {
    change: (el) => {
      if (!el.matches('[data-quiz-field], [data-quiz-option-text], [data-quiz-correct]'))
        return false;
      const block = ctx.module.lessons
        .find((l) => l.id === ctx.selected)
        ?.blocks.find((b) => b.id === el.closest<HTMLElement>('[data-block]')?.dataset.block);
      if (!block?.quiz) return true;
      const quiz = block.quiz;
      const input = el as HTMLInputElement;
      const field = el.dataset.quizField;
      if (field === 'prompt' || field === 'feedback') quiz[field] = input.value;
      if (field === 'mode') {
        quiz.mode = input.value as LearningQuiz['mode'];
        if (quiz.mode === 'true-false')
          quiz.options = ['True', 'False'].map((text, i) => ({
            id: crypto.randomUUID(),
            text,
            correct: i === 0,
          }));
        else if (quiz.mode === 'single') {
          const first = quiz.options.find((o) => o.correct);
          for (const o of quiz.options) o.correct = o === first;
        }
      }
      const option = quiz.options.find(
        (o) => o.id === (el.dataset.quizOptionText || el.dataset.quizCorrect)
      );
      if (option && el.dataset.quizOptionText) option.text = input.value;
      if (option && el.dataset.quizCorrect) {
        if (quiz.mode !== 'multiple') for (const o of quiz.options) o.correct = false;
        option.correct = input.checked;
      }
      ctx.edit.change();
      if (field === 'mode' || el.dataset.quizCorrect) ctx.ui.render();
      else ctx.ui.checks();
      return true;
    },
    action: (action, id) => {
      if (!action.startsWith('quiz-') && action !== 'add-quiz') return false;
      const lesson = ctx.module.lessons.find((l) => l.id === ctx.selected);
      if (!lesson) return true;
      if (action === 'add-quiz') {
        const block = {
          id: crypto.randomUUID(),
          kind: 'quiz' as const,
          quiz: {
            mode: 'single' as const,
            prompt: '',
            feedback: '',
            options: [0, 1].map((i) => ({ id: crypto.randomUUID(), text: '', correct: i === 0 })),
          },
        };
        ctx.module.schemaVersion = 2;
        ctx.edit.insert(block);
        ctx.edit.change();
        ctx.ui.render(`[data-block="${block.id}"] [data-quiz-field=prompt]`);
        ctx.insertAfter = undefined;
      } else {
        const [blockId, optionId] = (id || '').split('/');
        const block = lesson.blocks.find((b) => b.id === blockId);
        if (!block?.quiz) return true;
        if (action === 'quiz-add-option' && block.quiz.options.length < 8)
          block.quiz.options.push({ id: crypto.randomUUID(), text: '', correct: false });
        else if (action === 'quiz-remove-option' && block.quiz.options.length > 2)
          block.quiz.options = block.quiz.options.filter((o) => o.id !== optionId);
        else return true;
        ctx.edit.change();
        ctx.ui.render(
          `[data-block="${block.id}"] [data-quiz-option-text="${block.quiz.options.at(-1)!.id}"]`
        );
      }
      return true;
    },
  };
}
