// SPDX-License-Identifier: MPL-2.0

package tools.lolly.auth

import android.app.Activity
import android.app.PendingIntent
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.activity.result.ActivityResult
import androidx.activity.result.IntentSenderRequest
import androidx.browser.auth.AuthTabIntent
import androidx.browser.customtabs.CustomTabsClient
import androidx.browser.customtabs.CustomTabsIntent
import androidx.browser.customtabs.CustomTabsService
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.LifecycleOwner
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class AuthenticateArgs {
  lateinit var url: String
  lateinit var callbackScheme: String

  // Accepted for the shared contract. Android has no per-session equivalent of
  // the iOS ephemeral sheet that works in every browser, so it is not used.
  var ephemeral: Boolean = false
}

@InvokeArg
class GoogleAuthorizeArgs {
  var scopes: List<String>? = null
  var interactive: Boolean = false
}

// The web caller matches the words "cancelled", "consent-required" and
// "play-services-unavailable", so keep them in these sentences.
private const val CANCELLED = "Sign-in cancelled."
private const val GOOGLE_CANCELLED = "Google sign-in cancelled."
private const val CONSENT_REQUIRED = "Google access needs the person's approval first (consent-required)."
private const val CONSENT_NOT_GIVEN = "Google access was not approved (consent-required)."
private const val PLAY_SERVICES_LEFT_OUT = "This build of Lolly has no Google Play services support (play-services-unavailable)."
private const val BUSY = "Another sign-in is already open."
private const val BAD_GOOGLE_SCOPES =
  "Google scopes must be 1 to 10 values, each openid, email, profile or an address under https://www.googleapis.com/auth/."

private fun playServicesUnavailable(detail: String?): String {
  val suffix = if (detail.isNullOrBlank()) "" else ": $detail"
  return "Google Play services is missing or out of date on this device (play-services-unavailable$suffix)."
}

/**
 * Custom Tab: after the app is back in front with no redirect, wait this long
 * before treating the sign-in as cancelled. A redirect reaches the plugin
 * before the app resumes; the wait only covers slow devices.
 */
private const val CUSTOM_TAB_GRACE_MS = 1500L

/**
 * Auth Tab and the Google consent screen report their result before the app
 * resumes, so this wait only ends a session whose result never arrived (for
 * example if another plugin replaced Tauri's shared activity result callback
 * while the screen was open).
 */
private const val RESULT_GRACE_MS = 3000L

/** Longest wait for Play services to answer before any screen is shown. */
private const val GOOGLE_SILENT_TIMEOUT_MS = 60_000L

private const val MAX_SCHEME_CHARS = 128

private enum class Flow { AUTH_TAB, CUSTOM_TAB, GOOGLE }

/**
 * The Android half of lolly-auth.
 *
 * `authenticate` opens the provider page in an Auth Tab when the browser
 * supports one (the browser catches the redirect and returns it as an
 * activity result), otherwise in a Custom Tab (the redirect arrives as a VIEW
 * intent at [RedirectActivity]).
 *
 * `googleAuthorize` asks Google Play services for an access token, showing
 * Google's consent screen only when the caller allows it.
 *
 * Both commands share one session, so only one sheet or consent screen is
 * open at a time.
 */
@TauriPlugin
class LollyAuthPlugin(private val activity: Activity) : Plugin(activity) {
  private val main = Handler(Looper.getMainLooper())

  // Session state. Read and written on the main thread only.
  private var pending: Invoke? = null
  private var flow: Flow? = null
  private var pendingScheme: String? = null
  private var google: GoogleSession? = null
  private var leftApp = false

  private val googleAuthorizer: GoogleAuthorizer? by lazy { loadGoogleAuthorizer() }

  private val resumeCheck = Runnable {
    if (pending != null && leftApp) {
      rejectPending(if (flow == Flow.GOOGLE) GOOGLE_CANCELLED else CANCELLED, "cancelled")
    }
  }

