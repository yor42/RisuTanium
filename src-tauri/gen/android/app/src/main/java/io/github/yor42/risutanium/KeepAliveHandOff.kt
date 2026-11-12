package io.github.yor42.risutanium

// A page message that arrived while no service instance could apply it.
sealed class HeldMessage

// An update notice, replayed through the same path a live update takes.
data class HeldUpdate(val notice: KeepAliveNotice) : HeldMessage()

// The closing notice of the delayed stop; null when it could not be read.
data class HeldOutcome(val notice: KeepAliveNotice?) : HeldMessage()

// Where an offered message went.
enum class OfferRoute { APPLY, HELD_NO_INSTANCE, HELD_START_PENDING }

// The most messages held at once; the oldest is dropped past it.
const val MAX_HELD_MESSAGES = 32

// The order contract between the page's messages and the service's start commands (MC-1517, MC-091).
// A start the service accepted is numbered; the number travels in the start intent. A page message sent
// after an accepted start may reach a service instance that has not handled that start's command yet (a
// fresh instance before onStartCommand, or a lingering instance with a newer start pending). Applying it
// there would be overwritten by the start's own notice or lost, so it is held with the number of the
// latest accepted start and replayed, in arrival order, when that start's command is handled (MC-1496,
// MC-1497, MC-1508 keep their order). Everything here runs on the main thread only, like the running
// instance reference it serves; there is no locking. S is the service instance type.
class KeepAliveHandOff<S : Any> {
  private class Entry(val tag: Int, val message: HeldMessage)

  private val held = ArrayList<Entry>()

  // The latest start the service accepted, and the latest start command a live instance handled.
  private var issued = 0
  private var handled = 0

  // How many messages the cap has dropped so far; the service logs when it grows.
  var capDrops: Int = 0
    private set

  // How many held messages the last startHandled dropped because their start was never handled.
  var lastSkipped: Int = 0
    private set

  // The number the next accepted start will carry. It changes nothing.
  fun nextStart(): Int = issued + 1

  // Runs the launch and records the start as accepted only when it returned; a launch that throws leaves
  // the numbering and the queue as they were.
  fun launchStart(start: Int, launch: () -> Unit) {
    launch()
    issued = start
  }

  // Applies the update on the live instance when it has handled the latest start; otherwise holds it.
  fun offerUpdate(instance: S?, notice: KeepAliveNotice, apply: (S, KeepAliveNotice) -> Unit): OfferRoute {
    if (instance != null && handled == issued) {
      apply(instance, notice)
      return OfferRoute.APPLY
    }
    return hold(instance, HeldUpdate(notice))
  }

  // Applies the closing outcome like offerUpdate does an update. Updates and outcomes share one queue, so
  // their arrival order is kept.
  fun offerOutcome(instance: S?, notice: KeepAliveNotice?, apply: (S, KeepAliveNotice?) -> Unit): OfferRoute {
    if (instance != null && handled == issued) {
      apply(instance, notice)
      return OfferRoute.APPLY
    }
    return hold(instance, HeldOutcome(notice))
  }

  // Tags the message with the latest accepted start. Past the cap the oldest message goes.
  private fun hold(instance: S?, message: HeldMessage): OfferRoute {
    held.add(Entry(issued, message))
    while (held.size > MAX_HELD_MESSAGES) {
      held.removeAt(0)
      capDrops++
    }
    return if (instance == null) OfferRoute.HELD_NO_INSTANCE else OfferRoute.HELD_START_PENDING
  }

  // The instance handled the command of this start: the messages held for it, in arrival order. The
  // messages of older starts are dropped, those of newer starts stay, and the command of start 0 (the
  // stop action or a null intent) changes nothing. The handled start never moves backwards: a stale or
  // lower command must not reopen direct apply while a newer start is pending.
  fun startHandled(start: Int): List<HeldMessage> {
    lastSkipped = 0
    if (start == 0) return emptyList()
    handled = maxOf(handled, start)
    val replay = ArrayList<HeldMessage>()
    val kept = ArrayList<Entry>()
    for (entry in held) {
      when {
        entry.tag < start -> lastSkipped++
        entry.tag == start -> replay.add(entry.message)
        else -> kept.add(entry)
      }
    }
    held.clear()
    held.addAll(kept)
    return replay
  }

  // A stop clears the queue and returns how many messages it held.
  fun stopped(): Int {
    val count = held.size
    held.clear()
    return count
  }

  // The running instance ended; its held messages stay for the next instance of the same start, which
  // holds until it handles that start's command.
  fun instanceGone() {
    handled = 0
  }
}

// What one start command does, in order, for the service to supply. showIntentNotice shows the notice the
// intent carries; applyHeld applies one replayed message without reposting; enterStopTap is the Stop
// tap's entry to Stopping; startForeground answers whether the foreground start was accepted;
// endIfWanted is the early end check (MC-1508); deliverStop tells the page about the tap.
interface StartCommandHost {
  fun showIntentNotice()
  fun applyHeld(message: HeldMessage)
  fun enterStopTap(): StopTap
  fun startForeground(): Boolean
  fun endIfWanted()
  fun deliverStop(tap: StopTap)
}

// The order of one start command: the intent's notice, then the messages held for this start, then the
// Stop tap's entry, then the foreground start (it posts the one card for all of them), and only after a
// successful foreground start the early end check when the replay held an outcome and the stop delivery.
// ACTION_STOP carries no start number, so a stop command replays nothing and drops nothing.
fun runStartCommand(handOff: KeepAliveHandOff<*>, start: Int, stopAction: Boolean, host: StartCommandHost) {
  host.showIntentNotice()
  val replay = handOff.startHandled(start)
  for (message in replay) {
    host.applyHeld(message)
  }
  val tap = if (stopAction) host.enterStopTap() else StopTap.PLAIN
  if (!host.startForeground()) return
  if (replay.any { it is HeldOutcome }) {
    host.endIfWanted()
  }
  if (stopAction) {
    host.deliverStop(tap)
  }
}
