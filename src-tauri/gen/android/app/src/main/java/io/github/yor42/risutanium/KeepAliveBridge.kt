package io.github.yor42.risutanium

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.JavascriptInterface
import org.json.JSONObject

// Exposed to the page as window.__risuTaniumKeepAlive. Kept by name in proguard-rules.pro: the
// page calls these methods by name, so minification must not rename or drop them. A call may
// arrive on a bridge thread (legacy) or the main thread (message channel), so every call is posted
// to the main thread in order, where the service and the activity may be touched. It holds the application context, never the activity.
//
// A start the system refuses (a background start that is not allowed, a quota, a missing
// permission) is logged and recorded as "not running", so later updates do nothing and the app
// never fails because the service could not start.
//
// stopAfter owns the page's linger natively: a hidden page's timers are throttled, the main
// handler's are not. At most one delayed stop is pending; start, update and stop cancel it.
class KeepAliveBridge(
  private val appContext: Context,
  private val requestPermission: () -> Unit,
  private val answerOpenTarget: () -> Unit
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
        KeepAliveService.launch(appContext, KeepAliveService.intentFor(appContext, title, stopLabel))
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
    mainHandler.post { scheduleDelayedStop(ms) }
  }

  // Contract v2. A notice the page sends as JSON; one that cannot be read is handled as the v1 call
  // would be, except that a start still starts the service (with the app name and no Stop action), so
  // the foreground start contract holds, and an update is dropped.
  @JavascriptInterface
  fun startState(json: String) {
    mainHandler.post {
      val readable = parseKeepAliveNoticeJson(json) != null
      try {
        KeepAliveService.launch(appContext, KeepAliveService.intentForNotice(appContext, if (readable) json else null))
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
  fun updateState(json: String) {
    mainHandler.post {
      val notice = parseKeepAliveNoticeJson(json) ?: return@post
      mainHandler.removeCallbacks(delayedStop)
      if (running) {
        KeepAliveService.refreshNotice(notice)
      }
    }
  }

  // The closing notice and the delayed stop in one call: an update after stopAfter would cancel the
  // stop, so the outcome travels inside it. The notice is shown once and the stop stays scheduled. A
  // notice that cannot be read acts as stopAfter(ms), so the stop is never lost.
  @JavascriptInterface
  fun stopAfterWithOutcome(ms: Int, json: String) {
    mainHandler.post {
      mainHandler.removeCallbacks(delayedStop)
      KeepAliveService.applyOutcome(parseKeepAliveNoticeJson(json))
      scheduleDelayedStop(ms)
    }
  }

  // Main thread only.
  private fun scheduleDelayedStop(ms: Int) {
    mainHandler.removeCallbacks(delayedStop)
    if (ms <= 0) {
      delayedStop.run()
    } else {
      mainHandler.postDelayed(delayedStop, minOf(ms, MAX_STOP_DELAY_MS).toLong())
    }
  }

  @JavascriptInterface
  fun requestNotificationPermissionOnce() {
    mainHandler.post { requestPermission() }
  }

  // The page asks for the chat a notification tap named; the activity answers through the page's hook
  // and forgets the target, so each tap is delivered once.
  @JavascriptInterface
  fun requestOpenTarget() {
    mainHandler.post {
      try {
        answerOpenTarget()
      } catch (error: Exception) {
        Log.w(TAG, "open target answer failed", error)
      }
    }
  }

  private companion object {
    const val TAG = "KeepAliveBridge"
    const val MAX_STOP_DELAY_MS = 60000
  }
}

// The notice in a v2 payload, or null when the payload is not a JSON object or does not fit the
// contract. org.json only reads the text here; the rules are in plain Kotlin (parseKeepAliveNotice).
internal fun parseKeepAliveNoticeJson(json: String): KeepAliveNotice? {
  return try {
    parseKeepAliveNotice(mapOfJsonObject(JSONObject(json)))
  } catch (error: Exception) {
    null
  }
}

private fun mapOfJsonObject(source: JSONObject): Map<String, Any?> {
  val copy = HashMap<String, Any?>()
  val keys = source.keys()
  while (keys.hasNext()) {
    val key = keys.next()
    val value = source.opt(key)
    copy[key] = when {
      value === JSONObject.NULL -> null
      value is JSONObject -> mapOfJsonObject(value)
      else -> value
    }
  }
  return copy
}