  private val googleTimeout = Runnable {
    if (flow == Flow.GOOGLE && google?.consentShown == false) {
      rejectPending("Google sign-in failed: Google Play services did not answer.")
    }
  }

  // Follows the activity itself, not Tauri's process-wide onPause/onResume:
  // those come from ProcessLifecycleOwner, which delays the pause by 700 ms
  // and reports nothing at all if the person closes the screen within that
  // time. For Google, only a pause after the consent screen opened counts.
  private val lifecycleObserver = LifecycleEventObserver { _, event ->
    when (event) {
      Lifecycle.Event.ON_PAUSE -> if (pending != null && (flow != Flow.GOOGLE || google?.consentShown == true)) {
        leftApp = true
        main.removeCallbacks(resumeCheck)
      }
      Lifecycle.Event.ON_RESUME -> if (pending != null && leftApp) {
        main.removeCallbacks(resumeCheck)
        main.postDelayed(resumeCheck, if (flow == Flow.CUSTOM_TAB) CUSTOM_TAB_GRACE_MS else RESULT_GRACE_MS)
      }
      Lifecycle.Event.ON_DESTROY -> rejectPending("Sign-in failed: the app window closed.")
      else -> {}
    }
  }

  // ---- authenticate --------------------------------------------------------

  @Command
  fun authenticate(invoke: Invoke) {
    val url: String
    val scheme: String
    try {
      val args = invoke.parseArgs(AuthenticateArgs::class.java)
      url = args.url
      scheme = args.callbackScheme
    } catch (e: Exception) {
      invoke.reject("Sign-in failed: the request was not understood.")
      return
    }
    // The Rust command has already checked both values; check again here so
    // this class is safe on its own.
    if (!isPlainHttpsText(url)) {
      invoke.reject("The sign-in address must be an https URL.")
      return
    }
    val uri = Uri.parse(url)
    if (!"https".equals(uri.scheme, ignoreCase = true) || uri.host.isNullOrEmpty() || uri.userInfo != null) {
      invoke.reject("The sign-in address must be an https URL.")
      return
    }
    if (!isCallbackScheme(scheme)) {
      invoke.reject("The callback scheme must be a URI scheme with at least one dot, such as tools.lolly.mobile.")
      return
    }
    // Commands already arrive on the main thread; runOnUiThread runs at once
    // there and hops to it otherwise.
    activity.runOnUiThread { startBrowser(invoke, uri, scheme) }
  }

  private fun startBrowser(invoke: Invoke, uri: Uri, scheme: String) {
    if (pending != null) {
      invoke.reject(BUSY)
      return
    }
    val browser = customTabsBrowser()
    val authTab = browser != null && CustomTabsClient.isAuthTabSupported(activity, browser)
    if (!authTab && !hasRedirectReceiver(scheme)) {
      invoke.reject(
        "Sign-in failed: this browser does not support Auth Tab and the app cannot receive a return to $scheme. " +
          "Updating Chrome may help."
      )
      return
    }

    beginSession(invoke, if (authTab) Flow.AUTH_TAB else Flow.CUSTOM_TAB)
    pendingScheme = scheme
    RedirectRelay.listener = { received -> onRedirect(received) }

    try {
      if (authTab) {
        val intent = AuthTabIntent.Builder().build().intent
        intent.setPackage(browser)
        // The same extras AuthTabIntent.launch(launcher, url, scheme) sets,
        // sent through Tauri's activity result launcher so the answer comes
        // back to authTabResult below.
        intent.data = uri
        intent.putExtra(AuthTabIntent.EXTRA_REDIRECT_SCHEME, scheme)
        startActivityForResult(invoke, intent, "authTabResult")
      } else {
        val tab = CustomTabsIntent.Builder().setShowTitle(true).build()
        // Without a Custom Tabs browser this opens the default browser as an
        // ordinary page; the redirect still reaches RedirectActivity.
        if (browser != null) tab.intent.setPackage(browser)
        tab.launchUrl(activity, uri)
      }
    } catch (e: ActivityNotFoundException) {
      rejectPending("Sign-in failed: no browser is available.")
    } catch (e: Exception) {
      rejectPending("Sign-in failed: ${e.message ?: e.javaClass.simpleName}")
    }
  }

