package io.github.yor42.risutanium

// The reply-notification decisions as plain Kotlin with no imports, so they run in JVM tests. The
// Android layer (MainActivity, ReplyNotifier) reads the system state and applies the answers.

// The longest key the page may name a chat's notification with.
const val REPLY_KEY_MAX_LENGTH = 200

// POST_NOTIFICATIONS is a runtime permission from this API level.
const val REPLY_PERMISSION_SDK = 33

// Notification channels exist from this API level.
const val REPLY_CHANNEL_SDK = 26

// NotificationManager.IMPORTANCE_NONE: the user switched the channel off.
const val CHANNEL_IMPORTANCE_NONE = 0

enum class EnableStep { Done, Ask, OpenSettings }

fun isReplyKey(key: String): Boolean = key.length in 1..REPLY_KEY_MAX_LENGTH

// What turning the switch on does next. The ask comes first where the permission is a runtime
// one and not granted; anything else that keeps a notification from showing (the app's
// notifications or the reply channel switched off) is for the user to undo in the system settings.
fun enableStep(sdk: Int, granted: Boolean, appEnabled: Boolean, channelBlocked: Boolean): EnableStep {
  if (sdk >= REPLY_PERMISSION_SDK && !granted) return EnableStep.Ask
  if (!appEnabled || channelBlocked) return EnableStep.OpenSettings
  return EnableStep.Done
}

// A refusal, including an ask Android no longer shows, sends the user to the settings.
fun afterAsk(granted: Boolean): EnableStep = if (granted) EnableStep.Done else EnableStep.OpenSettings

// A channel that does not exist yet (null) is not blocked: the first notification creates it.
fun replyNotificationsEnabled(appEnabled: Boolean, sdk: Int, channelImportance: Int?): Boolean =
  appEnabled && (sdk < REPLY_CHANNEL_SDK || channelImportance == null || channelImportance != CHANNEL_IMPORTANCE_NONE)

// The state pushed to the page.
fun encodeReplyNotificationsState(optedIn: Boolean, enabled: Boolean): String =
  "{\"optedIn\":$optedIn,\"enabled\":$enabled}"
