package io.github.yor42.risutanium

// The host bridges answer only the app's main frame. Everything here is plain Kotlin with no
// android imports, so the rules run in JVM tests; the Android layer (HostMessageListener and
// MainActivity) applies them.

// The origin the app's own page is served from. The message channel is injected for this origin
// only, and a message is acted on only when it comes from it.
const val APP_ORIGIN = "http://tauri.localhost"

// The name of the injected message channel in the page.
const val HOST_OBJECT_NAME = "__risuTaniumHost"

// A debug-only launch extra that selects the separate-object bridges, to exercise the path used
// on a WebView without message-listener support.
const val EXTRA_FORCE_LEGACY_BRIDGES = "io.github.yor42.risutanium.FORCE_LEGACY_BRIDGES"

// A debug-only launch extra that asks a fresh launch to delete every vault key, to exercise the
// invalidated-key path.
const val EXTRA_DEBUG_DELETE_VAULT_KEYS = "io.github.yor42.risutanium.DEBUG_DELETE_VAULT_KEYS"

enum class BridgeMode { LISTENER, LEGACY }

// The delete request counts only in a debug build, so a release build ignores the extra and no
// production path ever removes a vault key.
fun shouldDeleteVaultKeys(debugBuild: Boolean, requested: Boolean): Boolean = debugBuild && requested

// LEGACY registers the separate host objects exactly as before. The force request counts only in a
// debug build, so a release build ignores the extra.
fun chooseBridgeMode(listenerSupported: Boolean, debugBuild: Boolean, forceLegacyRequested: Boolean): BridgeMode {
  if (!listenerSupported) return BridgeMode.LEGACY
  if (debugBuild && forceLegacyRequested) return BridgeMode.LEGACY
  return BridgeMode.LISTENER
}

// A message is acted on only from the main frame and only from the app origin; one trailing slash
// on either origin does not matter.
fun acceptsBridgeMessage(isMainFrame: Boolean, sourceOrigin: String, appOrigin: String): Boolean {
  return isMainFrame && normalized(sourceOrigin) == normalized(appOrigin)
}

private fun normalized(origin: String): String = if (origin.endsWith("/")) origin.dropLast(1) else origin

// A vault request: the reply carries the same id and the method named here.
interface VaultCommand {
  val id: Int
  val replyMethod: String
}

// One validated request from the page. Anything that does not fit a case below is dropped by the
// caller without an effect, as a bad value never throws.
sealed class BridgeCommand {
  object SubscribeGestureInset : BridgeCommand()
  object SubscribeIme : BridgeCommand()
  object SubscribeTouchExploration : BridgeCommand()
  data class SetBackground(val red: Int, val green: Int, val blue: Int) : BridgeCommand()
  data class KeepAliveStart(val title: String, val stopLabel: String) : BridgeCommand()
  data class KeepAliveUpdate(val title: String, val stopLabel: String) : BridgeCommand()
  object KeepAliveStop : BridgeCommand()
  data class KeepAliveStopAfter(val ms: Int) : BridgeCommand()
  // Contract v2: each carries the page's notice as a JSON string, because toCommand rejects nested values.
  data class KeepAliveStartState(val json: String) : BridgeCommand()
  data class KeepAliveUpdateState(val json: String) : BridgeCommand()
  data class KeepAliveStopAfterWithOutcome(val ms: Int, val json: String) : BridgeCommand()
  object KeepAliveRequestNotificationPermissionOnce : BridgeCommand()
  // The page asks for the chat a notification tap named; the answer goes to its hook.
  object KeepAliveRequestOpenTarget : BridgeCommand()
  // The page asks for the launch options (the shortcut's pack-safe request, the touch-exploration state); the answer goes to its hook.
  object KeepAliveRequestLaunchOptions : BridgeCommand()
  data class OpenedFilesTake(val id: Int) : BridgeCommand()
  // A take that has an id but a wrong argument list: it is answered with an empty reply.
  data class OpenedFilesMalformedTake(val id: Int) : BridgeCommand()
  data class OpenedFilesConfirm(val through: Long) : BridgeCommand()
  object ReplyNotificationsRefresh : BridgeCommand()
  object ReplyNotificationsEnable : BridgeCommand()
  object ReplyNotificationsDisable : BridgeCommand()
  object ReplyNotificationsOpenSettings : BridgeCommand()
  data class ReplyNotificationsNotify(val key: String, val title: String, val body: String, val silent: Boolean) : BridgeCommand()
  // Contract v2: carries the page's notice as a JSON string, because toCommand rejects nested values.
  data class ReplyNotificationsNotifyState(val json: String) : BridgeCommand()
  // The notices native posts for the reply that the positive token names; the arm is a JSON string for the same reason.
  data class ReplyNotificationsArmNative(val token: Int, val json: String) : BridgeCommand()
  data class ReplyNotificationsCancel(val key: String) : BridgeCommand()
  data class VaultAvailable(override val id: Int) : BridgeCommand(), VaultCommand {
    override val replyMethod: String get() = "keyVault.available"
  }
  data class VaultWrap(override val id: Int, val plain: String) : BridgeCommand(), VaultCommand {
    override val replyMethod: String get() = "keyVault.wrap"
  }
  data class VaultUnwrap(override val id: Int, val envelope: String) : BridgeCommand(), VaultCommand {
    override val replyMethod: String get() = "keyVault.unwrap"
  }
  // A known vault method with a wrong argument list and an id: answered with an `other` error.
  data class KeyVaultMalformed(override val id: Int, val method: String) : BridgeCommand(), VaultCommand {
    override val replyMethod: String get() = "keyVault.$method"
  }
  // The in-app update. A known method with a wrong argument list and an id is answered with an `other`
  // error; a call without an id has nobody to answer and is dropped. Cancel needs no id.
  data class AppUpdateCheck(val id: Int) : BridgeCommand()
  data class AppUpdateInstallPermission(val id: Int) : BridgeCommand()
  data class AppUpdateOpenInstallSettings(val id: Int) : BridgeCommand()
  data class AppUpdateInstall(val id: Int, val url: String, val size: Long, val versionCode: Long) : BridgeCommand()
  object AppUpdateCancel : BridgeCommand()
  data class AppUpdateMalformed(val id: Int, val method: String) : BridgeCommand()
}

