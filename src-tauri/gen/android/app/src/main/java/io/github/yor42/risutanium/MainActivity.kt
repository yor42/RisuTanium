package io.github.yor42.risutanium

import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  private var backWebView: WebView? = null
  private val mainHandler = Handler(Looper.getMainLooper())
  private val gestureInsets = GestureInsetHolder()

  // Back asks the page first: while the phone overlay sidebar is open the page closes it and
  // answers true. Any other answer, a missing page, or no answer within the timeout falls
  // through to the default Back, exactly as without this callback.
  private val backCallback = object : OnBackPressedCallback(true) {
    override fun handleOnBackPressed() {
      val webView = backWebView
      if (webView == null) {
        defaultBack()
        return
      }
      var settled = false
      val timeout = object : Runnable {
        override fun run() {
          if (settled) return
          settled = true
          defaultBack()
        }
      }
      mainHandler.postDelayed(timeout, BACK_TIMEOUT_MS)
      webView.evaluateJavascript("window.__risuTaniumBack?.() === true") { result ->
        if (settled) return@evaluateJavascript
        settled = true
        mainHandler.removeCallbacks(timeout)
        if (result != "true") {
          defaultBack()
        }
      }
      // A late "true" after the timeout already fell through is ignored here, but the page
      // has by then started closing the overlay; harmless because the app is leaving.
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    onBackPressedDispatcher.addCallback(this, backCallback)

    // Records the OS back-gesture strip on every inset dispatch (navigation mode, rotation).
    // The insets are handed on unchanged so layout stays exactly as without this listener.
    ViewCompat.setOnApplyWindowInsetsListener(window.decorView) { view, insets ->
      val gestures = insets.getInsets(WindowInsetsCompat.Type.systemGestures())
      gestureInsets.leftDp = (gestures.left / resources.displayMetrics.density).toDouble()
      ViewCompat.onApplyWindowInsets(view, insets)
    }
  }

  override fun onWebViewCreate(webView: WebView) {
    backWebView = webView
    webView.addJavascriptInterface(GestureInsetBridge(gestureInsets), "__risuTaniumGestureInset")
  }

  private fun defaultBack() {
    backCallback.isEnabled = false
    onBackPressedDispatcher.onBackPressed()
    backCallback.isEnabled = true
  }

  companion object {
    // A main thread busy for longer than this makes Back exit instead of closing the overlay.
    private const val BACK_TIMEOUT_MS = 1000L
  }
}
