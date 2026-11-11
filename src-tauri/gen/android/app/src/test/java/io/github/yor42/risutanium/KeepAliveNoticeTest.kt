package io.github.yor42.risutanium

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class KeepAliveNoticeTest {
  private fun notice(
    state: NoticeState = NoticeState.GENERATING,
    title: String = "Generating a reply…",
    text: String = "",
    startedAtMs: Long? = 1_000_000L,
    stopLabel: String = "Stop",
    publicTitle: String = "Generating a reply…",
    identity: NoticeIdentity? = null,
    target: NoticeTarget? = NoticeTarget("g1", "c1")
  ) = KeepAliveNotice(
    state = state,
    title = title,
    text = text,
    startedAtMs = startedAtMs,
    stopLabel = stopLabel,
    publicTitle = publicTitle,
    stoppingTitle = "Stopping…",
    stoppedTitle = "Stopped",
    identity = identity,
    avatar = null,
    target = target
  )

  private val alice = NoticeIdentity("c1", "Alice")

  private fun wire(vararg overrides: Pair<String, Any?>): Map<String, Any?> {
    val base = mutableMapOf<String, Any?>(
      "v" to 2,
      "state" to "generating",
      "title" to "Generating a reply…",
      "text" to "",
      "startedAt" to 1_000_000.0,
      "stopLabel" to "Stop",
      "publicTitle" to "Generating a reply…",
      "stoppingTitle" to "Stopping…",
      "stoppedTitle" to "Stopped",
      "identity" to null,
      "avatar" to null,
      "target" to mapOf("chaId" to "g1", "chatId" to "c1")
    )
    for ((key, value) in overrides) base[key] = value
    return base
  }

  // J1: what a notice shows.

  @Test
  fun aGeneratingNoticeShowsTheChronometerAndStop() {
    val plan = noticePlan(notice(), stopping = false, sdk = 34)
    assertEquals("Generating a reply…", plan.title)
    assertEquals("", plan.text)
    assertTrue(plan.chronometer)
    assertEquals(1_000_000L, plan.whenMs)
    assertEquals("Stop", plan.actionLabel)
  }

  @Test
  fun theChronometerFollowsTheStateAndTheStartTime() {
    for (state in listOf(NoticeState.GENERATING, NoticeState.SPEAKING, NoticeState.IMAGE, NoticeState.TRANSLATING, NoticeState.WORKING)) {
      assertTrue(state.wire, noticePlan(notice(state = state), false, 34).chronometer)
      assertFalse(state.wire, noticePlan(notice(state = state, startedAtMs = null), false, 34).chronometer)
    }
    for (state in listOf(NoticeState.SAVE_PENDING, NoticeState.FINISHING, NoticeState.STOPPED, NoticeState.FAILED)) {
      assertFalse(state.wire, noticePlan(notice(state = state), false, 34).chronometer)
    }
  }

  @Test
  fun theStopActionExistsOnlyForAReplyOrSpeechAndNeverInTheLingersOrSavePending() {
    assertEquals("Stop", noticePlan(notice(state = NoticeState.GENERATING), false, 34).actionLabel)
    assertEquals("Stop", noticePlan(notice(state = NoticeState.SPEAKING), false, 34).actionLabel)
    for (state in listOf(NoticeState.IMAGE, NoticeState.TRANSLATING, NoticeState.WORKING, NoticeState.SAVE_PENDING, NoticeState.FINISHING, NoticeState.STOPPED, NoticeState.FAILED)) {
      assertNull(state.wire, noticePlan(notice(state = state), false, 34).actionLabel)
    }
    assertNull(noticePlan(notice(stopLabel = ""), false, 34).actionLabel)
  }

  @Test
  fun theStopActionNeedsTheDeviceUnlockedFromAndroid12() {
    assertTrue(noticePlan(notice(), false, 31).authRequired)
    assertTrue(noticePlan(notice(), false, 34).authRequired)
    assertFalse(noticePlan(notice(), false, 30).authRequired)
    assertFalse(noticePlan(notice(), false, 29).authRequired)
    assertTrue(noticePlan(notice(), false, 31).publicVersion.authRequired)
    assertFalse(noticePlan(notice(), false, 29).publicVersion.authRequired)
    assertTrue(authRequiredFor(31))
    assertFalse(authRequiredFor(30))
  }

  @Test
  fun thePublicVersionShowsTheStateTitleKeepsTheChronometerAndStopAndNamesNobody() {
    val plan = noticePlan(
      notice(title = "Generating a reply…", publicTitle = "Generating a reply…", text = "secret text", identity = alice),
      stopping = false,
      sdk = 34
    )
    assertEquals("Alice", plan.title)
    assertEquals("Generating a reply…", plan.publicVersion.title)
    assertTrue(plan.publicVersion.chronometer)
    assertEquals(1_000_000L, plan.publicVersion.whenMs)
    assertEquals("Stop", plan.publicVersion.actionLabel)
    assertFalse(plan.publicVersion.title.contains("Alice"))
  }

  @Test
  fun thePublicVersionHasNoStopInStoppingTheLingersOrSavePending() {
    assertNull(noticePlan(notice(), stopping = true, sdk = 34).publicVersion.actionLabel)
    for (state in listOf(NoticeState.STOPPED, NoticeState.FAILED, NoticeState.FINISHING, NoticeState.SAVE_PENDING)) {
      assertNull(state.wire, noticePlan(notice(state = state), false, 34).publicVersion.actionLabel)
    }
  }

  @Test
  fun stoppingShowsTheStoppingTitleWithNoActionAndNoChronometer() {
    val plan = noticePlan(notice(publicTitle = "Generating a reply…"), stopping = true, sdk = 34)
    assertEquals("Stopping…", plan.title)
    assertNull(plan.actionLabel)
    assertFalse(plan.chronometer)
    assertFalse(plan.publicVersion.chronometer)
    assertEquals("Generating a reply…", plan.publicVersion.title)
  }

  @Test
  fun aReplyStateWithAnIdentityShowsTheNameAsTitleAndTheStateTitleAsText() {
    val plan = noticePlan(notice(identity = alice), false, 34)
    assertEquals("Alice", plan.title)
    assertEquals("Generating a reply…", plan.text)
    assertEquals("c1", plan.largeIconKey)
  }

  @Test
  fun aFailedNoticeJoinsItsHintToTheTitleWithTheSeparator() {
    val failed = notice(state = NoticeState.FAILED, title = "Reply failed", text = "Open the app to see why.", startedAtMs = null, stopLabel = "", identity = alice)
    val plan = noticePlan(failed, false, 34)
    assertEquals("Alice", plan.title)
    assertEquals("Reply failed · Open the app to see why.", plan.text)
    val anonymous = noticePlan(failed.copy(identity = null), false, 34)
    assertEquals("Reply failed", anonymous.title)
    assertEquals("Open the app to see why.", anonymous.text)
  }

  @Test
  fun stoppingWithAnIdentityKeepsTheNameAndShowsTheStoppingTitleAsText() {
    val plan = noticePlan(notice(identity = alice), stopping = true, sdk = 34)
    assertEquals("Alice", plan.title)
    assertEquals("Stopping…", plan.text)
  }

  @Test
  fun onlyAReplyStateNamesACharacterOrCarriesATarget() {
    for (state in listOf(NoticeState.IMAGE, NoticeState.TRANSLATING, NoticeState.WORKING, NoticeState.SAVE_PENDING, NoticeState.FINISHING)) {
      val plan = noticePlan(notice(state = state, title = "Title", identity = alice), false, 34)
      assertEquals(state.wire, "Title", plan.title)
      assertNull(state.wire, plan.largeIconKey)
      assertNull(state.wire, plan.target)
    }
    for (state in listOf(NoticeState.GENERATING, NoticeState.SPEAKING, NoticeState.STOPPED, NoticeState.FAILED)) {
      assertEquals(state.wire, NoticeTarget("g1", "c1"), noticePlan(notice(state = state, identity = alice), false, 34).target)
    }
  }

  @Test
  fun aNoticeWithAnEmptyNameFallsBackToTheStateTitle() {
    val plan = noticePlan(notice(identity = NoticeIdentity("c1", "")), false, 34)
    assertEquals("Generating a reply…", plan.title)
    assertNull(plan.largeIconKey)
  }

  @Test
  fun koreanTitlesPassThroughUnchanged() {
    val plan = noticePlan(notice(title = "답변 생성 중…", publicTitle = "답변 생성 중…", stopLabel = "중지"), false, 34)
    assertEquals("답변 생성 중…", plan.title)
    assertEquals("중지", plan.actionLabel)
    assertEquals("답변 생성 중…", plan.publicVersion.title)
  }

  // J2: the display machine.

  @Test
  fun aStopTapEntersStoppingOnceAndAStaleTapIsIgnored() {
    val display = KeepAliveDisplay()
    display.pageNotice(notice())
    assertEquals(StopTap.ENTERED, display.stopTapped())
    assertTrue(display.stopping)
    assertEquals(StopTap.STALE, display.stopTapped())
    assertTrue(display.stopping)
  }

  @Test
  fun aStopTapWithNoStoppableV2NoticeIsPlain() {
    val display = KeepAliveDisplay()
    assertEquals(StopTap.PLAIN, display.stopTapped())
    display.pageNotice(notice(state = NoticeState.SAVE_PENDING, stopLabel = ""))
    assertEquals(StopTap.PLAIN, display.stopTapped())
    assertFalse(display.stopping)
  }

  @Test
  fun aV1NoticeNeverEntersStopping() {
    val display = KeepAliveDisplay()
    display.pageNotice(notice())
    display.reset()
    assertNull(display.current())
    assertEquals(StopTap.PLAIN, display.stopTapped())
    assertFalse(display.stopping)
  }

  @Test
  fun aStoppableUpdateKeepsStoppingAndChangesOnlyTheData() {
    val display = KeepAliveDisplay()
    display.pageNotice(notice())
    display.stopTapped()
    val updated = notice(text = "1,204 characters")
    assertFalse(display.pageNotice(updated))
    assertTrue(display.stopping)
    assertEquals("1,204 characters", display.current()?.text)
  }

  @Test
  fun aNoticeWithoutStoppableWorkEndsStoppingAndAsksForTheTimeoutToBeCancelled() {
    val display = KeepAliveDisplay()
    display.pageNotice(notice())
    display.stopTapped()
    assertTrue(display.pageNotice(notice(state = NoticeState.IMAGE, title = "Generating an image…", stopLabel = "")))
    assertFalse(display.stopping)
    assertEquals(NoticeState.IMAGE, display.current()?.state)
  }

  @Test
  fun theTimeoutRestoresTheLastPageNoticeWithItsStop() {
    val display = KeepAliveDisplay()
    display.pageNotice(notice())
    display.stopTapped()
    assertTrue(display.stopTimeout())
    assertFalse(display.stopping)
    assertEquals("Stop", noticePlan(display.current()!!, display.stopping, 34).actionLabel)
    assertFalse(display.stopTimeout())
    // A second tap after the timeout is an ordinary Stop again.
    assertEquals(StopTap.ENTERED, display.stopTapped())
  }

  // J2b: the closing notice that comes with the delayed stop.

  @Test
  fun aFinishingNoticeWhileStoppingShowsStoppedAndCancelsTheTimeout() {
    val display = KeepAliveDisplay()
    display.pageNotice(notice(identity = alice))
    display.stopTapped()
    val closing = notice(state = NoticeState.FINISHING, title = "Finishing up…", publicTitle = "Finishing up…", startedAtMs = null, stopLabel = "", identity = alice)

    assertTrue(display.outcome(closing))

    assertFalse(display.stopping)
    val shown = display.current()!!
    assertEquals(NoticeState.STOPPED, shown.state)
    assertEquals("Stopped", shown.title)
    assertEquals("Stopped", shown.publicTitle)
    assertEquals(alice, shown.identity)
    assertEquals(NoticeTarget("g1", "c1"), shown.target)
    assertNull(noticePlan(shown, false, 34).actionLabel)
    assertFalse(noticePlan(shown, false, 34).chronometer)
  }

  @Test
  fun anUnreadableClosingNoticeWhileStoppingShowsStoppedFromTheLastNotice() {
    val display = KeepAliveDisplay()
    display.pageNotice(notice(identity = alice))
    display.stopTapped()

    assertTrue(display.outcome(null))

    val shown = display.current()!!
    assertEquals(NoticeState.STOPPED, shown.state)
    assertEquals("Stopped", shown.title)
    assertEquals(alice, shown.identity)
    assertFalse(display.stopping)
  }

  @Test
  fun aFailedClosingNoticeWhileStoppingShowsFailed() {
    val display = KeepAliveDisplay()
    display.pageNotice(notice())
    display.stopTapped()
    val failed = notice(state = NoticeState.FAILED, title = "Reply failed", text = "Open the app to see why.", startedAtMs = null, stopLabel = "")

    assertTrue(display.outcome(failed))

    assertEquals(NoticeState.FAILED, display.current()?.state)
    assertEquals("Reply failed", display.current()?.title)
  }

  @Test
  fun aStoppedClosingNoticeWhileStoppingShowsStopped() {
    val display = KeepAliveDisplay()
    display.pageNotice(notice())
    display.stopTapped()
    val stopped = notice(state = NoticeState.STOPPED, title = "Stopped", startedAtMs = null, stopLabel = "")

    assertTrue(display.outcome(stopped))

    assertEquals(NoticeState.STOPPED, display.current()?.state)
    assertFalse(display.stopping)
  }

  @Test
  fun aFinishingNoticeOutsideStoppingShowsAsSent() {
    val display = KeepAliveDisplay()
    display.pageNotice(notice())
    val closing = notice(state = NoticeState.FINISHING, title = "Finishing up…", startedAtMs = null, stopLabel = "")

    assertFalse(display.outcome(closing))

    assertEquals(NoticeState.FINISHING, display.current()?.state)
    assertEquals("Finishing up…", display.current()?.title)
  }

  @Test
  fun anUnreadableClosingNoticeOutsideStoppingChangesNothing() {
    val display = KeepAliveDisplay()
    val before = notice()
    display.pageNotice(before)

    assertFalse(display.outcome(null))

    assertEquals(before, display.current())
  }

  @Test
  fun aClosingNoticeWhileStoppingWithoutAStoppedTitleFallsBackToTheStoppingTitle() {
    val display = KeepAliveDisplay()
    display.pageNotice(notice().copy(stoppedTitle = ""))
    display.stopTapped()

    display.outcome(null)

    assertEquals("Stopping…", display.current()?.title)
    assertEquals(NoticeState.STOPPED, display.current()?.state)
  }

  // J3: reading the page's payload.

  @Test
  fun aWellFormedPayloadIsRead() {
    val read = parseKeepAliveNotice(wire(
      "identity" to mapOf("key" to "c1", "name" to "Alice"),
      "avatar" to "data:image/webp;base64,AAAA"
    ))
    assertNotNull(read)
    assertEquals(NoticeState.GENERATING, read!!.state)
    assertEquals("Generating a reply…", read.title)
    assertEquals(1_000_000L, read.startedAtMs)
    assertEquals("Stop", read.stopLabel)
    assertEquals("Stopping…", read.stoppingTitle)
    assertEquals("Stopped", read.stoppedTitle)
    assertEquals(NoticeIdentity("c1", "Alice"), read.identity)
    assertEquals(NoticeTarget("g1", "c1"), read.target)
    assertEquals("data:image/webp;base64,AAAA", read.avatar)
  }

  @Test
  fun everyStateNameIsRead() {
    for (state in NoticeState.values()) {
      assertEquals(state, parseKeepAliveNotice(wire("state" to state.wire))?.state)
    }
  }

  @Test
  fun aMissingOrWrongVersionOrAnUnknownStateIsRejected() {
    assertNull(parseKeepAliveNotice(wire("v" to 1)))
    assertNull(parseKeepAliveNotice(wire("v" to 3)))
    assertNull(parseKeepAliveNotice(wire("v" to "2")))
    assertNull(parseKeepAliveNotice(wire("v" to null)))
    assertNull(parseKeepAliveNotice(wire("state" to "dancing")))
    assertNull(parseKeepAliveNotice(wire("state" to 5)))
    assertNull(parseKeepAliveNotice(wire("state" to null)))
    assertNull(parseKeepAliveNotice(emptyMap()))
  }

  @Test
  fun aStartTimeThatIsNotAFinitePositiveNumberHidesTheChronometer() {
    assertNull(parseKeepAliveNotice(wire("startedAt" to Double.NaN))!!.startedAtMs)
    assertNull(parseKeepAliveNotice(wire("startedAt" to Double.POSITIVE_INFINITY))!!.startedAtMs)
    assertNull(parseKeepAliveNotice(wire("startedAt" to 0))!!.startedAtMs)
    assertNull(parseKeepAliveNotice(wire("startedAt" to -5))!!.startedAtMs)
    assertNull(parseKeepAliveNotice(wire("startedAt" to "1000"))!!.startedAtMs)
    assertNull(parseKeepAliveNotice(wire("startedAt" to null))!!.startedAtMs)
    assertEquals(1_794_360_956_381L, parseKeepAliveNotice(wire("startedAt" to 1_794_360_956_381L))!!.startedAtMs)
  }

  @Test
  fun oversizeStringsAreCapped() {
    val read = parseKeepAliveNotice(wire(
      "title" to "t".repeat(300),
      "text" to "x".repeat(600),
      "stopLabel" to "s".repeat(300),
      "publicTitle" to "p".repeat(300),
      "identity" to mapOf("key" to "k".repeat(300), "name" to "n".repeat(300))
    ))!!
    assertEquals(256, read.title.length)
    assertEquals(512, read.text.length)
    assertEquals(256, read.stopLabel.length)
    assertEquals(256, read.publicTitle.length)
    assertEquals(256, read.identity!!.name.length)
    assertEquals(256, read.identity!!.key.length)
  }

  @Test
  fun aCapDoesNotSplitASurrogatePair() {
    val title = "a".repeat(255) + "😀"
    val read = parseKeepAliveNotice(wire("title" to title))!!
    assertEquals(255, read.title.length)
    assertFalse(Character.isHighSurrogate(read.title.last()))
  }

  @Test
  fun anIdentityOrTargetThatDoesNotFitIsDroppedWithoutRejectingTheRest() {
    val dropped = parseKeepAliveNotice(wire(
      "identity" to mapOf("key" to "", "name" to "Alice"),
      "target" to mapOf("chaId" to "a".repeat(201), "chatId" to "c1")
    ))!!
    assertNull(dropped.identity)
    assertNull(dropped.target)
    assertEquals("Generating a reply…", dropped.title)

    assertNull(parseKeepAliveNotice(wire("target" to mapOf("chaId" to "g1")))!!.target)
    assertNull(parseKeepAliveNotice(wire("target" to mapOf("chaId" to "g1", "chatId" to 7)))!!.target)
    assertNull(parseKeepAliveNotice(wire("target" to mapOf("chaId" to "", "chatId" to "c1")))!!.target)
    assertNull(parseKeepAliveNotice(wire("target" to "g1/c1"))!!.target)
    assertNull(parseKeepAliveNotice(wire("identity" to listOf("c1", "Alice")))!!.identity)
    assertNull(parseKeepAliveNotice(wire("identity" to mapOf("name" to "Alice")))!!.identity)
    assertEquals(NoticeTarget("a".repeat(200), "c".repeat(200)), parseKeepAliveNotice(wire("target" to mapOf("chaId" to "a".repeat(200), "chatId" to "c".repeat(200))))!!.target)
  }

  @Test
  fun aFieldOfTheWrongTypeReadsAsEmpty() {
    val read = parseKeepAliveNotice(wire("title" to 5, "text" to null, "stopLabel" to true, "avatar" to 3))!!
    assertEquals("", read.title)
    assertEquals("", read.text)
    assertEquals("", read.stopLabel)
    assertNull(read.avatar)
    assertFalse(read.stoppable)
  }

  // F3: the Stopping timeout runs only while the app is in the foreground (MC-1435). The display
  // answers what the service should do with its single timer after every change.

  private fun hiddenStoppingDisplay(): KeepAliveDisplay {
    val display = KeepAliveDisplay()
    display.appForeground(false)
    display.pageNotice(notice())
    assertEquals(StopTap.ENTERED, display.stopTapped())
    return display
  }

  @Test
  fun hiddenTapEntersStoppingWithNoTimer() {
    val display = hiddenStoppingDisplay()
    assertTrue(display.stopping)
    assertEquals(TimerChange.NONE, display.takeTimerChange())
  }

  @Test
  fun foregroundTapArmsAtTheTap() {
    val display = KeepAliveDisplay()
    display.pageNotice(notice())
    assertEquals(StopTap.ENTERED, display.stopTapped())
    assertEquals(TimerChange.ARM, display.takeTimerChange())
    assertEquals(TimerChange.NONE, display.takeTimerChange())
  }

  @Test
  fun returnArmsOnceAndADuplicateDoesNotRestart() {
    val display = hiddenStoppingDisplay()
    assertEquals(TimerChange.NONE, display.takeTimerChange())
    display.appForeground(true)
    assertEquals(TimerChange.ARM, display.takeTimerChange())
    display.appForeground(true)
    assertEquals(TimerChange.NONE, display.takeTimerChange())
  }

  @Test
  fun backgroundCancelsAndTheNextReturnArmsAgain() {
    val display = KeepAliveDisplay()
    display.pageNotice(notice())
    display.stopTapped()
    assertEquals(TimerChange.ARM, display.takeTimerChange())
    display.appForeground(false)
    assertEquals(TimerChange.CANCEL, display.takeTimerChange())
    assertTrue(display.stopping)
    display.appForeground(true)
    assertEquals(TimerChange.ARM, display.takeTimerChange())
  }

  @Test
  fun aTimeoutWhileHiddenKeepsStopping() {
    val display = hiddenStoppingDisplay()
    assertFalse(display.stopTimeout())
    assertTrue(display.stopping)
    display.appForeground(true)
    assertEquals(TimerChange.ARM, display.takeTimerChange())
  }

  @Test
  fun anOutcomeWhileHiddenEndsStopping() {
    val closings = listOf(
      Pair(notice(state = NoticeState.FINISHING, stopLabel = ""), NoticeState.STOPPED),
      Pair(notice(state = NoticeState.FAILED, stopLabel = ""), NoticeState.FAILED),
      Pair(notice(state = NoticeState.STOPPED, stopLabel = ""), NoticeState.STOPPED),
      Pair(null, NoticeState.STOPPED)
    )
    for ((closing, expected) in closings) {
      val display = hiddenStoppingDisplay()
      assertTrue(display.outcome(closing))
      assertFalse(display.stopping)
      assertEquals(expected, display.current()?.state)
      assertEquals(TimerChange.NONE, display.takeTimerChange())
      display.appForeground(true)
      assertEquals(TimerChange.NONE, display.takeTimerChange())
    }
  }

  @Test
  fun aNonStoppableNoticeWhileHiddenEndsStopping() {
    val display = hiddenStoppingDisplay()
    assertTrue(display.pageNotice(notice(state = NoticeState.IMAGE, stopLabel = "")))
    assertFalse(display.stopping)
    display.appForeground(true)
    assertEquals(TimerChange.NONE, display.takeTimerChange())
  }

  @Test
  fun anOutcomeAfterTheReturnCancelsTheTimer() {
    val display = hiddenStoppingDisplay()
    assertEquals(TimerChange.NONE, display.takeTimerChange())
    display.appForeground(true)
    assertEquals(TimerChange.ARM, display.takeTimerChange())
    display.outcome(notice(state = NoticeState.STOPPED, stopLabel = ""))
    assertEquals(TimerChange.CANCEL, display.takeTimerChange())
  }

  @Test
  fun staleTapsNeverRestartTheTimer() {
    val display = hiddenStoppingDisplay()
    assertEquals(StopTap.STALE, display.stopTapped())
    assertEquals(TimerChange.NONE, display.takeTimerChange())
    display.appForeground(true)
    assertEquals(TimerChange.ARM, display.takeTimerChange())
    assertEquals(StopTap.STALE, display.stopTapped())
    assertEquals(TimerChange.NONE, display.takeTimerChange())
  }

  @Test
  fun aV1NoticeNeverStopsOrArms() {
    val display = KeepAliveDisplay()
    display.pageNotice(notice())
    display.reset()
    display.appForeground(false)
    assertEquals(StopTap.PLAIN, display.stopTapped())
    assertEquals(TimerChange.NONE, display.takeTimerChange())
    display.appForeground(true)
    assertEquals(TimerChange.NONE, display.takeTimerChange())
    display.appForeground(false)
    assertEquals(TimerChange.NONE, display.takeTimerChange())
  }

  @Test
  fun aFiredTimerThenANewForegroundTapArmsANewTimer() {
    val display = KeepAliveDisplay()
    display.pageNotice(notice())
    display.stopTapped()
    assertEquals(TimerChange.ARM, display.takeTimerChange())
    assertTrue(display.stopTimeout())
    assertEquals(TimerChange.NONE, display.takeTimerChange())
    assertEquals(StopTap.ENTERED, display.stopTapped())
    assertEquals(TimerChange.ARM, display.takeTimerChange())
  }

  @Test
  fun aV1ResetWhileArmedCancels() {
    val display = KeepAliveDisplay()
    display.pageNotice(notice())
    display.stopTapped()
    assertEquals(TimerChange.ARM, display.takeTimerChange())
    display.reset()
    assertEquals(TimerChange.CANCEL, display.takeTimerChange())
  }
}
