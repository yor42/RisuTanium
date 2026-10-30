package io.github.yor42.risutanium

import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.WebView
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import org.json.JSONArray
import org.json.JSONObject

// The one message channel the page reaches the host bridges through (window.__risuTaniumHost).
// It is injected for the app origin only, and a message is acted on only from the app's main
// frame (acceptsBridgeMessage); any other message is dropped without a reply. A message that is
// malformed, or names an unknown bridge or method, is dropped too, because a bad value never
// throws. The effects go to the same bridge instances the separate-object path uses.
//
// onPostMessage and every reply run on the main thread. A take reads the content providers, so it
// runs on a single worker and its reply is posted back to the main thread. A confirm is handled
// on the main thread as it arrives, ahead of any later take's worker job, so a confirm always
// precedes the snapshot of the take that follows it on the same channel.
class HostMessageListener(
  private val appOrigin: String,
  private val gestureInsets: GestureInsetHolder,
  private val systemBars: SystemBarsBridge,
  private val keepAlive: KeepAliveBridge,
  private val openedFiles: OpenedFilesBridge
) : WebViewCompat.WebMessageListener {
  private val mainHandler = Handler(Looper.getMainLooper())
  private val takeWorker: ExecutorService = Executors.newSingleThreadExecutor()

  // Main thread only. The latest main-frame channel that subscribed to the inset, and the last
  // value sent on it.
  private var insetReplyProxy: JavaScriptReplyProxy? = null
  private var lastPushedInset: Double? = null

  override fun onPostMessage(
    view: WebView,
    message: WebMessageCompat,
    sourceOrigin: Uri,
    isMainFrame: Boolean,
    replyProxy: JavaScriptReplyProxy
  ) {
    if (!acceptsBridgeMessage(isMainFrame, sourceOrigin.toString(), appOrigin)) return
    try {
      dispatch(message, replyProxy)
    } catch (error: Exception) {
      Log.w(TAG, "host message dropped", error)
    }
  }

  // The inset listener calls this after it updates the holder; the value is sent only when it
  // changed since the last send.
  fun pushGestureInset(value: Double) {
    val proxy = insetReplyProxy ?: return
    if (lastPushedInset == value) return
    sendInset(proxy, value)
  }

  private fun sendInset(proxy: JavaScriptReplyProxy, value: Double) {
    try {
      proxy.postMessage(encodeInsetEvent(value))
      lastPushedInset = value
    } catch (error: Exception) {
      Log.w(TAG, "inset push failed", error)
      if (insetReplyProxy === proxy) insetReplyProxy = null
    }
  }

  private fun dispatch(message: WebMessageCompat, replyProxy: JavaScriptReplyProxy) {
    if (message.type != WebMessageCompat.TYPE_STRING) return
    val text = message.data ?: return
    val request = JSONObject(text)
    val bridge = request.opt("bridge") as? String ?: return
    val method = request.opt("method") as? String ?: return
    val args = request.opt("args") as? JSONArray ?: return
    val id = request.opt("id").takeUnless { it === JSONObject.NULL }
    val command = toCommand(bridge, method, copyOf(args), id) ?: return
    run(command, replyProxy)
  }

  // JSON null becomes Kotlin null; nested values stay as org.json objects, which toCommand rejects.
  private fun copyOf(args: JSONArray): List<Any?> {
    val copy = ArrayList<Any?>(args.length())
    for (index in 0 until args.length()) {
      val value = args.opt(index)
      copy.add(if (value === JSONObject.NULL) null else value)
    }
    return copy
  }

  private fun run(command: BridgeCommand, replyProxy: JavaScriptReplyProxy) {
    when (command) {
      is BridgeCommand.SubscribeGestureInset -> {
        insetReplyProxy = replyProxy
        sendInset(replyProxy, gestureInsets.leftDp)
      }
      is BridgeCommand.SetBackground -> systemBars.setBackground(command.red, command.green, command.blue)
      is BridgeCommand.KeepAliveStart -> keepAlive.start(command.title, command.stopLabel)
      is BridgeCommand.KeepAliveUpdate -> keepAlive.update(command.title, command.stopLabel)
      is BridgeCommand.KeepAliveStop -> keepAlive.stop()
      is BridgeCommand.KeepAliveStopAfter -> keepAlive.stopAfter(command.ms)
      is BridgeCommand.KeepAliveRequestNotificationPermissionOnce -> keepAlive.requestNotificationPermissionOnce()
      is BridgeCommand.OpenedFilesConfirm -> openedFiles.confirm(command.through)
      is BridgeCommand.OpenedFilesMalformedTake -> reply(replyProxy, encodeTakeReply(command.id, "[]", 0))
      is BridgeCommand.OpenedFilesTake -> take(command.id, replyProxy)
    }
  }

  private fun take(id: Int, replyProxy: JavaScriptReplyProxy) {
    takeWorker.execute {
      // A failing provider still gets a reply, with nothing in it and nothing held.
      var answer = encodeTakeReply(id, "[]", 0)
      try {
        val held = openedFiles.takeHeld()
        answer = encodeTakeReply(id, held.json, held.through)
      } catch (error: Exception) {
        Log.w(TAG, "opened files take failed", error)
      }
      mainHandler.post { reply(replyProxy, answer) }
    }
  }

  private fun reply(replyProxy: JavaScriptReplyProxy, answer: String) {
    try {
      replyProxy.postMessage(answer)
    } catch (error: Exception) {
      Log.w(TAG, "host reply failed", error)
    }
  }

  private companion object {
    const val TAG = "HostMessageListener"
  }
}
