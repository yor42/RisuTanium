package io.github.yor42.risutanium

import android.util.Log

// The native side of the chat's Stop (MC-1435). The Rust library (alib) is already loaded by the
// webview's own Rust object before any page exists, so there is no loadLibrary here. cancelChatStreams
// aborts the in-flight requests the page marked as the chat's and returns how many it cancelled. It
// takes one lock and does no I/O, so it is safe on the main thread.
object NativeStreams {
  @JvmStatic
  external fun cancelChatStreams(): Int

  // -1 when the library or the symbol is missing: the Stop then follows MC-1435 without a cancel.
  fun cancelChatStreamsOrNone(): Int =
    try {
      cancelChatStreams()
    } catch (error: UnsatisfiedLinkError) {
      Log.w("KeepAliveService", "Native chat cancel unavailable", error)
      -1
    }

  // The reply-notice hub (Rust, in memory). setHostVisibility takes 0 unknown, 1 visible, 2 hidden.
  // armReplyNotice takes flags >= 0 (bit 0: a notification may be posted) to arm a token and -1 to
  // disarm it; it answers the token's poll answer without consuming it. pollReplyOutcome answers
  // 1 done announced, 2 failed announced, 3 quiet (each only once), 4 armed and not yet bound, 0 pending
  // and -1 absent. Each takes one short lock and does no I/O, so it is safe on the main thread.
  @JvmStatic
  external fun setHostVisibility(state: Int): Int

  @JvmStatic
  external fun armReplyNotice(token: Int, flags: Int): Int

  @JvmStatic
  external fun pollReplyOutcome(token: Int): Int

  // -1 when the library or the symbol is missing: no native notice follows and the page posts its own.
  fun setHostVisibilityOrNone(state: Int): Int = noticeCall("setHostVisibility") { setHostVisibility(state) }

  fun armReplyNoticeOrNone(token: Int, flags: Int): Int = noticeCall("armReplyNotice") { armReplyNotice(token, flags) }

  fun pollReplyOutcomeOrNone(token: Int): Int = noticeCall("pollReplyOutcome") { pollReplyOutcome(token) }

  private fun noticeCall(name: String, call: () -> Int): Int =
    try {
      call()
    } catch (error: UnsatisfiedLinkError) {
      Log.w("NativeReplyNotices", "Native $name unavailable", error)
      -1
    }
}
