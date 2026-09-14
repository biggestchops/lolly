// SPDX-License-Identifier: MPL-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { unzipSync, strFromU8 } from 'fflate';
import type {
  LearningContent,
  LearningModule,
  LearningTarget,
} from '../packages/core/src/learning-v1.ts';
import {
  newLearningModule,
  parseLearningModule,
  checkLearningModule,
  learningPath,
} from '../engine/src/learning/module.ts';
import { compileLearningModule } from '../engine/src/learning/compile.ts';
import {
  learningProgress,
  encodeLearningAttempt,
  decodeLearningAttempt,
} from '../engine/src/learning/progress.ts';
import { buildLearningPackage } from '../packages/learning-player/src/package.ts';
import { learningPlayerJs } from '../packages/learning-player/src/bundle.ts';
import { createLearningTracking } from '../packages/learning-player/src/tracking.ts';

const hash = async (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function moduleFixture(): LearningModule {
  return {
    ...newLearningModule('course-one', 'Course <One>'),
    description: 'Practice & learn',
    lessons: [
      {
        id: 'intro',
        title: 'Introduction',
        required: true,
        blocks: [{ id: 'welcome', kind: 'text', text: 'Welcome <script>alert(1)</script>' }],
      },
      {
        id: 'practice',
        title: 'Practice',
        required: true,
        blocks: [{ id: 'exercise', kind: 'text', text: 'Try it yourself.' }],
      },
      {
        id: 'reference',
        title: 'Reference',
        required: false,
        blocks: [{ id: 'reading', kind: 'text', text: 'Further reading.' }],
      },
    ],
  };
}
const compile = (module = moduleFixture(), release = 'r1') =>
  compileLearningModule(module, release, async () => [], hash);
const turn = () => new Promise((resolve) => setTimeout(resolve, 0));

test('module input rejects unsupported versions, duplicate identifiers and oversized outlines', () => {
  const module = moduleFixture();
  assert.deepEqual(parseLearningModule(module), module);
  assert.throws(() => parseLearningModule({ ...module, schemaVersion: 9 }));
  module.lessons[1]!.id = 'intro';
  assert.throws(() => parseLearningModule(module));
  assert.throws(() =>
    parseLearningModule({ ...moduleFixture(), lessons: Array(201).fill(module.lessons[0]) })
  );
  for (const path of [
    '../escape',
    '/root',
    'https://host/x',
    'media/%2e%2e/x',
    'media/../x',
    'media\\x',
    'media//x',
  ])
    assert.throws(() => learningPath(path));
});

test('navigation and media viewing never complete lessons or the module', async () => {
  const { content } = await compile();
  let state = learningProgress(content, null, { kind: 'open', lessonId: 'reference' });
  assert.equal(state.completed, false);
  assert.deepEqual(state.acknowledged, []);
  state = learningProgress(content, state, { kind: 'finish' });
  assert.equal(state.completed, false);
  for (const lessonId of ['intro', 'practice'])
    state = learningProgress(content, state, { kind: 'acknowledge', lessonId });
  assert.equal(state.completed, false);
  state = learningProgress(content, state, { kind: 'finish' });
  assert.equal(state.completed, true);
  assert.deepEqual(decodeLearningAttempt(content, encodeLearningAttempt(content, state)), state);
  assert.equal(
    decodeLearningAttempt({ ...content, releaseId: 'r2' }, encodeLearningAttempt(content, state))
      .completed,
    false
  );
  assert.deepEqual(decodeLearningAttempt(content, '{broken').acknowledged, []);
});

test('the largest supported outline stays within the SCORM 1.2 suspend limit', () => {
  const content = {
    releaseId: 'r'.repeat(120),
    lessons: Array.from({ length: 200 }, (_, i) => ({
      id: `lesson-${i}`,
      title: '',
      required: true,
      blocks: [],
    })),
  };
  let state = learningProgress(content, null, { kind: 'restore' });
  for (const lesson of content.lessons)
    state = learningProgress(content, state, { kind: 'acknowledge', lessonId: lesson.id });
  assert.ok(encodeLearningAttempt(content, state).length < 4096);
  assert.throws(() => encodeLearningAttempt(content, state, 1));
});

test('compilation fails visibly if any required content is missing or unsupported', async () => {
  const module = moduleFixture();
  module.lessons[0]!.blocks.push({
    id: 'photo',
    kind: 'image',
    source: {
      kind: 'asset',
      asset: { source: 'user', id: 'picture', type: 'raster', format: 'png', url: '' },
    },
  });
  assert.ok(
    checkLearningModule(module).some((f) => f.severity === 'review' && f.blockId === 'photo')
  );
  await assert.rejects(
    compileLearningModule(
      module,
      'r1',
      async () => {
        throw new Error('Missing image');
      },
      hash
    ),
    /Introduction: Missing image/
  );
  await assert.rejects(
    compileLearningModule(
      module,
      'r1',
      async () => [{ bytes: new Uint8Array([1]), mime: 'text/html' }],
      hash
    ),
    /unsupported image/
  );
  const result = await compileLearningModule(
    module,
    'r1',
    async () => [{ bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), mime: 'image/png' }],
    hash
  );
  assert.equal(Object.keys(result.files).length, 1);
  assert.equal('source' in result.content.lessons[0]!.blocks[1]! ? true : undefined, undefined);
  assert.ok(!JSON.stringify(result.content).includes('picture'));
});

