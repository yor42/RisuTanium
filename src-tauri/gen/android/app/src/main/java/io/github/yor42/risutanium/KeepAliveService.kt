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
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.ProcessLifecycleOwner

// Keeps the process alive while the page has work in flight (a reply, speech, an image, a
// translation, an import or export). It is started only by KeepAliveBridge.start() and stopped by
// KeepAliveBridge.stop(), the page's stop action, a timeout, or the activity going away. It holds
// no work of its own: the page decides when work begins and ends.
//
// The running instance is the only thing that posts its notification, so a notification can never
// outlive the service: refresh() reaches the instance through the static reference below, which is
// set in onCreate and cleared in onDestroy, and does nothing when there is none. Every field here
// is read and written on the main thread only.
//
// A v2 page sends a whole notice (KeepAliveNotice) that the display machine and noticePlan turn into
// content; an old page sends a title and a Stop label, which are shown as before. The Stop tap
// enters Stopping here, before the page is told, and the timeout below ends it if the stoppable work
// does not, while the app is in the foreground. Every change to the display goes through
// changeDisplay, which ends by bringing the one Stopping timer in line with the display.
class KeepAliveService : Service() {
  private var title = ""
  private var stopLabel = ""
  private val display = KeepAliveDisplay()

  // The large icons by identity key, newest last, for the life of this service: the page sends an avatar
  // once per key and service, and the stopped and failed lingers reuse the bitmap by key.
  private val avatars = LinkedHashMap<String, Bitmap>()
  private val mainHandler = Handler(Looper.getMainLooper())
  private val stoppingTimeout = Runnable {
    if (changeDisplay { display.stopTimeout() }) {
      repost()
    }
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
    if (live === this) {
      live = null
    }
    super.onDestroy()
  }

  // Started through startForegroundService, so startForeground must follow for every start
  // command within seconds: the page's start, the stop action and a null intent alike. A start the
  // system refuses ends the service instead of failing the app.
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
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
    // The Stop tap enters Stopping before the notification is built and before the page is told.
    val stopTap = if (intent?.action == ACTION_STOP) changeDisplay { display.stopTapped() } else StopTap.PLAIN
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
      return START_NOT_STICKY
    }
    // A tap while Stopping is stale: the stop is already on its way.
    if (intent?.action == ACTION_STOP && stopTap != StopTap.STALE && !MainActivity.deliverKeepAliveStop()) {
      // No live page can act on the stop, so nothing is left to keep alive.
      stopSelf()
    }
    return START_NOT_STICKY
  }

  // The single place the display changes, so every change ends with the timer in line with it.
  private fun <T> changeDisplay(change: () -> T): T {
    val result = change()
    syncStoppingTimer()
    return result
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

  private fun onAppForeground(visible: Boolean) {
    changeDisplay { display.appForeground(visible) }
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

  private fun refreshNotice(notice: KeepAliveNotice) {
    showPageNotice(notice)
    repost()
  }

  // The closing notice that came with the delayed stop. An unreadable one changes nothing unless
  // the display was Stopping, where it still ends Stopping as Stopped.
  private fun applyOutcome(notice: KeepAliveNotice?) {
    if (notice != null) keepAvatar(notice)
    val leftStopping = changeDisplay { display.outcome(notice) }
    if (notice != null || leftStopping) {
      repost()
    }
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
    val plan = if (notice != null) noticePlan(notice, display.stopping, Build.VERSION.SDK_INT) else null
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
    private const val MAX_CACHED_AVATARS = 8

    // The running instance, or null; main thread only.
    private var live: KeepAliveService? = null

    fun intentFor(context: Context, title: String, stopLabel: String): Intent =
      Intent(context, KeepAliveService::class.java)
        .putExtra(EXTRA_TITLE, title)
        .putExtra(EXTRA_STOP_LABEL, stopLabel)

    // A v2 start; noticeJson is null when the page's notice could not be read.
    fun intentForNotice(context: Context, noticeJson: String?): Intent {
      val intent = Intent(context, KeepAliveService::class.java).putExtra(EXTRA_V2, true)
      if (noticeJson != null) {
        intent.putExtra(EXTRA_NOTICE, noticeJson)
      }
      return intent
    }

    // Does nothing without a running instance: a bare notify() here could orphan a notification.
    fun refresh(title: String, stopLabel: String) {
      live?.refresh(title, stopLabel)
    }

    fun refreshNotice(notice: KeepAliveNotice) {
      live?.refreshNotice(notice)
    }

    fun applyOutcome(notice: KeepAliveNotice?) {
      live?.applyOutcome(notice)
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, KeepAliveService::class.java))
    }
  }
}
