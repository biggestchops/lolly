// SPDX-License-Identifier: MPL-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { learningRenditions, learningSummary } from '../engine/src/learning/delivery.ts';
import { learningExportKey, checkLearningExportSize } from '../engine/src/learning/preflight.ts';
import { newLearningModule } from '../engine/src/learning/module.ts';
import {
  collectLearningSelection,
  moduleFromLearningCandidates,
  learningAssetBlock,
  type LearningReader,
} from '../shells/web/src/lib/learning-selection.ts';

const reader: LearningReader = {
  load: async (id) =>
    id === 'missing'
      ? null
      : id === 'batch'
        ? {
            __batch: true,
            rows: [
              { toolId: 'qr', values: { url: 'https://example.test' } },
              { toolId: 'blocked', values: {} },
            ],
          }
        : { __toolId: id, __label: id, __export_format: 'mp4', text: 'retained' },
  tool: async (id) => ({
    render: { formats: id === 'blocked' ? ['html'] : ['png', 'mp4'], export: true },
  }),
  asset: async (id) => ({
    source: 'user',
    id,
    type: 'raster',
    format: 'png',
    url: '',
    meta: { name: 'Imported picture' },
  }),
};
test('renditions derive from declared formats and reject live file inputs and disabled export', () => {
  assert.deepEqual(
    learningRenditions({ render: { formats: ['png', 'webm', 'html', 'pdf'] } }).map((r) => r.kind),
    ['slides', 'video', 'resource']
  );
  assert.deepEqual(learningRenditions({ render: { formats: ['png'], export: false } }), []);
  assert.deepEqual(
    learningRenditions({ render: { formats: ['png'] }, inputs: [{ type: 'file' }] }),
    []
  );
  assert.deepEqual(learningRenditions({ render: { formats: ['scorm', 'pptx'] } }), []);
});
test('folder assembly preserves content, nested folders and batch errors without silent omissions', async () => {
  const candidates = await collectLearningSelection(
    {
      folderIds: ['parent', 'child'],
      sessionRefs: ['qr'],
      folders: [
        {
          id: 'parent',
          name: 'Introduction',
          items: [
            { type: 'session', ref: 'qr' },
            { type: 'image', ref: 'pic' },
            { type: 'session', ref: 'missing' },
          ],
        },
        {
          id: 'child',
          name: 'Practice',
          parentId: 'parent',
          items: [{ type: 'session', ref: 'batch' }],
        },
      ],
    },
    reader
  );
  assert.equal(candidates.length, 5);
  assert.equal(candidates[0]!.block!.kind, 'video');
  assert.equal(candidates[1]!.block!.kind, 'image');
  assert.ok(candidates[2]!.problem);
  assert.equal(candidates[3]!.section, 'Practice / Batch');
  assert.ok(candidates[4]!.problem);
  assert.throws(() => moduleFromLearningCandidates('Course', candidates), /Unselect/);
  const module = moduleFromLearningCandidates(
    'Course',
    candidates.filter((c) => !c.problem).reverse(),
    'parent'
  );
  assert.equal(module.lessons.length, 3);
  assert.equal(module.lessons[2]!.title, 'qr');
  assert.equal(module.projectId, 'parent');
  assert.equal(new Set(module.lessons.map((l) => l.id)).size, 3);
  assert.equal(module.lessons[2]!.blocks[0]!.source!.values!.text, 'retained');
  assert.equal(learningSummary(module).required, 3);
});
test('folder cycles fail and unsupported animated imports require a finished video', async () => {
  await assert.rejects(
    () =>
      collectLearningSelection(
        {
          folderIds: ['a'],
          folders: [
            { id: 'a', name: 'A', parentId: 'b', items: [] },
            { id: 'b', name: 'B', parentId: 'a', items: [] },
          ],
        },
        reader
      ),
    /circular/
  );
  assert.throws(
    () => learningAssetBlock({ source: 'user', id: 'gif', type: 'raster', format: 'gif', url: '' }),
    /video/
  );
});
test('existing modules keep lesson requirements and get independent editing identities', async () => {
  const source = newLearningModule('source', 'Source');
  source.lessons.push({
    id: 'optional',
    title: 'Reference',
    required: false,
    blocks: [{ id: 'text', kind: 'text', text: 'Keep' }],
  });
  const candidates = await collectLearningSelection(
    { sessionRefs: ['module'] },
    { ...reader, load: async () => ({ __learningModule: source }) }
  );
  const course = moduleFromLearningCandidates('Copy', candidates);
  assert.equal(course.lessons[0]!.required, false);
  assert.notEqual(course.lessons[0]!.id, source.lessons[0]!.id);
  course.lessons[0]!.blocks[0]!.text = 'Changed';
  assert.equal(source.lessons[0]!.blocks[0]!.text, 'Keep');
});

test('folder assembly retains schema 2 quizzes and rich text from an existing module', async () => {
  const source = newLearningModule('source', 'Source');
  source.schemaVersion = 2;
  source.lessons.push({
    id: 'lesson',
    title: 'Practice',
    required: true,
    blocks: [
      {
        id: 'text',
        kind: 'text',
        richText: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Keep this emphasis', marks: [{ type: 'bold' }] }],
            },
          ],
        },
      },
      {
        id: 'quiz',
        kind: 'quiz',
        quiz: {
          mode: 'single',
          prompt: 'Ready?',
          feedback: 'Review first.',
          options: [
            { id: 'yes', text: 'Yes', correct: true },
            { id: 'no', text: 'No', correct: false },
          ],
        },
      },
    ],
  });
  const candidates = await collectLearningSelection(
    { sessionRefs: ['module'] },
    { ...reader, load: async () => ({ __learningModule: source }) }
  );
  const assembled = moduleFromLearningCandidates('Copy', candidates);
  assert.equal(assembled.schemaVersion, 2);
  assert.deepEqual(
    assembled.lessons[0]!.blocks[0]!.richText,
    source.lessons[0]!.blocks[0]!.richText
  );
  assert.deepEqual(assembled.lessons[0]!.blocks[1]!.quiz, source.lessons[0]!.blocks[1]!.quiz);
  assert.notEqual(assembled.lessons[0]!.blocks[1]!.id, 'quiz');
});
test('preflight is invalidated by content, target and limit changes but not a routine save', () => {
  const module = newLearningModule('module');
  const settings = { destination: 'Partner', maxMB: 20 };
  const key = learningExportKey(module, 'static', settings);
  module.revision++;
  assert.equal(learningExportKey(module, 'static', settings), key);
  assert.notEqual(learningExportKey(module, 'scorm12', settings), key);
  assert.notEqual(learningExportKey(module, 'static', { ...settings, maxMB: 1 }), key);
  module.title = 'Edited';
  assert.notEqual(learningExportKey(module, 'static', settings), key);
  checkLearningExportSize(1_000_000, 1);
  assert.throws(() => checkLearningExportSize(1_000_001, 1), /above/);
  assert.throws(() => checkLearningExportSize(1, NaN));
});

test('motion never silently falls back to a still when video export is unavailable', async () => {
  const candidates = await collectLearningSelection(
    { sessionRefs: ['motion'] },
    { ...reader, tool: async () => ({ render: { formats: ['png'] } }) }
  );
  assert.match(candidates[0]!.problem!, /video rendition/);
});
