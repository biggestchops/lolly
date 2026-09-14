// SPDX-License-Identifier: MPL-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { Ajv2020 } from 'ajv/dist/2020.js';
import schema from '../packages/core/schema/learning-module-v2.schema.json' with { type: 'json' };
import { build } from 'esbuild';
import type {
  LearningModule,
  LearningQuiz,
  LearningRichNode,
} from '../packages/core/src/learning-v1.ts';
import {
  newLearningModule,
  parseLearningModule,
  checkLearningModule,
} from '../engine/src/learning/module.ts';
import {
  learningLinkAllowed,
  validLearningRichText,
  learningQuizCorrect,
} from '../engine/src/learning/authoring.ts';
import { compileLearningModule } from '../engine/src/learning/compile.ts';
import {
  learningProgress,
  encodeLearningAttempt,
  decodeLearningAttempt,
} from '../engine/src/learning/progress.ts';
import type { learningPlayerJs } from '../packages/learning-player/src/bundle.ts';

const question = (): LearningQuiz => ({
  mode: 'multiple',
  prompt: 'Which actions prepare a course?',
  feedback: 'Review the content and test the exported package.',
  options: [
    { id: 'review', text: 'Review', correct: true },
    { id: 'test', text: 'Test', correct: true },
    { id: 'skip', text: 'Skip', correct: false },
  ],
});
const rich = (): LearningRichNode => ({
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Prepare <script> carefully' }],
    },
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'Creator guide',
          marks: [
            { type: 'bold' },
            {
              type: 'link',
              attrs: { href: 'https://lolly.tools/info/create/training-creators.html' },
            },
          ],
        },
      ],
    },
    {
      type: 'orderedList',
      attrs: { start: 2 },
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Preview the course' }] }],
        },
      ],
    },
  ],
});
const fixture = (): LearningModule => ({
  ...newLearningModule('authoring', 'Creator essentials'),
  schemaVersion: 2,
  lessons: [
    {
      id: 'lesson',
      title: 'Prepare a course',
      required: true,
      blocks: [
        { id: 'text', kind: 'text', richText: rich(), text: 'Legacy fallback' },
        { id: 'quiz', kind: 'quiz', quiz: question() },
      ],
    },
  ],
});
const compile = (module = fixture()) =>
  compileLearningModule(
    module,
    'release',
    async () => {
      throw new Error('Semantic content must not resolve media');
    },
    async (bytes) => createHash('sha256').update(bytes).digest('hex')
  );

test('the published schema describes formatted text and practice questions', () => {
  const validate = new Ajv2020({ strict: false }).compile(schema);
  assert.equal(validate(fixture()), true, JSON.stringify(validate.errors));
  const wrongKind = fixture();
  wrongKind.lessons[0]!.blocks[1]!.kind = 'text';
  assert.equal(validate(wrongKind), false);
  assert.throws(() => parseLearningModule(wrongKind));
  const badLink = fixture();
  badLink.lessons[0]!.blocks[0]!.richText!.content![1]!.content![0]!.marks![1]!.attrs!.href =
    'javascript:alert(1)';
  assert.equal(validate(badLink), false);
  assert.throws(() => parseLearningModule(badLink));
});

test('schema 2 preserves rich text and quizzes, while schema 1 remains readable', async () => {
  const m = fixture();
  assert.deepEqual(parseLearningModule(m), m);
  assert.throws(() => parseLearningModule({ ...m, schemaVersion: 1 }));
  assert.equal(parseLearningModule(newLearningModule('old')).schemaVersion, 1);
  assert.deepEqual(checkLearningModule(m), []);
  const { content } = await compile(m);
  assert.equal(content.schemaVersion, 2);
  assert.deepEqual(content.lessons[0]!.blocks[0]!.richText, rich());
  assert.deepEqual(content.lessons[0]!.blocks[1]!.quiz, question());
  m.lessons[0]!.blocks[1]!.quiz!.prompt = 'Changed draft';
  assert.equal(content.lessons[0]!.blocks[1]!.quiz!.prompt, question().prompt);
});

test('semantic text rejects unsafe links, arbitrary HTML/style, malformed structure and excessive nesting', () => {
  assert.equal(validLearningRichText(rich()), true);
  for (const href of [
    'javascript:alert(1)',
    'data:text/html,x',
    '//evil.test',
    'https://good.test\n.bad',
    'file:///x',
  ])
    assert.equal(learningLinkAllowed(href), false);
  for (const href of ['https://lolly.tools', 'mailto:learn@example.com'])
    assert.equal(learningLinkAllowed(href), true);
  for (const change of [
    (m: LearningModule) => {
      m.lessons[0]!.blocks[0]!.richText!.content![0]!.attrs = { level: 1 };
    },
    (m: LearningModule) => {
      (m.lessons[0]!.blocks[0]!.richText as unknown as Record<string, unknown>).html =
        '<img onerror=x>';
    },
    (m: LearningModule) => {
      m.lessons[0]!.blocks[0]!.richText!.content![1]!.content![0]!.marks![1]!.attrs!.href =
        'javascript:alert(1)';
    },
  ]) {
    const m = fixture();
    change(m);
    assert.throws(() => parseLearningModule(m));
  }
  let nested: LearningRichNode = { type: 'paragraph' };
  for (let i = 0; i < 20; i++) nested = { type: 'blockquote', content: [nested] };
  assert.equal(validLearningRichText({ type: 'doc', content: [nested] }), false);
  assert.equal(
    validLearningRichText({ type: 'doc', content: [{ type: 'text', text: 'Wrong parent' }] }),
    false
  );
});