// Largest magnitude a double holds exactly as an integer.
private const val MAX_EXACT_INTEGER = 9007199254740992.0

// A number that is a whole value: Int, Long, Short, Byte, or a Double or Float without a
// fractional part. Anything else, including a string, is not a number here.
private fun integral(value: Any?): Long? = when (value) {
  is Int -> value.toLong()
  is Long -> value
  is Short -> value.toLong()
  is Byte -> value.toLong()
  is Double -> if (value.isFinite() && value == Math.rint(value) && Math.abs(value) <= MAX_EXACT_INTEGER) value.toLong() else null
  is Float -> integral(value.toDouble())
  else -> null
}

private fun intArg(value: Any?): Int? {
  val whole = integral(value) ?: return null
  return if (whole >= Int.MIN_VALUE && whole <= Int.MAX_VALUE) whole.toInt() else null
}

fun toCommand(bridge: String, method: String, args: List<Any?>, id: Any?): BridgeCommand? = when (bridge) {
  "gestureInset" -> if (method == "subscribe" && args.isEmpty()) BridgeCommand.SubscribeGestureInset else null
  "ime" -> if (method == "subscribe" && args.isEmpty()) BridgeCommand.SubscribeIme else null
  "accessibility" -> if (method == "subscribe" && args.isEmpty()) BridgeCommand.SubscribeTouchExploration else null
  "systemBars" -> systemBarsCommand(method, args)
  "keepAlive" -> keepAliveCommand(method, args)
  "replyNotifications" -> replyNotificationsCommand(method, args)
  "openedFiles" -> openedFilesCommand(method, args, id)
  "keyVault" -> keyVaultCommand(method, args, id)
  "appUpdate" -> appUpdateCommand(method, args, id)
  else -> null
}

// The url is a bounded string (native re-validates it against the release pattern); size and
// versionCode are whole numbers inside the ranges the update accepts. Cancel carries no argument and
// needs no id, so it is accepted whatever id comes with it.
private fun appUpdateCommand(method: String, args: List<Any?>, id: Any?): BridgeCommand? {
  if (method == "cancel") return if (args.isEmpty()) BridgeCommand.AppUpdateCancel else null
  if (method != "check" && method != "installPermission" && method != "openInstallSettings" && method != "install") return null
  val requestId = intArg(id) ?: return null
  val malformed = BridgeCommand.AppUpdateMalformed(requestId, method)
  return when (method) {
    "check" -> if (args.isEmpty()) BridgeCommand.AppUpdateCheck(requestId) else malformed
    "installPermission" -> if (args.isEmpty()) BridgeCommand.AppUpdateInstallPermission(requestId) else malformed
    "openInstallSettings" -> if (args.isEmpty()) BridgeCommand.AppUpdateOpenInstallSettings(requestId) else malformed
    else -> {
      if (args.size != 3) return malformed
      val url = args[0] as? String ?: return malformed
      if (url.length > UPDATE_URL_MAX) return malformed
      val size = integral(args[1]) ?: return malformed
      val versionCode = integral(args[2]) ?: return malformed
      if (!acceptOfferedSize(size) || !acceptVersionCode(versionCode)) return malformed
      BridgeCommand.AppUpdateInstall(requestId, url, size, versionCode)
    }
  }
}

