// SPDX-License-Identifier: MPL-2.0
/**
 * lib/sync-choices.ts (plans/138 Tier D, WP-S5): what each shell may offer as a
 * sync home. These cases are the D.4 table of the plan, row by row, so a change
 * to what a shell can do shows up here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { syncChoicesFor, type ShellFacts, type SyncChoice } from './sync-choices.ts';

const ALL_SYNC = ['s3', 'webdav', 'gdrive', 'dropbox', 'o365'];

function facts(over: Partial<ShellFacts> = {}): ShellFacts {
  return {
    shell: 'web-hosted', mac: false, folderPicker: false,
    connected: new Set(), syncKinds: new Set(ALL_SYNC), mobileSignIn: new Set(), ...over,
  };
}
const states = (list: SyncChoice[]): Record<string, string> =>
  Object.fromEntries(list.map((c) => [c.id, c.state]));

test('hosted web: cloud accounts need set-up, own servers cannot work, a file always works', () => {
  assert.deepEqual(states(syncChoicesFor(facts())), {
    dropbox: 'setup', gdrive: 'setup', o365: 'setup', icloud: 'unavailable',
    webdav: 'unavailable', s3: 'unavailable', folder: 'unavailable', device: 'planned', file: 'ready',
  });
});

test('self-hosted web: own servers need the admin; a Chromium folder picker makes the folder choice planned', () => {
  const list = syncChoicesFor(facts({ shell: 'web-self-hosted', folderPicker: true }));
  assert.equal(states(list).webdav, 'setup');
  assert.equal(states(list).s3, 'setup');
  assert.equal(states(list).folder, 'planned');
  assert.match(list.find((c) => c.id === 's3')!.note, /CORS/);
});

test('desktop app: own servers need set-up; iCloud is planned only on a Mac', () => {
  const linux = states(syncChoicesFor(facts({ shell: 'desktop' })));
  assert.equal(linux.webdav, 'setup');
  assert.equal(linux.icloud, undefined, 'no iCloud row off Apple platforms in the apps');
  assert.equal(linux.folder, 'planned');
  assert.equal(states(syncChoicesFor(facts({ shell: 'desktop', mac: true }))).icloud, 'planned');
});

test('mobile apps: browser sign-in providers are unavailable unless already connected', () => {
  const ios = states(syncChoicesFor(facts({ shell: 'ios', connected: new Set(['gdrive']) })));
  assert.equal(ios.dropbox, 'unavailable');
  assert.equal(ios.o365, 'unavailable');
  assert.equal(ios.gdrive, 'ready');
  assert.equal(ios.icloud, 'planned');
  assert.equal(ios.webdav, 'setup');
  const android = states(syncChoicesFor(facts({ shell: 'android' })));
  assert.equal(android.icloud, undefined);
  assert.equal(android.dropbox, 'unavailable');
});

test('connected providers are ready; a provider without a sync adapter is planned', () => {
  const list = syncChoicesFor(facts({
    connected: new Set(['dropbox', 's3', 'gdrive']),
    syncKinds: new Set(['s3', 'webdav', 'gdrive', 'dropbox']),
  }));
  const s = states(list);
  assert.equal(s.dropbox, 'ready');
  assert.equal(s.s3, 'ready', 'a connection made elsewhere still counts on the hosted site');
  assert.equal(s.o365, 'planned');
  assert.match(list.find((c) => c.id === 'gdrive')!.note, /sign in/, 'browser Drive explains the per-visit sign-in');
});

test('every choice has a label and a note, and only set-up or storage rows carry an action', () => {
  for (const shell of ['web-hosted', 'web-self-hosted', 'desktop', 'ios', 'android'] as const) {
    for (const c of syncChoicesFor(facts({ shell }))) {
      assert.ok(c.label && c.note, `${shell}/${c.id}`);
      if (c.action) assert.ok(c.state === 'setup' || c.action === 'storage', `${shell}/${c.id}`);
    }
  }
});

test('mobile apps: a provider with mobile sign-in ready needs set-up; Google on Android says why not', () => {
  const ios = syncChoicesFor(facts({ shell: 'ios', mobileSignIn: new Set(['dropbox', 'gdrive']) }));
  assert.equal(states(ios).dropbox, 'setup');
  assert.equal(states(ios).gdrive, 'setup');
  assert.equal(states(ios).o365, 'unavailable');
  const android = syncChoicesFor(facts({ shell: 'android', mobileSignIn: new Set(['dropbox']) }));
  assert.equal(states(android).dropbox, 'setup');
  assert.equal(states(android).gdrive, 'unavailable', 'no Android client registered');
  const play = syncChoicesFor(facts({ shell: 'android', mobileSignIn: new Set(['dropbox', 'gdrive']) }));
  assert.equal(states(play).gdrive, 'setup');
  assert.match(play.find((c) => c.id === 'gdrive')!.note, /Google Play services/);
});
