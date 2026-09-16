// SPDX-License-Identifier: MPL-2.0

//! System browser sign-in for the Lolly mobile app (plans/138 Tier D, WP-M1.2).
//!
//! One command, `plugin:lolly-auth|authenticate`, opens a provider's authorize
//! page in the platform sign-in sheet and resolves with the full callback URL
//! once the provider redirects to the app's own URI scheme. iOS uses
//! ASWebAuthenticationSession; Android uses an Auth Tab when the browser
//! supports one and a Custom Tab otherwise. This replaces the desktop loopback
//! listener, which cannot work on a phone.
//!
//! A second command, `plugin:lolly-auth|google_authorize`, asks Google Play
//! services for a Google access token on Android (WP-M1.4). It refuses to run
//! on iOS, which uses `authenticate` for Google, and on desktop.
//!
//! Both commands share one busy flag, so only one sign-in sheet or consent
//! screen is open at a time.
//!
//! The desktop build compiles so the crate can be checked on any machine, but
//! the commands refuse to run there: the desktop shell has its own flow.

use std::marker::PhantomData;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Manager, Runtime, State, Url,
};

mod google;
#[cfg(mobile)]
mod mobile;

pub use google::GoogleAuthorization;
use google::GoogleAuthorizeRequest;

/// The native sheet was closed without a redirect. The web caller matches the
/// word "cancelled", so keep it in this sentence.
pub const CANCELLED: &str = "Sign-in cancelled.";
const BUSY: &str = "Another sign-in is already open.";
#[cfg(not(mobile))]
const DESKTOP_ONLY: &str = "The system sign-in sheet is only available in the Lolly mobile app.";
const BAD_URL: &str = "The sign-in address must be an https URL.";
const BAD_SCHEME: &str =
    "The callback scheme must be a URI scheme with at least one dot, such as tools.lolly.mobile.";
#[cfg_attr(not(mobile), allow(dead_code))]
const WRONG_RETURN: &str = "The sign-in returned to an unexpected address.";

/// Authorize URLs with PKCE and a scope list stay far below this.
const MAX_URL_BYTES: usize = 16 * 1024;
const MAX_SCHEME_BYTES: usize = 128;

/// What the native side receives. Field names match the JS contract.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthenticateRequest {
    url: String,
    callback_scheme: String,
    ephemeral: bool,
}

impl AuthenticateRequest {
    fn new(url: String, callback_scheme: String, ephemeral: bool) -> Result<Self, String> {
        if !is_https_url(&url) {
            return Err(BAD_URL.into());
        }
        if !is_callback_scheme(&callback_scheme) {
            return Err(BAD_SCHEME.into());
        }
        Ok(Self {
            url,
            callback_scheme,
            ephemeral,
        })
    }
}

/// What the command resolves with: `{ url }`, the callback URL exactly as the
/// provider sent it, query and fragment included.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuthenticateResponse {
    pub url: String,
}

/// An absolute https URL with a host and no user name or password.
///
/// The WHATWG parser behind `Url` forgives input that the iOS and Android
/// parsers read differently (`https:///host`, `https:\\host`, surrounding
/// spaces), so the raw text must already be in the plain form: a literal
/// `https://` followed by the host, with no spaces, control characters or
/// backslashes anywhere.
fn is_https_url(raw: &str) -> bool {
    if raw.is_empty() || raw.len() > MAX_URL_BYTES {
        return false;
    }
    let plain_prefix = raw
        .get(..8)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("https://"));
    if !plain_prefix || raw[8..].starts_with('/') {
        return false;
    }
    if raw
        .bytes()
        .any(|b| b.is_ascii_control() || b == b' ' || b == b'\\')
    {
        return false;
    }
    match Url::parse(raw) {
        Ok(url) => {
            url.scheme() == "https"
                && url.host_str().is_some_and(|host| !host.is_empty())
                && url.username().is_empty()
                && url.password().is_none()
        }
        Err(_) => false,
    }
}

/// RFC 3986 section 3.1: `ALPHA *( ALPHA / DIGIT / "+" / "-" / "." )`, given
/// without the trailing colon. At least one dot is required, so the value is a
/// reverse domain name (RFC 8252 section 7.1) and can never be `https`,
/// `javascript` or another scheme the web view already handles.
fn is_callback_scheme(scheme: &str) -> bool {
    let bytes = scheme.as_bytes();
    if bytes.is_empty() || bytes.len() > MAX_SCHEME_BYTES {
        return false;
    }
    if !bytes[0].is_ascii_alphabetic() {
        return false;
    }
    let allowed = |b: &u8| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'-' | b'.');
    bytes.iter().all(allowed) && bytes.contains(&b'.')
}

