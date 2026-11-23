package io.github.yor42.risutanium

import java.security.SecureRandom

sealed class FlowState {
  object Idle : FlowState()
  data class Running(val gen: Long, val name: String) : FlowState()
  data class Launching(val gen: Long, val name: String) : FlowState()
  data class Installing(val gen: Long, val name: String) : FlowState()
}

sealed class FlowAction {
  object DeleteAll : FlowAction()
  data class StartJob(val gen: Long, val name: String) : FlowAction()
  data class Launch(val gen: Long, val name: String) : FlowAction()
  data class RevokeGrant(val name: String) : FlowAction()
  data class Reply(val gen: Long, val reply: UpdateReply) : FlowAction()
  data class MarkCancelled(val gen: Long) : FlowAction()
}

// A busy reply belongs to the request that was just refused, which has no generation.
const val NO_GENERATION = 0L

private const val NAME_DRAW_LIMIT = 16

fun randomUpdateName(): String {
  val bytes = ByteArray(16)
  SecureRandom().nextBytes(bytes)
  val hex = StringBuilder("update-")
  for (byte in bytes) hex.append(String.format("%02x", byte.toInt() and 0xff))
  return hex.append(".apk").toString()
}

// The state machine of one update attempt at a time. Every method runs on the main thread and returns
// the actions the caller executes in order. Invariants:
// - An accepted generation is answered by exactly one Reply, unless the process dies.
// - A grant is revoked before the file is deleted.
// - A name is never issued twice in a process, so a grant can never expose an earlier attempt's file.
//   Other apps cannot reach the private cache. Within this app the verified file is protected in layers:
//   the page's fs scope and its denies in src-tauri/capabilities/android.json keep path-form commands out
//   of cache/app-update, the fs gate refuses file:// URLs and write opens (the plugin alone would skip the
//   scope for a URL on Android), the file is sealed read-only before it is verified (so a write-mode open
//   would fail even without the gate), and its random name is never sent to the page.
// - jobFinished acts only while the state is Running for that same generation.
class AppUpdateFlow(private val drawName: () -> String = ::randomUpdateName) {
  var state: FlowState = FlowState.Idle
    private set
  var newestGen = 0L
    private set
  var cancelledThrough = 0L
    private set
  private var foreground = false
  private var swept = false
  private val issued = HashSet<String>()

  fun isCancelled(gen: Long): Boolean = gen <= cancelledThrough

  fun processStart(): List<FlowAction> {
    if (swept) return emptyList()
    swept = true
    return listOf(FlowAction.DeleteAll)
  }

  // A new check or a new page ends whatever attempt is current. The page that asked is being replaced,
  // so its request is answered `cancelled` after the grant and the file are gone.
  fun newCheck(): List<FlowAction> {
    val current = state
    state = FlowState.Idle
    return when (current) {
      is FlowState.Idle -> listOf(FlowAction.DeleteAll)
      is FlowState.Running -> listOf(
        FlowAction.MarkCancelled(current.gen),
        FlowAction.DeleteAll,
        cancelledReply(current.gen)
      )
      is FlowState.Launching -> listOf(FlowAction.DeleteAll, cancelledReply(current.gen))
      is FlowState.Installing -> listOf(
        FlowAction.RevokeGrant(current.name),
        FlowAction.DeleteAll,
        cancelledReply(current.gen)
      )
    }
  }

  fun newPage(): List<FlowAction> = newCheck()

  fun accept(): List<FlowAction> {
    if (state != FlowState.Idle) {
      return listOf(FlowAction.Reply(NO_GENERATION, UpdateReply.Failure(UpdateErrorCode.BUSY)))
    }
    val name = fresh()
    val gen = ++newestGen
    state = FlowState.Running(gen, name)
    return listOf(FlowAction.StartJob(gen, name))
  }

  fun cancel(): List<FlowAction> {
    cancelledThrough = newestGen
    return when (val current = state) {
      is FlowState.Running -> listOf(FlowAction.MarkCancelled(current.gen))
      is FlowState.Launching -> {
        state = FlowState.Idle
        listOf(FlowAction.DeleteAll, cancelledReply(current.gen))
      }
      // The installer owns the screen; installerReturned settles the request.
      is FlowState.Installing -> emptyList()
      is FlowState.Idle -> emptyList()
    }
  }

  fun jobFinished(gen: Long, result: JobResult): List<FlowAction> {
    val current = state
    if (current !is FlowState.Running || current.gen != gen) return emptyList()
    if (result is JobResult.Cancelled || isCancelled(gen)) {
      state = FlowState.Idle
      return listOf(FlowAction.DeleteAll, cancelledReply(gen))
    }
    return when (result) {
      is JobResult.Failed -> {
        state = FlowState.Idle
        listOf(FlowAction.DeleteAll, FlowAction.Reply(gen, UpdateReply.Failure(result.code, result.needed)))
      }
      // A background activity start is blocked from API 29, so a paused app waits in Launching.
      is JobResult.Ok -> if (foreground) {
        state = FlowState.Installing(gen, current.name)
        listOf(FlowAction.Launch(gen, current.name))
      } else {
        state = FlowState.Launching(gen, current.name)
        emptyList()
      }
      is JobResult.Cancelled -> emptyList()
    }
  }

  fun resumed(): List<FlowAction> {
    foreground = true
    val current = state
    if (current is FlowState.Launching && !isCancelled(current.gen)) {
      state = FlowState.Installing(current.gen, current.name)
      return listOf(FlowAction.Launch(current.gen, current.name))
    }
    return emptyList()
  }

  fun paused(): List<FlowAction> {
    foreground = false
    return emptyList()
  }

  // The install permission was off at the last check before the hand-off. No grant exists yet.
  fun launchRefused(gen: Long): List<FlowAction> {
    val current = state
    if (current !is FlowState.Installing || current.gen != gen) return emptyList()
    state = FlowState.Idle
    return listOf(FlowAction.DeleteAll, FlowAction.Reply(gen, UpdateReply.Failure(UpdateErrorCode.PERMISSION)))
  }

  fun launchFailed(gen: Long): List<FlowAction> {
    val current = state
    if (current !is FlowState.Installing || current.gen != gen) return emptyList()
    state = FlowState.Idle
    return listOf(
      FlowAction.RevokeGrant(current.name),
      FlowAction.DeleteAll,
      FlowAction.Reply(gen, UpdateReply.Outcome(InstallOutcome.NOT_INSTALLED))
    )
  }

  fun installerReturned(): List<FlowAction> {
    val current = state
    if (current !is FlowState.Installing) return emptyList()
    state = FlowState.Idle
    return listOf(
      FlowAction.RevokeGrant(current.name),
      FlowAction.DeleteAll,
      FlowAction.Reply(current.gen, UpdateReply.Outcome(InstallOutcome.NOT_INSTALLED))
    )
  }

  private fun cancelledReply(gen: Long) = FlowAction.Reply(gen, UpdateReply.Failure(UpdateErrorCode.CANCELLED))

  private fun fresh(): String {
    repeat(NAME_DRAW_LIMIT) {
      val name = drawName()
      if (issued.add(name)) return name
    }
    throw IllegalStateException("no unused update name")
  }
}
