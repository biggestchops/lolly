// SPDX-License-Identifier: MPL-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyManifestI18n } from '../engine/src/loader.ts';
import type { ToolManifest } from '../engine/src/loader.ts';

test('localized section captions retain their icons and density, including partial overlays', () => {
  const manifest = {
    id: 'sections', name: 'Sections', status: 'community', version: '1.0.0', engineVersion: '^1.0.0',
    inputs: [
      { id: 'a', type: 'text', section: 'Text' },
      { id: 'b', type: 'text', section: 'Text' },
      { id: 'c', type: 'color', section: 'Colour' },
    ],
    render: { formats: ['svg'], width: 100, height: 100, sectionIcons: { Text: 'font', Colour: 'palette' }, denseSections: ['Text'] },
  } as ToolManifest;
  const overlay = { 'inputs.a.section': 'Texte', 'inputs.c.section': 'Couleur' };
  applyManifestI18n(manifest, overlay);
  applyManifestI18n(manifest, overlay);
  assert.deepEqual(manifest.inputs.map(input => input.section), ['Texte', 'Text', 'Couleur']);
  assert.deepEqual(manifest.render.sectionIcons, { Text: 'font', Texte: 'font', Colour: 'palette', Couleur: 'palette' });
  assert.deepEqual(manifest.render.denseSections, ['Text', 'Texte']);
});
