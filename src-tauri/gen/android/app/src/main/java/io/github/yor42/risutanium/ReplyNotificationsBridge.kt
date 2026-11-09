package io.github.yor42.risutanium

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface

// Exposed to the page as window.__risuTaniumReplyNotificationsHost on the separate-object path,
// and the target of the message channel's replyNotifications commands. Kept by name in
// proguard-rules.pro: the page calls these methods by name. A call may arrive on a bridge thread
// (legacy) or the main thread (message channel), so every call is posted to the main thread in
// order, where the activity and the notification manager may be touched. The enable, disable and
// refresh effects need the activity (the permission ask, the settings screen, the page push), so
// the activity supplies them; the notification itself is posted here. It holds the application
// context and the MainActivity-bound callbacks, as KeepAliveBridge does.
class ReplyNotificationsBridge(
  appContext: Context,
  private val onRefresh: () -> Unit,
  private val onEnable: () -> Unit,
  private val onDisable: () -> Unit
) {
  private val mainHandler = Handler(Looper.getMainLooper())
  private val notifier = ReplyNotifier(appContext)

  @JavascriptInterface
  fun refresh() {
    mainHandler.post { onRefresh() }
  }

  @JavascriptInterface
  fun enable() {
    mainHandler.post { onEnable() }
  }

  @JavascriptInterface
  fun disable() {
    mainHandler.post { onDisable() }
  }

  @JavascriptInterface
  fun notify(key: String, title: String, body: String, silent: Boolean) {
    mainHandler.post { notifier.notify(key, title, body, silent) }
  }

  @JavascriptInterface
  fun cancel(key: String) {
    mainHandler.post { notifier.cancel(key) }
  }
}
