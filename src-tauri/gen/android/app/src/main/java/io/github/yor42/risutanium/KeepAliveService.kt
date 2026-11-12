package io.github.yor42.risutanium

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.ProcessLifecycleOwner

// Keeps the process alive while the page has work in flight (a reply, speech, an image, a
// translation, an import or export). It is started only by KeepAliveBridge.start() and stopped by
// KeepAliveBridge.stop(), the page's stop action, a timeout, the early end (MC-1508) or the activity
// going away. It holds no work of its own: the page decides when work begins and ends.
//
// The running instance is the only thing that posts its notification, so a notification can never
// outlive the service: the page's updates and outcomes reach the instance through the static reference
// below, which is set in onCreate and cleared in onDestroy. A message the instance cannot apply yet (no
// instance, or one whose latest start command is still pending) is held and replayed in arrival order
// when that start's command is handled, so the start's own notice never overwrites it (MC-1517, MC-091;
// KeepAliveHandOff). The old page's refresh() still does nothing without an instance. Every field here
// is read and written on the main thread only.
//
// A v2 page sends a whole notice (KeepAliveNotice) that the display machine and noticePlan turn into
// content; an old page sends a title and a Stop label, which are shown as before. The Stop tap
// enters Stopping here, before the page is told, and the timeout below ends it if the stoppable work
// does not, while the app is in the foreground. Right after telling the page, the Stop tap also asks
// native to cancel the chat's in-flight requests, because a hidden page can be frozen and run nothing
// (MC-1435); a confirmed cancel shows Stopped at once (MC-1470) and keeps it until the work ends
// (MC-1496). The return of the app to the front clears it and reposts at once (MC-1497).
// With the app in front and the page's closing outcome in, a card that shows only the app name ends
// the service at once instead of after the linger (MC-1508). In front is the process lifecycle's
// STARTED state, which lags a real hide by up to 700 ms. Limitation (MC-1508, MC-1511): after a Stop,
// the stopped reply may finish on screen with no hidden-save hold, and the service then ends at once;
// neither the linger nor the save hold covers that reply's pending save, so a Home press before that
// save has landed (its 500 ms debounce plus the write) runs it without a foreground service, as an
// on-screen edit followed by a quick Home press already does.
//
// While the app is hidden, a count line the page has not refreshed for a few seconds is dropped by a
// single count check (MC-1450). Every change to the display goes through changeDisplay, which ends by
// bringing the one Stopping timer and the one count check in line with the display.
class KeepAliveService : Service() {
  private var title = ""
  private var stopLabel = ""
  private val display = KeepAliveDisplay()

  // The count line the last built notification showed; null before the first build.
  private var shownCountLine: CountLine? = null

  // The state of the page's previous update notice, so the diagnostic log names a state only when it
  // changes. It holds a state name only, never a title or text.
  private var lastLoggedPageState: NoticeState? = null

  // The id of the latest start command this instance has seen, for the early end (MC-1508).
  private var lastStartId = 0

  // The large icons by identity key, newest last, for the life of this service: the page sends an avatar
  // once per key and service, and the stopped and failed lingers reuse the bitmap by key.
  private val avatars = LinkedHashMap<String, Bitmap>()
  private val mainHandler = Handler(Looper.getMainLooper())
  private val stoppingTimeout = Runnable {
    if (changeDisplay { display.stopTimeout() }) {
      repost()
    }
  }

  // Fires when the count line is due to drop. A check that fires before the line is due re-arms for the
  // remaining time through syncCountTimer instead of stalling.
  private val countLineCheck = Runnable {
    val pending = display.countDelayMs()
    if (pending != null && pending > 0L) {
      Log.i(TAG, "Count check early")
    }
    repostIfCountLineChanged()
    syncCountTimer()
  }

