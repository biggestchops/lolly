// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isHiddenSlot } from './batch-slots.ts';
import { CHECKPOINTS_KEY } from './design-system/studio-state.ts';

test('brand import checkpoints stay out of saved-work lists without hiding designs', () => {
  assert.equal(isHiddenSlot(CHECKPOINTS_KEY), true);
  assert.equal(isHiddenSlot('design:journey-announcement'), false);
  assert.equal(isHiddenSlot('__batch__:journey'), false);
  assert.equal(isHiddenSlot(undefined), false);
});
