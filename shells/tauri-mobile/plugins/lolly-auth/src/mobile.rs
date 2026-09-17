// SPDX-License-Identifier: MPL-2.0

//! Glue to the native plugin classes: `LollyAuthPlugin.kt` on Android and
//! `LollyAuthPlugin.swift` on iOS. `google_authorize` exists only on Android.

use serde::de::DeserializeOwned;
use tauri::{
    plugin::{mobile::PluginInvokeError, PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::{AuthenticateRequest, AuthenticateResponse};
#[cfg(target_os = "android")]
use crate::{GoogleAuthorization, GoogleAuthorizeRequest};

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "tools.lolly.auth";

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_lolly_auth);

/// Creates the native plugin instance and returns the handle commands go through.
pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> Result<PluginHandle<R>, PluginInvokeError> {
    #[cfg(target_os = "android")]
    let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "LollyAuthPlugin")?;
    #[cfg(target_os = "ios")]
    let handle = api.register_ios_plugin(init_plugin_lolly_auth)?;
    Ok(handle)
}

/// Runs the native `authenticate` command and waits for the person to finish.
/// The async variant is used because the sheet can stay open for minutes and
/// the blocking variant would hold a thread for all of that time.
pub async fn authenticate<R: Runtime>(
    handle: &PluginHandle<R>,
    request: &AuthenticateRequest,
) -> Result<AuthenticateResponse, String> {
    handle
        .run_mobile_plugin_async::<AuthenticateResponse>("authenticate", request)
        .await
        .map_err(describe)
}

/// Runs the Android `googleAuthorize` command (Google Play services). It can
/// show a consent screen, so it waits the same way as `authenticate`.
#[cfg(target_os = "android")]
pub async fn google_authorize<R: Runtime>(
    handle: &PluginHandle<R>,
    request: &GoogleAuthorizeRequest,
) -> Result<GoogleAuthorization, String> {
    handle
        .run_mobile_plugin_async::<GoogleAuthorization>("googleAuthorize", request)
        .await
        .map_err(describe)
}

/// A native rejection carries a readable message; pass it through unchanged so
/// "Sign-in cancelled." reaches the page as written.
fn describe(error: PluginInvokeError) -> String {
    match error {
        PluginInvokeError::InvokeRejected(response) => response
            .message
            .filter(|message| !message.is_empty())
            .unwrap_or_else(|| "Sign-in failed.".to_string()),
        other => format!("Sign-in failed: {other}"),
    }
}
