package io.github.yor42.risutanium

import android.webkit.JavascriptInterface

// Latest space the keyboard takes from the page, in dp (equal to CSS px: the page uses
// width=device-width and no zoom). The Activity's inset listener writes it on the main thread;
// the page reads it from a WebView bridge thread. 0 means the keyboard is closed or floating.
// It holds no Activity reference.
class ImeStateHolder {
  @Volatile
  var heightDp: Double = 0.0

  val visible: Boolean
    get() = heightDp > 0.0
}

// Exposed to the page as window.__risuTaniumIme. Kept by name in proguard-rules.pro: the page
// calls visible() and height() by name, so minification must not rename or drop them.
class ImeBridge(private val holder: ImeStateHolder) {
  @JavascriptInterface
  fun visible(): Boolean = holder.visible

  @JavascriptInterface
  fun height(): Double = holder.heightDp
}
