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

enum class BridgeMode { LISTENER, LEGACY }

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

// One validated request from the page. Anything that does not fit a case below is dropped by the
// caller without an effect, as a bad value never throws.
sealed class BridgeCommand {
  object SubscribeGestureInset : BridgeCommand()
  data class SetBackground(val red: Int, val green: Int, val blue: Int) : BridgeCommand()
  data class KeepAliveStart(val title: String, val stopLabel: String) : BridgeCommand()
  data class KeepAliveUpdate(val title: String, val stopLabel: String) : BridgeCommand()
  object KeepAliveStop : BridgeCommand()
  data class KeepAliveStopAfter(val ms: Int) : BridgeCommand()
  object KeepAliveRequestNotificationPermissionOnce : BridgeCommand()
  data class OpenedFilesTake(val id: Int) : BridgeCommand()
  // A take that has an id but a wrong argument list: it is answered with an empty reply.
  data class OpenedFilesMalformedTake(val id: Int) : BridgeCommand()
  data class OpenedFilesConfirm(val through: Long) : BridgeCommand()
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
  "systemBars" -> systemBarsCommand(method, args)
  "keepAlive" -> keepAliveCommand(method, args)
  "openedFiles" -> openedFilesCommand(method, args, id)
  else -> null
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
    "stopAfter" -> {
      if (args.size != 1) return null
      val ms = intArg(args[0]) ?: return null
      return BridgeCommand.KeepAliveStopAfter(ms)
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

// takeJson is the JSON array the take produced, embedded as it is. through is the highest batch
// sequence the reply includes; 0 means none.
fun encodeTakeReply(id: Int, takeJson: String, through: Long): String {
  return "{\"id\":$id,\"result\":$takeJson,\"through\":$through}"
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