for (const target of ['scorm12', 'scorm2004', 'tincan', 'cmi5'] as LearningTarget[])
  test(`${target}: deterministic package with one local launch and separate manifest`, async () => {
    const compiled = await compile();
    const zip = buildLearningPackage(compiled, target);
    assert.deepEqual(zip, buildLearningPackage(compiled, target));
    const files = unzipSync(zip);
    const manifestName = target.startsWith('scorm')
      ? 'imsmanifest.xml'
      : target === 'tincan'
        ? 'tincan.xml'
        : 'cmi5.xml';
    assert.ok(files[manifestName]);
    assert.ok(files['index.html']);
    const dom = new JSDOM(''),
      parser = new dom.window.DOMParser();
    const doc = parser.parseFromString(strFromU8(files[manifestName]!), 'application/xml');
    assert.equal(doc.querySelector('parsererror'), null);
    if (target.startsWith('scorm')) {
      assert.equal(doc.querySelectorAll('resource').length, 1);
      for (const file of doc.querySelectorAll('file')) assert.ok(files[file.getAttribute('href')!]);
      assert.equal(doc.documentElement.getAttribute('xsi:schemaLocation'), null);
      assert.ok(
        strFromU8(files[manifestName]!).includes(
          target === 'scorm12' ? 'adlcp:scormtype="sco"' : 'adlcp:scormType="sco"'
        )
      );
    }
    assert.ok(!strFromU8(files['content.json']!).includes('__toolId'));
    assert.ok(!strFromU8(files['index.html']!).includes('https://'));
    dom.window.close();
  });

function lms(v4: boolean, failCommit = false) {
  const values: Record<string, string> = {
    [v4 ? 'cmi.mode' : 'cmi.core.lesson_mode']: 'normal',
    [v4 ? 'cmi.completion_status' : 'cmi.core.lesson_status']: 'not attempted',
  };
  const calls: string[] = [];
  const prefix = v4 ? '' : 'LMS';
  const api: Record<string, (...args: string[]) => string> = {
    [prefix + 'Initialize']: () => {
      calls.push('initialize');
      return 'true';
    },
    [prefix + 'GetValue']: (key) => values[key!] || '',
    [prefix + 'SetValue']: (key, value) => {
      values[key!] = value!;
      calls.push(`set:${key}`);
      return 'true';
    },
    [prefix + 'Commit']: () => {
      calls.push('commit');
      return failCommit ? 'false' : 'true';
    },
    [v4 ? 'Terminate' : 'LMSFinish']: () => {
      calls.push('finish');
      return 'true';
    },
    [prefix + 'GetLastError']: () => (failCommit && calls.at(-1) === 'commit' ? '101' : '0'),
  };
  const dom = new JSDOM('<div id="learning-player"></div>', {
    url: 'https://lms.test/course/',
    runScripts: 'outside-only',
  });
  Object.assign(dom.window, { [v4 ? 'API_1484_11' : 'API']: api });
  return { dom, values, calls };
}

for (const v4 of [false, true])
  test(`SCORM ${v4 ? '2004' : '1.2'} resumes, commits, terminates once and refuses failed writes`, async () => {
    const { dom, values, calls } = lms(v4);
    const tracking = await createLearningTracking(
      dom.window as unknown as Window,
      v4 ? 'scorm2004' : 'scorm12',
      'course'
    );
    await tracking.save('bookmark', false, 'intro');
    assert.equal(values['cmi.suspend_data'], 'bookmark');
    assert.equal(await tracking.read(), 'bookmark');
    assert.equal(values[v4 ? 'cmi.exit' : 'cmi.core.exit'], 'suspend');
    await tracking.save('completed-state', true, 'practice');
    assert.equal(values[v4 ? 'cmi.completion_status' : 'cmi.core.lesson_status'], 'completed');
    assert.ok(
      !Object.keys(values).some((k) => k.includes('score') || k.includes('success_status'))
    );
    await tracking.finish();
    await tracking.finish();
    assert.equal(calls.filter((c) => c === 'finish').length, 1);
    const failing = lms(v4, true);
    const adapter = await createLearningTracking(
      failing.dom.window as unknown as Window,
      v4 ? 'scorm2004' : 'scorm12',
      'course'
    );
    await assert.rejects(adapter.save('state', false, 'intro'), /did not save.*101/);
    dom.window.close();
    failing.dom.window.close();
  });

