package io.github.yor42.risutanium

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.JavascriptInterface
import androidx.core.content.ContextCompat

// Exposed to the page as window.__risuTaniumKeepAlive. Kept by name in proguard-rules.pro: the
// page calls these methods by name, so minification must not rename or drop them. WebView calls
// them on a bridge thread, so every call is posted to the main thread in order, where the service
// and the activity may be touched. It holds the application context, never the activity.
//
// A start the system refuses (a background start that is not allowed, a quota, a missing
// permission) is logged and recorded as "not running", so later updates do nothing and the app
// never fails because the service could not start.
//
// stopAfter owns the page's linger natively: a hidden page's timers are throttled, the main
// handler's are not. At most one delayed stop is pending; start, update and stop cancel it.
class KeepAliveBridge(
  private val appContext: Context,
  private val requestPermission: () -> Unit
) {
  private val mainHandler = Handler(Looper.getMainLooper())

  // Main thread only.
  private var running = false

  private val delayedStop = Runnable {
    running = false
    try {
      KeepAliveService.stop(appContext)
    } catch (error: Exception) {
      Log.w(TAG, "keep-alive delayed stop failed", error)
    }
  }

  @JavascriptInterface
  fun start(title: String, stopLabel: String) {
    mainHandler.post {
      try {
        ContextCompat.startForegroundService(appContext, KeepAliveService.intentFor(appContext, title, stopLabel))
        running = true
        // Only a start that succeeded may drop a pending stop.
        mainHandler.removeCallbacks(delayedStop)
      } catch (error: Exception) {
        running = false
        Log.w(TAG, "keep-alive service start refused", error)
      }
    }
  }

  @JavascriptInterface
  fun update(title: String, stopLabel: String) {
    mainHandler.post {
      mainHandler.removeCallbacks(delayedStop)
      if (running) {
        KeepAliveService.refresh(title, stopLabel)
      }
    }
  }

  // Context.stopService, never an intent through startForegroundService: that throws on API 31+
  // while the app is hidden, which is the main case (a reply ending in the background).
  @JavascriptInterface
  fun stop() {
    mainHandler.post {
      mainHandler.removeCallbacks(delayedStop)
      running = false
      try {
        KeepAliveService.stop(appContext)
      } catch (error: Exception) {
        Log.w(TAG, "keep-alive service stop failed", error)
      }
    }
  }

  // Replaces any pending delayed stop. A non-positive delay stops at once; the delay is clamped
  // to a minute.
  @JavascriptInterface
  fun stopAfter(ms: Int) {
    mainHandler.post {
      mainHandler.removeCallbacks(delayedStop)
      if (ms <= 0) {
        delayedStop.run()
      } else {
        mainHandler.postDelayed(delayedStop, minOf(ms, MAX_STOP_DELAY_MS).toLong())
      }
    }
  }

  @JavascriptInterface
  fun requestNotificationPermissionOnce() {
    mainHandler.post { requestPermission() }
  }

  private companion object {
    const val TAG = "KeepAliveBridge"
    const val MAX_STOP_DELAY_MS = 60000
  }
}
