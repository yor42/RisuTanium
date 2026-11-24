package io.github.yor42.risutanium

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// CHORE-722 stage 3: the notice native posts for an owned reply that ended while the app was hidden. Every
// test is a new-rule guard or a compatibility guard; none reproduces a defect that existed before.
class NativeReplyNoticePolicyTest {
  private val a = NoticeTarget("g1", "c1")
  private val b = NoticeTarget("g2", "c2")

  // The nested maps are shaped like the bridge's copy of the page's JSON (plainMap).
  private fun replyWire(text: String, silent: Boolean, chaId: String = "g1", chatId: String = "c1"): Map<String, Any?> = mapOf(
    "v" to 2,
    "key" to "reply/key",
    "name" to "Alice",
    "text" to text,
    "publicTitle" to "New reply",
    "chaId" to chaId,
    "chatId" to chatId,
    "avatar" to null,
    "silent" to silent
  )

  private fun armWire(
    chaId: String? = "g1",
    chatId: String? = "c1",
    vararg overrides: Pair<String, Any?>
  ): Map<String, Any?> {
    val closing = mutableMapOf<String, Any?>(
      "finishingTitle" to "Finishing…",
      "failedTitle" to "Reply failed",
      "failedText" to "Check the connection"
    )
    if (chaId != null) closing["chaId"] = chaId
    if (chatId != null) closing["chatId"] = chatId
    val base = mutableMapOf<String, Any?>(
      "v" to 1,
      "done" to replyWire("Replied", false, chaId ?: "g1", chatId ?: "c1"),
      "failed" to replyWire("Reply failed", true, chaId ?: "g1", chatId ?: "c1"),
      "closing" to closing
    )
    for ((key, value) in overrides) base[key] = value
    return base
  }

  private fun armFor(target: NoticeTarget?): NativeArm =
    parseNativeArm(armWire(target?.chaId, target?.chatId))!!

  private fun card(
    state: NoticeState = NoticeState.GENERATING,
    target: NoticeTarget? = a,
    startedAtMs: Long? = 1_000_000L,
    stopLabel: String = "Stop"
  ) = KeepAliveNotice(
    state = state,
    title = "Generating a reply…",
    text = "",
    startedAtMs = startedAtMs,
    stopLabel = stopLabel,
    publicTitle = "Generating a reply…",
    stoppingTitle = "Stopping…",
    stoppedTitle = "Stopped",
    identity = NoticeIdentity("c1", "Alice"),
    avatar = null,
    target = target
  )

  private fun generating(target: NoticeTarget? = a, foreground: Boolean = false): KeepAliveDisplay {
    val display = KeepAliveDisplay(foreground = foreground)
    display.pageNotice(card(target = target))
    return display
  }

  // One Stop tap as the service runs it: the tap sequence, then the delivery.
  private fun tap(display: KeepAliveDisplay, tokens: NoticeTokens, cancelled: Int = 1): StopDelivery {
    val tap = onStopTap(display, tokens)
    return deliverStopTap(tap, display, { true }, { cancelled })
  }

  private fun stoppedOutcome(target: NoticeTarget? = a) = card(state = NoticeState.STOPPED, target = target, startedAtMs = null, stopLabel = "")

  private fun finishingOutcome(target: NoticeTarget? = a) = card(state = NoticeState.FINISHING, target = target, startedAtMs = null, stopLabel = "")

  // K1: the arm.

  @Test
  fun anArmCarriesBothNoticesAndTheClosingCard() {
    val arm = parseNativeArm(armWire())!!
    assertEquals("Replied", arm.done.text)
    assertFalse(arm.done.silent)
    assertEquals("Reply failed", arm.failed.text)
    assertTrue(arm.failed.silent)
    assertEquals("reply/key", arm.done.key)
    assertEquals(a, arm.closing.target)
    assertEquals("Finishing…", arm.closing.finishingTitle)
    assertEquals("Reply failed", arm.closing.failedTitle)
    assertEquals("Check the connection", arm.closing.failedText)
  }

