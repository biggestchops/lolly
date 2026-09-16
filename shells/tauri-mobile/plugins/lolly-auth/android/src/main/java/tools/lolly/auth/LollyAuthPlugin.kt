// SPDX-License-Identifier: MPL-2.0

package tools.lolly.auth

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.activity.result.ActivityResult
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

/** The web caller matches the word "cancelled", so keep it in this sentence. */
private const val CANCELLED = "Sign-in cancelled."

/**
 * Custom Tab: after the app is back in front with no redirect, wait this long
 * before treating the sign-in as cancelled. A redirect reaches the plugin
 * before the app resumes; the wait only covers slow devices.
 */
private const val CUSTOM_TAB_GRACE_MS = 1500L

/**
 * Auth Tab reports its result before the app resumes, so this wait only ends a
 * session whose result never arrived (for example if another plugin replaced
 * Tauri's shared activity result callback while the tab was open).
 */
private const val AUTH_TAB_GRACE_MS = 3000L

private const val MAX_SCHEME_CHARS = 128

/**
 * The Android half of lolly-auth. Opens the provider page in an Auth Tab when
 * the browser supports one (the browser catches the redirect and returns it as
 * an activity result), otherwise in a Custom Tab (the redirect arrives as a
 * VIEW intent at [RedirectActivity]). One session at a time.
 */
@TauriPlugin
class LollyAuthPlugin(private val activity: Activity) : Plugin(activity) {
  private val main = Handler(Looper.getMainLooper())

  // Session state. Read and written on the main thread only.
  private var pending: Invoke? = null
  private var pendingScheme: String? = null
  private var usingAuthTab = false
  private var leftApp = false

  private val resumeCheck = Runnable {
    if (pending != null && leftApp) finish(null, CANCELLED)
  }

  // Follows the activity itself, not Tauri's process-wide onPause/onResume:
  // those come from ProcessLifecycleOwner, which delays the pause by 700 ms
  // and reports nothing at all if the person closes the tab within that time.
  private val lifecycleObserver = LifecycleEventObserver { _, event ->
    when (event) {
      Lifecycle.Event.ON_PAUSE -> if (pending != null) {
        leftApp = true
        main.removeCallbacks(resumeCheck)
      }
      Lifecycle.Event.ON_RESUME -> if (pending != null && leftApp) {
        main.removeCallbacks(resumeCheck)
        main.postDelayed(resumeCheck, if (usingAuthTab) AUTH_TAB_GRACE_MS else CUSTOM_TAB_GRACE_MS)
      }
      Lifecycle.Event.ON_DESTROY -> finish(null, "Sign-in failed: the app window closed.")
      else -> {}
    }
  }

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
    activity.runOnUiThread { start(invoke, uri, scheme) }
  }

  private fun start(invoke: Invoke, uri: Uri, scheme: String) {
    if (pending != null) {
      invoke.reject("Another sign-in is already open.")
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

    pending = invoke
    pendingScheme = scheme
    usingAuthTab = authTab
    leftApp = false
    main.removeCallbacks(resumeCheck)
    RedirectRelay.listener = { received -> onRedirect(received) }
    // Adding the observer replays the events up to the current state. The
    // replayed ON_RESUME does nothing because leftApp is still false.
    (activity as? LifecycleOwner)?.lifecycle?.addObserver(lifecycleObserver)

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
      finish(null, "Sign-in failed: no browser is available.")
    } catch (e: Exception) {
      finish(null, "Sign-in failed: ${e.message ?: e.javaClass.simpleName}")
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
          finish(back, null)
        } else {
          finish(null, "Sign-in failed: the browser returned no address.")
        }
      }
      AuthTabIntent.RESULT_CANCELED -> finish(null, CANCELLED)
      AuthTabIntent.RESULT_VERIFICATION_FAILED ->
        finish(null, "Sign-in failed: the browser could not verify the return address.")
      AuthTabIntent.RESULT_VERIFICATION_TIMED_OUT ->
        finish(null, "Sign-in failed: the browser timed out verifying the return address.")
      else -> finish(null, "Sign-in failed: the browser returned an unknown result (${result.resultCode}).")
    }
  }

  /** Called by [RedirectActivity] on the main thread. True when the address was taken. */
  private fun onRedirect(received: Uri): Boolean {
    val scheme = pendingScheme ?: return false
    if (pending == null || !scheme.equals(received.scheme, ignoreCase = true)) return false
    finish(received, null)
    return true
  }

  /** Answers the pending invoke once and clears the session. */
  private fun finish(back: Uri?, error: String?) {
    val invoke = pending ?: return
    val scheme = pendingScheme
    pending = null
    pendingScheme = null
    usingAuthTab = false
    leftApp = false
    main.removeCallbacks(resumeCheck)
    RedirectRelay.listener = null
    (activity as? LifecycleOwner)?.lifecycle?.removeObserver(lifecycleObserver)

    if (back == null) {
      invoke.reject(error ?: "Sign-in failed.", if (error == CANCELLED) "cancelled" else null)
      return
    }
    if (scheme == null || !scheme.equals(back.scheme, ignoreCase = true)) {
      invoke.reject("The sign-in returned to an unexpected address.")
      return
    }
    val out = JSObject()
    out.put("url", back.toString())
    invoke.resolve(out)
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
