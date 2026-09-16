# lolly-auth

A small in-repo Tauri 2 mobile plugin that runs a provider sign-in in the
system browser sheet and returns the callback URL (plans/138 Tier D, WP-M1.2).
It replaces the desktop loopback listener, which cannot work on a phone.

- iOS: `ASWebAuthenticationSession`
- Android: an Auth Tab when the browser supports one, otherwise a Custom Tab
- Desktop: the crate compiles, but the command refuses to run

PKCE, the `state` check and the token exchange stay in the web code
(`shells/web/src/lib/provider-auth.ts`, `mobileVia`). This plugin only opens
the page and hands back the address the provider redirected to.

## Wiring

- `shells/tauri-mobile/src-tauri/Cargo.toml`: path dependency on this crate
- `shells/tauri-mobile/src-tauri/src/lib.rs`: `.plugin(tauri_plugin_lolly_auth::init())`
- `shells/tauri-mobile/src-tauri/capabilities/default.json`: `lolly-auth:default`,
  which allows `authenticate` and nothing else

The plugin adds no network permission and no Info.plist entry.

## Command

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

## Which redirect each provider uses

| Provider | iOS | Android |
|---|---|---|
| Dropbox | `tools.lolly.mobile:/oauth2redirect` | `tools.lolly.mobile:/oauth2redirect` |
| Microsoft (OneDrive) | `tools.lolly.mobile:/oauth2redirect` | `tools.lolly.mobile:/oauth2redirect` |
| Google (Drive) | the iOS client's reversed client id, for example `com.googleusercontent.apps.1234-abcd:/oauth2redirect` | Not supported by this plugin. Google no longer accepts custom URI schemes for Android OAuth clients. |

## Files

- `src/lib.rs`: the command, argument checks, single-session flag, unit tests
- `src/mobile.rs`: registration of the native classes and the async call
- `ios/`: Swift package (`LollyAuthPlugin.swift`)
- `android/`: library module (`LollyAuthPlugin.kt`, `RedirectActivity.kt`,
  manifest, consumer R8 rules)
- `permissions/default.toml`: the default set; `permissions/autogenerated/` and
  `permissions/schemas/` are written by `build.rs`
- `.tauri/`, `android/.tauri/` and `ios/Package.resolved` are written during
  mobile builds and are ignored by git

## Checks

- `cargo check --lib` for the app, on macOS and for `aarch64-apple-ios-sim`
  (the second compiles the Swift package through `build.rs`)
- `cargo test --lib` in this folder (argument checks, return check, single
  session); cargo only runs these from this folder, so copy
  `../../src-tauri/Cargo.lock` here first to use the app's versions
- `rustfmt --edition 2021 --check build.rs src/lib.rs src/mobile.rs`

## Unverified

- Nothing here has run on a phone or a simulator: no sign-in has been
  completed, cancelled or refused on iOS or Android.
- iOS: the presentation anchor lookup and the behaviour when the app is not
  in the foreground at `start()`.
- Android: the Auth Tab result codes as a real Chrome returns them; the Custom
  Tab return path (the redirect reaching `RedirectActivity`, the tab closing,
  the main activity resuming through `onNewIntent`); the cancel grace periods
  on a slow device; browsers that open Custom Tabs in their own task;
  behaviour with no default browser set.
- Android: if the app process ends while the sheet is open, the sign-in is
  lost and the person starts again.
- The Android library has been compiled only in a separate probe project with
  the same Gradle, AGP and Kotlin versions as the app, not through
  `tauri android build`.
