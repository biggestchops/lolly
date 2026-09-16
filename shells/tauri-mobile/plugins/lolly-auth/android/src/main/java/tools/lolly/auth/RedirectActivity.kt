// SPDX-License-Identifier: MPL-2.0

package tools.lolly.auth

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle

/**
 * Hands a redirect from the browser to the running sign-in session.
 * The plugin sets [listener] when a session starts and clears it when the
 * session ends; both happen on the main thread, as does [deliver].
 */
internal object RedirectRelay {
  @Volatile
  var listener: ((Uri) -> Boolean)? = null

  fun deliver(uri: Uri): Boolean = listener?.invoke(uri) ?: false
}

/**
 * Target of the provider redirect when the sign-in runs in a Custom Tab.
 * It passes the address on, brings the app's own activity back to the front
 * (which closes the tab above it in the task) and finishes without drawing.
 *
 * The activity is exported, so any app could send it an address. It is only
 * used while a session is open and only when the scheme matches, and the web
 * caller still checks the OAuth `state` value and uses PKCE, so an address
 * sent by another app cannot complete a sign-in.
 */
class RedirectActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val data = intent?.data
    if (savedInstanceState == null && intent?.action == Intent.ACTION_VIEW && data != null) {
      RedirectRelay.deliver(data)
    }
    returnToApp()
    finish()
  }

  private fun returnToApp() {
    // The launcher intent names the app's main activity. With these flags the
    // existing instance is reused (onNewIntent) and everything above it in
    // its task, the Custom Tab included, is closed.
    val launch = packageManager.getLaunchIntentForPackage(packageName) ?: return
    launch.addFlags(
      Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
    )
    try {
      startActivity(launch)
    } catch (e: Exception) {
      // Nothing else to do; the person can switch back by hand.
    }
  }
}