// A call without an integer id has nobody to answer and is dropped; a known method with a wrong
// argument list and an id is answered with an error, so the page never waits on it.
private fun keyVaultCommand(method: String, args: List<Any?>, id: Any?): BridgeCommand? {
  if (method != "available" && method != "wrap" && method != "unwrap") return null
  val vaultId = intArg(id) ?: return null
  val malformed = BridgeCommand.KeyVaultMalformed(vaultId, method)
  return when (method) {
    "available" -> if (args.isEmpty()) BridgeCommand.VaultAvailable(vaultId) else malformed
    "wrap" -> (args.singleOrNull() as? String)?.let { BridgeCommand.VaultWrap(vaultId, it) } ?: malformed
    else -> (args.singleOrNull() as? String)?.let { BridgeCommand.VaultUnwrap(vaultId, it) } ?: malformed
  }
}

private fun systemBarsCommand(method: String, args: List<Any?>): BridgeCommand? {
  if (method != "setBackground" || args.size != 3) return null
  val red = intArg(args[0]) ?: return null
  val green = intArg(args[1]) ?: return null
  val blue = intArg(args[2]) ?: return null
  return BridgeCommand.SetBackground(red, green, blue)
}

private fun keepAliveCommand(method: String, args: List<Any?>): BridgeCommand? {
  when (method) {
    "start", "update" -> {
      if (args.size != 2) return null
      val title = args[0] as? String ?: return null
      val stopLabel = args[1] as? String ?: return null
      return if (method == "start") BridgeCommand.KeepAliveStart(title, stopLabel) else BridgeCommand.KeepAliveUpdate(title, stopLabel)
    }
    "stop" -> return if (args.isEmpty()) BridgeCommand.KeepAliveStop else null
    "requestNotificationPermissionOnce" ->
      return if (args.isEmpty()) BridgeCommand.KeepAliveRequestNotificationPermissionOnce else null
    "requestOpenTarget" ->
      return if (args.isEmpty()) BridgeCommand.KeepAliveRequestOpenTarget else null
    "requestLaunchOptions" ->
      return if (args.isEmpty()) BridgeCommand.KeepAliveRequestLaunchOptions else null
    "stopAfter" -> {
      if (args.size != 1) return null
      val ms = intArg(args[0]) ?: return null
      return BridgeCommand.KeepAliveStopAfter(ms)
    }
    "startState", "updateState" -> {
      if (args.size != 1) return null
      val json = args[0] as? String ?: return null
      return if (method == "startState") BridgeCommand.KeepAliveStartState(json) else BridgeCommand.KeepAliveUpdateState(json)
    }
    "stopAfterWithOutcome" -> {
      if (args.size != 2) return null
      val ms = intArg(args[0]) ?: return null
      // An outcome that is not a string acts as a plain stopAfter, so the stop is never lost.
      val json = args[1] as? String ?: return BridgeCommand.KeepAliveStopAfter(ms)
      return BridgeCommand.KeepAliveStopAfterWithOutcome(ms, json)
    }
  }
  return null
}

// A notification key is a string of 1 to REPLY_KEY_MAX_LENGTH characters; the silent flag is a
// boolean, never a number or a string.
private fun replyNotificationsCommand(method: String, args: List<Any?>): BridgeCommand? {
  when (method) {
    "refresh" -> return if (args.isEmpty()) BridgeCommand.ReplyNotificationsRefresh else null
    "enable" -> return if (args.isEmpty()) BridgeCommand.ReplyNotificationsEnable else null
    "disable" -> return if (args.isEmpty()) BridgeCommand.ReplyNotificationsDisable else null
    "openNotificationSettings" -> return if (args.isEmpty()) BridgeCommand.ReplyNotificationsOpenSettings else null
    "notify" -> {
      if (args.size != 4) return null
      val key = args[0] as? String ?: return null
      val title = args[1] as? String ?: return null
      val body = args[2] as? String ?: return null
      val silent = args[3] as? Boolean ?: return null
      return if (isReplyKey(key)) BridgeCommand.ReplyNotificationsNotify(key, title, body, silent) else null
    }
    "notifyState" -> {
      if (args.size != 1) return null
      val json = args[0] as? String ?: return null
      return BridgeCommand.ReplyNotificationsNotifyState(json)
    }
    "armNative" -> {
      if (args.size != 2) return null
      val token = intArg(args[0]) ?: return null
      val json = args[1] as? String ?: return null
      return if (token > 0) BridgeCommand.ReplyNotificationsArmNative(token, json) else null
    }
    "cancel" -> {
      if (args.size != 1) return null
      val key = args[0] as? String ?: return null
      return if (isReplyKey(key)) BridgeCommand.ReplyNotificationsCancel(key) else null
    }
  }
  return null
}

