# SPDX-License-Identifier: MPL-2.0
# Merged into the app's R8 configuration. Tauri finds the plugin class by name
# over JNI and calls its commands and result callbacks by reflection, and
# Jackson fills the argument classes by field name. The tauri-android rules
# already cover classes carrying the Tauri annotations; these rules keep the
# plugin working even if those rules change.
-keep class tools.lolly.auth.LollyAuthPlugin { *; }
-keep class tools.lolly.auth.AuthenticateArgs { *; }
-keep class tools.lolly.auth.GoogleAuthorizeArgs { *; }

# The Google Play services code is created by name (PLAY_AUTHORIZER_CLASS in
# GoogleAuthorizer.kt), so R8 cannot see that it is used. In a build with
# lollyGooglePlayServices=false the class does not exist and this rule matches
# nothing.
-keep class tools.lolly.auth.PlayGoogleAuthorizer { *; }
-keep interface tools.lolly.auth.GoogleAuthorizer { *; }
-keep interface tools.lolly.auth.GoogleAuthCallback { *; }
