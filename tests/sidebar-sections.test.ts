// SPDX-License-Identifier: MPL-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { globSync, readFileSync } from 'node:fs';
import { hasIcon } from '../shells/web/src/lib/icons.ts';

test('every public tool section names an available sidebar icon', () => {
  const files = globSync(['community/*/tool.json', 'brands/lolly-start/tools/*/tool.json'], { cwd: new URL('../', import.meta.url) });
  assert.ok(files.length >= 60);
  for (const file of files) {
    const manifest = JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')) as {
      id: string; inputs: { section?: string }[]; render?: { sectionIcons?: Record<string, string> };
    };
    for (const section of new Set(manifest.inputs.flatMap(input => input.section ? [input.section] : []))) {
      const glyph = manifest.render?.sectionIcons?.[section];
      assert.ok(glyph && hasIcon(glyph), `${manifest.id}: ${section} needs an icon from the shell registry`);
    }
  }
});
