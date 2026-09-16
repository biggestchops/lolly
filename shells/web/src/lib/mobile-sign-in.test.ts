// SPDX-License-Identifier: MPL-2.0
/**
 * plans/138 Tier D, M1.3: the mobile apps cannot finish a browser sign-in yet.
 * isTauriMobileShell() tells the mobile app apart from the desktop app and the
 * browser, and the loopback leg refuses at once there with a readable sentence
 * (a test transport still works, so the leg's own contract tests are unaffected).
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { isTauriShell, isTauriMobileShell } from './instance-choice.ts';
import { loopbackVia, mobileVia, MOBILE_REDIRECT_URI } from './provider-auth.ts';
import { driveMobileAvailable, reversedClientScheme, setDriveIosClientId } from './google-drive.ts';
import { oneDriveMobileAvailable, setOneDriveMobileClientId } from './onedrive-send.ts';
import { mobileSignInKinds } from './mobile-sign-in.ts';

const realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

function pretend(tauri: boolean, userAgent: string, maxTouchPoints = 0): void {
  (globalThis as { window?: unknown }).window = tauri ? { __TAURI_INTERNALS__: { invoke: () => {} } } : {};
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent, maxTouchPoints }, configurable: true });
}

afterEach(() => {
  setDriveIosClientId(null);
  setOneDriveMobileClientId(null);
  delete (globalThis as { window?: unknown }).window;
  if (realNavigator) Object.defineProperty(globalThis, 'navigator', realNavigator);
});

test('the mobile app is told apart from the desktop app and the browser', () => {
  pretend(true, 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15');
  assert.equal(isTauriMobileShell(), true);
  pretend(true, 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36');
  assert.equal(isTauriMobileShell(), true);
  pretend(true, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', 5);
  assert.equal(isTauriMobileShell(), true, 'an iPad reports a Mac user agent with touch');
  pretend(true, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', 0);
  assert.equal(isTauriShell(), true);
  assert.equal(isTauriMobileShell(), false, 'the Mac desktop app');
  pretend(false, 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)');
  assert.equal(isTauriMobileShell(), false, 'Safari on a phone is the web app');
});

test('the loopback sign-in refuses at once in the mobile app', async () => {
  pretend(true, 'Mozilla/5.0 (Linux; Android 15) Mobile');
  await assert.rejects(() => loopbackVia(), /mobile app/);
  // An injected transport (the leg's own tests) is not blocked.
  const via = await loopbackVia({ invoke: async <T>() => 4242 as T });
  assert.match(via.redirectUri, /:4242\/oauth-return$/);
});

test('the mobile leg asks the plugin and reads the code from the callback URL', async () => {
  const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
  const via = mobileVia({}, {
    invoke: async <T>(cmd: string, args?: Record<string, unknown>) => {
      calls.push({ cmd, args });
      return { url: 'tools.lolly.mobile:/oauth2redirect?code=abc&state=s1' } as T;
    },
  });
  assert.equal(via.redirectUri, MOBILE_REDIRECT_URI);
  assert.equal(MOBILE_REDIRECT_URI, 'tools.lolly.mobile:/oauth2redirect', 'the value to register with each provider');
  const back = await via.run('https://www.dropbox.com/oauth2/authorize?x=1');
  assert.deepEqual(calls, [{ cmd: 'plugin:lolly-auth|authenticate',
    args: { url: 'https://www.dropbox.com/oauth2/authorize?x=1', callbackScheme: 'tools.lolly.mobile', ephemeral: false } }]);
  assert.equal(new URLSearchParams(back.search).get('code'), 'abc');
});

test('the mobile leg: a closed sheet reads as cancelled; a foreign callback is refused', async () => {
  const closed = mobileVia({}, { invoke: async () => { throw new Error('sign-in cancelled'); } });
  await assert.rejects(() => closed.run('https://x.example'), /cancelled/);
  const elsewhere = mobileVia({}, { invoke: async <T>() => ({ url: 'https://evil.example/?code=1' }) as T });
  await assert.rejects(() => elsewhere.run('https://x.example'), /did not come back/);
  const google = mobileVia({ scheme: 'com.googleusercontent.apps.123-abc' },
    { invoke: async <T>() => ({ url: 'com.googleusercontent.apps.123-abc:/oauth2redirect?code=g&state=s' }) as T });
  assert.equal(google.redirectUri, 'com.googleusercontent.apps.123-abc:/oauth2redirect');
  assert.equal(new URLSearchParams((await google.run('https://accounts.google.com')).search).get('code'), 'g');
});

test('Google Drive signs in on iOS with an iOS client, never on Android', () => {
  assert.equal(reversedClientScheme('123-abc.apps.googleusercontent.com'), 'com.googleusercontent.apps.123-abc');
  pretend(true, 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)');
  assert.equal(driveMobileAvailable(), false, 'no iOS client id');
  setDriveIosClientId('123-abc.apps.googleusercontent.com');
  assert.equal(driveMobileAvailable(), true);
  pretend(true, 'Mozilla/5.0 (Linux; Android 15) Mobile');
  assert.equal(driveMobileAvailable(), false, 'Google refuses this sign-in for Android apps');
});

test('the mobile sign-in list follows the configured clients', () => {
  pretend(true, 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)');
  assert.deepEqual(mobileSignInKinds(), ['dropbox'], 'Dropbox always (own key); nothing else without client ids');
  setDriveIosClientId('1-a.apps.googleusercontent.com');
  setOneDriveMobileClientId('00000000-0000-0000-0000-000000000000');
  assert.equal(oneDriveMobileAvailable(), true);
  assert.deepEqual(mobileSignInKinds().sort(), ['dropbox', 'gdrive', 'o365']);
});
