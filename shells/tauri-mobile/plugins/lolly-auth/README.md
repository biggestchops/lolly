# lolly-auth

A small in-repo Tauri 2 mobile plugin with two commands:

- `authenticate` runs a provider sign-in in the system browser sheet and
  returns the callback URL (plans/138 Tier D, WP-M1.2). It replaces the desktop
  loopback listener, which cannot work on a phone.
  - iOS: `ASWebAuthenticationSession`
  - Android: an Auth Tab when the browser supports one, otherwise a Custom Tab
- `google_authorize` asks Google Play services for a Google access token on
  Android (WP-M1.4). Google Drive sync on Android uses it, because Google does
  not accept custom URI schemes for Android OAuth clients. iOS reaches Google
  through `authenticate` instead.

On desktop the crate compiles, but both commands refuse to run.

For `authenticate`, PKCE, the `state` check and the token exchange stay in the
web code (`shells/web/src/lib/provider-auth.ts`, `mobileVia`). This plugin only
opens the page and hands back the address the provider redirected to.

Only one sign-in sheet or consent screen is open at a time: the two commands
share one busy flag in Rust and one session in the Android plugin, and a call
made while another is open rejects with `Another sign-in is already open.`

## Wiring

- `shells/tauri-mobile/src-tauri/Cargo.toml`: path dependency on this crate
- `shells/tauri-mobile/src-tauri/src/lib.rs`: `.plugin(tauri_plugin_lolly_auth::init())`
- `shells/tauri-mobile/src-tauri/capabilities/default.json`: `lolly-auth:default`,
  which allows `authenticate` and `google_authorize` and nothing else

The plugin adds no network permission and no Info.plist entry.

## Command: authenticate

```js
const { url } = await invoke('plugin:lolly-auth|authenticate', {
  url,            // provider authorize URL
  callbackScheme, // for example 'tools.lolly.mobile', no colon
  ephemeral,      // boolean
});
```

| Argument | Rule |
|---|---|
| `url` | Must be `https://` followed by a host. No user name or password, no spaces, control characters or backslashes, at most 16 KiB. Anything else is refused before a sheet opens. |
| `callbackScheme` | An RFC 3986 scheme (`ALPHA *( ALPHA / DIGIT / "+" / "-" / "." )`) of at most 128 characters that contains at least one dot. |
| `ephemeral` | iOS: sets `prefersEphemeralWebBrowserSession`, so the sheet does not share the browser's cookies. Android: accepted and ignored. Optional, defaults to `false`. |

Result:

- Resolves `{ url }` with the full callback URL, query and fragment included,
  once the provider redirects to `<callbackScheme>:...`. The Rust side checks
  again that the returned URL uses the requested scheme.
- Rejects with `Sign-in cancelled.` when the person closes the sheet. Callers
  match the word `cancelled`.
- Rejects with a plain sentence for everything else (bad arguments, no browser,
  no window to present from, an unexpected return address).
- One session at a time. A second call while one is open rejects with
  `Another sign-in is already open.` The Rust command and each native class
  both enforce this.

Rejections reach JavaScript as a string.

## How each platform ends a session

### iOS

The session is created on the main queue with
`init(url:callback:completionHandler:)` and `.customScheme(...)` on iOS 17.4 and
later, and with `init(url:callbackURLScheme:completionHandler:)` on iOS 15 to
17.3. The presentation anchor is the web view's window, or else the key window
of the foreground scene. The plugin keeps a strong reference to the session
until the completion handler runs.

- Redirect: the completion handler receives the callback URL.
- Cancelled: the completion handler receives
  `ASWebAuthenticationSessionError.canceledLogin`.
- `start()` returning `false` rejects at once.

### Android

The plugin looks for the default browser that supports Custom Tabs (or else the
first installed one that does) and asks it whether it supports Auth Tab.