test('review mode leaves learner progress and completion unchanged', async () => {
  const { dom, values, calls } = lms(false);
  values['cmi.core.lesson_mode'] = 'review';
  values['cmi.core.lesson_status'] = 'completed';
  const adapter = await createLearningTracking(
    dom.window as unknown as Window,
    'scorm12',
    'course'
  );
  assert.equal(adapter.readOnly, true);
  await adapter.save('replacement', false, 'intro');
  assert.equal(values['cmi.suspend_data'], undefined);
  assert.equal(calls.filter((c) => c.startsWith('set:')).length, 0);
  dom.window.close();
});

async function exercisePlayer(source: string, content: LearningContent) {
  const { dom, values } = lms(false);
  let interval: (() => void) | undefined;
  dom.window.setInterval = ((cb: () => void) => {
    interval = cb;
    return 1;
  }) as typeof dom.window.setInterval;
  dom.window.eval(source);
  await turn();
  const button = (text: string) =>
    [...dom.window.document.querySelectorAll('button')].find((b) => b.textContent === text)!;
  assert.ok(dom.window.document.querySelector('main')!.textContent!.includes('<script>'));
  assert.equal(dom.window.document.querySelectorAll('main script').length, 0);
  assert.equal(button('Finish').disabled, true);
  button('Complete lesson and continue').click();
  await turn();
  assert.equal(button('Finish').disabled, true);
  button('Complete lesson and continue').click();
  await turn();
  assert.equal(button('Finish').disabled, false);
  const main = dom.window.document.querySelector('main h2');
  interval?.();
  await turn();
  assert.equal(
    dom.window.document.querySelector('main h2'),
    main,
    'background save must preserve the current media DOM'
  );
  button('Finish').click();
  await turn();
  assert.equal(values['cmi.core.lesson_status'], 'completed');
  assert.equal(decodeLearningAttempt(content, values['cmi.suspend_data']!).completed, true);
  const savedAttempt = values['cmi.suspend_data'];
  const review = dom.window.document.querySelector<HTMLButtonElement>('nav button')!;
  assert.equal(review.disabled, false, 'completed learners can revisit the course');
  review.click();
  await turn();
  assert.equal(dom.window.document.querySelector('main h2')!.textContent, 'Introduction');
  assert.equal(
    values['cmi.suspend_data'],
    savedAttempt,
    'reviewing after finish does not write to a terminated LMS session'
  );
  dom.window.close();
}
test('generated learner JavaScript completes required lessons and keeps background saves stable', async () => {
  const { content } = await compile();
  await exercisePlayer(learningPlayerJs(content, 'scorm12'), content);
});
test('the production-minified player builder produces executable standalone JavaScript', async () => {
  const { content } = await compile();
  const result = await build({
    entryPoints: ['packages/learning-player/src/bundle.ts'],
    bundle: true,
    minify: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    globalName: 'LearningBundle',
  });
  const dom = new JSDOM('', { runScripts: 'outside-only' });
  const factory = dom.window.eval(result.outputFiles[0]!.text + ';LearningBundle') as {
    learningPlayerJs: typeof learningPlayerJs;
  };
  await exercisePlayer(factory.learningPlayerJs(content, 'scorm12'), content);
  dom.window.close();
});

