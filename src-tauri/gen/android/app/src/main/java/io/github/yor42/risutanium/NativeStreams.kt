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
}
