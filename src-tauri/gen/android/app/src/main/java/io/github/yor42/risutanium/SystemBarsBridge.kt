package io.github.yor42.risutanium

import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface

// Exposed to the page as window.__risuTaniumSystemBars. Kept by name in proguard-rules.pro: the
// page calls setBackground() by name, so minification must not rename or drop it. The page
// reduces its background colour to integer channels first; the channels are clamped here so a
// bad value can only give a wrong colour, never an exception. WebView calls this on a bridge
// thread, so the change is posted to the main thread, where the window may be touched.
class SystemBarsBridge(private val onBackground: (Int) -> Unit) {
  private val mainHandler = Handler(Looper.getMainLooper())

  @JavascriptInterface
  fun setBackground(red: Int, green: Int, blue: Int) {
    val color = Color.rgb(red.coerceIn(0, 255), green.coerceIn(0, 255), blue.coerceIn(0, 255))
    mainHandler.post { onBackground(color) }
  }
}