  // The app's visibility is the process lifecycle's STARTED state, so a configuration change that
  // recreates the activity does not read as hidden.
  private val appVisibility = LifecycleEventObserver { _, event ->
    when (event) {
      Lifecycle.Event.ON_START -> onAppForeground(true)
      Lifecycle.Event.ON_STOP -> onAppForeground(false)
      else -> Unit
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    live = this
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        CHANNEL_ID,
        getString(R.string.keepalive_channel_name),
        NotificationManager.IMPORTANCE_LOW
      )
      channel.setShowBadge(false)
      getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }
    // addObserver replays events only up to the current state, so a service started while the app is
    // hidden would never see ON_STOP: the current state is read first.
    val processLifecycle = ProcessLifecycleOwner.get().lifecycle
    onAppForeground(processLifecycle.currentState.isAtLeast(Lifecycle.State.STARTED))
    processLifecycle.addObserver(appVisibility)
  }

  override fun onDestroy() {
    ProcessLifecycleOwner.get().lifecycle.removeObserver(appVisibility)
    mainHandler.removeCallbacks(stoppingTimeout)
    mainHandler.removeCallbacks(countLineCheck)
    if (live === this) {
      live = null
      // Held messages stay for the next instance of the same start.
      handOff.instanceGone()
      Log.i(TAG, "Instance gone")
    }
    super.onDestroy()
  }

  // Started through startForegroundService, so startForeground must follow for every start
  // command within seconds: the page's start, the stop action and a null intent alike. A start the
  // system refuses ends the service instead of failing the app.
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    lastStartId = startId
    val start = intent?.getIntExtra(EXTRA_START, 0) ?: 0
    val stopAction = intent?.action == ACTION_STOP
    val host = object : StartCommandHost {
      override fun showIntentNotice() = showStartIntentNotice(intent)

      override fun applyHeld(message: HeldMessage) = replayHeld(message)

      // The Stop tap enters Stopping before the notification is built and before the page is told.
      override fun enterStopTap(): StopTap = changeDisplay { display.stopTapped() }

      override fun startForeground(): Boolean = startForegroundNow()

      override fun endIfWanted() = this@KeepAliveService.endIfWanted("held outcome")

      override fun deliverStop(tap: StopTap) = deliverStopCommand(tap)
    }
    runStartCommand(handOff, start, stopAction, host)
    if (handOff.lastSkipped > 0) {
      Log.i(TAG, "Held dropped: skipped start")
    }
    return START_NOT_STICKY
  }

  // The notice the start intent carries: a v2 one, or an old page's title and Stop label.
  private fun showStartIntentNotice(intent: Intent?) {
    val extraTitle = intent?.getStringExtra(EXTRA_TITLE)
    if (intent != null && intent.getBooleanExtra(EXTRA_V2, false)) {
      // A start whose notice could not be read carries none: the service then shows the app name
      // with no Stop action, so the foreground start contract still holds.
      val notice = intent.getStringExtra(EXTRA_NOTICE)?.let { parseKeepAliveNoticeJson(it) }
      if (notice != null) {
        showPageNotice(notice)
      } else {
        showV1Notice("", "")
      }
    } else if (intent != null && extraTitle != null) {
      showV1Notice(extraTitle, intent.getStringExtra(EXTRA_STOP_LABEL) ?: "")
    }
  }

  // A replayed message changes the display like its live counterpart but never reposts: the foreground
  // start that follows posts the one card for all of them.
  private fun replayHeld(message: HeldMessage) {
    when (message) {
      is HeldUpdate -> {
        Log.i(TAG, "Held replayed update")
        applyPageUpdate(message.notice)
      }
      is HeldOutcome -> {
        Log.i(TAG, "Held replayed outcome")
        outcomeChange(message.notice)
      }
    }
  }

  // False when the system refused the foreground start; the service has then ended itself.
  private fun startForegroundNow(): Boolean {
    try {
      val notification = buildNotification()
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
      } else {
        startForeground(NOTIFICATION_ID, notification)
      }
    } catch (error: Exception) {
      Log.w(TAG, "startForeground refused; ending the keep-alive service", error)
      stopSelf()
      return false
    }
    return true
  }

  private fun deliverStopCommand(stopTap: StopTap) {
    // The page is told first and native cancels the chat's requests after it, in this same turn. A
    // stale tap (already Stopping) sends nothing.
    val delivery = changeDisplay {
      deliverStopTap(
        stopTap,
        display,
        { MainActivity.deliverKeepAliveStop() },
        { NativeStreams.cancelChatStreamsOrNone() }
      )
    }
    Log.i(TAG, "Stop delivered $delivery")
    if (delivery == StopDelivery.NO_PAGE) {
      // No live page can act on the stop, so nothing is left to keep alive.
      stopSelf()
    } else if (delivery == StopDelivery.CONFIRMED) {
      repost()
    }
  }

  // The single place the display changes, so every change ends with the timer and the count check in
  // line with it.
  private fun <T> changeDisplay(change: () -> T): T {
    val result = change()
    syncStoppingTimer()
    syncCountTimer()
    return result
  }

  // One count check is pending exactly when countTimerDelayMs wants one; every change re-arms it.
  private fun syncCountTimer() {
    mainHandler.removeCallbacks(countLineCheck)
    val delay = countTimerDelayMs(shownCountLine, display) ?: return
    mainHandler.postDelayed(countLineCheck, delay)
  }

  private fun repostIfCountLineChanged() {
    if (countLineRepostWanted(shownCountLine, display)) {
      Log.i(TAG, "Count line ${countLineName(display.countLine())}")
      repost()
    }
  }

  private fun countLineName(line: CountLine): String =
    when (line) {
      CountLine.Page -> "Page"
      CountLine.Dropped -> "Dropped"
    }

  // The timer is pending exactly while the display is Stopping and the app is in the foreground. A
  // pending timer is never restarted by another sync.
  private fun syncStoppingTimer() {
    val timerChange = display.takeTimerChange()
    if (timerChange == TimerChange.NONE) return
    mainHandler.removeCallbacks(stoppingTimeout)
    if (timerChange == TimerChange.ARM) {
      mainHandler.postDelayed(stoppingTimeout, STOPPING_TIMEOUT_MS)
    }
    Log.i(TAG, "Stopping timer $timerChange")
  }

  // A return to the foreground clears a Stopped card (MC-1497) or restores a dropped count line, at once
  // and with the page's last count. The repost choice and the log name come from foregroundRepost.
  private fun onAppForeground(visible: Boolean) {
    val cleared = changeDisplay { display.appForeground(visible) }
    when (foregroundRepost(cleared, shownCountLine, display)) {
      ForegroundRepost.STOPPED_CLEARED -> {
        Log.i(TAG, "Stopped cleared")
        repost()
      }
      ForegroundRepost.COUNT_LINE -> {
        Log.i(TAG, "Count line ${countLineName(display.countLine())}")
        repost()
      }
      ForegroundRepost.NONE -> Unit
    }
    endIfWanted("return")
  }

  // Ends the service early when the display wants it (MC-1508). It stops only through the latest start
  // this instance has seen, so a start the page already issued and the system still holds keeps the
  // service; the bare stopSelf() would drop it. It runs after the repost, so a deferred stop leaves the
  // current card posted, and nothing posts after a successful stop.
  private fun endIfWanted(site: String) {
    if (!display.endWanted()) return
    if (stopSelfResult(lastStartId)) {
      Log.i(TAG, "Early end at $site")
    } else {
      Log.i(TAG, "Early end deferred")
    }
  }

  private fun showV1Notice(newTitle: String, newStopLabel: String) {
    changeDisplay { display.reset() }
    title = newTitle
    stopLabel = newStopLabel
  }

  private fun showPageNotice(notice: KeepAliveNotice) {
    keepAvatar(notice)
    changeDisplay { display.pageNotice(notice) }
  }

  // Decodes the avatar a notice carries and keeps it under the notice's identity key, at most
  // MAX_CACHED_AVATARS of them; a failed decode keeps nothing and the notice shows no large icon.
  private fun keepAvatar(notice: KeepAliveNotice) {
    val data = notice.avatar
    val key = notice.identity?.key
    if (data.isNullOrEmpty() || key == null) return
    val bitmap = NotificationAvatarDecoder.decode(data) ?: return
    avatars.remove(key)
    avatars[key] = bitmap
    while (avatars.size > MAX_CACHED_AVATARS) {
      val oldest = avatars.keys.first()
      avatars.remove(oldest)
    }
  }

  private fun repost() {
    getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, buildNotification())
  }

  // The system's time limit for a dataSync service (API 35): the service must end within seconds
  // or the app is stopped. The page is told so its state matches.
  override fun onTimeout(startId: Int, fgsType: Int) {
    stopSelf()
    MainActivity.deliverKeepAliveTimeout()
  }

  // An old page's notice replaces any v2 one.
  private fun refresh(newTitle: String, newStopLabel: String) {
    showV1Notice(newTitle, newStopLabel)
    repost()
  }

  // The display change of a page update, shared by the live update and the replay of a held one.
  private fun applyPageUpdate(notice: KeepAliveNotice) {
    pageStateToLog(lastLoggedPageState, notice)?.let { Log.i(TAG, "Page notice $it") }
    lastLoggedPageState = notice.state
    showPageNotice(notice)
  }

  private fun refreshNotice(notice: KeepAliveNotice) {
    applyPageUpdate(notice)
    repost()
  }

  // The display change of the closing outcome, shared by the live outcome and the replay of a held one.
  // It returns whether Stopping ended.
  private fun outcomeChange(notice: KeepAliveNotice?): Boolean {
    if (notice != null) keepAvatar(notice)
    val leftStopping = changeDisplay { display.outcome(notice) }
    if (display.outcomeHidden) {
      Log.i(TAG, "Stopped outcome hidden")
    }
    return leftStopping
  }

  // The closing notice that came with the delayed stop. An unreadable one changes nothing unless
  // the display was Stopping, where it still ends Stopping as Stopped. After a Stopped cleared at the
  // return, the cancelled work's Stopped outcome shows the neutral card (MC-1497).
  private fun applyOutcome(notice: KeepAliveNotice?) {
    val leftStopping = outcomeChange(notice)
    if (notice != null || leftStopping) {
      repost()
    }
    endIfWanted("outcome")
  }

  // getService, not getForegroundService: the stop action goes to a service that is already
  // running, and the service answers it with startForeground like any other command. On Android 12
  // and later the action needs the device unlocked, so a locked screen cannot stop a reply.
  private fun stopAction(label: String, authRequired: Boolean): NotificationCompat.Action {
    val stop = Intent(this, KeepAliveService::class.java).setAction(ACTION_STOP)
    val action = NotificationCompat.Action.Builder(
      0,
      label,
      PendingIntent.getService(this, 1, stop, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    )
    if (authRequired) {
      action.setAuthenticationRequired(true)
    }
    return action.build()
  }

  // The tap intent of a notice that names a chat: explicit, with the target as data so every chat has a
  // PendingIntent of its own, and as extras for MainActivity. NEW_TASK is harmless with singleTask.
  private fun chatIntent(target: NoticeTarget): Intent =
    Intent(this, MainActivity::class.java)
      .setAction(ACTION_OPEN_CHAT)
      .setData(Uri.parse(targetDataUri(target)))
      .putExtra(EXTRA_TARGET_CHA_ID, target.chaId)
      .putExtra(EXTRA_TARGET_CHAT_ID, target.chatId)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

  // The version a locked screen shows when the user hides sensitive content.
  private fun buildPublicVersion(plan: PublicPlan): Notification {
    val builder = NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_stat_risutanium)
      .setColor(KEEP_ALIVE_ACCENT_COLOR)
      .setContentTitle(if (plan.title.isEmpty()) getString(R.string.app_name) else plan.title)
      .setUsesChronometer(plan.chronometer)
      .setShowWhen(plan.chronometer)
    if (plan.chronometer) {
      builder.setWhen(plan.whenMs)
    }
    val label = plan.actionLabel
    if (label != null) {
      builder.addAction(stopAction(label, plan.authRequired))
    }
    return builder.build()
  }

  private fun buildNotification(): Notification {
    val notice = display.current()
    val line = display.countLine()
    shownCountLine = line
    val plan = if (notice != null) {
      noticePlan(notice, display.stopping, Build.VERSION.SDK_INT, display.cancelConfirmed, line)
    } else {
      null
    }
    val shownTitle = plan?.title ?: title
    val builder = NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_stat_risutanium)
      .setColor(KEEP_ALIVE_ACCENT_COLOR)
      .setContentTitle(if (shownTitle.isEmpty()) getString(R.string.app_name) else shownTitle)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
    if (plan != null) {
      if (plan.text.isNotEmpty()) {
        builder.setContentText(plan.text)
      }
      val bigText = plan.bigText
      if (bigText != null) {
        builder.setStyle(NotificationCompat.BigTextStyle().bigText(bigText))
      }
      // The speaker's avatar, when this service has decoded one for the key; the public version never has it.
      val icon = plan.largeIconKey?.let { avatars[it] }
      if (icon != null) {
        builder.setLargeIcon(icon)
      }
      builder.setUsesChronometer(plan.chronometer).setShowWhen(plan.chronometer)
      if (plan.chronometer) {
        builder.setWhen(plan.whenMs)
      }
      builder
        .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
        .setPublicVersion(buildPublicVersion(plan.publicVersion))
    }
    // A notice that names a chat opens that chat; any other opens the app as before.
    val target = plan?.target
    val tapIntent = if (target != null) chatIntent(target) else packageManager.getLaunchIntentForPackage(packageName)
    if (tapIntent != null) {
      builder.setContentIntent(
        PendingIntent.getActivity(this, 0, tapIntent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
      )
    }
    val label = if (plan != null) plan.actionLabel else stopLabel.takeIf { it.isNotEmpty() }
    if (label != null) {
      builder.addAction(stopAction(label, authRequiredFor(Build.VERSION.SDK_INT)))
    }
    return builder.build()
  }

  companion object {
    private const val TAG = "KeepAliveService"
    private const val CHANNEL_ID = "keepalive"
    private const val NOTIFICATION_ID = 7421
    private const val ACTION_STOP = "io.github.yor42.risutanium.KEEP_ALIVE_STOP"
    private const val EXTRA_TITLE = "title"
    private const val EXTRA_STOP_LABEL = "stopLabel"
    private const val EXTRA_V2 = "v2"
    private const val EXTRA_NOTICE = "notice"
    private const val EXTRA_START = "start"
    private const val MAX_CACHED_AVATARS = 8

    // The running instance, or null; main thread only.
    private var live: KeepAliveService? = null

    // The start numbers and the messages held between a start and its command; main thread only.
    private val handOff = KeepAliveHandOff<KeepAliveService>()

    fun intentFor(context: Context, title: String, stopLabel: String): Intent =
      Intent(context, KeepAliveService::class.java)
        .putExtra(EXTRA_TITLE, title)
        .putExtra(EXTRA_STOP_LABEL, stopLabel)
        .putExtra(EXTRA_START, handOff.nextStart())

    // A v2 start; noticeJson is null when the page's notice could not be read.
    fun intentForNotice(context: Context, noticeJson: String?): Intent {
      val intent = Intent(context, KeepAliveService::class.java)
        .putExtra(EXTRA_V2, true)
        .putExtra(EXTRA_START, handOff.nextStart())
      if (noticeJson != null) {
        intent.putExtra(EXTRA_NOTICE, noticeJson)
      }
      return intent
    }

    // Starts the service with an intent from intentFor or intentForNotice. The start counts as accepted
    // only when the system took it; a refusal throws and changes nothing.
    fun launch(context: Context, intent: Intent) {
      handOff.launchStart(intent.getIntExtra(EXTRA_START, 0)) {
        ContextCompat.startForegroundService(context, intent)
      }
      Log.i(TAG, "Start accepted")
    }

    private fun heldRouteName(route: OfferRoute): String? =
      when (route) {
        OfferRoute.APPLY -> null
        OfferRoute.HELD_NO_INSTANCE -> "no instance"
        OfferRoute.HELD_START_PENDING -> "start pending"
      }

    private fun logCapDrops(before: Int) {
      if (handOff.capDrops > before) {
        Log.i(TAG, "Held capped")
      }
    }

    // Does nothing without a running instance: a bare notify() here could orphan a notification.
    fun refresh(title: String, stopLabel: String) {
      live?.refresh(title, stopLabel)
    }

    // The live instance takes the update only when it has handled the latest start; otherwise the update
    // is held for that start's command.
    fun refreshNotice(notice: KeepAliveNotice) {
      val capBefore = handOff.capDrops
      val route = handOff.offerUpdate(live, notice) { instance, held -> instance.refreshNotice(held) }
      heldRouteName(route)?.let { Log.i(TAG, "Notice held: $it") }
      logCapDrops(capBefore)
    }

    fun applyOutcome(notice: KeepAliveNotice?) {
      val capBefore = handOff.capDrops
      val route = handOff.offerOutcome(live, notice) { instance, held -> instance.applyOutcome(held) }
      heldRouteName(route)?.let { Log.i(TAG, "Outcome held: $it") }
      logCapDrops(capBefore)
    }

    // A stop clears the held messages. It matters only when a start's command is still pending at the
    // stop (before the instance is created, or a lingering instance with a newer start pending): the
    // system still delivers that command to an instance that is about to stop; any later start already
    // drops the messages of older starts.
    fun stop(context: Context) {
      if (handOff.stopped() > 0) {
        Log.i(TAG, "Held dropped: stop")
      }
      context.stopService(Intent(context, KeepAliveService::class.java))
    }
  }
}
