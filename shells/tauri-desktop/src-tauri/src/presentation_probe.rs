// SPDX-License-Identifier: MPL-2.0
//! Compiled only by the presentation-probe feature, in a separately identified test bundle.
use tauri::{
    ipc::{Invoke, InvokeBody},
    Manager, Runtime,
};

pub fn report<R: Runtime>(invoke: Invoke<R>) -> bool {
    if let InvokeBody::Json(body) = invoke.message.payload() {
        let windows: Vec<_> = invoke
            .message
            .webview_ref()
            .app_handle()
            .webview_windows()
            .keys()
            .cloned()
            .collect();
        println!(
            "LOLLY_PRESENTATION_PROBE {}",
            serde_json::json!({ "report": body, "windows": windows })
        );
    }
    invoke.resolver.resolve(());
    true
}