/// The returned URL must use the callback scheme the caller asked for.
#[cfg_attr(not(mobile), allow(dead_code))]
fn check_return(
    response: AuthenticateResponse,
    scheme: &str,
) -> Result<AuthenticateResponse, String> {
    match Url::parse(&response.url) {
        Ok(url) if url.scheme().eq_ignore_ascii_case(scheme) => Ok(response),
        _ => Err(WRONG_RETURN.into()),
    }
}

/// Plugin state: the single-session flag and, on a phone, the native handle.
pub struct LollyAuth<R: Runtime> {
    busy: AtomicBool,
    #[cfg(mobile)]
    handle: tauri::plugin::PluginHandle<R>,
    _runtime: PhantomData<fn() -> R>,
}

/// Clears the busy flag when the command finishes, whichever way it ends.
struct SessionClaim<'a>(&'a AtomicBool);

impl Drop for SessionClaim<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

impl<R: Runtime> LollyAuth<R> {
    fn claim(&self) -> Result<SessionClaim<'_>, String> {
        claim_flag(&self.busy)
    }

    #[cfg(mobile)]
    async fn run(&self, request: &AuthenticateRequest) -> Result<AuthenticateResponse, String> {
        let response = mobile::authenticate(&self.handle, request).await?;
        check_return(response, &request.callback_scheme)
    }

    #[cfg(not(mobile))]
    async fn run(&self, request: &AuthenticateRequest) -> Result<AuthenticateResponse, String> {
        let _ = request;
        Err(DESKTOP_ONLY.into())
    }

    #[cfg(target_os = "android")]
    async fn run_google(
        &self,
        request: &GoogleAuthorizeRequest,
    ) -> Result<GoogleAuthorization, String> {
        let _claim = self.claim()?;
        let authorization = mobile::google_authorize(&self.handle, request).await?;
        google::check_authorization(authorization)
    }

    #[cfg(not(target_os = "android"))]
    async fn run_google(
        &self,
        request: &GoogleAuthorizeRequest,
    ) -> Result<GoogleAuthorization, String> {
        let _ = request;
        Err(google::ANDROID_ONLY.into())
    }
}

fn claim_flag(flag: &AtomicBool) -> Result<SessionClaim<'_>, String> {
    flag.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .map(|_| SessionClaim(flag))
        .map_err(|_| BUSY.to_string())
}

/// `invoke('plugin:lolly-auth|authenticate', { url, callbackScheme, ephemeral })`.
/// Async so the wait for the person never holds the main thread, which the
/// native side needs to show the sheet. The unused `AppHandle` ties `R` to the
/// runtime that invoked the command.
#[tauri::command]
async fn authenticate<R: Runtime>(
    _app: AppHandle<R>,
    state: State<'_, LollyAuth<R>>,
    url: String,
    callback_scheme: String,
    ephemeral: Option<bool>,
) -> Result<AuthenticateResponse, String> {
    let request = AuthenticateRequest::new(url, callback_scheme, ephemeral.unwrap_or(false))?;
    let _claim = state.claim()?;
    state.run(&request).await
}

/// `invoke('plugin:lolly-auth|google_authorize', { scopes, interactive })`,
/// resolving `{ accessToken, grantedScopes }`. Android only. With
/// `interactive` false no screen is ever shown: a request that needs the
/// person's approval rejects with `consent-required`.
#[tauri::command]
async fn google_authorize<R: Runtime>(
    _app: AppHandle<R>,
    state: State<'_, LollyAuth<R>>,
    scopes: Vec<String>,
    interactive: Option<bool>,
) -> Result<GoogleAuthorization, String> {
    let request = GoogleAuthorizeRequest::new(scopes, interactive.unwrap_or(false))?;
    state.run_google(&request).await
}