  @Test
  fun anArmThatDoesNotFitTheContractIsDropped() {
    assertNull(parseNativeArm(armWire(null, null, "v" to 2)))
    assertNull(parseNativeArm(armWire(null, null, "v" to null)))
    assertNull(parseNativeArm(armWire(null, null, "done" to null)))
    assertNull(parseNativeArm(armWire(null, null, "done" to "text")))
    assertNull(parseNativeArm(armWire(null, null, "failed" to emptyMap<String, Any?>())))
    assertNull(parseNativeArm(armWire(null, null, "failed" to replyWire("x", true).minus("key"))))
    assertNull(parseNativeArm(armWire(null, null, "done" to replyWire("x", false).plus("v" to 1))))
    assertNull(parseNativeArm(armWire(null, null, "closing" to null)))
    assertNull(parseNativeArm(armWire(null, null, "closing" to listOf("g1"))))
  }

  // The arm reads the closing chat with the card's own rule, so the same chat is the same target on both.
  @Test
  fun theClosingTargetFollowsTheCardsTargetRules() {
    assertNull(armFor(null).closing.target)
    assertNull(parseNativeArm(armWire("g".repeat(201), "c1"))!!.closing.target)
    assertNull(parseNativeArm(armWire("", "c1"))!!.closing.target)
    val fromCard = parseKeepAliveNotice(
      mapOf("v" to 2, "state" to "generating", "target" to mapOf("chaId" to "g1", "chatId" to "c1"))
    )!!.target
    assertEquals(fromCard, parseNativeArm(armWire())!!.closing.target)
    val noTarget = parseKeepAliveNotice(mapOf("v" to 2, "state" to "generating", "target" to mapOf("chaId" to "g1")))!!.target
    assertEquals(noTarget, parseNativeArm(armWire("g1", null))!!.closing.target)
  }

  @Test
  fun theClosingTextIsCappedAndMissingTextIsEmpty() {
    val long = parseNativeArm(
      armWire(
        "g1", "c1",
        "closing" to mapOf(
          "chaId" to "g1", "chatId" to "c1",
          "finishingTitle" to "t".repeat(300), "failedTitle" to 5, "failedText" to "x".repeat(600)
        )
      )
    )!!
    assertEquals(256, long.closing.finishingTitle.length)
    assertEquals("", long.closing.failedTitle)
    assertEquals(512, long.closing.failedText.length)
  }

  // K2: the poll rules.

  @Test
  fun aPollAnswerMapsToOneAction() {
    assertEquals(NoticeAction.POST_DONE, pollStep(1, 0))
    assertEquals(NoticeAction.POST_FAILED, pollStep(2, 0))
    assertEquals(NoticeAction.DROP, pollStep(3, 0))
    assertEquals(NoticeAction.DROP, pollStep(-1, 0))
    assertEquals(NoticeAction.DROP, pollStep(5, 0))
    assertEquals(NoticeAction.KEEP, pollStep(0, 0))
  }

  // A pending reply is never given up on a count: the hub always ends a bound token.
  @Test
  fun aPendingAnswerKeepsForeverAndAnUnboundOneDisarmsAfterSixtyPolls() {
    assertEquals(NoticeAction.KEEP, pollStep(0, 1000))
    assertEquals(NoticeAction.KEEP, pollStep(4, 1))
    assertEquals(NoticeAction.KEEP, pollStep(4, 59))
    assertEquals(NoticeAction.DISARM, pollStep(4, 60))
    val tokens = NoticeTokens()
    tokens.add(1, armFor(a))
    for (poll in 1..59) assertEquals(NoticeAction.KEEP, tokens.onPoll(1, 4))
    assertEquals(NoticeAction.DISARM, tokens.onPoll(1, 4))
    assertEquals(setOf(1), tokens.held())
  }

  @Test
  fun aBoundAnswerRestartsTheUnboundCount() {
    val tokens = NoticeTokens()
    tokens.add(1, armFor(a))
    for (poll in 1..59) tokens.onPoll(1, 4)
    assertEquals(NoticeAction.KEEP, tokens.onPoll(1, 0))
    for (poll in 1..59) assertEquals(NoticeAction.KEEP, tokens.onPoll(1, 4))
  }

