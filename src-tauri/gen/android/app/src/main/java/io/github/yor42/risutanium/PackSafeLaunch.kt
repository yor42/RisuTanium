package io.github.yor42.risutanium

import android.content.Intent

// The launcher shortcut "Start without theme pack". Plain Kotlin besides the Intent flag constants,
// which the compiler inlines, so the rules run in JVM tests; PackSafeLaunchActivity and MainActivity
// apply them. MainActivity and the trampoline are exported, so any app can send the action: the effect is the same as the
// shortcut's (the page turns the theme pack off for this session, nothing is written), and the page
// validates the answer again.

const val ACTION_START_WITHOUT_THEME_PACK = "io.github.yor42.risutanium.action.START_WITHOUT_THEME_PACK"

fun isPackSafeModeIntent(action: String?): Boolean = action == ACTION_START_WITHOUT_THEME_PACK

// What the trampoline starts MainActivity with. NEW_TASK joins the existing task instead of starting a
// second one, and SINGLE_TOP delivers the intent to the running activity without recreating it. Never
// CLEAR_TASK or CLEAR_TOP: either would finish or recreate a running MainActivity and lose the open chat's
// unsent draft.
class PackSafeForward(val action: String, val flags: Int)

fun packSafeForward(): PackSafeForward =
  PackSafeForward(ACTION_START_WITHOUT_THEME_PACK, Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)

// The request a shortcut launch made, held until the page asks for it. Main thread only. Taking it
// clears it, so one launch is answered once: a page reload or a later ask finds none.
class PendingPackSafe {
  private var pending = false

  fun arm() {
    pending = true
  }

  fun take(): Boolean {
    val taken = pending
    pending = false
    return taken
  }
}

// The JavaScript literal the page's launch-options hook is called with. touchExploration is read at
// answer time and is not consumed: the page uses it to keep its banner up while TalkBack is on.
fun encodeLaunchOptions(packSafeMode: Boolean, touchExploration: Boolean): String =
  "{\"packSafeMode\":$packSafeMode,\"touchExploration\":$touchExploration}"