  /** Auth Tab result, delivered by Tauri's PluginHandle on the main thread. */
  @ActivityCallback
  fun authTabResult(invoke: Invoke, result: ActivityResult) {
    if (pending !== invoke) return
    when (result.resultCode) {
      AuthTabIntent.RESULT_OK -> {
        val back = result.data?.data
        if (back != null) {
          finishBrowser(back)
        } else {
          rejectPending("Sign-in failed: the browser returned no address.")
        }
      }
      AuthTabIntent.RESULT_CANCELED -> rejectPending(CANCELLED, "cancelled")
      AuthTabIntent.RESULT_VERIFICATION_FAILED ->
        rejectPending("Sign-in failed: the browser could not verify the return address.")
      AuthTabIntent.RESULT_VERIFICATION_TIMED_OUT ->
        rejectPending("Sign-in failed: the browser timed out verifying the return address.")
      else -> rejectPending("Sign-in failed: the browser returned an unknown result (${result.resultCode}).")
    }
  }

  /** Called by [RedirectActivity] on the main thread. True when the address was taken. */
  private fun onRedirect(received: Uri): Boolean {
    val scheme = pendingScheme ?: return false
    if (pending == null || !scheme.equals(received.scheme, ignoreCase = true)) return false
    finishBrowser(received)
    return true
  }

  private fun finishBrowser(back: Uri) {
    val scheme = pendingScheme
    val invoke = endSession() ?: return
    if (scheme == null || !scheme.equals(back.scheme, ignoreCase = true)) {
      invoke.reject("The sign-in returned to an unexpected address.")
      return
    }
    val out = JSObject()
    out.put("url", back.toString())
    invoke.resolve(out)
  }

  // ---- googleAuthorize -----------------------------------------------------

  @Command
  fun googleAuthorize(invoke: Invoke) {
    val scopes: List<String>
    val interactive: Boolean
    try {
      val args = invoke.parseArgs(GoogleAuthorizeArgs::class.java)
      scopes = args.scopes ?: emptyList()
      interactive = args.interactive
    } catch (e: Exception) {
      invoke.reject("Google sign-in failed: the request was not understood.")
      return
    }
    // Checked in Rust too; checked again so this class is safe on its own.
    if (!areGoogleScopes(scopes)) {
      invoke.reject(BAD_GOOGLE_SCOPES)
      return
    }
    activity.runOnUiThread { startGoogle(invoke, scopes, interactive) }
  }

  private fun startGoogle(invoke: Invoke, scopes: List<String>, interactive: Boolean) {
    if (pending != null) {
      invoke.reject(BUSY)
      return
    }
    val authorizer = googleAuthorizer
    if (authorizer == null) {
      invoke.reject(PLAY_SERVICES_LEFT_OUT, "play-services-unavailable")
      return
    }
    val reason = try {
      authorizer.unavailableReason(activity)
    } catch (e: Exception) {
      e.message ?: e.javaClass.simpleName
    } catch (e: LinkageError) {
      e.message ?: e.javaClass.simpleName
    }
    if (reason != null) {
      invoke.reject(playServicesUnavailable(reason), "play-services-unavailable")
      return
    }

    val session = GoogleSession(invoke, interactive)
    beginSession(invoke, Flow.GOOGLE)
    google = session
    main.postDelayed(googleTimeout, GOOGLE_SILENT_TIMEOUT_MS)
    try {
      authorizer.authorize(activity, scopes, session)
    } catch (e: Exception) {
      rejectPending("Google sign-in failed: ${e.message ?: e.javaClass.simpleName}")
    }
  }