/// Builds the plugin. Register it with `.plugin(tauri_plugin_lolly_auth::init())`
/// and grant `lolly-auth:default` in a capability.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("lolly-auth")
        .invoke_handler(tauri::generate_handler![authenticate, google_authorize])
        .setup(|app, api| {
            #[cfg(mobile)]
            let state = LollyAuth::<R> {
                busy: AtomicBool::new(false),
                handle: mobile::init(app, api)?,
                _runtime: PhantomData,
            };
            #[cfg(not(mobile))]
            let state = {
                let _ = api;
                LollyAuth::<R> {
                    busy: AtomicBool::new(false),
                    _runtime: PhantomData,
                }
            };
            app.manage(state);
            Ok(())
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_https_authorize_urls() {
        assert!(is_https_url(
            "https://www.dropbox.com/oauth2/authorize?client_id=a&state=b#frag"
        ));
        assert!(is_https_url(
            "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
        ));
        assert!(is_https_url(
            "HTTPS://accounts.google.com/o/oauth2/v2/auth?scope=a%20b"
        ));
    }

    #[test]
    fn refuses_other_urls() {
        for raw in [
            "",
            "http://example.com/authorize",
            "javascript:alert(1)",
            "file:///etc/passwd",
            "tools.lolly.mobile:/oauth2redirect",
            "https://user:pass@example.com/",
            "https://user@example.com/",
            "https:///nohost",
            "https:\\\\example.com/",
            "https://example.com\\@evil.example/",
            " https://example.com/",
            "https://example.com/\n",
            "https://example.com/a b",
            "https:example.com",
            "/relative/path",
        ] {
            assert!(!is_https_url(raw), "{raw} should be refused");
        }
        let long = format!("https://example.com/?q={}", "a".repeat(MAX_URL_BYTES));
        assert!(!is_https_url(&long));
    }

    #[test]
    fn accepts_reverse_domain_schemes() {
        for scheme in [
            "tools.lolly.mobile",
            "com.googleusercontent.apps.1234-abcd",
            "a.b",
            "x+y.z-1",
        ] {
            assert!(is_callback_scheme(scheme), "{scheme} should be accepted");
        }
    }

    #[test]
    fn refuses_bad_schemes() {
        for scheme in [
            "",
            "https",
            "lolly",
            "tools.lolly.mobile:",
            "tools.lolly.mobile://",
            "1tools.lolly",
            ".tools.lolly",
            "tools lolly.mobile",
            "tools_lolly.mobile",
            "tööls.lolly",
        ] {
            assert!(!is_callback_scheme(scheme), "{scheme} should be refused");
        }
        assert!(!is_callback_scheme(&format!(
            "a.{}",
            "b".repeat(MAX_SCHEME_BYTES)
        )));
    }

    #[test]
    fn request_validates_both_fields() {
        let ok = AuthenticateRequest::new(
            "https://example.com/authorize".into(),
            "tools.lolly.mobile".into(),
            true,
        )
        .unwrap();
        assert!(ok.ephemeral);
        assert_eq!(
            AuthenticateRequest::new(
                "http://example.com".into(),
                "tools.lolly.mobile".into(),
                false
            ),
            Err(BAD_URL.to_string())
        );
        assert_eq!(
            AuthenticateRequest::new("https://example.com".into(), "lolly".into(), false),
            Err(BAD_SCHEME.to_string())
        );
    }

    #[test]
    fn request_serialises_with_the_js_field_names() {
        let request = AuthenticateRequest::new(
            "https://example.com/a".into(),
            "tools.lolly.mobile".into(),
            false,
        )
        .unwrap();
        let json = serde_json::to_value(&request).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "url": "https://example.com/a",
                "callbackScheme": "tools.lolly.mobile",
                "ephemeral": false,
            })
        );
    }

    #[test]
    fn return_must_use_the_requested_scheme() {
        let good = AuthenticateResponse {
            url: "tools.lolly.mobile:/oauth2redirect?code=1&state=2#x".into(),
        };
        assert_eq!(
            check_return(good.clone(), "tools.lolly.mobile"),
            Ok(good.clone())
        );
        assert_eq!(check_return(good.clone(), "TOOLS.lolly.mobile"), Ok(good));
        for url in [
            "https://evil.example/oauth2redirect?code=1",
            "com.other.app:/oauth2redirect?code=1",
            "not a url",
        ] {
            let bad = AuthenticateResponse { url: url.into() };
            assert_eq!(
                check_return(bad, "tools.lolly.mobile"),
                Err(WRONG_RETURN.to_string())
            );
        }
    }

    #[test]
    fn only_one_session_at_a_time() {
        let flag = AtomicBool::new(false);
        let first = claim_flag(&flag).unwrap();
        assert_eq!(claim_flag(&flag).err(), Some(BUSY.to_string()));
        drop(first);
        assert!(claim_flag(&flag).is_ok());
    }
}
