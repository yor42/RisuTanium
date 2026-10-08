package io.github.yor42.risutanium

import android.content.res.Configuration
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.WindowManager
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.graphics.ColorUtils
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  private var backWebView: WebView? = null
  private val mainHandler = Handler(Looper.getMainLooper())
  private val gestureInsets = GestureInsetHolder()
  private var lastBarColor = DEFAULT_BAR_COLOR

  // A live system day/night switch changes the navigation-bar rule on API 35+; the activity is
  // not recreated (uiMode is in configChanges), so the last colour is applied again.
  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    applyBarColor(lastBarColor)
  }

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
    // Below API 30 the platform reports the keyboard in the insets only under adjust-resize.
    window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
    onBackPressedDispatcher.addCallback(this, backCallback)

    // The content frame is the WebView's parent (wry sets the WebView as the content view), so
    // padding it moves and shrinks the page clear of the status bar, the navigation bar and a
    // display cutout, and the strips show the frame's background. The listener is on the frame
    // and not on the decor view, which keeps seeing the full insets for its own bar handling.
    // It runs on every dispatch (rotation, navigation-mode switch). The OS back-gesture strip
    // is recorded here too, from the same dispatch: it is in window coordinates, and the page
    // starts at the left padding, so the page-side zone is what remains beyond that padding.
    // The bottom padding is the larger of the navigation bar and the keyboard, so the page ends
    // above the keyboard. The WebView gets the insets reduced by that padding, bars and keyboard
    // alike, so the page sees none of them and resizes by its own layout.
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
      val bottom = maxOf(bars.bottom, ime.bottom)
      view.setPadding(bars.left, bars.top, bars.right, bottom)
      val gestures = insets.getInsets(WindowInsetsCompat.Type.systemGestures())
      gestureInsets.leftDp = (maxOf(0, gestures.left - bars.left) / resources.displayMetrics.density).toDouble()
      insets.inset(bars.left, bars.top, bars.right, bottom)
    }
    // Until the page reports its scheme the bars match the default dark scheme.
    applyBarColor(DEFAULT_BAR_COLOR)
  }

  override fun onWebViewCreate(webView: WebView) {
    backWebView = webView
    webView.addJavascriptInterface(GestureInsetBridge(gestureInsets), "__risuTaniumGestureInset")
    webView.addJavascriptInterface(SystemBarsBridge(::applyBarColor), "__risuTaniumSystemBars")
  }

  // Colours the strips behind the bars with the page's background and sets the bar icons to
  // suit it. The content frame's background is what shows on every API level.
  // Below API 35 the bars themselves get the colour too, with the contrast scrim switched off
  // so it stays exact; the page's scheme alone decides, never the system light/dark mode.
  // From API 35 the status-bar colour setter is ignored. The navigation-bar colour is drawn
  // only where the navigation bar does not suppress the scrim (on phones, 3-button), and only
  // with contrast enforcement on, at 80 % alpha over the content frame. The 3-button buttons
  // follow the system day/night mode, not the app, so the rule is: when the page's lightness
  // agrees with the system mode the colour is the page's; otherwise it is an opaque system-mode
  // colour (near-black in night mode, light grey by day), and its 80 % blend over the page keeps
  // the buttons legible.
  // The navigation appearance follows the system mode there, matching the buttons.
  @Suppress("DEPRECATION")
  private fun applyBarColor(color: Int) {
    lastBarColor = color
    findViewById<View>(android.R.id.content).setBackgroundColor(color)
    val lightBackground = ColorUtils.calculateLuminance(color) > LIGHT_BACKGROUND_LUMINANCE
    val night = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
    val systemColors = Build.VERSION.SDK_INT >= BAR_RULE_API
    val controller = WindowCompat.getInsetsController(window, window.decorView)
    controller.isAppearanceLightStatusBars = lightBackground
    controller.isAppearanceLightNavigationBars = if (systemColors) !night else lightBackground
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      window.isStatusBarContrastEnforced = false
      window.isNavigationBarContrastEnforced = systemColors
    }
    window.statusBarColor = color
    // Dark navigation-bar icons need API 26; below it a light page gets a black bar, whose
    // light icons stay readable.
    window.navigationBarColor = when {
      systemColors -> if (lightBackground == !night) color else if (night) NIGHT_NAV_COLOR else DAY_NAV_COLOR
      lightBackground && Build.VERSION.SDK_INT < Build.VERSION_CODES.O -> Color.BLACK
      else -> color
    }
  }

  private fun defaultBack() {
    backCallback.isEnabled = false
    onBackPressedDispatcher.onBackPressed()
    backCallback.isEnabled = true
  }

  companion object {
    // A main thread busy for longer than this makes Back exit instead of closing the overlay.
    private const val BACK_TIMEOUT_MS = 1000L

    // The default dark scheme's background, as the page's fallback colour is.
    private const val DEFAULT_BAR_COLOR = 0xFF282A36.toInt()

    // The navigation-bar rule for the system day/night mode applies from this API level.
    private const val BAR_RULE_API = 35

    // The system's own navigation-bar colours, near-black at night and light grey by day.
    private const val NIGHT_NAV_COLOR = 0xFF1A1B1F.toInt()
    private const val DAY_NAV_COLOR = 0xFFE9E9E9.toInt()

    // Relative luminance above which dark icons contrast better than light ones (equal contrast
    // against white and black).
    private const val LIGHT_BACKGROUND_LUMINANCE = 0.179
  }
}