  @Test
  fun theArmFlagsAllowANotificationOnlyWhenEveryConditionHolds() {
    assertEquals(ARM_FLAG_NOTIFY, armFlags(optedIn = true, enabled = true, hasNotice = true))
    assertEquals(0, armFlags(optedIn = false, enabled = true, hasNotice = true))
    assertEquals(0, armFlags(optedIn = true, enabled = false, hasNotice = true))
    assertEquals(0, armFlags(optedIn = true, enabled = true, hasNotice = false))
  }

  @Test
  fun aFinishedReplySoundsOnlyWhileHiddenAndAFailureNever() {
    assertFalse(postSilent(NoticeKind.DONE, visibleNow = false))
    assertTrue(postSilent(NoticeKind.DONE, visibleNow = true))
    assertTrue(postSilent(NoticeKind.FAILED, visibleNow = false))
    assertTrue(postSilent(NoticeKind.FAILED, visibleNow = true))
  }

  @Test
  fun aPostedNoticeCarriesTheSilentRuleAndAnEndedTokenIsForgotten() {
    val tokens = NoticeTokens()
    tokens.add(1, armFor(a))
    tokens.add(2, armFor(a))
    tokens.add(3, armFor(a))
    val sounding = pollEffect(tokens, 1, 1, null, visibleNow = false)
    assertEquals(NoticeAction.POST_DONE, sounding.action)
    assertFalse(sounding.post!!.silent)
    assertEquals("reply/key", sounding.post!!.key)
    val returned = pollEffect(tokens, 2, 1, null, visibleNow = true)
    assertTrue(returned.post!!.silent)
    val failed = pollEffect(tokens, 3, 2, null, visibleNow = false)
    assertEquals(NoticeAction.POST_FAILED, failed.action)
    assertTrue(failed.post!!.silent)
    assertTrue(tokens.held().isEmpty())
    assertEquals(NoticeAction.DROP, pollEffect(tokens, 1, 1, null).action)
    assertNull(pollEffect(tokens, 1, 1, null).post)
  }

  @Test
  fun aQuietOrAbsentAnswerPostsNothingAndForgetsTheToken() {
    for (code in listOf(3, -1)) {
      val tokens = NoticeTokens()
      tokens.add(1, armFor(a))
      val effect = pollEffect(tokens, 1, code, generating())
      assertEquals(NoticeAction.DROP, effect.action)
      assertNull(effect.post)
      assertFalse(effect.cardChanged)
      assertTrue(tokens.held().isEmpty())
    }
  }

  // K3 closing card through the poll seam: the card of the arm's own chat closes, another chat's does not.
  @Test
  fun aPostedNoticeClosesTheCardOfItsOwnChatOnly() {
    val tokens = NoticeTokens()
    tokens.add(1, armFor(a))
    tokens.add(2, armFor(b))
    val display = generating(a)
    val other = pollEffect(tokens, 2, 1, display)
    assertEquals(NoticeAction.POST_DONE, other.action)
    assertFalse(other.cardChanged)
    assertEquals(NoticeState.GENERATING, display.current()!!.state)
    val own = pollEffect(tokens, 1, 1, display)
    assertTrue(own.cardChanged)
    assertEquals(NoticeState.FINISHING, display.current()!!.state)
    assertEquals("Finishing…", display.current()!!.title)

    val failedTokens = NoticeTokens()
    failedTokens.add(1, armFor(a))
    val failedDisplay = generating(a)
    assertTrue(pollEffect(failedTokens, 1, 2, failedDisplay).cardChanged)
    assertEquals(NoticeState.FAILED, failedDisplay.current()!!.state)
    assertEquals("Reply failed", failedDisplay.current()!!.title)
    assertEquals("Check the connection", failedDisplay.current()!!.text)
  }

