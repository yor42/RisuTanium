package io.github.yor42.risutanium

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat

// Keeps the process alive while the page has work in flight (a reply, speech, an image, a
// translation, an import or export). It is started only by KeepAliveBridge.start() and stopped by
// KeepAliveBridge.stop(), the page's stop action, a timeout, or the activity going away. It holds
// no work of its own: the page decides when work begins and ends.
//
// The running instance is the only thing that posts its notification, so a notification can never
// outlive the service: refresh() reaches the instance through the static reference below, which is
// set in onCreate and cleared in onDestroy, and does nothing when there is none. Every field here
// is read and written on the main thread only.
class KeepAliveService : Service() {
  private var title = ""
  private var stopLabel = ""

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
  }

  override fun onDestroy() {
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
    if (intent != null && extraTitle != null) {
      title = extraTitle
      stopLabel = intent.getStringExtra(EXTRA_STOP_LABEL) ?: ""
    }
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
    if (intent?.action == ACTION_STOP && !MainActivity.deliverKeepAliveStop()) {
      // No live page can act on the stop, so nothing is left to keep alive.
      stopSelf()
    }
    return START_NOT_STICKY
  }

  // The system's time limit for a dataSync service (API 35): the service must end within seconds
  // or the app is stopped. The page is told so its state matches.
  override fun onTimeout(startId: Int, fgsType: Int) {
    stopSelf()
    MainActivity.deliverKeepAliveTimeout()
  }

  private fun refresh(newTitle: String, newStopLabel: String) {
    title = newTitle
    stopLabel = newStopLabel
    getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, buildNotification())
  }

  private fun buildNotification(): Notification {
    val builder = NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_stat_keepalive)
      .setContentTitle(if (title.isEmpty()) getString(R.string.app_name) else title)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
    val launch = packageManager.getLaunchIntentForPackage(packageName)
    if (launch != null) {
      builder.setContentIntent(
        PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
      )
    }
    if (stopLabel.isNotEmpty()) {
      // getService, not getForegroundService: the stop action goes to a service that is already
      // running, and the service answers it with startForeground like any other command.
      val stop = Intent(this, KeepAliveService::class.java).setAction(ACTION_STOP)
      builder.addAction(
        0,
        stopLabel,
        PendingIntent.getService(this, 1, stop, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
      )
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

    // The running instance, or null; main thread only.
    private var live: KeepAliveService? = null

    fun intentFor(context: Context, title: String, stopLabel: String): Intent =
      Intent(context, KeepAliveService::class.java)
        .putExtra(EXTRA_TITLE, title)
        .putExtra(EXTRA_STOP_LABEL, stopLabel)

    // Does nothing without a running instance: a bare notify() here could orphan a notification.
    fun refresh(title: String, stopLabel: String) {
      live?.refresh(title, stopLabel)
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, KeepAliveService::class.java))
    }
  }
}
