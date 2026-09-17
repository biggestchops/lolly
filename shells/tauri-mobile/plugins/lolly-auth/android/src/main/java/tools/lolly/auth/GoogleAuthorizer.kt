// SPDX-License-Identifier: MPL-2.0

package tools.lolly.auth

import android.app.Activity
import android.app.PendingIntent
import android.content.Intent

/**
 * The class that talks to Google Play services. It lives in src/play/java and
 * is compiled only when the Gradle property `lollyGooglePlayServices` is true
 * (the default), because Play services is not open source. The plugin loads it
 * by this name, and consumer-rules.pro keeps the name through R8.
 */
internal const val PLAY_AUTHORIZER_CLASS = "tools.lolly.auth.PlayGoogleAuthorizer"

/** What `googleAuthorize` needs from Google Play services. */
internal interface GoogleAuthorizer {
  /** Null when Play services can serve the request, else a short reason. */
  fun unavailableReason(activity: Activity): String?

  /** Asks for a token without showing anything. Reports through [callback]. */
  fun authorize(activity: Activity, scopes: List<String>, callback: GoogleAuthCallback)

  /** Reads the answer the consent screen returned. Reports through [callback]. */
  fun readConsentResult(activity: Activity, data: Intent, callback: GoogleAuthCallback)
}

/** Exactly one of these is called per request, on any thread. */
internal interface GoogleAuthCallback {
  fun granted(accessToken: String, grantedScopes: List<String>)

  /** Google needs the person to choose an account or approve access first. */
  fun needsConsent(consent: PendingIntent)

  fun failed(failure: GoogleAuthFailure, detail: String)
}

internal enum class GoogleAuthFailure {
  /** The person closed the consent screen. */
  CANCELLED,

  /** Play services is missing, disabled, updating or too old. */
  UNAVAILABLE,

  /** Google does not know this app (no matching Android OAuth client). */
  NOT_REGISTERED,
  OTHER,
}

/** The Play services implementation, or null when this build left it out. */
internal fun loadGoogleAuthorizer(): GoogleAuthorizer? {
  return try {
    Class.forName(PLAY_AUTHORIZER_CLASS).getDeclaredConstructor().newInstance() as? GoogleAuthorizer
  } catch (e: ReflectiveOperationException) {
    null
  } catch (e: LinkageError) {
    // The class is there but the Play services library it needs is not.
    null
  }
}
