// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockHost } from '@lolly-tools/core';
import { createNodeHookExecutor } from '@lolly-tools/node-shell/hook-worker';
import {
  compileSessionTool,
  type SessionToolSource,
} from '../engine/src/design-tool/session-compiler.ts';
import { loadTool } from '../engine/src/loader.ts';
import { createRuntime } from '../engine/src/runtime.ts';
import { buildInputModel } from '../engine/src/inputs.ts';
import { newSessionToolDraft, sessionField } from '../shells/web/src/lib/session-tool-draft.ts';
import { rulesCopySeed } from '../shells/web/src/lib/rules-launch.ts';

function fixture() {
  const manifest: SessionToolSource['manifest'] = {
    id: 'fixture-source',
    name: 'Source',
    status: 'community',
    version: '1.0.0',
    engineVersion: '^1.0.0',
    render: { width: 600, height: 400, formats: ['png', 'svg', 'pdf'] },
    inputs: [
      { id: 'heading', type: 'text', label: 'Heading', default: 'Welcome', maxLength: 80 },
      { id: 'size', type: 'number', label: 'Size', default: 24, min: 12, max: 48, step: 2 },
      { id: 'ink', type: 'color', default: '#123456' },
      { id: 'enabled', type: 'boolean', default: true },
    ],
    hooks: { onInit: true, onInput: true, beforeExport: true },
  };
  const model = buildInputModel(manifest);
  const draft = newSessionToolDraft(manifest, 'Reusable card', { width: 600, height: 400 });
  for (const index of [0, 1, 3]) {
    const field = sessionField(manifest.inputs[index]!, model[index]!, index);
    draft.inputs.push(field);
    draft.sourceTool!.inputs[field.input.id] = manifest.inputs[index]!.id;
  }
  const source: SessionToolSource = {
    manifest,
    model,
    template:
      '<div style="color:{{ink}};font-size:{{size}}px">{{heading}} {{computed}} {{enabled}}</div>',
    styles: '',
    css: '',
    assets: {},
    tokens: {
      entries: [{ path: 'color.primary', type: 'color', value: '#123456' }],
      colors: [],
      themes: [],
      active: null,
    },
    dependencies: [],
    hooks: `function onInit(ctx){return onInput(ctx)}
function onInput({model}){var values=Object.fromEntries(model.map(i=>[i.id,i.value]));if(values.heading==='bad')throw new Error('Source rejected that heading');return {computed:values.heading.toUpperCase()};}
function beforeExport({format,opts}){if(format==='png')opts.background='transparent';}`,
  };
  return { draft, source };
}

async function mount(sourceOverride?: (source: SessionToolSource) => void) {
  const { draft, source } = fixture();
  sourceOverride?.(source);
  const compiled = compileSessionTool(draft, source);
  const tool = await loadTool(
    draft.id,
    async (path) => String(compiled.files[path.slice(draft.id.length + 1)] || ''),
    { trustClass: 'sideloaded-consented' }
  );
  const host = createMockHost();
  const exported: unknown[] = [];
  host.export.checkLayout = async () => ({ ok: true, issues: [] });
  host.export.render = async (_node, _format, options) => {
    exported.push(options);
    return new Blob(['rendered']);
  };
  const runtime = await createRuntime(
    tool,
    host,
    {},
    { hookExecutor: createNodeHookExecutor({ strict: true }) }
  );
  return { runtime, compiled, exported };
}

test('a session tool retains source rendering in a strict worker and exposes only selected inputs', async () => {
  const { runtime, compiled, exported } = await mount();
  try {
    assert.deepEqual(runtime.hookErrors, []);
    assert.deepEqual(
      runtime.getModel().map((i) => i.id),
      ['editable_1', 'editable_2', 'editable_4']
    );
    assert.match(runtime.getHydrated(), /color:#123456;font-size:24px.*Welcome WELCOME true/);
    await runtime.setInput('editable_1', 'Alice');
    await runtime.setInput('editable_4', false);
    assert.match(runtime.getHydrated(), /Alice ALICE false/);
    await assert.rejects(runtime.setInput('ink', '#ffffff'), /fixed by the designer/);
    await assert.rejects(runtime.applyPatch({ heading: 'Override' }), /fixed by the designer/);
    await runtime.setInput('editable_1', 'Alice');
    await runtime.export({}, 'png');
    assert.equal((exported[0] as { background: string }).background, 'transparent');
    assert.deepEqual(compiled.manifest.hooks, { onInit: true, onInput: true });
    assert.equal(compiled.manifest.designTool!.sourceTool!.id, 'fixture-source');
  } finally {
    runtime.destroy();
  }
});

test('source errors block export and a valid edit recovers', async () => {
  const { runtime } = await mount();
  try {
    await runtime.setInput('editable_1', 'bad');
    await assert.rejects(runtime.export({}, 'svg'), /Source rejected that heading/);
    await runtime.setInput('editable_1', 'Good');
    await runtime.export({}, 'svg');
    await assert.rejects(runtime.setInput('editable_2', 25), /steps of 2/);
    await assert.rejects(runtime.export({}, 'png'), /steps of 2/);
  } finally {
    runtime.destroy();
  }
});

test('DOM export hooks and missing source dependencies fail visibly on the first render', async () => {
  for (const hooks of [
    'function beforeExport({node}){node.style.background="red";}',
    'async function onInit(){try{await host.assets.get("missing")}catch{}}',
    'async function onInit(){await host.profile.get()}',
    'async function onInit(){await host.state.load("secret")}',
  ]) {
    const { runtime } = await mount((source) => {
      source.hooks = hooks;
    });
    try {
      assert.match(runtime.getHydrated(), /data-source-tool-error/);
      await assert.rejects(runtime.export({}, 'png'), /export|dependency|canvas/i);
    } finally {
      runtime.destroy();
    }
  }
});

test('source limits may tighten but cannot be broadened or change numeric step alignment', () => {
  for (const change of [
    (d: ReturnType<typeof fixture>['draft']) => {
      d.inputs[0]!.input.maxLength = 81;
    },
    (d: ReturnType<typeof fixture>['draft']) => {
      d.inputs[1]!.input.min = 10;
    },
    (d: ReturnType<typeof fixture>['draft']) => {
      d.inputs[1]!.input.step = 3;
    },
  ]) {
    const { draft, source } = fixture();
    change(draft);
    assert.throws(() => compileSessionTool(draft, source), /source/);
  }
  const { draft, source } = fixture();
  draft.inputs[0]!.input.maxLength = 40;
  draft.inputs[1]!.input.min = 20;
  assert.doesNotThrow(() => compileSessionTool(draft, source));
  source.manifest.hooks!.exportFile = true;
  assert.throws(() => compileSessionTool(draft, source), /custom export/);
});

test('the authoring handoff preserves original data and gives copied rules a new publication identity', () => {
  const { draft } = fixture();
  const source = {
    heading: 'Saved',
    __label: 'Original',
    __slot: 'slot',
    __designTool: draft,
    __designPublication: { version: '2.0.0' },
    __export_width: 600,
  };
  const before = structuredClone(source);
  const seed = rulesCopySeed(source, 'New tool');
  assert.deepEqual(source, before);
  assert.equal(seed.__slot, undefined);
  assert.equal(seed.__designPublication, undefined);
  assert.equal(seed.__export_width, 600);
  assert.notEqual((seed.__designTool as typeof draft).id, draft.id);
  assert.equal((seed.__designTool as typeof draft).name, 'New tool');
});