  /** Google consent screen result, delivered by Tauri on the main thread. */
  @ActivityCallback
  fun googleConsentResult(invoke: Invoke, result: ActivityResult) {
    val session = google
    if (pending !== invoke || session == null) return
    session.closedByPerson = result.resultCode == Activity.RESULT_CANCELED
    val data = result.data
    if (data == null) {
      if (session.closedByPerson) {
        rejectPending(GOOGLE_CANCELLED, "cancelled")
      } else {
        rejectPending("Google sign-in failed: the consent screen returned nothing.")
      }
      return
    }
    val authorizer = googleAuthorizer
    if (authorizer == null) {
      rejectPending(PLAY_SERVICES_LEFT_OUT, "play-services-unavailable")
      return
    }
    try {
      authorizer.readConsentResult(activity, data, session)
    } catch (e: Exception) {
      rejectPending("Google sign-in failed: ${e.message ?: e.javaClass.simpleName}")
    }
  }

  /** Receives the Play services answers for one googleAuthorize call. */
  private inner class GoogleSession(val invoke: Invoke, val interactive: Boolean) : GoogleAuthCallback {
    var consentShown = false

    /** The consent screen came back with RESULT_CANCELED. */
    var closedByPerson = false

    override fun granted(accessToken: String, grantedScopes: List<String>) = onMain {
      if (pending !== invoke) return@onMain
      val answer = endSession() ?: return@onMain
      answer.resolveObject(mapOf("accessToken" to accessToken, "grantedScopes" to grantedScopes))
    }

    override fun needsConsent(consent: PendingIntent) = onMain {
      if (pending !== invoke) return@onMain
      when {
        // Never launch anything unless the caller allowed a screen.
        !interactive -> rejectPending(CONSENT_REQUIRED, "consent-required")
        closedByPerson -> rejectPending(GOOGLE_CANCELLED, "cancelled")
        consentShown -> rejectPending(CONSENT_NOT_GIVEN, "consent-required")
        else -> showConsent(consent)
      }
    }

    override fun failed(failure: GoogleAuthFailure, detail: String) = onMain {
      if (pending !== invoke) return@onMain
      when (failure) {
        GoogleAuthFailure.CANCELLED -> rejectPending(GOOGLE_CANCELLED, "cancelled")
        GoogleAuthFailure.UNAVAILABLE ->
          rejectPending(playServicesUnavailable(detail), "play-services-unavailable")
        GoogleAuthFailure.NOT_REGISTERED -> rejectPending(
          "Google sign-in failed: Google does not recognise this app ($detail). " +
            "The Android OAuth client needs the package name tools.lolly.mobile and the SHA-1 of this build's signing certificate."
        )
        GoogleAuthFailure.OTHER ->
          if (closedByPerson) {
            rejectPending(GOOGLE_CANCELLED, "cancelled")
          } else {
            rejectPending("Google sign-in failed: $detail")
          }
      }
    }

    private fun showConsent(consent: PendingIntent) {
      consentShown = true
      main.removeCallbacks(googleTimeout)
      try {
        startIntentSenderForResult(invoke, IntentSenderRequest.Builder(consent).build(), "googleConsentResult")
      } catch (e: Exception) {
        rejectPending("Google sign-in failed: the consent screen could not open.")
      }
    }
  }

  // ---- shared session ------------------------------------------------------

  private fun beginSession(invoke: Invoke, kind: Flow) {
    pending = invoke
    flow = kind
    leftApp = false
    main.removeCallbacks(resumeCheck)
    main.removeCallbacks(googleTimeout)
    // Adding the observer replays the events up to the current state. The
    // replayed ON_RESUME does nothing because leftApp is still false.
    (activity as? LifecycleOwner)?.lifecycle?.addObserver(lifecycleObserver)
  }

  /** Clears the session and returns the invoke still to answer, if any. */
  private fun endSession(): Invoke? {
    val invoke = pending ?: return null
    pending = null
    flow = null
    pendingScheme = null
    google = null
    leftApp = false
    main.removeCallbacks(resumeCheck)
    main.removeCallbacks(googleTimeout)
    RedirectRelay.listener = null
    (activity as? LifecycleOwner)?.lifecycle?.removeObserver(lifecycleObserver)
    return invoke
  }