private fun openedFilesCommand(method: String, args: List<Any?>, id: Any?): BridgeCommand? {
  when (method) {
    "take" -> {
      val takeId = intArg(id) ?: return null
      return if (args.isEmpty()) BridgeCommand.OpenedFilesTake(takeId) else BridgeCommand.OpenedFilesMalformedTake(takeId)
    }
    "confirm" -> {
      if (args.size != 1) return null
      val through = integral(args[0]) ?: return null
      return if (through >= 0) BridgeCommand.OpenedFilesConfirm(through) else null
    }
  }
  return null
}

// A value that is not a finite number is sent as 0.0.
fun encodeInsetEvent(value: Double): String {
  val finite = if (value.isFinite()) value else 0.0
  return "{\"event\":\"gestureInset\",\"value\":$finite}"
}

// The space the keyboard takes from the page: only what lies above the bars, which is what the
// bottom padding gives it. A floating keyboard reports no bottom inset and so reads as closed.
fun imeSpacePx(imeBottom: Int, barsBottom: Int): Int = maxOf(0, imeBottom - barsBottom)

// The keyboard state pushed to the page. A non-finite or negative height is sent as 0.0, and a
// height of 0 is never visible.
fun encodeImeEvent(visible: Boolean, heightDp: Double): String {
  val finite = if (heightDp.isFinite() && heightDp > 0.0) heightDp else 0.0
  return "{\"event\":\"ime\",\"visible\":${visible && finite > 0.0},\"height\":$finite}"
}

// The touch-exploration (TalkBack) state pushed to the page.
fun encodeTouchExplorationEvent(enabled: Boolean): String {
  return "{\"event\":\"touchExploration\",\"enabled\":$enabled}"
}

// takeJson is the JSON array the take produced, embedded as it is. through is the highest batch
// sequence the reply includes; 0 means none.
fun encodeTakeReply(id: Int, takeJson: String, through: Long): String {
  return "{\"id\":$id,\"result\":$takeJson,\"through\":$through}"
}

// A vault reply names its request's id and method. Success carries the value (an envelope, the
// plaintext, or a JSON boolean for available); failure carries the code.
fun encodeVaultReply(id: Int, method: String, result: VaultResult): String {
  val head = "{\"id\":$id,\"method\":${jsonString(method)}"
  return when (result) {
    is VaultResult.Value -> "$head,\"vault\":\"ok\",\"value\":${jsonString(result.text)}}"
    is VaultResult.Flag -> "$head,\"vault\":\"ok\",\"value\":${result.value}}"
    is VaultResult.Error -> "$head,\"vault\":\"error\",\"code\":${jsonString(result.code.wire)}}"
  }
}

// Quotes, backslashes, control characters and the line separators U+2028/2029 are escaped; every
// other character, a supplementary one included, is passed through.
internal fun jsonString(value: String): String {
  val out = StringBuilder(value.length + 2).append('"')
  for (char in value) {
    when {
      char == '"' -> out.append("\\\"")
      char == '\\' -> out.append("\\\\")
      char < ' ' || char == '\u2028' || char == '\u2029' -> {
        out.append("\\u")
        val hex = Integer.toHexString(char.code)
        for (pad in hex.length until 4) out.append('0')
        out.append(hex)
      }
      else -> out.append(char)
    }
  }
  return out.append('"').toString()
}

class PendingSnapshot<T>(val batches: List<T>, val through: Long)

// The opened-files queue. A batch gets an increasing sequence when it is queued. A snapshot
// leaves its batches in place, so a reply that never arrives loses nothing; confirm(through)
// removes every batch up to that sequence, so a later batch survives. takeAll is the separate-
// object path's atomic take.
class PendingBatches<T> {
  private class Entry<T>(val sequence: Long, val batch: T)

  private val lock = Any()
  private val entries = ArrayList<Entry<T>>()
  private var lastSequence = 0L

  fun enqueue(batch: T): Long = synchronized(lock) {
    lastSequence += 1
    entries.add(Entry(lastSequence, batch))
    lastSequence
  }

  fun snapshot(): PendingSnapshot<T> = synchronized(lock) {
    PendingSnapshot(entries.map { it.batch }, entries.lastOrNull()?.sequence ?: 0L)
  }

  fun confirm(through: Long) {
    synchronized(lock) { entries.removeAll { it.sequence <= through } }
  }

  fun takeAll(): List<T> = synchronized(lock) {
    val taken = snapshot()
    confirm(taken.through)
    taken.batches
  }
}
