// SPDX-License-Identifier: MPL-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIconSprite } from '../docs/icon-sprite.ts';

test('shared glyphs retain viewBox, paint and accessibility attributes without repeating paths', () => {
  const icons = { arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="M2 12h20"/></svg>' };
  const sprite = createIconSprite(icons);
  assert.match(sprite.svg, /<symbol id="arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor"/);
  assert.match(sprite.icon('arrow')!, /viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"/);
  assert.ok(sprite.icon('arrow')!.includes(`/info/${sprite.filename}#arrow`));
  assert.ok(!sprite.icon('arrow')!.includes('<path'));
  assert.equal(createIconSprite(icons).filename, sprite.filename);
  assert.notEqual(createIconSprite({ arrow: icons.arrow.replace('h20', 'h18') }).filename, sprite.filename);
});

test('glyphs with scoped definitions stay inline and missing names stay missing', () => {
  const svg = '<svg viewBox="0 0 24 24"><defs><clipPath id="cut"><circle r="2"/></clipPath></defs><path clip-path="url(#cut)"/></svg>';
  const sprite = createIconSprite({ artwork: svg });
  assert.equal(sprite.icon('artwork'), svg);
  assert.equal(sprite.icon('absent'), undefined);
  assert.ok(!sprite.svg.includes('clipPath'));
});
