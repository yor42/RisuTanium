package io.github.yor42.risutanium

import android.content.Intent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
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

  // Records what an answer handed to the page and how often the stored flag was cleared.
  private class Page(var delivers: Boolean = true) {
    val answers = mutableListOf<Boolean>()
    var clearCalls = 0
    var clearResult: Boolean = true
    var clearThrows = false

    fun ask(session: PackSafeSession) {
      session.answer(
        { value -> answers.add(value); delivers },
        {
          clearCalls++
          if (clearThrows) throw RuntimeException("boom")
          clearResult
        }
      )
    }
  }

  @Test
  fun aRequestIsAnsweredEveryTimeUntilTheProcessEnds() {
    val session = PackSafeSession()
    val page = Page()
    page.ask(session)
    session.request()
    page.ask(session)
    page.ask(session)
    page.ask(session)
    assertEquals(listOf(false, true, true, true), page.answers)
    assertEquals(0, page.clearCalls)
  }

  @Test
  fun withoutARequestOrTheStoredFlagTheAnswerIsFalse() {
    val session = PackSafeSession()
    val page = Page()
    session.loadNextStart { false }
    page.ask(session)
    assertEquals(listOf(false), page.answers)
    val before = PackSafeSession()
    before.request()
    before.loadNextStart { false }
    page.ask(before)
    val after = PackSafeSession()
    after.loadNextStart { false }
    after.request()
    page.ask(after)
    assertEquals(listOf(false, true, true), page.answers)
    assertEquals(0, page.clearCalls)
  }

  @Test
  fun theStoredFlagKeepsTheAnswerTrueAndIsClearedAfterTheFirstDeliveredAnswer() {
    val session = PackSafeSession()
    session.loadNextStart { true }
    val page = Page(delivers = false)
    page.ask(session)
    page.ask(session)
    assertEquals(listOf(true, true), page.answers)
    assertEquals(0, page.clearCalls)
    page.delivers = true
    page.ask(session)
    assertEquals(1, page.clearCalls)
    page.ask(session)
    page.ask(session)
    assertEquals(listOf(true, true, true, true, true), page.answers)
    assertEquals(1, page.clearCalls)
  }

  @Test
  fun aLaterLoadWithoutTheFlagNeverClearsTheSession() {
    val session = PackSafeSession()
    session.loadNextStart { true }
    session.loadNextStart { false }
    val page = Page()
    page.ask(session)
    assertEquals(listOf(true), page.answers)
    assertEquals(1, page.clearCalls)
  }

  @Test
  fun aFailedOrThrowingRemovalIsRetriedAtTheNextAnswerAndNeverEscapes() {
    val session = PackSafeSession()
    session.loadNextStart { true }
    val page = Page()
    page.clearResult = false
    page.ask(session)
    page.ask(session)
    assertEquals(2, page.clearCalls)
    page.clearThrows = true
    page.ask(session)
    assertEquals(3, page.clearCalls)
    page.clearThrows = false
    page.clearResult = true
    page.ask(session)
    assertEquals(4, page.clearCalls)
    page.ask(session)
    assertEquals(4, page.clearCalls)
    assertEquals(listOf(true, true, true, true, true), page.answers)
  }

  @Test
  fun aThrowingReadOfTheStoredFlagGivesTrue() {
    val session = PackSafeSession()
    session.loadNextStart { throw RuntimeException("boom") }
    val page = Page()
    page.ask(session)
    assertEquals(listOf(true), page.answers)
    assertEquals(1, page.clearCalls)
  }

  @Test
  fun aThrowingDeliveryNeverEscapesAndKeepsTheFlag() {
    val session = PackSafeSession()
    session.loadNextStart { true }
    var clearCalls = 0
    session.answer({ throw RuntimeException("boom") }, { clearCalls++; true })
    assertEquals(0, clearCalls)
    val page = Page()
    page.ask(session)
    assertEquals(listOf(true), page.answers)
    assertEquals(1, page.clearCalls)
  }

  @Test
  fun theRelaunchCarriesThePackSafeActionOnlyWhileTheSessionIsOn() {
    val session = PackSafeSession()
    assertNull(session.relaunchAction())
    session.request()
    assertEquals(ACTION_START_WITHOUT_THEME_PACK, session.relaunchAction())
    val fromFlag = PackSafeSession()
    fromFlag.loadNextStart { true }
    assertEquals(ACTION_START_WITHOUT_THEME_PACK, fromFlag.relaunchAction())
    val none = PackSafeSession()
    none.loadNextStart { false }
    assertNull(none.relaunchAction())
  }

  @Test
  fun theAnswerIsTwoBooleans() {
    assertEquals("{\"packSafeMode\":true,\"touchExploration\":false}", encodeLaunchOptions(true, false))
    assertEquals("{\"packSafeMode\":false,\"touchExploration\":true}", encodeLaunchOptions(false, true))
  }
}
