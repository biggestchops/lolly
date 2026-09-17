// SPDX-License-Identifier: MPL-2.0
/**
 * Every studio export path asks the studio for a capture error before it keeps the output.
 *
 * Run with:
 *   node --import ./tests/css-stub.mjs --test shells/web/src/views/tool/exporting-studio.test.ts
 *
 * exporting.ts cannot be imported under plain Node (its import chain reaches
 * bridge/format-support.js), so this pins the source instead: the editor's two capture
 * sites and the batch row export go through withStudioExport (lib/studio-export-guard.ts,
 * whose behaviour studio-export-guard.test.ts covers), and nothing calls prepareToolStudio
 * on its own and then exports without the check.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (path: string) => readFileSync(join(SRC, path), 'utf8');

/** The body of a top-level function, from its declaration to the next top-level declaration. */
function functionBody(source: string, name: string): string {
  const start = source.search(new RegExp(`^export (?:async )?function ${name}\\b`, 'm'));
  assert.ok(start >= 0, `${name} is declared`);
  const rest = source.slice(start + 1);
  const next = rest.search(/^(?:export )?(?:async )?function |^\/\*\*/m);
  return next < 0 ? rest : rest.slice(0, next);
}

test('both editor capture sites export through withStudioExport and prepare at export quality', () => {
  const source = read('views/tool/exporting.ts');
  assert.match(source, /import \{ withStudioExport \} from '\.\.\/\.\.\/lib\/studio-export-guard\.ts';/);
  const body = functionBody(source, 'exportUnscaledRaw');
  const guarded = body.match(
    /return await withStudioExport\(tview\.studioModule, tview\.contentEl, \(\) => fn\(report\), 'export'\);/g
  );
  assert.equal(guarded?.length, 2, 'the full-bleed path and the artboard path are both guarded');
  assert.doesNotMatch(body, /prepareToolStudio/, 'the guard prepares the frame; no bare prepare remains');
  assert.doesNotMatch(body, /return await fn\(report\)/, 'no capture site exports without the check');
  // The load check still runs first: a studio that failed to mount never starts an export.
  assert.ok(body.indexOf('if (tview.studioError) throw tview.studioError;') < body.indexOf('withStudioExport('));
});

test('the batch row export checks the studio it mounted, without a second prepare', () => {
  const source = read('pro/render-export.ts');
  assert.match(source, /import \{ type StudioExportHooks, withStudioExport \} from '\.\.\/lib\/studio-export-guard\.ts';/);
  const body = functionBody(source, 'renderRowToBlob');
  assert.match(
    body,
    /const blob = await withStudioExport\(mounted\.studio, canvas, \(\) => runtime\.export\(target, fmt, exportOpts\)\);/
  );
  assert.doesNotMatch(body, /await runtime\.export\(/, 'every export in the row goes through the check');
  assert.doesNotMatch(body, /prepareToolStudio/);
  // mountToolCanvas hands back the module it mounted the scene with, after its own prepare.
  assert.match(source, /mountedStudio = studio;/);
  assert.match(source, /return \{ stage, canvas, studio: mountedStudio \};/);
});

test('paged batch exports are checked the same way', () => {
  const body = functionBody(read('pro/render-export.ts'), 'renderToolPages');
  assert.match(body, /await withStudioExport\(mounted\.studio, canvas, \(\) => runtime\.export\(el, /);
  assert.doesNotMatch(body, /pages\.push\(await runtime\.export\(/);
});
