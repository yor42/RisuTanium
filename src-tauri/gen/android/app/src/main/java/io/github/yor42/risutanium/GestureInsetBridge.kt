package io.github.yor42.risutanium

import android.webkit.JavascriptInterface

// Latest system-gesture inset on the left edge, in dp (equal to CSS px: the page uses
// width=device-width and no zoom). The Activity's inset listener writes it on the main thread;
// the page reads it from a WebView bridge thread. It holds no Activity reference.
class GestureInsetHolder {
  @Volatile
  var leftDp: Double = 0.0
}

// Exposed to the page as window.__risuTaniumGestureInset. Kept by name in proguard-rules.pro:
// the page calls left() by name, so minification must not rename or drop it.
class GestureInsetBridge(private val holder: GestureInsetHolder) {
  @JavascriptInterface
  fun left(): Double = holder.leftDp
}