  // K3d: the Stop mark (D17). Every tap goes through onStopTap, then deliverStopTap, like the service.

  // d1: the page's outcome ends Stopping before the poll; the mark still skips the notice and leaves the
  // card alone.
  @Test
  fun aStopThenTheOutcomeStillSkipsTheRepliedNotice() {
    val tokens = NoticeTokens()
    tokens.add(1, armFor(a))
    val display = generating()
    assertEquals(StopDelivery.CONFIRMED, tap(display, tokens, cancelled = 1))
    display.outcome(stoppedOutcome())
    assertFalse(display.stopping)
    val before = display.current()
    val effect = pollEffect(tokens, 1, 1, display)
    assertEquals(NoticeAction.SKIP_STOPPED, effect.action)
    assertNull(effect.post)
    assertFalse(effect.cardChanged)
    assertEquals(before, display.current())
    assertTrue(tokens.held().isEmpty())
  }

  // d2: the return to the app clears the confirmed Stopped card; the mark survives it.
  @Test
  fun aStopThenTheReturnToTheAppStillSkips() {
    val tokens = NoticeTokens()
    tokens.add(1, armFor(a))
    val display = generating()
    assertEquals(StopDelivery.CONFIRMED, tap(display, tokens))
    display.appForeground(false)
    assertTrue(display.appForeground(true))
    assertFalse(display.stopping)
    assertEquals(NoticeAction.SKIP_STOPPED, pollEffect(tokens, 1, 1, display).action)
  }

  // d3: the service is gone (no display), and a restarted service has a fresh display.
  @Test
  fun aStopThenTheServiceEndingStillSkips() {
    val tokens = NoticeTokens()
    tokens.add(1, armFor(a))
    tokens.add(2, armFor(a))
    val display = generating()
    assertEquals(StopTap.ENTERED, onStopTap(display, tokens))
    val gone = pollEffect(tokens, 1, 1, null)
    assertEquals(NoticeAction.SKIP_STOPPED, gone.action)
    assertNull(gone.post)
    val restarted = generating()
    val fresh = pollEffect(tokens, 2, 1, restarted)
    assertEquals(NoticeAction.SKIP_STOPPED, fresh.action)
    assertFalse(fresh.cardChanged)
    assertEquals(NoticeState.GENERATING, restarted.current()!!.state)
  }

  // d4: an unconfirmed Stopping that the page's outcome or the timeout ended.
  @Test
  fun anUnconfirmedStopEndedByTheOutcomeOrTheTimeoutStillSkips() {
    val byOutcome = NoticeTokens()
    byOutcome.add(1, armFor(a))
    val display = generating()
    assertEquals(StopDelivery.DELIVERED, tap(display, byOutcome, cancelled = 0))
    assertTrue(display.stopping)
    display.outcome(finishingOutcome())
    assertFalse(display.stopping)
    assertEquals(NoticeAction.SKIP_STOPPED, pollEffect(byOutcome, 1, 1, display).action)

    val byTimeout = NoticeTokens()
    byTimeout.add(1, armFor(a))
    val foreground = generating(foreground = true)
    assertEquals(StopDelivery.DELIVERED, tap(foreground, byTimeout, cancelled = 0))
    assertTrue(foreground.stopTimeout())
    assertFalse(foreground.stopping)
    assertEquals(NoticeAction.SKIP_STOPPED, pollEffect(byTimeout, 1, 1, foreground).action)
  }

  // d5: a token armed after the tap is for new work: it posts and closes the new card. The sequence is a
  // confirmed Stop, then new work for the same chat (which ends Stopped), then the new arm and its poll.
  @Test
  fun aTokenArmedAfterTheStopStillPosts() {
    val tokens = NoticeTokens()
    tokens.add(1, armFor(a))
    val display = generating()
    assertEquals(StopDelivery.CONFIRMED, tap(display, tokens))
    assertTrue(display.pageNotice(card(startedAtMs = 2_000_000L)))
    assertFalse(display.stopping)
    tokens.add(2, armFor(a))
    val effect = pollEffect(tokens, 2, 1, display)
    assertEquals(NoticeAction.POST_DONE, effect.action)
    assertNotNull(effect.post)
    assertTrue(effect.cardChanged)
    assertEquals(NoticeState.FINISHING, display.current()!!.state)
    assertEquals(NoticeAction.SKIP_STOPPED, pollEffect(tokens, 1, 1, display).action)
  }

