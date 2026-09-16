// SPDX-License-Identifier: MPL-2.0

//! Arguments and result of `google_authorize` (plans/138 Tier D, WP-M1.4):
//! the Android-only command that asks Google Play services for a Google
//! access token. There is no server auth code and no offline access, because
//! the apps talk to no server other than the storage the person chooses.

use serde::{Deserialize, Serialize};

const MAX_SCOPES: usize = 10;
const MAX_SCOPE_BYTES: usize = 200;
const SCOPE_PREFIX: &str = "https://www.googleapis.com/auth/";
const PLAIN_SCOPES: [&str; 3] = ["openid", "email", "profile"];

pub(crate) const BAD_SCOPES: &str = "Google scopes must be 1 to 10 values, each openid, email, profile or an address under https://www.googleapis.com/auth/.";
#[cfg_attr(target_os = "android", allow(dead_code))]
pub(crate) const ANDROID_ONLY: &str =
    "Google sign-in through Play services is only available in the Android app.";
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
const NO_TOKEN: &str = "Google sign-in failed: Google returned no access token.";

/// What the Android plugin receives. Field names match the JS contract.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GoogleAuthorizeRequest {
    scopes: Vec<String>,
    interactive: bool,
}

impl GoogleAuthorizeRequest {
    pub(crate) fn new(scopes: Vec<String>, interactive: bool) -> Result<Self, String> {
        if !are_google_scopes(&scopes) {
            return Err(BAD_SCOPES.into());
        }
        Ok(Self {
            scopes,
            interactive,
        })
    }
}

/// What the command resolves with: `{ accessToken, grantedScopes }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleAuthorization {
    pub access_token: String,
    pub granted_scopes: Vec<String>,
}

/// One to ten scopes, each valid on its own.
fn are_google_scopes(scopes: &[String]) -> bool {
    !scopes.is_empty()
        && scopes.len() <= MAX_SCOPES
        && scopes.iter().all(|scope| is_google_scope(scope))
}

/// `openid`, `email`, `profile`, or `https://www.googleapis.com/auth/` followed
/// by a plain name such as `drive.file`: letters, digits, `.`, `_`, `-` and
/// `/`, starting with a letter or digit. Scope lists are space separated, so
/// anything looser could smuggle a second scope into the request.
fn is_google_scope(scope: &str) -> bool {
    if PLAIN_SCOPES.contains(&scope) {
        return true;
    }
    if scope.len() > MAX_SCOPE_BYTES {
        return false;
    }
    let Some(name) = scope.strip_prefix(SCOPE_PREFIX) else {
        return false;
    };
    let allowed = |b: u8| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-' | b'/');
    name.bytes()
        .next()
        .is_some_and(|b| b.is_ascii_alphanumeric())
        && name.bytes().all(allowed)
}

/// A successful answer must carry a token.
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
pub(crate) fn check_authorization(
    authorization: GoogleAuthorization,
) -> Result<GoogleAuthorization, String> {
    if authorization.access_token.is_empty() {
        Err(NO_TOKEN.into())
    } else {
        Ok(authorization)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn owned(scopes: &[&str]) -> Vec<String> {
        scopes.iter().map(|scope| scope.to_string()).collect()
    }

    #[test]
    fn accepts_google_scopes() {
        for scope in [
            "openid",
            "email",
            "profile",
            "https://www.googleapis.com/auth/drive.file",
            "https://www.googleapis.com/auth/drive.appdata",
            "https://www.googleapis.com/auth/userinfo.email",
            "https://www.googleapis.com/auth/cloud-platform.read-only",
            "https://www.googleapis.com/auth/admin/directory.user",
        ] {
            assert!(is_google_scope(scope), "{scope} should be accepted");
        }
    }

    #[test]
    fn refuses_other_scopes() {
        for scope in [
            "",
            "OpenID",
            "openid ",
            "drive.file",
            "https://www.googleapis.com/auth/",
            "https://www.googleapis.com/auth//drive",
            "https://www.googleapis.com/auth/.drive",
            "https://www.googleapis.com/auth/drive.file openid",
            "https://www.googleapis.com/auth/drive.file\n",
            "https://www.googleapis.com/auth/drive?x=1",
            "https://www.googleapis.com/auth/drive#x",
            "https://www.googleapis.com/auth/dr%20ive",
            "http://www.googleapis.com/auth/drive.file",
            "HTTPS://www.googleapis.com/auth/drive.file",
            "https://www.googleapis.com.evil.example/auth/drive.file",
            "https://evil.example/https://www.googleapis.com/auth/drive.file",
            "https://www.googleapis.com/auth/drivé",
        ] {
            assert!(!is_google_scope(scope), "{scope:?} should be refused");
        }
        let long = format!("{SCOPE_PREFIX}{}", "a".repeat(MAX_SCOPE_BYTES));
        assert!(!is_google_scope(&long));
    }

    #[test]
    fn needs_one_to_ten_scopes() {
        assert!(GoogleAuthorizeRequest::new(owned(&["openid"]), false).is_ok());
        let ten = vec!["email".to_string(); MAX_SCOPES];
        assert!(GoogleAuthorizeRequest::new(ten.clone(), false).is_ok());
        let mut eleven = ten;
        eleven.push("profile".into());
        assert_eq!(
            GoogleAuthorizeRequest::new(eleven, false),
            Err(BAD_SCOPES.to_string())
        );
        assert_eq!(
            GoogleAuthorizeRequest::new(Vec::new(), true),
            Err(BAD_SCOPES.to_string())
        );
        assert_eq!(
            GoogleAuthorizeRequest::new(owned(&["openid", "drive"]), true),
            Err(BAD_SCOPES.to_string())
        );
    }

    #[test]
    fn request_serialises_with_the_js_field_names() {
        let request = GoogleAuthorizeRequest::new(
            owned(&["https://www.googleapis.com/auth/drive.file"]),
            true,
        )
        .unwrap();
        assert_eq!(
            serde_json::to_value(&request).unwrap(),
            serde_json::json!({
                "scopes": ["https://www.googleapis.com/auth/drive.file"],
                "interactive": true,
            })
        );
    }

    #[test]
    fn answer_uses_the_js_field_names_and_needs_a_token() {
        let parsed: GoogleAuthorization = serde_json::from_value(serde_json::json!({
            "accessToken": "ya29.token",
            "grantedScopes": ["https://www.googleapis.com/auth/drive.file"],
        }))
        .unwrap();
        assert_eq!(parsed.access_token, "ya29.token");
        assert_eq!(
            serde_json::to_value(&parsed).unwrap()["grantedScopes"],
            serde_json::json!(["https://www.googleapis.com/auth/drive.file"])
        );
        assert_eq!(check_authorization(parsed.clone()), Ok(parsed));
        let empty = GoogleAuthorization {
            access_token: String::new(),
            granted_scopes: Vec::new(),
        };
        assert_eq!(check_authorization(empty), Err(NO_TOKEN.to_string()));
    }
}
