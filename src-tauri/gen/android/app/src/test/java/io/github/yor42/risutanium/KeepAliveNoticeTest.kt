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

  // F5-K: the Stop tap's delivery and a confirmed native cancel (MC-1435, MC-1470, MC-1471). Labels:
  // KJ-1, KJ-2 are designed reproducers (a delivery that never cancels fails them); the rest are guards.

  private class DeliveryCalls {
    val calls = mutableListOf<String>()
  }

  private fun deliver(
    display: KeepAliveDisplay,
    tap: StopTap,
    calls: DeliveryCalls = DeliveryCalls(),
    pageAccepts: Boolean = true,
    cancelled: Int = 1
  ): StopDelivery = deliverStopTap(
    tap,
    display,
    { calls.calls.add("page"); pageAccepts },
    { calls.calls.add("cancel"); cancelled }
  )

  private fun confirmedDisplay(foreground: Boolean = false, base: KeepAliveNotice = notice()): KeepAliveDisplay {
    val display = KeepAliveDisplay(foreground = foreground)
    display.pageNotice(base)
    val tap = display.stopTapped()
    assertEquals(StopTap.ENTERED, tap)
    assertEquals(StopDelivery.CONFIRMED, deliver(display, tap))
    return display
  }

  @Test
  fun hiddenStopCallsThePageBeforeTheNativeCancel() {
    val display = KeepAliveDisplay(foreground = false)
    display.pageNotice(notice())
    val tap = display.stopTapped()
    val calls = DeliveryCalls()
    assertEquals(StopDelivery.CONFIRMED, deliver(display, tap, calls))
    assertEquals(listOf("page", "cancel"), calls.calls)
  }

  @Test
  fun aConfirmedCancelShowsStoppedWithNoTimer() {
    val display = KeepAliveDisplay()
    display.pageNotice(notice())
    val tap = display.stopTapped()
    assertEquals(TimerChange.ARM, display.takeTimerChange())
    assertEquals(StopDelivery.CONFIRMED, deliver(display, tap))
    assertTrue(display.cancelConfirmed)
    val plan = noticePlan(display.current()!!, display.stopping, 34, display.cancelConfirmed)
    assertEquals("Stopped", plan.title)
    assertEquals("Stopped", plan.publicVersion.title)
    assertNull(plan.actionLabel)
    assertNull(plan.publicVersion.actionLabel)
    assertFalse(plan.chronometer)
    assertEquals(TimerChange.CANCEL, display.takeTimerChange())
    assertFalse(display.stopTimeout())
    assertTrue(display.stopping)
  }

  @Test
  fun aConfirmedStoppedPlanDiffersFromStoppingOnlyInTheTitle() {
    val named = notice(identity = alice)
    for (base in listOf(notice(), named)) {
      val stopping = noticePlan(base, stopping = true, sdk = 34)
      val stopped = noticePlan(base, stopping = true, sdk = 34, stopped = true)
      if (base.identity == null) {
        assertEquals(stopping.copy(title = "Stopped", publicVersion = stopping.publicVersion.copy(title = "Stopped")), stopped)
      } else {
        assertEquals("Alice", stopped.title)
        assertEquals("Stopped", stopped.text)
        assertEquals(stopping.copy(text = "Stopped", publicVersion = stopping.publicVersion.copy(title = "Stopped")), stopped)
      }
    }
    val unnamedTitle = notice().copy(stoppedTitle = "")
    assertEquals("Stopping…", noticePlan(unnamedTitle, stopping = true, sdk = 34, stopped = true).title)
  }

  @Test
  fun noMatchKeepsMc1435() {
    val hidden = KeepAliveDisplay(foreground = false)
    hidden.pageNotice(notice())
    assertEquals(StopDelivery.DELIVERED, deliver(hidden, hidden.stopTapped(), cancelled = 0))
    assertFalse(hidden.cancelConfirmed)
    assertEquals(TimerChange.NONE, hidden.takeTimerChange())
    val foreground = KeepAliveDisplay()
    foreground.pageNotice(notice())
    assertEquals(StopDelivery.DELIVERED, deliver(foreground, foreground.stopTapped(), cancelled = 0))
    assertEquals(TimerChange.ARM, foreground.takeTimerChange())
    assertEquals("Stopping…", noticePlan(foreground.current()!!, foreground.stopping, 34, foreground.cancelConfirmed).title)
  }

  @Test
  fun noPageNeverCancels() {
    val display = KeepAliveDisplay(foreground = false)
    display.pageNotice(notice())
    val calls = DeliveryCalls()
    assertEquals(StopDelivery.NO_PAGE, deliver(display, display.stopTapped(), calls, pageAccepts = false))
    assertEquals(listOf("page"), calls.calls)
    assertFalse(display.cancelConfirmed)
  }

  @Test
  fun staleAndPlainNeverCancel() {
    val display = KeepAliveDisplay(foreground = false)
    display.pageNotice(notice())
    display.stopTapped()
    val staleCalls = DeliveryCalls()
    assertEquals(StopDelivery.IGNORED, deliver(display, display.stopTapped(), staleCalls))
    assertTrue(staleCalls.calls.isEmpty())
    val v1 = KeepAliveDisplay(foreground = false)
    val plainCalls = DeliveryCalls()
    assertEquals(StopDelivery.DELIVERED, deliver(v1, v1.stopTapped(), plainCalls))
    assertEquals(listOf("page"), plainCalls.calls)
  }

  @Test
  fun speakingDoesNotCancelNatively() {
    val display = KeepAliveDisplay(foreground = false)
    display.pageNotice(notice(state = NoticeState.SPEAKING))
    val calls = DeliveryCalls()
    assertEquals(StopDelivery.DELIVERED, deliver(display, display.stopTapped(), calls))
    assertEquals(listOf("page"), calls.calls)
    assertFalse(display.cancelConfirmed)
  }

  @Test
  fun aStoppableUpdateAfterConfirmKeepsStopped() {
    val display = confirmedDisplay()
    assertFalse(display.pageNotice(notice(text = "10 characters")))
    assertEquals("10 characters", display.current()!!.text)
    assertTrue(display.stopping)
    assertTrue(display.cancelConfirmed)
    val ended = display.pageNotice(notice(state = NoticeState.IMAGE, stopLabel = ""))
    assertTrue(display.stopping)
    assertTrue(display.cancelConfirmed)
    assertFalse(ended)
  }

  @Test
  fun theOutcomeAfterConfirmFollowsN2AndClears() {
    val display = confirmedDisplay()
    assertTrue(display.outcome(notice(state = NoticeState.FINISHING, stopLabel = "")))
    assertEquals(NoticeState.STOPPED, display.current()?.state)
    assertFalse(display.cancelConfirmed)
    display.pageNotice(notice())
    assertEquals(StopTap.ENTERED, display.stopTapped())
    assertEquals("Stopping…", noticePlan(display.current()!!, display.stopping, 34, display.cancelConfirmed).title)
  }

  @Test
  fun aV1ResetClearsConfirm() {
    val display = confirmedDisplay()
    display.reset()
    assertFalse(display.cancelConfirmed)
    assertFalse(display.stopping)
  }

  @Test
  fun aNegativeCountIsNoMatch() {
    val display = KeepAliveDisplay(foreground = false)
    display.pageNotice(notice())
    assertEquals(StopDelivery.DELIVERED, deliver(display, display.stopTapped(), cancelled = -1))
    assertFalse(display.cancelConfirmed)
  }

  // F5-C: the count line while hidden (MC-1450). KC-1 and KC-2 are designed reproducers (a countLine
  // that is always Page fails them); the rest are guards.

  private val counted = "1,204 characters"

  @Test
  fun hiddenSilenceDropsTheCountLineAtTheThreshold() {
    var now = 0L
    val display = KeepAliveDisplay(foreground = false, clock = { now })
    val shown = notice(text = counted, identity = alice)
    display.pageNotice(shown)
    now = COUNT_STALE_MS - 1
    assertEquals(CountLine.Page, display.countLine())
    now = COUNT_STALE_MS
    assertEquals(CountLine.Dropped, display.countLine())
    assertEquals("Generating a reply…\n$counted", noticePlan(shown, false, 34, countLine = CountLine.Page).bigText)
    assertNull(noticePlan(shown, false, 34, countLine = display.countLine()).bigText)
  }

  @Test
  fun aPageNoticeBringsTheLineBack() {
    var now = 0L
    val display = KeepAliveDisplay(foreground = false, clock = { now })
    display.pageNotice(notice(text = counted))
    now = 8000L
    assertEquals(CountLine.Dropped, display.countLine())
    display.pageNotice(notice(text = counted))
    assertEquals(CountLine.Page, display.countLine())
    assertEquals(COUNT_STALE_MS, display.countDelayMs())
  }

  @Test
  fun theForegroundNeverDrops() {
    var now = 0L
    val display = KeepAliveDisplay(foreground = true, clock = { now })
    display.pageNotice(notice(text = counted))
    now = 60_000L
    assertEquals(CountLine.Page, display.countLine())
    assertNull(display.countDelayMs())
  }

  @Test
  fun aReturnToTheForegroundAsksForARepost() {
    var now = 0L
    val display = KeepAliveDisplay(foreground = false, clock = { now })
    display.pageNotice(notice(text = counted))
    now = 8000L
    assertTrue(countLineRepostWanted(CountLine.Page, display))
    assertFalse(countLineRepostWanted(CountLine.Dropped, display))
    display.appForeground(true)
    assertEquals(CountLine.Page, display.countLine())
    assertTrue(countLineRepostWanted(CountLine.Dropped, display))
    val early = KeepAliveDisplay(foreground = false, clock = { now })
    now = 9000L
    early.pageNotice(notice(text = counted))
    assertFalse(countLineRepostWanted(CountLine.Page, early))
    assertFalse(countLineRepostWanted(null, early))
  }

  @Test
  fun stoppingAndStoppedAreUnaffectedByStaleness() {
    var now = 0L
    val display = KeepAliveDisplay(foreground = false, clock = { now })
    val shown = notice(text = counted)
    display.pageNotice(shown)
    assertEquals(StopTap.ENTERED, display.stopTapped())
    now = 10_000L
    for (stopped in listOf(false, true)) {
      assertEquals(
        noticePlan(shown, true, 34, stopped, CountLine.Page),
        noticePlan(shown, true, 34, stopped, display.countLine())
      )
    }
    assertNull(display.countDelayMs())
    assertEquals(TimerChange.NONE, display.takeTimerChange())
  }

  @Test
  fun theDelayFollowsTheLastPageNotice() {
    var now = 0L
    val display = KeepAliveDisplay(foreground = true, clock = { now })
    display.pageNotice(notice(text = counted))
    now = 2000L
    display.appForeground(false)
    assertEquals(3000L, display.countDelayMs())
    now = 3000L
    display.pageNotice(notice(text = counted))
    assertEquals(COUNT_STALE_MS, display.countDelayMs())
    var later = 0L
    val silent = KeepAliveDisplay(foreground = false, clock = { later })
    silent.pageNotice(notice(text = counted))
    later = 7000L
    assertEquals(0L, silent.countDelayMs())
    assertEquals(CountLine.Dropped, silent.countLine())
  }

  @Test
  fun onlyAGeneratingNoticeWithACountIsAffected() {
    var now = 0L
    val display = KeepAliveDisplay(foreground = false, clock = { now })
    display.pageNotice(notice(text = ""))
    now = 9000L
    assertEquals(CountLine.Page, display.countLine())
    assertNull(display.countDelayMs())
    val speaking = notice(state = NoticeState.SPEAKING, text = counted)
    display.pageNotice(speaking)
    now = 20_000L
    assertEquals(CountLine.Page, display.countLine())
    assertNull(display.countDelayMs())
    assertEquals(
      noticePlan(speaking, false, 34, countLine = CountLine.Page),
      noticePlan(speaking, false, 34, countLine = CountLine.Dropped)
    )
  }

  @Test
  fun resetAndOutcomeClearTheDrop() {
    var now = 0L
    val display = KeepAliveDisplay(foreground = false, clock = { now })
    display.pageNotice(notice(text = counted))
    now = 8000L
    assertEquals(CountLine.Dropped, display.countLine())
    display.reset()
    assertEquals(CountLine.Page, display.countLine())
    display.pageNotice(notice(text = counted))
    now = 20_000L
    assertEquals(CountLine.Dropped, display.countLine())
    display.outcome(notice(state = NoticeState.FINISHING, stopLabel = ""))
    assertEquals(CountLine.Page, display.countLine())
    assertNull(display.countDelayMs())
  }

  @Test
  fun droppingRemovesOnlyTheNumbers() {
    for (shown in listOf(notice(text = counted), notice(text = counted, identity = alice))) {
      val page = noticePlan(shown, false, 34, countLine = CountLine.Page)
      assertNotNull(page.bigText)
      assertEquals(page.copy(bigText = null), noticePlan(shown, false, 34, countLine = CountLine.Dropped))
    }
  }

  @Test
  fun aCheckThatFiresEarlyReArms() {
    var now = 0L
    val display = KeepAliveDisplay(foreground = false, clock = { now })
    display.pageNotice(notice(text = counted))
    now = 3000L
    assertEquals(CountLine.Page, display.countLine())
    assertFalse(countLineRepostWanted(CountLine.Page, display))
    assertEquals(2000L, countTimerDelayMs(CountLine.Page, display))
    now = COUNT_STALE_MS
    assertEquals(0L, display.countDelayMs())
    assertEquals(CountLine.Dropped, display.countLine())
    assertEquals(0L, countTimerDelayMs(CountLine.Page, display))
    assertNull(countTimerDelayMs(CountLine.Dropped, display))
    assertNull(countTimerDelayMs(null, display))
    display.appForeground(true)
    assertNull(countTimerDelayMs(CountLine.Dropped, display))
    // While not Stopping, for one clock value the delay is 0 exactly when the line is dropped.
    var sampled = 0L
    val probe = KeepAliveDisplay(foreground = false, clock = { sampled })
    probe.pageNotice(notice(text = counted))
    for (at in listOf(0L, COUNT_STALE_MS - 1, COUNT_STALE_MS, 9000L)) {
      sampled = at
      assertEquals("at $at", probe.countDelayMs() == 0L, probe.countLine() == CountLine.Dropped)
    }
  }

  // F6: Stopped after a confirmed cancel (MC-1496, MC-1497). The fixtures are shaped like the page's
  // payloads: a save-pending notice has no start, label, identity or target; a closing notice carries the
  // chat's identity and target. "Return" is the hidden-to-visible transition. The reproducers are
  // savePendingKeepsConfirmedStopped, aStoppableUpdateAfterConfirmKeepsStopped,
  // returnClearsConfirmedStoppedToNeutral, returnClearsTheClosingStoppedCard,
  // theLaterStoppedOutcomeShowsNothing, returnShowsTheRemainingSavePending,
  // staleGeneratingAfterReturnStaysNeutral, newGenerationAfterReturnShowsNormally,
  // newWorkAfterReturnCanBeStoppedAgain, newStoppableWorkWhileHiddenEndsStopped,
  // aFinishingClosingAfterSavePendingShowsStopped, savePendingAfterReturnShowsAndKeepsTheLatch,
  // newWorkAfterAConfirmRefreshesTheCountClock, aStoppedPageNoticeIsNotShownAtReturn and
  // aFinishingOutcomeAfterReturnShows: they fail when the display keeps a confirmed Stopped for a
  // non-stoppable notice, never clears at the return, or lets the cancelled work's later notices show.
  // The other rows are compatibility guards.

  private fun shownPlan(display: KeepAliveDisplay): NoticePlan =
    noticePlan(display.current()!!, display.stopping, 34, display.cancelConfirmed, display.countLine())

  private fun savePending() = notice(
    state = NoticeState.SAVE_PENDING,
    title = "Saving…",
    publicTitle = "Saving…",
    startedAtMs = null,
    stopLabel = "",
    target = null
  )

  private fun stoppedClosing(identity: NoticeIdentity?) = notice(
    state = NoticeState.STOPPED,
    title = "Stopped",
    publicTitle = "Stopped",
    startedAtMs = null,
    stopLabel = "",
    identity = identity
  )

  private fun failedClosing(identity: NoticeIdentity? = null) = notice(
    state = NoticeState.FAILED,
    title = "Reply failed",
    text = "Open the app to see why.",
    publicTitle = "Reply failed",
    startedAtMs = null,
    stopLabel = "",
    identity = identity
  )

  private fun finishingClosing(identity: NoticeIdentity?) = notice(
    state = NoticeState.FINISHING,
    title = "Finishing up…",
    publicTitle = "Finishing up…",
    startedAtMs = null,
    stopLabel = "",
    identity = identity
  )

  private fun newGeneration() = notice(startedAtMs = 2_000_000L)

  private fun assertNeutral(display: KeepAliveDisplay) {
    val plan = shownPlan(display)
    assertEquals("", plan.title)
    assertEquals("", plan.text)
    assertNull(plan.actionLabel)
    assertFalse(plan.chronometer)
    assertNull(plan.target)
    assertNull(plan.largeIconKey)
    assertEquals("", plan.publicVersion.title)
    assertNull(plan.publicVersion.actionLabel)
    assertFalse(display.stopping)
  }

  private fun assertSavePendingPlan(display: KeepAliveDisplay) {
    val plan = shownPlan(display)
    assertEquals("Saving…", plan.title)
    assertEquals("", plan.text)
    assertNull(plan.actionLabel)
    assertFalse(plan.chronometer)
    assertNull(plan.target)
    assertEquals("Saving…", plan.publicVersion.title)
  }

  private fun assertGeneratingWithStop(display: KeepAliveDisplay) {
    val plan = shownPlan(display)
    assertEquals("Generating a reply…", plan.title)
    assertEquals("Stop", plan.actionLabel)
    assertFalse(display.stopping)
  }

  @Test
  fun savePendingKeepsConfirmedStopped() {
    val display = confirmedDisplay(base = notice(identity = alice))
    val ended = display.pageNotice(savePending())
    val plan = shownPlan(display)
    assertEquals("Alice", plan.title)
    assertEquals("Stopped", plan.text)
    assertEquals(NoticeTarget("g1", "c1"), plan.target)
    assertTrue(display.stopping)
    assertTrue(display.cancelConfirmed)
    assertFalse(ended)
  }

  @Test
  fun returnClearsConfirmedStoppedToNeutral() {
    val display = confirmedDisplay(base = notice(identity = alice, text = counted))
    display.appForeground(true)
    assertNeutral(display)
    assertFalse(display.cancelConfirmed)
    assertEquals(NoticeState.FINISHING, display.current()!!.state)
    assertNull(display.current()!!.identity)
    assertNull(display.current()!!.target)
    assertNull(display.current()!!.startedAtMs)
  }

  @Test
  fun returnClearsTheClosingStoppedCard() {
    val display = KeepAliveDisplay(foreground = false)
    display.pageNotice(notice(identity = alice))
    display.outcome(stoppedClosing(alice))
    assertEquals("Alice", shownPlan(display).title)
    display.appForeground(true)
    assertNeutral(display)
  }

  @Test
  fun theLaterStoppedOutcomeShowsNothing() {
    for (hiddenAgain in listOf(false, true)) {
      val display = confirmedDisplay()
      display.appForeground(true)
      if (hiddenAgain) display.appForeground(false)
      display.outcome(stoppedClosing(null))
      assertNeutral(display)
    }
  }

  @Test
  fun returnShowsTheRemainingSavePending() {
    val display = confirmedDisplay()
    display.pageNotice(savePending())
    display.appForeground(true)
    assertSavePendingPlan(display)
    display.outcome(stoppedClosing(null))
    assertNeutral(display)
  }

  @Test
  fun staleGeneratingAfterReturnStaysNeutral() {
    val display = confirmedDisplay()
    display.appForeground(true)
    display.pageNotice(notice(text = "12 characters"))
    assertNeutral(display)
  }

  @Test
  fun newGenerationAfterReturnShowsNormally() {
    val display = confirmedDisplay()
    display.appForeground(true)
    display.pageNotice(newGeneration())
    assertGeneratingWithStop(display)
  }

  @Test
  fun newWorkStopShowsStopped() {
    val display = confirmedDisplay()
    display.appForeground(true)
    display.outcome(stoppedClosing(null))
    display.pageNotice(newGeneration())
    assertEquals(StopTap.ENTERED, display.stopTapped())
    assertEquals(StopDelivery.CONFIRMED, deliver(display, StopTap.ENTERED))
    display.outcome(stoppedClosing(null))
    assertEquals(NoticeState.STOPPED, display.current()!!.state)
    assertEquals("Stopped", shownPlan(display).title)
  }

  @Test
  fun newWorkAfterReturnCanBeStoppedAgain() {
    val display = confirmedDisplay()
    display.appForeground(true)
    display.pageNotice(newGeneration())
    assertEquals(2_000_000L, display.current()!!.startedAtMs)
    assertEquals(StopTap.ENTERED, display.stopTapped())
    assertEquals(StopDelivery.CONFIRMED, deliver(display, StopTap.ENTERED))
    assertEquals("Stopped", shownPlan(display).title)
    display.outcome(stoppedClosing(null))
    assertEquals(NoticeState.STOPPED, display.current()!!.state)
    assertEquals("Stopped", shownPlan(display).title)
  }

  @Test
  fun newWorkAfterReturnShowsItsOwnStoppedOutcome() {
    val display = confirmedDisplay()
    display.appForeground(true)
    display.pageNotice(newGeneration())
    display.outcome(stoppedClosing(null))
    assertEquals(NoticeState.STOPPED, display.current()!!.state)
    assertEquals("Stopped", shownPlan(display).title)
  }

  @Test
  fun laterFailedAfterReturnShows() {
    val display = confirmedDisplay()
    display.appForeground(true)
    display.outcome(failedClosing())
    val plan = shownPlan(display)
    assertEquals("Reply failed", plan.title)
    assertEquals("Open the app to see why.", plan.text)
  }

  @Test
  fun unconfirmedStoppingIsUntouchedByReturn() {
    val display = KeepAliveDisplay(foreground = false)
    display.pageNotice(notice())
    assertEquals(StopDelivery.DELIVERED, deliver(display, display.stopTapped(), cancelled = 0))
    assertEquals(TimerChange.NONE, display.takeTimerChange())
    display.appForeground(true)
    assertEquals("Stopping…", shownPlan(display).title)
    assertTrue(display.stopping)
    assertEquals(TimerChange.ARM, display.takeTimerChange())
    assertTrue(display.pageNotice(savePending()))
    assertSavePendingPlan(display)
  }

  @Test
  fun aConfirmedStopInTheForegroundIsNotCleared() {
    val display = confirmedDisplay(foreground = true)
    display.appForeground(true)
    display.appForeground(true)
    assertEquals("Stopped", shownPlan(display).title)
    assertTrue(display.stopping)
    assertTrue(display.cancelConfirmed)
  }

  @Test
  fun newStoppableWorkWhileHiddenEndsStopped() {
    val display = confirmedDisplay()
    val speaking = notice(
      state = NoticeState.SPEAKING,
      title = "Speaking…",
      publicTitle = "Speaking…",
      startedAtMs = 3_000_000L
    )
    val ended = display.pageNotice(speaking)
    val plan = shownPlan(display)
    assertEquals("Speaking…", plan.title)
    assertEquals("Stop", plan.actionLabel)
    assertTrue(ended)
    assertFalse(display.cancelConfirmed)
  }

  @Test
  fun aFinishingClosingAfterSavePendingShowsStopped() {
    val display = confirmedDisplay(base = notice(identity = alice))
    display.pageNotice(savePending())
    display.outcome(finishingClosing(alice))
    assertEquals(NoticeState.STOPPED, display.current()!!.state)
    val plan = shownPlan(display)
    assertEquals("Alice", plan.title)
    assertEquals("Stopped", plan.text)
    assertEquals(NoticeTarget("g1", "c1"), plan.target)
  }

  @Test
  fun resetDropsTheLatch() {
    val first = confirmedDisplay()
    first.appForeground(true)
    first.reset()
    first.pageNotice(notice())
    assertGeneratingWithStop(first)
    val second = confirmedDisplay()
    second.appForeground(true)
    second.reset()
    second.pageNotice(savePending())
    second.outcome(stoppedClosing(null))
    assertEquals(NoticeState.STOPPED, second.current()!!.state)
    assertEquals("Stopped", shownPlan(second).title)
  }

  @Test
  fun savePendingAfterReturnShowsAndKeepsTheLatch() {
    val first = confirmedDisplay()
    first.appForeground(true)
    first.pageNotice(savePending())
    assertSavePendingPlan(first)
    first.outcome(stoppedClosing(null))
    assertNeutral(first)
    val second = confirmedDisplay()
    second.appForeground(true)
    second.pageNotice(savePending())
    second.pageNotice(notice(text = "12 characters"))
    assertSavePendingPlan(second)
  }

  @Test
  fun returnNeverClearsANonStoppedCard() {
    val failedNamed = failedClosing(alice)
    val hiddenFailed = KeepAliveDisplay(foreground = false)
    hiddenFailed.pageNotice(notice(identity = alice))
    hiddenFailed.outcome(failedNamed)
    hiddenFailed.appForeground(true)
    val failedPlan = shownPlan(hiddenFailed)
    assertEquals("Alice", failedPlan.title)
    assertEquals("Reply failed · Open the app to see why.", failedPlan.text)
    assertEquals(NoticeTarget("g1", "c1"), failedPlan.target)
    val hiddenSaving = KeepAliveDisplay(foreground = false)
    hiddenSaving.pageNotice(notice())
    hiddenSaving.pageNotice(savePending())
    hiddenSaving.appForeground(true)
    assertSavePendingPlan(hiddenSaving)
    val confirmedThenFailed = confirmedDisplay(base = notice(identity = alice))
    confirmedThenFailed.outcome(failedNamed)
    confirmedThenFailed.appForeground(true)
    assertEquals(failedPlan, shownPlan(confirmedThenFailed))
  }

  @Test
  fun newWorkAfterAConfirmRefreshesTheCountClock() {
    var now = 0L
    val afterClear = KeepAliveDisplay(foreground = false, clock = { now })
    afterClear.pageNotice(notice())
    assertEquals(StopDelivery.CONFIRMED, deliver(afterClear, afterClear.stopTapped()))
    now = 1_000L
    afterClear.appForeground(true)
    now = 2_000L
    afterClear.appForeground(false)
    now = 20_000L
    afterClear.pageNotice(notice(startedAtMs = 2_000_000L, text = counted))
    assertEquals(CountLine.Page, afterClear.countLine())
    assertEquals(COUNT_STALE_MS, afterClear.countDelayMs())
    var later = 0L
    val whileStopped = KeepAliveDisplay(foreground = false, clock = { later })
    whileStopped.pageNotice(notice())
    assertEquals(StopDelivery.CONFIRMED, deliver(whileStopped, whileStopped.stopTapped()))
    later = 20_000L
    whileStopped.pageNotice(notice(startedAtMs = 2_000_000L, text = counted))
    assertEquals(CountLine.Page, whileStopped.countLine())
    assertEquals(COUNT_STALE_MS, whileStopped.countDelayMs())
  }

  @Test
  fun aStoppedPageNoticeIsNotShownAtReturn() {
    val display = confirmedDisplay()
    display.pageNotice(stoppedClosing(null))
    display.appForeground(true)
    assertNeutral(display)
  }

  @Test
  fun aClearedClosingCardSetsNoLatch() {
    val display = KeepAliveDisplay(foreground = false)
    display.pageNotice(notice(identity = alice))
    display.outcome(stoppedClosing(alice))
    display.appForeground(true)
    display.pageNotice(savePending())
    display.outcome(stoppedClosing(null))
    assertEquals(NoticeState.STOPPED, display.current()!!.state)
    assertEquals("Stopped", shownPlan(display).title)
  }

  @Test
  fun aFinishingOutcomeAfterReturnShows() {
    val display = confirmedDisplay()
    display.appForeground(true)
    display.outcome(finishingClosing(alice))
    val plan = shownPlan(display)
    assertEquals("Finishing up…", plan.title)
    assertEquals("", plan.text)
    assertNull(plan.actionLabel)
    assertFalse(plan.chronometer)
    assertNull(plan.target)
    assertEquals(NoticeState.FINISHING, display.current()!!.state)
  }

  @Test
  fun anUnreadableOutcomeAfterReturnKeepsTheCard() {
    val display = confirmedDisplay()
    display.pageNotice(savePending())
    display.appForeground(true)
    assertSavePendingPlan(display)
    display.outcome(null)
    assertSavePendingPlan(display)
  }

  @Test
  fun everyOutcomeAfterReturnDropsTheLatch() {
    val outcomes = listOf(stoppedClosing(null), failedClosing(), finishingClosing(alice), null)
    for (closing in outcomes) {
      val display = confirmedDisplay()
      display.appForeground(true)
      display.outcome(closing)
      display.pageNotice(savePending())
      display.outcome(stoppedClosing(null))
      assertEquals("for $closing", NoticeState.STOPPED, display.current()!!.state)
      assertEquals("for $closing", "Stopped", shownPlan(display).title)
    }
  }

  // Guards on the F6 API: what the return reports, what the hidden outcome flag marks, and the pure
  // decisions the service takes from them.

  @Test
  fun appForegroundReportsAChange() {
    val confirmed = confirmedDisplay()
    assertTrue(confirmed.appForeground(true))
    assertFalse(confirmed.appForeground(true))
    assertFalse(confirmed.appForeground(false))
    val closing = KeepAliveDisplay(foreground = false)
    closing.pageNotice(notice(identity = alice))
    closing.outcome(stoppedClosing(alice))
    assertTrue(closing.appForeground(true))
    val unconfirmed = KeepAliveDisplay(foreground = false)
    unconfirmed.pageNotice(notice())
    unconfirmed.stopTapped()
    assertFalse(unconfirmed.appForeground(true))
    assertFalse(KeepAliveDisplay(foreground = false).appForeground(true))
  }

  @Test
  fun outcomeHiddenMarksOnlyASwallowedStopped() {
    val display = confirmedDisplay()
    display.appForeground(true)
    display.outcome(stoppedClosing(null))
    assertTrue(display.outcomeHidden)
    display.pageNotice(savePending())
    display.outcome(stoppedClosing(null))
    assertFalse(display.outcomeHidden)
    val failed = confirmedDisplay()
    failed.appForeground(true)
    failed.outcome(failedClosing())
    assertFalse(failed.outcomeHidden)
  }

  @Test
  fun theForegroundRepostFollowsTheClearBeforeTheCountLine() {
    var now = 0L
    val display = KeepAliveDisplay(foreground = false, clock = { now })
    display.pageNotice(notice(text = counted))
    now = 8000L
    assertEquals(ForegroundRepost.STOPPED_CLEARED, foregroundRepost(true, CountLine.Dropped, display))
    assertEquals(ForegroundRepost.STOPPED_CLEARED, foregroundRepost(true, CountLine.Page, display))
    assertEquals(ForegroundRepost.COUNT_LINE, foregroundRepost(false, CountLine.Page, display))
    assertEquals(ForegroundRepost.NONE, foregroundRepost(false, CountLine.Dropped, display))
    assertEquals(ForegroundRepost.NONE, foregroundRepost(false, null, display))
  }

  @Test
  fun aPageStateIsLoggedOnlyWhenItChanges() {
    assertEquals("generating", pageStateToLog(null, notice()))
    assertNull(pageStateToLog(NoticeState.GENERATING, notice()))
    assertEquals("savePending", pageStateToLog(NoticeState.GENERATING, savePending()))
    assertEquals("generating", pageStateToLog(NoticeState.SAVE_PENDING, notice()))
  }

  // F6 stage 2: early end (MC-1508). Guards on endWanted: it is true only with the app in front, the
  // page's closing outcome as its latest message and the app-name-only card shown. Each test is one rule
  // and a guard: it passes on the current source and fails when its rule is broken.

  @Test
  fun aHiddenAppNeverEndsEarly() {
    val display = confirmedDisplay()
    display.appForeground(true)
    display.appForeground(false)
    display.outcome(stoppedClosing(null))
    assertFalse(display.endWanted())
  }

  @Test
  fun aSwallowedStoppedOutcomeInFrontEnds() {
    val display = confirmedDisplay()
    display.appForeground(true)
    display.outcome(stoppedClosing(null))
    assertTrue(display.endWanted())
  }

  @Test
  fun aFailedClosingAfterTheClearNeverEnds() {
    val display = confirmedDisplay()
    display.appForeground(true)
    display.outcome(failedClosing())
    assertFalse(display.endWanted())
  }

  @Test
  fun aSavePendingClearEndsOnlyAtTheClosing() {
    val display = confirmedDisplay()
    display.pageNotice(savePending())
    display.appForeground(true)
    assertSavePendingPlan(display)
    assertFalse(display.endWanted())
    display.outcome(stoppedClosing(null))
    assertTrue(display.endWanted())
  }

  @Test
  fun aStoppedCardShownInFrontNeverEnds() {
    val display = confirmedDisplay(foreground = true)
    display.outcome(stoppedClosing(null))
    assertEquals("Stopped", shownPlan(display).title)
    assertFalse(display.endWanted())
    display.appForeground(true)
    assertFalse(display.endWanted())
  }

  @Test
  fun aFinishingClosingAfterTheClearNeverEnds() {
    val withIdentity = confirmedDisplay()
    withIdentity.appForeground(true)
    withIdentity.outcome(finishingClosing(alice))
    assertFalse(withIdentity.endWanted())
    val withoutIdentity = confirmedDisplay()
    withoutIdentity.appForeground(true)
    withoutIdentity.outcome(finishingClosing(null).copy(target = null))
    assertFalse(withoutIdentity.endWanted())
  }

  @Test
  fun aSecondReturnAfterAHiddenClosingEnds() {
    val display = confirmedDisplay()
    display.appForeground(true)
    display.appForeground(false)
    display.outcome(stoppedClosing(null))
    assertFalse(display.endWanted())
    val changed = display.appForeground(true)
    assertFalse(changed)
    assertTrue(display.endWanted())
  }

  @Test
  fun theThawBetweenTheClearAndTheClosingNeverEnds() {
    val display = confirmedDisplay()
    assertTrue(display.appForeground(true))
    assertFalse(display.endWanted())
    display.pageNotice(notice(text = counted))
    assertFalse(display.endWanted())
  }

  @Test
  fun anUnreadableClosingAfterTheClearEnds() {
    val display = confirmedDisplay()
    display.appForeground(true)
    display.outcome(null)
    assertTrue(display.endWanted())
  }

  @Test
  fun newWorkAfterAHiddenClosingClearsTheClosing() {
    val display = confirmedDisplay()
    display.outcome(stoppedClosing(null))
    display.pageNotice(newGeneration())
    val tap = display.stopTapped()
    assertEquals(StopTap.ENTERED, tap)
    assertEquals(StopDelivery.CONFIRMED, deliver(display, tap))
    display.appForeground(true)
    assertNeutral(display)
    assertFalse(display.endWanted())
  }

  @Test
  fun aStoppedClosingWhileStoppingHiddenClosesForTheReturn() {
    val display = confirmedDisplay()
    display.outcome(stoppedClosing(null))
    assertFalse(display.endWanted())
    display.appForeground(true)
    assertNeutral(display)
    assertTrue(display.endWanted())
  }

  // Guard: after a clear, a stoppable notice that shares the cancelled work's start time but has another
  // state or another chat is new work, not the cancelled work's leftovers.
  @Test
  fun aSameStartOnAnotherStateOrChatIsNewWorkAfterTheClear() {
    val speech = confirmedDisplay()
    speech.appForeground(true)
    speech.pageNotice(notice(state = NoticeState.SPEAKING, title = "Speaking…", publicTitle = "Speaking…"))
    assertEquals(NoticeState.SPEAKING, speech.current()!!.state)
    val otherChat = confirmedDisplay()
    otherChat.appForeground(true)
    otherChat.pageNotice(notice(target = NoticeTarget("g2", "c2")))
    assertEquals("g2", otherChat.current()!!.target!!.chaId)
  }

  // Guard: a second return keeps the remaining pending-save card; only a Stopped card is cleared.
  @Test
  fun aSecondReturnKeepsTheRemainingSavePending() {
    val display = confirmedDisplay()
    display.appForeground(true)
    display.pageNotice(savePending())
    display.appForeground(false)
    assertFalse(display.appForeground(true))
    assertSavePendingPlan(display)
    assertFalse(display.endWanted())
  }

  // Guard: the early-end predicate needs the exact neutral card, so a closing card that differs from it
  // only in target, text, identity or start time never ends the service.
  @Test
  fun aClosingCardWithOnlyAnEmptyTitleNeverEnds() {
    fun empty(text: String, identity: NoticeIdentity?, startedAtMs: Long?, target: NoticeTarget?) = notice(
      state = NoticeState.FINISHING, title = "", text = text, startedAtMs = startedAtMs, stopLabel = "",
      publicTitle = "", identity = identity, target = target
    )
    val cases = listOf(
      empty("", null, null, NoticeTarget("g1", "c1")),
      empty("saving", null, null, null),
      empty("", alice, 5L, null)
    )
    for (closing in cases) {
      val display = confirmedDisplay()
      display.appForeground(true)
      display.outcome(closing)
      assertFalse(display.endWanted())
    }
    val neutral = confirmedDisplay()
    neutral.appForeground(true)
    neutral.outcome(empty("", null, null, null))
    assertTrue(neutral.endWanted())
  }
}
