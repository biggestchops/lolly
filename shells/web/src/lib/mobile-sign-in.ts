// SPDX-License-Identifier: MPL-2.0
/**
 * mobile-sign-in (plans/138 Tier D, WP-M1): which browser-sign-in services can
 * sign in inside the mobile apps. One rule, read by Connected services (to hide
 * rows whose Connect button could only fail) and by the sync choice list.
 *
 * - Dropbox: always, with the build's key when its Dropbox app lists the mobile
 *   redirect, else with the person's own key (lib/dropbox-send.ts).
 * - Google Drive: on iOS with an iOS client id; on Android through Google Play
 *   services once the Android client is registered (lib/google-drive.ts).
 * - OneDrive: with a mobile client id (lib/onedrive-send.ts).
 * - LinkedIn and Mastodon: not yet.
 */

import { driveMobileAvailable } from './google-drive.ts';
import { oneDriveMobileAvailable } from './onedrive-send.ts';

/** Services whose sign-in needs a browser round trip (plans/138 Tier D, H9). */
export const BROWSER_SIGN_IN_KINDS: ReadonlySet<string> = new Set(['gdrive', 'dropbox', 'o365', 'linkedin', 'mastodon']);

/** Can `kind` sign in inside the mobile apps? Meaningful only there. */
export function mobileSignInReady(kind: string): boolean {
  if (kind === 'dropbox') return true;
  if (kind === 'gdrive') return driveMobileAvailable();
  if (kind === 'o365') return oneDriveMobileAvailable();
  return false;
}

/** The kinds that can sign in inside the mobile apps. */
export function mobileSignInKinds(): string[] {
  return [...BROWSER_SIGN_IN_KINDS].filter(mobileSignInReady);
}
