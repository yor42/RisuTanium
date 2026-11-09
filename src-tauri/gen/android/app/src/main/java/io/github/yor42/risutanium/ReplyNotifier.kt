package io.github.yor42.risutanium

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.media.AudioAttributes
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

// Posts the "a reply finished in a chat you were not looking at" notification. One notification
// per chat: the page's key is the notification tag and the id is fixed, so a new reply in the same
// chat replaces the old one, and the keep-alive notification (its own id, no tag) is never touched.
// A sounding post is always a fresh record (the old one is cancelled first, see postReply); a silent
// one updates the existing record in place.
// Everything here runs on the main thread. It holds the application context, never the activity.
//
// The reply channel's sound is our chime, fixed once the channel is created: a later sound change
// ships a new channel id and deletes this one. A notification is posted only while the user has
// opted in and Android would show it; otherwise the call returns quietly.
class ReplyNotifier(private val context: Context) {
  // Creates the channel with the chime. Idempotent: an existing channel keeps the user's settings.
  fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val channel = NotificationChannel(
      CHANNEL_ID,
      context.getString(R.string.reply_channel_name),
      NotificationManager.IMPORTANCE_DEFAULT
    )
    channel.description = context.getString(R.string.reply_channel_description)
    channel.setSound(
      chimeUri(),
      AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_NOTIFICATION)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build()
    )
    context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
  }

  // The reply channel's importance, or null before the channel exists and below API 26.
  fun channelImportance(): Int? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return null
    return context.getSystemService(NotificationManager::class.java).getNotificationChannel(CHANNEL_ID)?.importance
  }

  fun appNotificationsEnabled(): Boolean = NotificationManagerCompat.from(context).areNotificationsEnabled()

  // Whether Android would show a reply notification now. Unreadable state counts as not enabled.
  fun enabled(): Boolean = try {
    replyNotificationsEnabled(appNotificationsEnabled(), Build.VERSION.SDK_INT, channelImportance())
  } catch (error: Exception) {
    Log.w(TAG, "notification state unreadable", error)
    false
  }

  @SuppressLint("MissingPermission")
  fun notify(key: String, title: String, body: String, silent: Boolean) {
    if (!isReplyKey(key) || !optedIn(context)) return
    try {
      ensureChannel()
      if (!enabled()) return
      val builder = NotificationCompat.Builder(context, CHANNEL_ID)
        .setSmallIcon(R.drawable.ic_stat_keepalive)
        .setContentTitle(title)
        .setContentText(body)
        .setStyle(NotificationCompat.BigTextStyle().bigText(body))
        .setAutoCancel(true)
        .setSilent(silent)
        .setCategory(NotificationCompat.CATEGORY_MESSAGE)
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O && !silent) {
        builder.setSound(chimeUri())
      }
      val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
      if (launch != null) {
        builder.setContentIntent(
          PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        )
      }
      val manager = NotificationManagerCompat.from(context)
      postReply(
        object : ReplyPostSink<Notification> {
          override fun cancel(tag: String, id: Int) = manager.cancel(tag, id)
          override fun notify(tag: String, id: Int, notification: Notification) = manager.notify(tag, id, notification)
        },
        key, REPLY_ID, silent, builder.build()
      ) { error -> Log.w(TAG, "old reply notification not cancelled before the post", error) }
    } catch (error: Exception) {
      Log.w(TAG, "reply notification not posted", error)
    }
  }

  fun cancel(key: String) {
    if (!isReplyKey(key)) return
    try {
      NotificationManagerCompat.from(context).cancel(key, REPLY_ID)
    } catch (error: Exception) {
      Log.w(TAG, "reply notification not cancelled", error)
    }
  }

  private fun chimeUri(): Uri = Uri.parse("android.resource://${context.packageName}/${R.raw.reply_chime}")

  companion object {
    private const val TAG = "ReplyNotifier"
    const val CHANNEL_ID = "reply_chime_v1"

    // Every reply notification shares this id and differs by its tag; the keep-alive id is 7421.
    private const val REPLY_ID = 7422
    private const val PREFS_NAME = "reply_notifications"
    private const val KEY_OPTED_IN = "optedIn"

    fun optedIn(context: Context): Boolean =
      context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getBoolean(KEY_OPTED_IN, false)

    fun setOptedIn(context: Context, value: Boolean) {
      context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit().putBoolean(KEY_OPTED_IN, value).apply()
    }
  }
}
