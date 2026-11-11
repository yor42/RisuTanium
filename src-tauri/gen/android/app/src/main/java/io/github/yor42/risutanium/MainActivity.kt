package io.github.yor42.risutanium

import android.Manifest
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.os.SystemClock
import android.provider.Settings
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.RequiresApi
import androidx.core.content.ContextCompat
import androidx.core.graphics.ColorUtils
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.Lifecycle
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature

class MainActivity : TauriActivity() {
  private var backWebView: WebView? = null
  private val mainHandler = Handler(Looper.getMainLooper())
  private val gestureInsets = GestureInsetHolder()
  private val imeState = ImeStateHolder()
  private var lastBarColor = DEFAULT_BAR_COLOR

  // The message channel's handler while the channel is in use; main thread only.
  private var hostListener: HostMessageListener? = null

  // The chat a notification tap named, held until the page asks for it; main thread only.
  private var pendingTarget: NoticeTarget? = null

  private val replyNotifier by lazy { ReplyNotifier(applicationContext) }

  // Registered in the initializer, before the activity starts, as the result API requires.
  private val replyPermissionRequest =
    registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
      applyReplyStep(afterAsk(granted))
    }

  // The keep-alive ask's own launcher: its answer goes to the page after the fresh state push, so
  // the page reads the app-level state before it learns of a denial.
  private val keepAlivePermissionRequest =
    registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
      pushReplyNotificationsState()
      callPage(notificationPermissionResultScript(granted))
    }

  // A live system day/night switch changes the navigation-bar rule on API 35+; the activity is
  // not recreated (uiMode is in configChanges), so the last colour is applied again.
  // The WebView reads the system font scale only when it is created, and a font change does not
  // recreate the activity (fontScale is in configChanges), so the text zoom a new WebView would
  // get is applied here. Once set, the WebView no longer follows the system scale on its own.
  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    applyBarColor(lastBarColor)
    backWebView?.settings?.textZoom = (newConfig.fontScale * 100).toInt()
  }

  // Back asks the page first: the page runs its registered Back handlers (the phone overlay
  // sidebar, the Grid's edit mode) and, when none takes the press, its quit guard, which shows
  // "press Back again" and answers true on the first press. Any other answer, a missing page,
  // or no answer within the timeout falls through to the default Back, exactly as without this
  // callback.
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
      // has by then acted: it may have closed the overlay, left edit mode or armed the quit
      // guard. All harmless, because the app is leaving.
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    // Until the bridge mode is decided, the launch intent's force request is the one that counts.
    if (latchedBridgeMode == null) {
      forceLegacyRequested = intent.getBooleanExtra(EXTRA_FORCE_LEGACY_BRIDGES, false)
    }
    // Must precede super.onCreate: it switches the starting theme (Theme.risuai.Starting) to
    // Theme.risuai, which the activity's own theme handling has to see.
    installSplashScreen()
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
      hostListener?.pushGestureInset(gestureInsets.leftDp)
      // The keyboard state is the space the padding above gave to the keyboard, so a floating
      // keyboard, split screen and rotation do not read as an open keyboard.
      imeState.heightDp = (imeSpacePx(ime.bottom, bars.bottom) / resources.displayMetrics.density).toDouble()
      hostListener?.pushIme(imeState.heightDp)
      insets.inset(bars.left, bars.top, bars.right, bottom)
    }
    // Until the page reports its scheme the bars match the default dark scheme.
    applyBarColor(DEFAULT_BAR_COLOR)

    // A file the app was started with. A restored instance and a relaunch from the recents list
    // carry the intent that started the earlier instance, whose file was already handled.
    // A notification tap is held under the same rule, so a relaunch from the recents list or a
    // recreation never opens the chat again.
    if (savedInstanceState == null && (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) == 0) {
      OpenedFilesBridge.enqueue(intent)
      pendingTarget = targetOfIntent(intent)
    }
  }

  // The intent comes from outside the app (the activity is exported); a read that throws is no target.
  private fun targetOfIntent(source: Intent): NoticeTarget? =
    targetFromIntent({ source.action }, { name -> source.getStringExtra(name) })

  // The page asked for the pending target: it is answered once, with null when there is none.
  private fun answerOpenTarget() {
    val target = pendingTarget
    pendingTarget = null
    callPage("window.__risuTaniumLaunchTarget?.(${encodeChatTarget(target)})")
  }

  // A file opened or shared while the app is running (singleTask delivers it here). The queue
  // takes it first, so a page that is not ready yet still finds it; the page is told to drain.
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    OpenedFilesBridge.enqueue(intent)
    callPage("window.__risuTaniumOpenedFiles?.()")
    // A later intent that names no chat leaves an earlier, unanswered target alone.
    val target = targetOfIntent(intent)
    if (target != null) {
      pendingTarget = target
      callPage("window.__risuTaniumLaunchTargetReady?.()")
    }
  }

  // A configuration recreation leaves the superseded WebView alive and running next to the
  // replacement. It is retired right after wry has installed the replacement (the post runs after
  // the message that is creating it), so after that only the replacement runs. Only a view with
  // the same id is retired, and never the one just created.
  override fun onWebViewCreate(webView: WebView) {
    val previous = liveWebView
    liveWebView = webView
    backWebView = webView
    // Until the page paints, the WebView shows the loading screen's colour, so no white or black frame appears.
    webView.setBackgroundColor(ContextCompat.getColor(this, R.color.loading_background))
    hostListener = null
    if (bridgeMode() == BridgeMode.LISTENER) {
      val listener = HostMessageListener(
        APP_ORIGIN,
        gestureInsets,
        imeState,
        SystemBarsBridge(::applyBarColor),
        KeepAliveBridge(applicationContext, ::requestKeepAliveNotificationPermissionOnce, ::answerOpenTarget),
        newReplyNotificationsBridge(),
        OpenedFilesBridge(contentResolver)
      )
      try {
        WebViewCompat.addWebMessageListener(webView, HOST_OBJECT_NAME, setOf(APP_ORIGIN), listener)
        hostListener = listener
      } catch (error: Exception) {
        Log.w("MainActivity", "host message channel unavailable, using the separate host objects", error)
        addSeparateHostObjects(webView)
      }
    } else {
      addSeparateHostObjects(webView)
    }
    if (previous != null && previous !== webView && sameId(previous, webView)) {
      mainHandler.post { retire(previous) }
    }
    // wry installs its client after this callback returns, so the wrapper goes on in the next
    // message. onRenderProcessGone exists from API 26.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      mainHandler.post { installRendererLossClient(webView) }
    }
  }

  // Only the live view is wrapped, and never twice. A view superseded before its install runs is not wrapped; a same-id one is retired by the post above.
  @RequiresApi(Build.VERSION_CODES.O)
  private fun installRendererLossClient(webView: WebView) {
    val client = webView.webViewClient
    if (webView !== liveWebView || client is RendererLossClient) return
    webView.webViewClient = RendererLossClient(client, ::onRendererGone)
  }

  // Every wrapped view answers true: Chromium aborts the process unless all of them handle the
  // loss. Whether the loss is live is decided in the runner, which runs ahead of every other
  // queued message so that no lifecycle or main-pipe message runs between the loss and the exit.
  // The dead view only leaves the tree; it is not destroyed, because the runner ends the process.
  private fun onRendererGone(view: WebView?, didCrash: Boolean): Boolean {
    val isLive = view != null && view === liveWebView
    mainHandler.postAtFrontOfQueue { runRendererLoss(isLive, didCrash, lossEffects) }
    try {
      view?.let { (it.parent as? ViewGroup)?.removeView(it) }
    } catch (error: Exception) {
      Log.w("RendererLoss", "dead view not removed", error)
    }
    return true
  }

  private val lossEffects = object : RendererLossEffects {
    override fun foreground(): Boolean =
      !isFinishing && !isDestroyed && lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)

    override fun now(): Long = SystemClock.elapsedRealtime()

    override fun load(): String? = lossPrefs().getString(KEY_LOSS_TIMES, null)

    override fun log(action: RendererLossAction?, didCrash: Boolean) {
      Log.w("RendererLoss", "renderer gone: didCrash=$didCrash action=$action")
    }

    override fun logOutcome(durable: Boolean, ok: Boolean, relaunchCalled: Boolean) {
      Log.w("RendererLoss", "outcome: durable=$durable ok=$ok relaunchCalled=$relaunchCalled")
    }

    override fun warn(step: String, error: Exception) {
      Log.w("RendererLoss", "$step failed", error)
    }

    override fun persist(value: String): Boolean = persistLossTimes(lossPrefs(), value)

    override fun stopKeepAlive() = KeepAliveService.stop(applicationContext)

    // The start and the kill run in one message, so the new task can only begin in a new process.
    override fun relaunch() {
      startActivity(
        Intent.makeRestartActivityTask(ComponentName(this@MainActivity, MainActivity::class.java))
          .putExtra(EXTRA_FORCE_LEGACY_BRIDGES, forceLegacyRequested)
      )
    }

    override fun exitProcess() = Process.killProcess(Process.myPid())
  }

  private fun lossPrefs() = getSharedPreferences(RENDERER_LOSS_PREFS, MODE_PRIVATE)

  // The separate host objects, one per bridge; the registration used where the message channel
  // is not available.
  private fun addSeparateHostObjects(webView: WebView) {
    webView.addJavascriptInterface(GestureInsetBridge(gestureInsets), "__risuTaniumGestureInset")
    webView.addJavascriptInterface(ImeBridge(imeState), "__risuTaniumIme")
    webView.addJavascriptInterface(SystemBarsBridge(::applyBarColor), "__risuTaniumSystemBars")
    webView.addJavascriptInterface(
      KeepAliveBridge(applicationContext, ::requestKeepAliveNotificationPermissionOnce, ::answerOpenTarget),
      "__risuTaniumKeepAlive"
    )
    webView.addJavascriptInterface(newReplyNotificationsBridge(), "__risuTaniumReplyNotificationsHost")
    webView.addJavascriptInterface(OpenedFilesBridge(contentResolver), "__risuTaniumOpenedFilesHost")
  }

  private fun newReplyNotificationsBridge() = ReplyNotificationsBridge(
    applicationContext,
    ::pushReplyNotificationsState,
    ::enableReplyNotifications,
    ::disableReplyNotifications,
    ::openAppNotificationSettings
  )

  // The real state is read again on every resume: the user may have changed the system settings
  // while the app was away.
  override fun onResume() {
    super.onResume()
    pushReplyNotificationsState()
  }

  // Turning the switch on: the opt-in is stored first, the channel is created with its sound, and
  // what happens next follows from the system state (enableStep).
  private fun enableReplyNotifications() {
    ReplyNotifier.setOptedIn(applicationContext, true)
    try {
      replyNotifier.ensureChannel()
      val granted = checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
      val channelBlocked = replyNotifier.channelImportance() == CHANNEL_IMPORTANCE_NONE
      applyReplyStep(enableStep(Build.VERSION.SDK_INT, granted, replyNotifier.appNotificationsEnabled(), channelBlocked))
    } catch (error: Exception) {
      Log.w("MainActivity", "reply notifications enable failed", error)
      pushReplyNotificationsState()
    }
  }

  private fun disableReplyNotifications() {
    ReplyNotifier.setOptedIn(applicationContext, false)
    pushReplyNotificationsState()
  }

  private fun applyReplyStep(step: EnableStep) {
    when (step) {
      EnableStep.Ask -> replyPermissionRequest.launch(Manifest.permission.POST_NOTIFICATIONS)
      EnableStep.OpenSettings -> {
        openAppNotificationSettings()
        pushReplyNotificationsState()
      }
      EnableStep.Done -> pushReplyNotificationsState()
    }
  }

  // The app's notification settings, or its details page below API 26. A device without the
  // screen leaves the switch where it was.
  private fun openAppNotificationSettings() {
    try {
      val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
      } else {
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null))
      }
      startActivity(intent)
    } catch (error: Exception) {
      Log.w("MainActivity", "notification settings not opened", error)
    }
  }

  private fun pushReplyNotificationsState() {
    val appEnabled = try {
      replyNotifier.appNotificationsEnabled()
    } catch (error: Exception) {
      Log.w("MainActivity", "app notification state unreadable", error)
      null
    }
    val json = encodeReplyNotificationsState(ReplyNotifier.optedIn(applicationContext), replyNotifier.enabled(), appEnabled)
    callPage("window.__risuTaniumReplyNotificationsState?.($json)")
  }

  // Decided once per process, so every WebView of the process gets the same bridges. The force
  // request is read from the launch intent in onCreate.
  private fun bridgeMode(): BridgeMode {
    latchedBridgeMode?.let { return it }
    val mode = chooseBridgeMode(
      WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER),
      BuildConfig.DEBUG,
      forceLegacyRequested
    )
    latchedBridgeMode = mode
    return mode
  }

  // The service never outlives its activity. A recreated activity's page stops it at init when no
  // work is in flight and starts it again when work is.
  override fun onDestroy() {
    KeepAliveService.stop(applicationContext)
    super.onDestroy()
  }

  // Asked once, on the first work, and only while the activity is resumed: the dialog needs a
  // foreground activity, and a denial is final (the service still runs, its notification hidden).
  private fun requestKeepAliveNotificationPermissionOnce() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
    if (!lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) return
    if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return
    val prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
    if (prefs.getBoolean(KEY_NOTIFICATION_PERMISSION_ASKED, false)) return
    prefs.edit().putBoolean(KEY_NOTIFICATION_PERMISSION_ASKED, true).apply()
    keepAlivePermissionRequest.launch(Manifest.permission.POST_NOTIFICATIONS)
  }

  private fun sameId(a: WebView, b: WebView) = a is RustWebView && b is RustWebView && a.id == b.id

  // destroy() must follow removal from the view tree.
  private fun retire(stale: WebView) {
    (stale.parent as? ViewGroup)?.removeView(stale)
    stale.destroy()
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
    // The WebView of the latest onWebViewCreate; read and written on the main thread only. It
    // outlives the activity, which is how a recreation finds the view it supersedes.
    private var liveWebView: WebView? = null

    // The bridge mode of this process, set when the first WebView is created; main thread only.
    private var latchedBridgeMode: BridgeMode? = null
    private var forceLegacyRequested = false

    // The service's stop action and time limit reach the page through the live WebView, on the
    // main thread. False when there is no page to act on it or the call failed.
    fun deliverKeepAliveStop(): Boolean = callPage("window.__risuTaniumKeepAliveStop?.()")

    fun deliverKeepAliveTimeout(): Boolean = callPage("window.__risuTaniumKeepAliveTimeout?.()")

    private fun callPage(script: String): Boolean {
      val webView = liveWebView ?: return false
      return try {
        webView.evaluateJavascript(script, null)
        true
      } catch (error: Exception) {
        Log.w("MainActivity", "page call failed", error)
        false
      }
    }

    private const val PREFS_NAME = "keepalive"
    private const val KEY_NOTIFICATION_PERMISSION_ASKED = "notificationPermissionAsked"

    // A main thread busy for longer than this makes Back exit instead of closing the overlay.
    private const val BACK_TIMEOUT_MS = 1000L

    // The launch canvas (the nexus-canvas token), shared with the splash and WebView base colours until the page reports its scheme.
    private const val DEFAULT_BAR_COLOR = 0xFF00011C.toInt()

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