test('quiz preflight points to incomplete questions and invalid answer keys', async () => {
  const m = fixture();
  const q = m.lessons[0]!.blocks[1]!.quiz!;
  q.mode = 'single';
  q.prompt = '';
  q.options[0]!.text = '';
  const findings = checkLearningModule(m);
  assert.equal(findings.length, 3);
  assert.ok(
    findings.every((f) => f.blockId === 'quiz' && f.lessonId === 'lesson' && f.severity === 'error')
  );
  await assert.rejects(compile(m));
  q.options[1]!.id = q.options[0]!.id;
  assert.throws(() => parseLearningModule(m));
});

test('practice answers resume compactly without changing completion and ignore foreign state', async () => {
  const { content } = await compile();
  let state = learningProgress(content, null, {
    kind: 'answer',
    blockId: 'quiz',
    answers: ['review', 'test'],
  });
  assert.equal(learningQuizCorrect(question(), state.quizAnswers!.quiz!), true);
  assert.equal(learningQuizCorrect(question(), ['review', 'skip']), false);
  assert.equal(state.completed, false);
  assert.deepEqual(state.acknowledged, []);
  assert.deepEqual(decodeLearningAttempt(content, encodeLearningAttempt(content, state)), state);
  assert.deepEqual(
    decodeLearningAttempt({ ...content, releaseId: 'new' }, encodeLearningAttempt(content, state))
      .quizAnswers,
    {}
  );
  state = learningProgress(content, state, { kind: 'acknowledge', lessonId: 'lesson' });
  state = learningProgress(content, state, { kind: 'finish' });
  assert.equal(state.completed, true);
  const max = {
    ...content,
    lessons: Array.from({ length: 200 }, (_, i) => ({
      ...content.lessons[0]!,
      id: `lesson-${i}`,
      blocks: Array.from({ length: 5 }, (_, j) => ({
        id: `q-${i}-${j}`,
        kind: 'quiz' as const,
        quiz: question(),
      })),
    })),
  };
  const answers = Object.fromEntries(
    max.lessons.flatMap((l) => l.blocks.map((b) => [b.id, ['review', 'test']]))
  );
  const largest = learningProgress(max, { ...state, quizAnswers: answers }, { kind: 'restore' });
  assert.ok(encodeLearningAttempt(max, largest).length < 4096);
  assert.deepEqual(decodeLearningAttempt(max, encodeLearningAttempt(max, largest)), largest);
});

test('minified portable player renders semantic content and saves quiz feedback across reloads', async () => {
  const { content } = await compile();
  const bundled = await build({
    entryPoints: ['packages/learning-player/src/bundle.ts'],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    minify: true,
  });
  const exported = { exports: {} as { learningPlayerJs: typeof learningPlayerJs } };
  new Function('module', 'exports', 'require', bundled.outputFiles[0]!.text)(
    exported,
    exported.exports,
    () => {
      throw new Error('Unexpected import');
    }
  );
  const js = exported.exports.learningPlayerJs(content, 'scorm12');
  const dom = new JSDOM('<div id="learning-player"></div>', {
    url: 'https://course.test',
    runScripts: 'outside-only',
  });
  try {
    const values: Record<string, string> = {};
    Object.assign(dom.window, {
      API: {
        LMSInitialize: () => 'true',
        LMSGetValue: (key: string) => values[key] || '',
        LMSSetValue: (key: string, value: string) => {
          values[key] = value;
          return 'true';
        },
        LMSCommit: () => 'true',
        LMSFinish: () => 'true',
        LMSGetLastError: () => '0',
      },
    });
    dom.window.eval(js);
    await new Promise((r) => setTimeout(r, 10));
    const d = dom.window.document;
    assert.equal(
      d.querySelector('.learning-rich-text h2')!.textContent,
      'Prepare <script> carefully'
    );
    assert.equal(d.querySelector('.learning-rich-text script'), null);
    assert.equal(
      d.querySelector('.learning-rich-text a')!.getAttribute('rel'),
      'noopener noreferrer'
    );
    assert.equal(d.querySelector('ol')!.start, 2);
    (d.querySelector('input[value=review]') as HTMLInputElement).click();
    (d.querySelector('input[value=test]') as HTMLInputElement).click();
    (d.querySelector('.learning-quiz button') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 10));
    assert.match(d.querySelector('.learning-quiz-feedback')!.textContent!, /^Correct\./);
    assert.equal(d.querySelector('progress')!.value, 0);
    d.getElementById('learning-player')!.replaceChildren();
    dom.window.eval(js);
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(d.querySelectorAll('input:checked').length, 2);
    assert.match(d.querySelector('.learning-quiz-feedback')!.textContent!, /^Correct\./);
  } finally {
    dom.window.close();
  }
});
