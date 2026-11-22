package io.github.yor42.risutanium

import android.content.Intent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PackSafeLaunchTest {
  @Test
  fun onlyTheShortcutActionIsAPackSafeRequest() {
    assertTrue(isPackSafeModeIntent("io.github.yor42.risutanium.action.START_WITHOUT_THEME_PACK"))
    assertTrue(isPackSafeModeIntent(ACTION_START_WITHOUT_THEME_PACK))
    assertFalse(isPackSafeModeIntent(null))
    assertFalse(isPackSafeModeIntent(""))
    assertFalse(isPackSafeModeIntent("android.intent.action.MAIN"))
    assertFalse(isPackSafeModeIntent(ACTION_OPEN_CHAT))
    assertFalse(isPackSafeModeIntent("$ACTION_START_WITHOUT_THEME_PACK "))
  }

  @Test
  fun theForwardJoinsTheTaskAndNeverClearsIt() {
    val forward = packSafeForward()
    assertEquals(ACTION_START_WITHOUT_THEME_PACK, forward.action)
    assertTrue(forward.flags and Intent.FLAG_ACTIVITY_NEW_TASK != 0)
    assertTrue(forward.flags and Intent.FLAG_ACTIVITY_SINGLE_TOP != 0)
    assertEquals(0, forward.flags and Intent.FLAG_ACTIVITY_CLEAR_TASK)
    assertEquals(0, forward.flags and Intent.FLAG_ACTIVITY_CLEAR_TOP)
    assertEquals(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP, forward.flags)
  }

  @Test
  fun theRequestIsAnsweredOnceAndThenCleared() {
    val pending = PendingPackSafe()
    assertFalse(pending.take())
    pending.arm()
    assertTrue(pending.take())
    assertFalse(pending.take())
    pending.arm()
    pending.arm()
    assertTrue(pending.take())
    assertFalse(pending.take())
  }

  @Test
  fun theAnswerIsTwoBooleans() {
    assertEquals("{\"packSafeMode\":true,\"touchExploration\":false}", encodeLaunchOptions(true, false))
    assertEquals("{\"packSafeMode\":false,\"touchExploration\":true}", encodeLaunchOptions(false, true))
  }
}
