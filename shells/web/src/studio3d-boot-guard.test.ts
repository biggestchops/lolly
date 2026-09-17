// SPDX-License-Identifier: MPL-2.0
/**
 * Opening a light tool never loads three.js or the 3D studio.
 *
 * Run with:
 *   node --import ./tests/css-stub.mjs --test shells/web/src/studio3d-boot-guard.test.ts
 *
 * The studio is loaded with import() where a template asks for it (views/tool/render.ts,
 * pro/render-export.ts, views/multi-edit.ts). This walks the static import graph, relative
 * imports only, skipping import() and type-only imports, from the web entry (main.ts) and
 * from the tool view every tool opens (views/tool.ts), and fails if any module on either
 * walk imports `three`, a `three/` subpath, or anything under lib/studio3d/.
 *
 * If this fails: move the import behind `await import()` at its use site, or import the
 * piece you need from a module outside lib/studio3d/ that does not import three (as
 * lib/studio-export-guard.ts does for exports).
 *
 * The extractor is a copy of the one in boot-path-guard.test.ts; importing that file would
 * register its tests a second time.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SRC = dirname(fileURLToPath(import.meta.url));
const STUDIO_DIR = join(SRC, 'lib', 'studio3d') + sep;

/** Static, value-level import specifiers of one module (type-only and dynamic imports excluded). */
function staticImports(source: string): string[] {
  const out: string[] = [];
  // Strip comments so a commented-out import is not a use.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');
  const re = /^\s*(import|export)\s+(type\s+)?([^;'"]*?\s+from\s+)?['"]([^'"]+)['"]/gm;
  for (const m of code.matchAll(re)) {
    if (m[2]) continue; // import type / export type
    const clause = m[3] ?? '';
    // `import { type A, type B } from` is type-only in effect; a mixed clause is a value import.
    if (m[1] === 'import' && clause && /^\{[^}]*\}\s+from\s+$/.test(clause)) {
      const names = clause.replace(/^\{|\}\s+from\s+$/g, '').split(',').map((n) => n.trim()).filter(Boolean);
      if (names.length && names.every((n) => n.startsWith('type '))) continue;
    }
    if (m[1] === 'export' && !clause) continue; // `export 'x'` is not a thing; guard anyway
    out.push(m[4]!);
  }
  return out;
}

function resolveRelative(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(from), spec);
  const candidates = [base, base.replace(/\.js$/, '.ts'), `${base}.ts`, join(base, 'index.ts')];
  for (const c of candidates) if (existsSync(c) && /\.ts$/.test(c)) return c;
  return null;
}

interface Offender {
  file: string;
  spec: string;
}

/**
 * Every module reachable by static imports from `entry` under `root`, and each import of
 * three or of lib/studio3d/ found on the way. A module under lib/studio3d/ is reported and
 * not walked into.
 */
function walkStudioFree(
  entry: string,
  root = SRC,
  studioDir = STUDIO_DIR
): { modules: string[]; offenders: Offender[] } {
  const seen = new Set<string>();
  const offenders: Offender[] = [];
  const queue = [entry];
  const name = (file: string) => file.slice(root.length + 1);
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of staticImports(readFileSync(file, 'utf8'))) {
      if (/\.(css|scss|svg|png|json)(\?.*)?$/.test(spec)) continue;
      if (spec === 'three' || spec.startsWith('three/')) {
        offenders.push({ file: name(file), spec });
        continue;
      }
      const next = resolveRelative(file, spec);
      if (next?.startsWith(studioDir)) {
        offenders.push({ file: name(file), spec });
        continue;
      }
      if (next?.startsWith(root)) queue.push(next);
    }
  }
  return { modules: [...seen].map(name).sort(), offenders };
}

for (const entry of ['main.ts', join('views', 'tool.ts')]) {
  test(`the static import graph from ${entry} reaches neither three nor lib/studio3d/`, () => {
    const { modules, offenders } = walkStudioFree(join(SRC, entry));
    assert.ok(modules.length > 20, `the walk found ${modules.length} modules; did the entry or the resolver move?`);
    assert.deepEqual(
      offenders.map((o) => `${o.file} imports ${o.spec}`),
      [],
      'a static import loads the 3D studio for every tool; make it an import() at the use site'
    );
  });
}

test('the walk reports a module that statically imports the studio mount, and one that imports three', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-boot-guard-'));
  try {
    const studioDir = join(root, 'lib', 'studio3d') + sep;
    const write = (path: string, source: string) => {
      const file = join(root, path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, source);
    };
    write('lib/studio3d/mount.ts', "import * as THREE from 'three';\nexport const mount = THREE;\n");
    write('lib/studio-export-guard.ts', 'export const guard = 1;\n');
    write('views/tool.ts', "import { guard } from '../lib/studio-export-guard.ts';\nimport { panel } from './panel.ts';\nexport const lazy = () => import('../lib/studio3d/mount.ts');\nexport { guard, panel };\n");
    write('views/panel.ts', "import type { mount } from '../lib/studio3d/mount.ts';\nimport { mount as live } from '../lib/studio3d/mount.ts';\nexport const panel: typeof mount = live;\n");
    write('views/scene.ts', "import { Vector3 } from 'three/src/math/Vector3.js';\nexport const scene = new Vector3();\n");
    const walked = walkStudioFree(join(root, 'views', 'tool.ts'), root, studioDir);
    assert.deepEqual(walked.offenders, [{ file: join('views', 'panel.ts'), spec: '../lib/studio3d/mount.ts' }]);
    assert.ok(!walked.modules.includes(join('lib', 'studio3d', 'mount.ts')), 'the studio itself is not walked into');
    assert.ok(walked.modules.includes(join('lib', 'studio-export-guard.ts')));
    const three = walkStudioFree(join(root, 'views', 'scene.ts'), root, studioDir);
    assert.deepEqual(three.offenders, [{ file: join('views', 'scene.ts'), spec: 'three/src/math/Vector3.js' }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