- Auth Tab (`androidx.browser` 1.9.0): the intent carries the same extras as
  `AuthTabIntent.launch(launcher, url, scheme)` and goes through Tauri's
  `startActivityForResult`. The browser catches the redirect itself and returns
  it as the activity result. `RESULT_OK` resolves; `RESULT_CANCELED` is
  cancelled; the two verification codes and unknown codes are plain errors. No
  manifest entry is needed, so any valid scheme works here.
- Custom Tab: the redirect arrives as a VIEW intent at `RedirectActivity`,
  declared in this library's manifest (merged into the app) for
  `tools.lolly.mobile`. It hands the URI to the plugin, brings the app's main
  activity back to the front (which closes the tab) and finishes. Before
  opening a Custom Tab, the plugin checks that `RedirectActivity` accepts the
  scheme and refuses otherwise, rather than opening a tab that can never
  return.
- Cancelled: the plugin watches the app activity's own lifecycle. If the
  activity pauses (the tab opened) and later resumes with no answer, the
  session is cancelled after 1.5 seconds for a Custom Tab, or after 3 seconds
  for an Auth Tab (whose result normally arrives before the resume). Tauri's
  plugin `onPause`/`onResume` are not used: they come from
  `ProcessLifecycleOwner`, which delays the pause by 700 ms and reports
  nothing if the tab is closed within that time.
- The activity being destroyed ends the session with an error.

A second redirect scheme can be added at build time with the Gradle property
`lollyAuthExtraScheme` (for example in
`shells/tauri-mobile/src-tauri/gen/android/gradle.properties`). It must be
lower case and contain a dot, and it defaults to `tools.lolly.mobile`, so the
manifest is unchanged unless it is set.

`RedirectActivity` is exported, so another app could send it an address. It is
only used while a session is open and only for the matching scheme, and PKCE
plus the `state` check in the web code mean an address sent by another app
cannot complete a sign-in.

## Command: google_authorize

```js
const { accessToken, grantedScopes } = await invoke('plugin:lolly-auth|google_authorize', {
  scopes,      // for example ['https://www.googleapis.com/auth/drive.file']
  interactive, // boolean: may Google show its account and consent screens?
});
```

| Argument | Rule |
|---|---|
| `scopes` | 1 to 10 values. Each is `openid`, `email`, `profile`, or `https://www.googleapis.com/auth/` followed by letters, digits, `.`, `_`, `-` or `/` (starting with a letter or digit), at most 200 characters. |
| `interactive` | `false`: never show a screen; a request that needs the person rejects with `consent-required`. `true`: show Google's account and consent screens when needed. Optional, defaults to `false`. |

Android only. It calls
`Identity.getAuthorizationClient(activity).authorize(...)` with the requested
scopes and nothing else: no `requestOfflineAccess`, so no server auth code and
no refresh token, because the apps depend on no server other than the storage
the person chooses. Access tokens last about an hour; to get a fresh one, call
again with `interactive: false`, which Google answers without a screen once
the person has approved the scopes.

Result and rejections (messages reach JavaScript as a string; callers match
the word in brackets or `cancelled`):

| Outcome | Message |
|---|---|
| Token issued | resolves `{ accessToken, grantedScopes }` |
| Needs the person and `interactive` is false | `Google access needs the person's approval first (consent-required).` Nothing is launched. |
| Consent screen answered without approval | `Google access was not approved (consent-required).` |
| Consent screen closed | `Google sign-in cancelled.` |
| Play services missing, disabled, updating or too old | `Google Play services is missing or out of date on this device (play-services-unavailable: <reason>).` |
| Build made without Play services | `This build of Lolly has no Google Play services support (play-services-unavailable).` |
| Google does not know the app (`DEVELOPER_ERROR`) | `Google sign-in failed: Google does not recognise this app (...). The Android OAuth client needs ...` |
| Bad scopes | `Google scopes must be 1 to 10 values, ...` (before anything else) |
| Called on iOS or desktop | `Google sign-in through Play services is only available in the Android app.` |
| Anything else | `Google sign-in failed: <status name> (<code>)...` |