for (const target of ['tincan', 'cmi5'])
  test(`${target}: launch identity, registration, conditional state and stable statement retries`, async () => {
    const actor = {
      objectType: 'Agent',
      account: { homePage: 'https://lms.test', name: 'learner-one' },
    };
    const registration = '48cb6364-0953-468b-8b60-21687284c4d3';
    const params = new URLSearchParams({
      endpoint: 'https://lrs.test/xapi/',
      actor: JSON.stringify(actor),
      registration,
      auth: 'Basic test-token',
      fetch: 'https://lms.test/token',
      activity_id: 'urn:activity:one',
      activityId: 'urn:activity:one',
    });
    const dom = new JSDOM('', { url: `https://lms.test/course/?${params}` });
    const calls: Array<{ url: URL; init: RequestInit }> = [];
    let state = '',
      stateWrites = 0,
      rejectStatement = true;
    Object.assign(dom.window, {
      structuredClone,
      fetch: async (url: URL | string, init: RequestInit) => {
        const u = new URL(url);
        calls.push({ url: u, init });
        if (u.hostname === 'lms.test') return Response.json({ 'auth-token': 'Basic cmi5-token' });
        if (u.searchParams.get('stateId') === 'LMS.LaunchData')
          return Response.json({
            launchMode: 'Normal',
            moveOn: 'Completed',
            contextTemplate: {
              extensions: {
                'https://w3id.org/xapi/cmi5/context/extensions/sessionid': 'session-one',
              },
              contextActivities: { grouping: [{ id: 'urn:publisher:one' }] },
            },
          });
        if (u.pathname.endsWith('/statements')) {
          if (rejectStatement) {
            rejectStatement = false;
            return new Response('', { status: 503 });
          }
          return Response.json([JSON.parse(String(init.body)).id]);
        }
        if (init.method === 'PUT') {
          state = String(init.body);
          stateWrites++;
          return new Response(null, { status: 204, headers: { ETag: `"${stateWrites}"` } });
        }
        return state
          ? new Response(state, { headers: { ETag: `"${stateWrites}"` } })
          : new Response(null, { status: 404 });
      },
    });
    const adapter = await createLearningTracking(
      dom.window as unknown as Window,
      target,
      'urn:fallback'
    );
    assert.equal(await adapter.read(), '');
    await adapter.save('progress-one', false, 'intro');
    await adapter.save('progress-two', true, 'practice');
    await adapter.finish();
    await adapter.finish();
    const statements = calls
      .filter((c) => c.url.pathname.endsWith('/statements'))
      .map((c) => JSON.parse(String(c.init.body)));
    assert.deepEqual(
      statements[0],
      statements[1],
      'a network retry must keep its original statement ID and timestamp'
    );
    for (const statement of statements) {
      assert.deepEqual(statement.actor, actor);
      assert.equal(statement.context.registration, registration);
      assert.equal(statement.object.id, 'urn:activity:one');
      assert.equal(statement.result?.score, undefined);
      if (target === 'cmi5')
        assert.equal(
          statement.context.extensions['https://w3id.org/xapi/cmi5/context/extensions/sessionid'],
          'session-one'
        );
    }
    assert.equal(statements.filter((s) => s.verb.id.endsWith('/terminated')).length, 1);
    const writes = calls.filter((c) => c.init.method === 'PUT');
    assert.equal((writes[0]!.init.headers as Record<string, string>)['If-None-Match'], '*');
    assert.equal((writes[1]!.init.headers as Record<string, string>)['If-Match'], '"1"');
    assert.equal(
      calls.filter((c) => c.url.hostname === 'lms.test').length,
      target === 'cmi5' ? 1 : 0
    );
    dom.window.close();
  });

test('xAPI refuses a missing registration without sending learner statements', async () => {
  const dom = new JSDOM('', {
    url: 'https://lms.test/course/?endpoint=https://lrs.test&auth=secret',
  });
  await assert.rejects(
    createLearningTracking(dom.window as unknown as Window, 'tincan', 'urn:course'),
    /registration/
  );
  dom.window.close();
});

test('static package is portable and has no LMS manifest or remote runtime dependency', async () => {
  const compiled = await compile();
  const bytes = buildLearningPackage(compiled, 'static');
  const files = unzipSync(bytes);
  assert.deepEqual(bytes, buildLearningPackage(compiled, 'static'));
  for (const name of ['imsmanifest.xml', 'tincan.xml', 'cmi5.xml'])
    assert.equal(files[name], undefined);
  for (const name of [
    'index.html',
    'player.js',
    'player.css',
    'content.json',
    'release.json',
    'README.txt',
    'HANDOFF.txt',
  ])
    assert.ok(files[name]);
  assert.match(strFromU8(files['HANDOFF.txt']!), /static|HTTP/);
  assert.ok(!strFromU8(files['index.html']!).includes('https://'));
});