  private fun speaking(target: NoticeTarget? = a): KeepAliveDisplay {
    val display = KeepAliveDisplay(foreground = false)
    display.pageNotice(card(state = NoticeState.SPEAKING, target = target))
    return display
  }

  // d6 (N2): native cancels every chat stream under a Generating card, so an entered Stop marks every held
  // token, the named card's chat, another chat and an unnamed one alike.
  @Test
  fun aStopOnAGeneratingCardMarksEveryHeldToken() {
    val tokens = NoticeTokens()
    tokens.add(1, armFor(a))
    tokens.add(2, armFor(b))
    tokens.add(3, armFor(null))
    val display = generating(a)
    assertEquals(StopTap.ENTERED, onStopTap(display, tokens))
    assertTrue(display.nativeCancelWanted())
    assertEquals(NoticeAction.SKIP_STOPPED, pollEffect(tokens, 1, 1, display).action)
    assertEquals(NoticeAction.SKIP_STOPPED, pollEffect(tokens, 2, 1, display).action)
    assertEquals(NoticeAction.SKIP_STOPPED, pollEffect(tokens, 3, 1, display).action)

    val nullTokens = NoticeTokens()
    nullTokens.add(1, armFor(null))
    nullTokens.add(2, armFor(a))
    val nullCard = generating(null)
    assertEquals(StopTap.ENTERED, onStopTap(nullCard, nullTokens))
    assertEquals(NoticeAction.SKIP_STOPPED, pollEffect(nullTokens, 1, 1, nullCard).action)
    assertEquals(NoticeAction.SKIP_STOPPED, pollEffect(nullTokens, 2, 1, nullCard).action)
  }

  // N1: the count card (no target) over two chats; a notification Stop leaves no "Replied" for either.
  @Test
  fun aStopOnTheCountCardSkipsEveryChatsDoneNotice() {
    val tokens = NoticeTokens()
    tokens.add(1, armFor(a))
    tokens.add(2, armFor(b))
    val display = generating(null)
    assertEquals(StopTap.ENTERED, onStopTap(display, tokens))
    assertEquals(NoticeAction.SKIP_STOPPED, pollEffect(tokens, 1, 1, display).action)
    assertEquals(NoticeAction.SKIP_STOPPED, pollEffect(tokens, 2, 1, display).action)
  }

  // N4: native cancels nothing under a Speaking card, so only the card's own chat is marked and another
  // chat's reply that nothing stopped still announces itself; a null-target Speaking card marks no chat.
  @Test
  fun aStopOnASpeakingCardMarksOnlyItsOwnChat() {
    val tokens = NoticeTokens()
    tokens.add(1, armFor(a))
    tokens.add(2, armFor(b))
    val display = speaking(a)
    assertEquals(StopTap.ENTERED, onStopTap(display, tokens))
    assertFalse(display.nativeCancelWanted())
    assertEquals(NoticeAction.SKIP_STOPPED, pollEffect(tokens, 1, 1, display).action)
    assertEquals(NoticeAction.POST_DONE, pollEffect(tokens, 2, 1, display).action)

    val nullTokens = NoticeTokens()
    nullTokens.add(1, armFor(b))
    val nullCard = speaking(null)
    assertEquals(StopTap.ENTERED, onStopTap(nullCard, nullTokens))
    assertFalse(nullCard.nativeCancelWanted())
    assertEquals(NoticeAction.POST_DONE, pollEffect(nullTokens, 1, 1, nullCard).action)
  }

