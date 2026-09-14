// SPDX-License-Identifier: MPL-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settingsRoute } from './settings-route.ts';
import { DASH_SECTIONS, dashHref } from '../lib/dashboard-registry.ts';

test('Settings starts with preferences and preserves focused controls', () => {
  for (const params of ['', 'tab=preferences', 'lang=de', 'tab=unknown', 'focus=storage-section', 'focus=use-details&tab=brand']) {
    assert.deepEqual(settingsRoute(params), { name: 'profile', params });
  }
});

test('every dashboard destination is reachable inside Settings', () => {
  for (const section of DASH_SECTIONS) {
    const href = dashHref(section);
    assert.ok(href.startsWith('#/settings?'));
    const params = href.split('?')[1]!;
    assert.deepEqual(settingsRoute(params), { name: 'dashboard', params }, section.id);
    for (const flag of section.flag.split(' ').filter(Boolean)) {
      assert.equal(settingsRoute(flag).name, 'dashboard', flag);
    }
  }
});
