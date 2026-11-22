package io.github.yor42.risutanium

import android.webkit.JavascriptInterface

// Whether Android's touch exploration (TalkBack) is on. The Activity's accessibility listener and
// its resume re-read write it on the main thread; the page reads it from a WebView bridge thread.
// It holds no Activity reference.
class TouchExplorationHolder {
  @Volatile
  var enabled: Boolean = false
}

// Exposed to the page as window.__risuTaniumAccessibility. Kept by name in proguard-rules.pro: the
// page calls touchExploration() by name, so minification must not rename or drop it.
class AccessibilityBridge(private val holder: TouchExplorationHolder) {
  @JavascriptInterface
  fun touchExploration(): Boolean = holder.enabled
}
