// SPDX-License-Identifier: MPL-2.0

package tools.lolly.auth

import android.app.Activity
import android.content.Intent
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.common.api.CommonStatusCodes
import com.google.android.gms.common.api.Scope
import com.google.android.gms.common.api.UnsupportedApiCallException

/** ConnectionResult codes that mean Play services cannot serve the call. */
private val UNAVAILABLE_CONNECTION_CODES = setOf(
  ConnectionResult.SERVICE_MISSING,
  ConnectionResult.SERVICE_VERSION_UPDATE_REQUIRED,
  ConnectionResult.SERVICE_DISABLED,
  ConnectionResult.SERVICE_INVALID,
  ConnectionResult.API_UNAVAILABLE,
  ConnectionResult.SERVICE_UPDATING,
  ConnectionResult.SERVICE_MISSING_PERMISSION,
  ConnectionResult.API_DISABLED,
  ConnectionResult.API_DISABLED_FOR_CONNECTION,
)

/**
 * `googleAuthorize` through Google Play services (AuthorizationClient).
 * Compiled only when `lollyGooglePlayServices` is true; the plugin creates it
 * by name through [loadGoogleAuthorizer].
 *
 * Only a short-lived access token is asked for. There is no
 * requestOfflineAccess and no server auth code, because the app has no server
 * to exchange one; asking again later with no screen gives a fresh token.
 */
internal class PlayGoogleAuthorizer : GoogleAuthorizer {
  override fun unavailableReason(activity: Activity): String? {
    val availability = GoogleApiAvailability.getInstance()
    val code = availability.isGooglePlayServicesAvailable(activity)
    return if (code == ConnectionResult.SUCCESS) null else availability.getErrorString(code)
  }

  override fun authorize(activity: Activity, scopes: List<String>, callback: GoogleAuthCallback) {
    val request = AuthorizationRequest.builder()
      .setRequestedScopes(scopes.map { Scope(it) })
      .build()
    Identity.getAuthorizationClient(activity)
      .authorize(request)
      .addOnSuccessListener { result -> deliver(result, callback) }
      .addOnFailureListener { error -> report(error, callback) }
  }

  override fun readConsentResult(activity: Activity, data: Intent, callback: GoogleAuthCallback) {
    val result = try {
      Identity.getAuthorizationClient(activity).getAuthorizationResultFromIntent(data)
    } catch (e: Exception) {
      report(e, callback)
      return
    }
    deliver(result, callback)
  }

  private fun deliver(result: AuthorizationResult, callback: GoogleAuthCallback) {
    if (result.hasResolution()) {
      val consent = result.pendingIntent
      if (consent != null) {
        callback.needsConsent(consent)
      } else {
        callback.failed(GoogleAuthFailure.OTHER, "Google asked for approval but gave no screen to show")
      }
      return
    }
    val token = result.accessToken
    if (token.isNullOrEmpty()) {
      callback.failed(GoogleAuthFailure.OTHER, "Google returned no access token")
      return
    }
    callback.granted(token, result.grantedScopes)
  }

  private fun report(error: Exception, callback: GoogleAuthCallback) {
    when (error) {
      is UnsupportedApiCallException ->
        callback.failed(GoogleAuthFailure.UNAVAILABLE, error.message)
      is ApiException -> {
        val (failure, detail) = classify(error)
        callback.failed(failure, detail)
      }
      else -> callback.failed(GoogleAuthFailure.OTHER, error.message ?: error.javaClass.simpleName)
    }
  }

  private fun classify(error: ApiException): Pair<GoogleAuthFailure, String> {
    // A status built from a ConnectionResult carries that result. Check it
    // first: its API_UNAVAILABLE (16) has the same number as CANCELED.
    val connection = error.status.connectionResult
    if (connection != null && connection.errorCode in UNAVAILABLE_CONNECTION_CODES) {
      return GoogleAuthFailure.UNAVAILABLE to (connection.errorMessage ?: "connection result ${connection.errorCode}")
    }
    val code = error.statusCode
    val detail = "${CommonStatusCodes.getStatusCodeString(code)} ($code)"
    val failure = when (code) {
      CommonStatusCodes.CANCELED -> GoogleAuthFailure.CANCELLED
      // CommonStatusCodes marks its own copies of 2 and 3 deprecated; the
      // numbers are the same as these.
      ConnectionResult.SERVICE_VERSION_UPDATE_REQUIRED,
      ConnectionResult.SERVICE_DISABLED,
      CommonStatusCodes.API_NOT_CONNECTED -> GoogleAuthFailure.UNAVAILABLE
      CommonStatusCodes.DEVELOPER_ERROR -> GoogleAuthFailure.NOT_REGISTERED
      else -> GoogleAuthFailure.OTHER
    }
    val message = error.status.statusMessage
    return failure to (if (message.isNullOrBlank()) detail else "$detail: $message")
  }
}