  private fun rejectPending(message: String, code: String? = null) {
    endSession()?.reject(message, code)
  }

  private fun onMain(block: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) block() else main.post(block)
  }

  /** The default browser if it supports Custom Tabs, else the first one that does. */
  private fun customTabsBrowser(): String? {
    return try {
      @Suppress("DEPRECATION")
      val providers = activity.packageManager
        .queryIntentServices(Intent(CustomTabsService.ACTION_CUSTOM_TABS_CONNECTION), 0)
        .mapNotNull { it.serviceInfo?.packageName }
        .distinct()
      CustomTabsClient.getPackageName(activity, providers)
    } catch (e: Exception) {
      null
    }
  }

  /** True when RedirectActivity's intent filter covers this scheme. */
  private fun hasRedirectReceiver(scheme: String): Boolean {
    val probe = Intent(Intent.ACTION_VIEW, Uri.parse("$scheme:/oauth2redirect"))
      .addCategory(Intent.CATEGORY_BROWSABLE)
      .setPackage(activity.packageName)
    @Suppress("DEPRECATION")
    val matches = activity.packageManager.queryIntentActivities(probe, 0)
    return matches.any { it.activityInfo?.name == RedirectActivity::class.java.name }
  }
}

private const val MAX_URL_CHARS = 16 * 1024

/**
 * The same plain-form rule as the Rust command: a literal `https://` followed
 * by the host, with no spaces, control characters or backslashes.
 */
internal fun isPlainHttpsText(url: String): Boolean {
  if (url.length > MAX_URL_CHARS || !url.startsWith("https://", ignoreCase = true)) return false
  if (url.length == 8 || url[8] == '/') return false
  return url.none { it == ' ' || it == '\\' || it.code < 0x20 || it.code == 0x7f }
}

/** RFC 3986 scheme, given without the colon, with at least one dot. */
internal fun isCallbackScheme(scheme: String): Boolean {
  if (scheme.isEmpty() || scheme.length > MAX_SCHEME_CHARS) return false
  if (scheme[0] !in 'a'..'z' && scheme[0] !in 'A'..'Z') return false
  var sawDot = false
  for (c in scheme) {
    when {
      c == '.' -> sawDot = true
      c in 'a'..'z' || c in 'A'..'Z' || c in '0'..'9' || c == '+' || c == '-' -> {}
      else -> return false
    }
  }
  return sawDot
}

private const val MAX_GOOGLE_SCOPES = 10
private const val MAX_GOOGLE_SCOPE_CHARS = 200
private const val GOOGLE_SCOPE_PREFIX = "https://www.googleapis.com/auth/"

/** The same rule as the Rust command: one to ten scopes, each valid. */
internal fun areGoogleScopes(scopes: List<String>): Boolean =
  scopes.size in 1..MAX_GOOGLE_SCOPES && scopes.all(::isGoogleScope)

/**
 * `openid`, `email`, `profile`, or `https://www.googleapis.com/auth/` followed
 * by letters, digits, `.`, `_`, `-` and `/`, starting with a letter or digit.
 */
internal fun isGoogleScope(scope: String): Boolean {
  if (scope == "openid" || scope == "email" || scope == "profile") return true
  if (scope.length > MAX_GOOGLE_SCOPE_CHARS || !scope.startsWith(GOOGLE_SCOPE_PREFIX)) return false
  val name = scope.substring(GOOGLE_SCOPE_PREFIX.length)
  if (name.isEmpty() || !name[0].isAsciiLetterOrDigit()) return false
  return name.all { it.isAsciiLetterOrDigit() || it == '.' || it == '_' || it == '-' || it == '/' }
}

private fun Char.isAsciiLetterOrDigit(): Boolean = this in 'a'..'z' || this in 'A'..'Z' || this in '0'..'9'
