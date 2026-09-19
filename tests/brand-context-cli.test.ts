// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { brandContext } from '../engine/src/brand-context.ts';
import { importSystemTokens } from '../shells/cli/src/system.ts';

test('CLI reads downloaded context and checks a composition without changing terminal state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lolly-brand-context-'));
  try {
    const doc = { color: { brand: { $type: 'color', $value: '#CC3322' } } };
    const file = join(dir, 'context.json'), design = join(dir, 'design.json'), output = join(dir, 'check.json');
    await writeFile(file, JSON.stringify(brandContext(doc)));
    await writeFile(design, JSON.stringify({ boxes: [{ id: 'a', kind: 'box', bg: '#ca3020' }] }));
    assert.deepEqual((await importSystemTokens(file)).doc, doc);
    const run = spawnSync(process.execPath, ['shells/cli/bin/lolly.ts', 'system', 'check', design, `--file=${file}`, `--output=${output}`], {
      cwd: new URL('..', import.meta.url), encoding: 'utf8', env: { ...process.env, LOLLY_STATE_DIR: join(dir, 'state') }, timeout: 30_000,
    });
    assert.equal(run.status, 0, run.stderr);
    const report = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(report.findings[0].status, 'review');
    assert.equal(report.findings[0].fix.after, '{color.brand}');
    assert.ok(report.requiresMount.includes('computed contrast'));
    assert.deepEqual(JSON.parse(await readFile(design, 'utf8')).boxes[0].bg, '#ca3020');
    const future = join(dir, 'future.json');
    await writeFile(future, JSON.stringify({ format: 'lolly-design-context', version: 2, tokens: doc }));
    await assert.rejects(importSystemTokens(future), /no readable token document/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