  // d7: a stale tap and a tap on a card with no stoppable work are no Stop for any chat.
  @Test
  fun aStaleOrPlainTapMarksNothing() {
    val tokens = NoticeTokens()
    tokens.add(1, armFor(a))
    val display = generating()
    assertEquals(StopTap.ENTERED, onStopTap(display, tokens))
    tokens.add(2, armFor(a))
    assertEquals(StopTap.STALE, onStopTap(display, tokens))
    assertEquals(NoticeAction.SKIP_STOPPED, pollEffect(tokens, 1, 1, display).action)
    assertEquals(NoticeAction.POST_DONE, pollEffect(tokens, 2, 1, display).action)

    val plainTokens = NoticeTokens()
    plainTokens.add(1, armFor(a))
    val plain = KeepAliveDisplay(foreground = false)
    plain.pageNotice(finishingOutcome(a))
    assertFalse(plain.current()!!.stoppable)
    assertEquals(StopTap.PLAIN, onStopTap(plain, plainTokens))
    assertEquals(NoticeAction.POST_DONE, pollEffect(plainTokens, 1, 1, plain).action)

    val emptyTokens = NoticeTokens()
    emptyTokens.add(1, armFor(a))
    assertEquals(StopTap.PLAIN, onStopTap(KeepAliveDisplay(), emptyTokens))
    assertEquals(NoticeAction.POST_DONE, pollEffect(emptyTokens, 1, 1, null).action)
  }

  // d8: the mark survives pending polls, an unbound countdown and a disarm answer that did not end the token.
  @Test
  fun theMarkSurvivesPollsAndAnUnansweredDisarm() {
    val tokens = NoticeTokens()
    tokens.add(1, armFor(a))
    val display = generating()
    assertEquals(StopTap.ENTERED, onStopTap(display, tokens))
    assertEquals(NoticeAction.KEEP, pollEffect(tokens, 1, 0, display).action)
    assertEquals(NoticeAction.KEEP, pollEffect(tokens, 1, 0, display).action)
    var last = NoticeAction.KEEP
    for (poll in 1..60) last = pollEffect(tokens, 1, 4, display).action
    assertEquals(NoticeAction.DISARM, last)
    tokens.disarmAnswered(1, 0)
    assertEquals(setOf(1), tokens.held())
    assertEquals(NoticeAction.SKIP_STOPPED, pollEffect(tokens, 1, 1, display).action)
  }

  @Test
  fun aDisarmAnswerOfAbsentEndsTheTokenAndAHeldTokenKeepsItsMarkWhenArmedAgain() {
    val tokens = NoticeTokens()
    assertTrue(tokens.add(1, armFor(a)))
    tokens.stopPressed(a)
    assertFalse(tokens.add(1, armFor(a)))
    assertEquals(NoticeAction.SKIP_STOPPED, tokens.onPoll(1, 1))
    assertTrue(tokens.add(2, armFor(a)))
    tokens.disarmAnswered(2, -1)
    assertTrue(tokens.held().isEmpty())
  }

  // d9: D17 names only the finished-reply notice, so a failure still posts silently.
  @Test
  fun aStopDoesNotSkipAFailureNotice() {
    val tokens = NoticeTokens()
    tokens.add(1, armFor(a))
    val display = generating()
    assertEquals(StopTap.ENTERED, onStopTap(display, tokens))
    val effect = pollEffect(tokens, 1, 2, display)
    assertEquals(NoticeAction.POST_FAILED, effect.action)
    assertTrue(effect.post!!.silent)
    assertEquals("Reply failed", effect.post!!.text)
    assertFalse(effect.cardChanged)
  }

  // A tap with nothing held changes nothing, including before the singleton is installed.
  @Test
  fun aStopWithNoHeldTokenMarksNothingAndKeepsTheTap() {
    val display = generating()
    val tokens = NoticeTokens()
    assertEquals(StopTap.ENTERED, onStopTap(display, tokens))
    assertTrue(tokens.held().isEmpty())
    assertNull(stopMark(StopTap.STALE, display))
    assertNull(stopMark(StopTap.PLAIN, display))
    assertEquals(StopMark(a), stopMark(StopTap.ENTERED, display))
  }
}
