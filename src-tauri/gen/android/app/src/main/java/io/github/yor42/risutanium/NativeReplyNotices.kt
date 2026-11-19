package io.github.yor42.risutanium

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.ProcessLifecycleOwner

// Posts the notice for an owned reply that ended while the app was hidden (CHORE-722 stage 3). Rust
// decides what each reply ended as and, for a token the page armed, answers a poll with a code; this
// object arms the tokens the page hands over, tells Rust whether the app is visible, polls while any token
// is held and posts what the answer asks for (NativeReplyNoticePolicy). It is a process singleton that
// outlives the keep-alive service and the activity: the Stop marks it holds must survive both. The
// notification is the page's own "Replied" notice (ReplyNotifier.notifyState, MC-1463). Every method runs
// on the main thread.
object NativeReplyNotices {
  private const val TAG = "NativeReplyNotices"

  // How often the held tokens are polled while any is held.
  private const val POLL_INTERVAL_MS = 500L

  // The tokens the page armed and their Stop marks. Built with the object, so a Stop tap before install()
  // finds an empty table and marks nothing.
  internal val tokens = NoticeTokens()

  private val mainHandler = Handler(Looper.getMainLooper())
  private var appContext: Context? = null
  private var installed = false

  // The process lifecycle's STARTED state, as Rust was last told.
  private var visible = false
  private var pollPending = false

  private val pollRunnable = Runnable {
    pollPending = false
    pollHeld()
  }

  private val appVisibility = LifecycleEventObserver { _, event ->
    when (event) {
      Lifecycle.Event.ON_START -> onVisibility(true)
      Lifecycle.Event.ON_STOP -> onVisibility(false)
      else -> Unit
    }
  }

  // Idempotent. addObserver replays events only up to the current state, so the current state is read and
  // told to Rust first.
  fun install(context: Context) {
    if (installed) return
    installed = true
    appContext = context.applicationContext
    val lifecycle = ProcessLifecycleOwner.get().lifecycle
    visible = lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)
    NativeStreams.setHostVisibilityOrNone(if (visible) VISIBLE else HIDDEN)
    lifecycle.addObserver(appVisibility)
  }

  // The page hands over a token with the notices to post. A payload that cannot be read arms nothing and
  // the page posts as it always did.
  fun arm(token: Int, json: String) {
    val context = appContext ?: return
    val arm = parseNativeArmJson(json) ?: return
    if (!tokens.add(token, arm)) return
    val notifier = ReplyNotifier(context)
    val flags = armFlags(ReplyNotifier.optedIn(context), notifier.enabled(), true)
    if (NativeStreams.armReplyNoticeOrNone(token, flags) == -1) {
      tokens.disarmAnswered(token, -1)
      return
    }
    schedulePoll()
  }

  private fun onVisibility(nowVisible: Boolean) {
    visible = nowVisible
    NativeStreams.setHostVisibilityOrNone(if (nowVisible) VISIBLE else HIDDEN)
    // A reply may have ended in the lag before this change; the answer should not wait for the next tick.
    mainHandler.removeCallbacks(pollRunnable)
    pollPending = false
    pollHeld()
  }

  private fun schedulePoll() {
    if (pollPending || tokens.held().isEmpty()) return
    pollPending = true
    mainHandler.postDelayed(pollRunnable, POLL_INTERVAL_MS)
  }

  private fun pollHeld() {
    val context = appContext
    for (token in tokens.held()) {
      val code = NativeStreams.pollReplyOutcomeOrNone(token)
      val effect = KeepAliveService.applyNativePoll { display -> pollEffect(tokens, token, code, display, visible) }
      if (effect.action == NoticeAction.DISARM) {
        tokens.disarmAnswered(token, NativeStreams.armReplyNoticeOrNone(token, -1))
      }
      val post = effect.post
      if (post != null && context != null) {
        ReplyNotifier(context).notifyState(post)
      }
      if (effect.action == NoticeAction.SKIP_STOPPED) {
        Log.i(TAG, "Reply notice skipped after Stop")
      }
    }
    schedulePoll()
  }

  private const val VISIBLE = 1
  private const val HIDDEN = 2
}