test('static player degrades to page progress and emits only the versioned observation contract', async () => {
  const content = (await compile()).content;
  const dom = new JSDOM('<div id="learning-player"></div>', {
    url: 'https://course.test/v1/',
    runScripts: 'outside-only',
  });
  const events: Record<string, unknown>[] = [];
  dom.window.addEventListener('lolly:learning-progress', (event) =>
    events.push((event as CustomEvent).detail)
  );
  dom.window.eval(learningPlayerJs(content, 'static'));
  await turn();
  await turn();
  assert.match(
    dom.window.document.querySelector('[role=status]')!.textContent!,
    /only while this page stays open/
  );
  const complete = [...dom.window.document.querySelectorAll('button')].find(
    (b) => b.textContent === 'Complete lesson and continue'
  )!;
  complete.click();
  await turn();
  assert.equal(events.at(-1)?.version, 1);
  assert.equal(events.at(-1)?.persistence, 'session');
  assert.equal(events.at(-1)?.completed, false);
  assert.deepEqual(Object.keys(events[0]!).sort(), [
    'acknowledged',
    'completed',
    'lessonId',
    'moduleId',
    'persistence',
    'releaseId',
    'version',
  ]);
  dom.window.close();
});

test('compiler cancellation stops required media without returning a partial package', async () => {
  const module = moduleFixture();
  for (const lesson of module.lessons)
    lesson.blocks.push({
      id: `img-${lesson.id}`,
      kind: 'image',
      description: 'Picture',
      source: {
        kind: 'asset',
        asset: { id: 'user/picture', source: 'user', type: 'raster', format: 'png', url: '' },
      },
    });
  let cancelled = false,
    calls = 0;
  await assert.rejects(
    () =>
      compileLearningModule(
        module,
        'cancelled',
        async () => {
          calls++;
          cancelled = true;
          return [{ mime: 'image/png', bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]) }];
        },
        hash,
        undefined,
        {
          throwIfCancelled: () => {
            if (cancelled) throw new Error('Cancelled');
          },
        }
      ),
    /Cancelled/
  );
  assert.equal(calls, 1);
});

test('unfinished previews retain every lesson and show unavailable content without weakening exports', async () => {
  const module = moduleFixture();
  module.title = '';
  module.lessons[0]!.blocks.push(
    { id: 'empty', kind: 'text', text: '' },
    { id: 'missing', kind: 'image' }
  );
  module.lessons[1]!.blocks = [];
  module.lessons.forEach((lesson) => {
    lesson.required = false;
  });
  const preview = await compileLearningModule(
    module,
    'preview',
    async () => {
      throw new Error('Missing source image');
    },
    hash,
    undefined,
    { preview: true }
  );
  assert.equal(preview.content.lessons.length, 3);
  assert.equal(preview.content.lessons[0]!.blocks.length, 3);
  assert.match(preview.content.lessons[0]!.blocks[1]!.previewIssue!, /empty/);
  assert.match(preview.content.lessons[0]!.blocks[2]!.previewIssue!, /Missing source/);
  assert.throws(() => buildLearningPackage(preview, 'static'), /Draft previews cannot be exported/);
  await assert.rejects(compile(module), /title|lesson/);
});

test('saved presentation includes validated local fonts and remains deterministic across targets', async () => {
  const compiled = await compile();
  const bytes = new Uint8Array([119, 79, 70, 50, 1, 2]);
  const digest = await hash(bytes);
  const path = `media/${digest}.woff2`;
  compiled.files[path] = bytes;
  compiled.content.presentation = {
    version: 1,
    colorScheme: 'dark',
    tokens: {
      '--ui-color-action-primary': 'rgb(48, 186, 120)',
      '--ui-type-ui-family': 'Course Sans, sans-serif',
    },
    fonts: [
      {
        family: 'Course Sans',
        weight: '100 900',
        style: 'normal',
        unicodeRange: '',
        file: { path, size: bytes.length, hash: digest, mime: 'font/woff2' },
      },
    ],
    licenses: [],
  };
  const first = buildLearningPackage(compiled, 'static');
  assert.deepEqual(first, buildLearningPackage(compiled, 'static'));
  const files = unzipSync(first);
  assert.deepEqual(files[path], bytes);
  assert.match(strFromU8(files['player.css']!), /@font-face/);
  const variant = unzipSync(buildLearningPackage(compiled, 'scorm12'));
  assert.deepEqual(files['content.json'], variant['content.json']);
  assert.deepEqual(files['player.css'], variant['player.css']);
  compiled.content.presentation.tokens['--ui-color-action-primary'] =
    'red;}body{background:url(https://invalid.test)';
  assert.throws(() => buildLearningPackage(compiled, 'static'), /Invalid course presentation/);
  compiled.content.presentation.tokens['--ui-color-action-primary'] = '#30ba78';
  compiled.content.presentation.fonts[0]!.file.path = 'https://invalid.test/font.woff2';
  assert.throws(() => buildLearningPackage(compiled, 'static'));
  compiled.content.presentation.fonts[0]!.file.path = path;
  delete compiled.files[path];
  assert.throws(() => buildLearningPackage(compiled, 'static'), /Missing or changed presentation/);
});