How it runs: the plugin first checks
`GoogleApiAvailability.isGooglePlayServicesAvailable`. If the authorize result
has a resolution (Google needs to show an account chooser or a consent
screen), the plugin either rejects (`interactive: false`) or launches the
result's `PendingIntent` through Tauri's `startIntentSenderForResult` and reads
the answer with `getAuthorizationResultFromIntent`. A result with no
resolution resolves at once. An `ApiException` whose status carries a
`ConnectionResult` for a missing or outdated Play services, an
`UnsupportedApiCallException`, or the status codes 2, 3 and 17 map to
`play-services-unavailable`; status 16 (`CANCELED`) maps to cancelled. If the
consent screen comes back with `RESULT_CANCELED`, the answer is cancelled
unless Play services reports a more specific problem. The same
activity-lifecycle check as for Auth Tab ends a session whose consent result
never arrives (3 seconds after the app resumes), and Play services gets 60
seconds to answer before any screen is shown.

### Google Cloud registration

No client id is needed in the code. Google matches the app by package name and
signing certificate, so the Google Cloud project that owns the Drive API
access needs:

- an OAuth client of type Android for the package `tools.lolly.mobile`, with
  the SHA-1 fingerprint of each certificate that signs a build people run: the
  debug keystore (`keytool -list -v -keystore ~/.android/debug.keystore -alias
  androiddebugkey -storepass android`), the release key, and, if the app is
  distributed through Google Play with Play App Signing, the app signing key
  shown in Play Console (App integrity). One Android client per fingerprint.
- the Google Drive API enabled, and the OAuth consent screen listing the
  scopes the app requests.

A build signed with a certificate that is not registered gets the
`DEVELOPER_ERROR` message above.

### Building without Google Play services

Google Play services (`com.google.android.gms:play-services-auth:22.0.0`) is
licensed under the Android Software Development Kit License, not an open
source licence. F-Droid and other builds without Google software can leave it
out with the Gradle property `lollyGooglePlayServices`:

```sh
# one build
./gradlew assembleRelease -PlollyGooglePlayServices=false
# or in shells/tauri-mobile/src-tauri/gen/android/gradle.properties
lollyGooglePlayServices=false
```

It defaults to `true`. With `false`:

- the Play services dependency is not added;
- `android/src/play/java` (`PlayGoogleAuthorizer.kt`, the only code that
  imports Play services) is not compiled;
- the plugin looks the class up by name (`GoogleAuthorizer.kt`), finds
  nothing, and `google_authorize` rejects with `play-services-unavailable`.
  `authenticate` is unaffected.

`consumer-rules.pro` keeps `PlayGoogleAuthorizer` and its interfaces through
R8; in a build without it that rule matches nothing. Any other value than
`true` or `false` fails the build.

## Which redirect each provider uses

| Provider | iOS | Android |
|---|---|---|
| Dropbox | `tools.lolly.mobile:/oauth2redirect` | `tools.lolly.mobile:/oauth2redirect` |
| Microsoft (OneDrive) | `tools.lolly.mobile:/oauth2redirect` | `tools.lolly.mobile:/oauth2redirect` |
| Google (Drive) | the iOS client's reversed client id, for example `com.googleusercontent.apps.1234-abcd:/oauth2redirect` | No redirect: use `google_authorize` (Google Play services). Google no longer accepts custom URI schemes for Android OAuth clients. |

## Files

- `src/lib.rs`: the commands, URL and scheme checks, single-session flag, unit tests
- `src/google.rs`: `google_authorize` arguments, scope checks and result, unit tests
- `src/mobile.rs`: registration of the native classes and the async calls
- `ios/`: Swift package (`LollyAuthPlugin.swift`); no Google code
- `android/`: library module: `LollyAuthPlugin.kt` (both commands),
  `RedirectActivity.kt`, `GoogleAuthorizer.kt` (the interface and the lookup
  by name), `src/play/java/.../PlayGoogleAuthorizer.kt` (Play services, built
  only when `lollyGooglePlayServices` is true), manifest, consumer R8 rules
