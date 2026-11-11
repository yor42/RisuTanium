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

// The state pushed to the page. appEnabled is the app-level areNotificationsEnabled answer; null
// (unreadable) leaves the field out, so the push is then byte-identical to the two-field one.
fun encodeReplyNotificationsState(optedIn: Boolean, enabled: Boolean, appEnabled: Boolean? = null): String =
  if (appEnabled == null) "{\"optedIn\":$optedIn,\"enabled\":$enabled}"
  else "{\"optedIn\":$optedIn,\"enabled\":$enabled,\"appNotifications\":$appEnabled}"

// The page's hook for the keep-alive permission answer; the page ignores it when it has not installed one.
fun notificationPermissionResultScript(granted: Boolean): String =
  "window.__risuTaniumNotificationPermissionResult?.($granted)"

// The reply notice of contract v2, as the page sends it. The page owns every string and sends it
// already localised, so native holds none of its own. key is the notification's tag: the page cancels
// a notice by the same key. target is where a tap goes, null when the ids do not fit (the tap then
// opens the app). avatar is a thumbnail data URL, never decoded here.
data class ReplyNotice(
  val key: String,
  val name: String,
  val text: String,
  val publicTitle: String,
  val target: NoticeTarget?,
  val avatar: String?,
  val silent: Boolean
)

private const val REPLY_MAX_TITLE_LENGTH = 256
private const val REPLY_MAX_TEXT_LENGTH = 512

// Cuts at a character count without splitting a surrogate pair; a value that is not a string is empty.
private fun replyString(value: Any?, max: Int): String {
  if (value !is String) return ""
  if (value.length <= max) return value
  val end = if (Character.isHighSurrogate(value[max - 1])) max - 1 else max
  return value.substring(0, end)
}

// A notice from the page's parsed JSON object. Null when the version is not 2, the key does not fit
// or the silent flag is not a boolean: the caller then drops the payload. Strings are capped, and an
// avatar that is not a non-empty string or a target that does not fit is dropped without rejecting
// the rest.
fun parseReplyNotice(map: Map<String, Any?>): ReplyNotice? {
  val version = (map["v"] as? Number)?.toDouble() ?: return null
  if (version != 2.0) return null
  val key = map["key"] as? String ?: return null
  if (!isReplyKey(key)) return null
  val silent = map["silent"] as? Boolean ?: return null
  return ReplyNotice(
    key = key,
    name = replyString(map["name"], REPLY_MAX_TITLE_LENGTH),
    text = replyString(map["text"], REPLY_MAX_TEXT_LENGTH),
    publicTitle = replyString(map["publicTitle"], REPLY_MAX_TITLE_LENGTH),
    target = chatTargetOf(ACTION_OPEN_CHAT, map["chaId"] as? String, map["chatId"] as? String),
    avatar = (map["avatar"] as? String)?.takeIf { it.isNotEmpty() },
    silent = silent
  )
}

// What a locked screen shows when the user hides sensitive content: the public title and nothing
// else. No name, no avatar, no text, no target and no action.
data class ReplyPublicPlan(val title: String)

// What ReplyNotifier applies to a notification builder. tag is the page's key. An empty title or
// public title is for the caller to fill with the app name.
data class ReplyNoticePlan(
  val tag: String,
  val title: String,
  val text: String,
  val avatar: String?,
  val target: NoticeTarget?,
  val silent: Boolean,
  val publicVersion: ReplyPublicPlan
)

fun replyNoticePlan(notice: ReplyNotice): ReplyNoticePlan = ReplyNoticePlan(
  tag = notice.key,
  title = notice.name,
  text = notice.text,
  avatar = notice.avatar,
  target = notice.target,
  silent = notice.silent,
  publicVersion = ReplyPublicPlan(notice.publicTitle)
)
