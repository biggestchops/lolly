# SPDX-License-Identifier: MPL-2.0
# Merged into the app's R8 configuration. Tauri finds the plugin class by name
# over JNI and calls its commands and result callbacks by reflection, and
# Jackson fills the argument class by field name. The tauri-android rules
# already cover classes carrying the Tauri annotations; these rules keep the
# plugin working even if those rules change.
-keep class tools.lolly.auth.LollyAuthPlugin { *; }
-keep class tools.lolly.auth.AuthenticateArgs { *; }