- `permissions/default.toml`: the default set; `permissions/autogenerated/` and
  `permissions/schemas/` are written by `build.rs`
- `.tauri/`, `android/.tauri/` and `ios/Package.resolved` are written during
  mobile builds and are ignored by git

## Checks

- `cargo check --lib` for the app, on macOS and for `aarch64-apple-ios-sim`
  (the second compiles the Swift package through `build.rs`)
- `cargo test --lib` in this folder (argument and scope checks, return
  checks, single session); cargo only runs these from this folder, so copy
  `../../src-tauri/Cargo.lock` here first to use the app's versions
- `rustfmt --edition 2021 --check build.rs src/lib.rs src/mobile.rs src/google.rs`

## What has run on an Android emulator

On 2026-09-16 the Kotlin half ran on the `lolly36` emulator (Android 16,
API 36, Google APIs image, Chrome 133, Google Play services 25.26.35) inside a
small probe app. The probe was an R8 release build with this module and
tauri-android. It called the plugin through Tauri's own `PluginHandle` and
`Invoke` classes, without the Rust side. Seen there:

- Both argument classes parse after R8, and `PlayGoogleAuthorizer` is found by
  name in a Play services build; bad or too many scopes are refused.
- `googleAuthorize` with no Google account on the device: `interactive: false`
  rejects with `consent-required` without opening anything; `interactive:
  true` opens Google's sign-in screen, and Back returns `Google sign-in
  cancelled.` through the activity result.
- With Play services disabled (`pm disable-user`), `googleAuthorize` rejects
  with `play-services-unavailable: SERVICE_DISABLED`.
- A build made with `-PlollyGooglePlayServices=false` rejects
  `googleAuthorize` with `play-services-unavailable`, has no Play services
  classes, and `authenticate` still completes.
- `authenticate` (Chrome 133 has no Auth Tab, so this was the Custom Tab path):
  the tab opens in the app's own task; a 302 from an https page to the extra
  scheme (`lollyAuthExtraScheme`) resolves with the full address, query and
  fragment included, closes the tab and brings the main activity back through
  `onNewIntent`; closing the tab rejects with `Sign-in cancelled.` 1.5 seconds
  after the app resumes; a redirect sent when no sign-in is open only brings
  the app to the front.
- One session across both commands: `authenticate` during a silent
  `googleAuthorize`, and `googleAuthorize` while a tab is open, both reject
  with `Another sign-in is already open.`

## Unverified

- Nothing has run on iOS, on a physical phone, or inside the real Lolly app
  with the Rust side: no sign-in has been completed through
  `invoke('plugin:lolly-auth|...')`.
- iOS: the presentation anchor lookup and the behaviour when the app is not
  in the foreground at `start()`.
- Android: the Auth Tab path (it needs Chrome 137 or later); the cancel grace
  periods on a slow physical device; browsers other than Chrome, browsers
  that open Custom Tabs in their own task, and a device with no default
  browser set. Chrome 133 also offers "Minimize tab": minimizing counts as
  leaving the sheet, so the sign-in is cancelled, and a redirect that arrives
  later is ignored.
- Android: if the app process ends while the sheet is open, the sign-in is
  lost and the person starts again.
- The Android library has been built only in probe projects with the same
  Gradle, AGP and Kotlin versions as the app, not through
  `tauri android build`.
- `google_authorize`: no token has been issued. Nothing has been checked
  against a registered Android OAuth client, a signed-in Google account, the
  consent screen's result after approval, a device without Play services
  installed at all, or a device whose Play services is too old for
  `play-services-auth` 22.0.0. The `DEVELOPER_ERROR` mapping and the 60 second
  wait have not been triggered.
- `google_authorize`: a token that Google has revoked but Play services still
  holds cannot be cleared through this plugin
  (`AuthorizationClient.clearToken` is not exposed), so a caller that gets
  401 from Drive has no way yet to force a new token.
