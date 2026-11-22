package io.github.yor42.risutanium

import android.content.Intent

// The launcher shortcut "Start without theme pack". Plain Kotlin besides the Intent flag constants,
// which the compiler inlines, so the rules run in JVM tests; PackSafeLaunchActivity and MainActivity
// apply them. MainActivity and the trampoline are exported, so any app can send the action: the effect is the same as the
// shortcut's (the page turns the theme pack off for this session, nothing is written, and the session
// keeps it off until the process ends), and the page validates the answer again.

const val ACTION_START_WITHOUT_THEME_PACK = "io.github.yor42.risutanium.action.START_WITHOUT_THEME_PACK"

fun isPackSafeModeIntent(action: String?): Boolean = action == ACTION_START_WITHOUT_THEME_PACK

// What the trampoline starts MainActivity with. NEW_TASK joins the existing task instead of starting a
// second one, and SINGLE_TOP delivers the intent to the running activity without recreating it. Never
// CLEAR_TASK or CLEAR_TOP: either would finish or recreate a running MainActivity and lose the open chat's
// unsent draft.
class PackSafeForward(val action: String, val flags: Int)

fun packSafeForward(): PackSafeForward =
  PackSafeForward(ACTION_START_WITHOUT_THEME_PACK, Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)

// The pack-safe decision of one process. Main thread only. Once on, it stays on until the process ends:
// every answer, a page reload and a relaunch after a renderer loss give the same decision, and a
// later load that finds no stored flag never turns it off. A stored next-start flag (a crash-loop exit)
// turns it on and is removed only after an answer was handed to a page; a failed removal is retried at
// the next answer, so the flag can outlive its start but never be lost before it was used.
class PackSafeSession {
  private var on = false
  private var nextStartHeld = false

  fun request() {
    on = true
  }

  // A read that throws counts as a stored flag: failing safe keeps the pack off.
  fun loadNextStart(read: () -> Boolean) {
    val stored = try {
      read()
    } catch (_: Exception) {
      true
    }
    if (stored) {
      on = true
      nextStartHeld = true
    }
  }

  // Hands the decision to the page through deliver, which says whether the page was reached. Neither
  // callback can throw out of here.
  fun answer(deliver: (Boolean) -> Boolean, clearNextStart: () -> Boolean) {
    val delivered = try {
      deliver(on)
    } catch (_: Exception) {
      false
    }
    if (!delivered || !nextStartHeld) return
    val cleared = try {
      clearNextStart()
    } catch (_: Exception) {
      false
    }
    if (cleared) nextStartHeld = false
  }

  // The action a restart after a renderer loss carries, so the relaunched process asks for pack-safe too.
  fun relaunchAction(): String? = if (on) ACTION_START_WITHOUT_THEME_PACK else null
}

// The one session of this process; the activity, the trampoline and the loss relaunch share it.
val packSafeSession = PackSafeSession()

// The JavaScript literal the page's launch-options hook is called with. touchExploration is read at
// answer time and is not consumed: the page uses it to keep its banner up while TalkBack is on.
fun encodeLaunchOptions(packSafeMode: Boolean, touchExploration: Boolean): String =
  "{\"packSafeMode\":$packSafeMode,\"touchExploration\":$touchExploration}"
