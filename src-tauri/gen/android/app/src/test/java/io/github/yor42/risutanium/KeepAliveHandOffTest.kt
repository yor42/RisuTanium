package io.github.yor42.risutanium

import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

// Tests of the order contract between the page's messages and the service's start commands
// (KeepAliveHandOff, runStartCommand; MC-1517, MC-091).
//
// Reproducers: T1, T2, T3, T4, ST1, DM1 and DM2 fail on the stage-0 seam (the same API with
// behaviour-preserving stub bodies: messages apply or vanish, nothing is held) at the intended defect.
// That base is a model of the old behaviour, not the old service code: the JVM cannot load Service or
// Intent. Every other test is a guard of the new rule or of an unchanged rule, and its comment says which.
//
// Not covered here: the production wiring (the bridge calling launch, the intent carrying the start
// number, the live argument of the offers, stop() clearing the queue, onDestroy calling instanceGone,
// lastStartId set before runStartCommand, the host's startForeground answering false on the catch path,
// onStartCommand going through runStartCommand, no repost() in the replay path). It is proven only by the
// device log lines and by a reader of the service at the review gate, who checks: for the live argument,
// that the offers receive the live reference and never a fresh value; for the replay, that no repost() is
// in its path; that lastStartId = startId comes before runStartCommand; and that onStartCommand goes
// through runStartCommand and the host's startForeground answers false on the catch path.
//
// The notices are built like the page's wire format: a v2 map through parseKeepAliveNotice.
class KeepAliveHandOffTest {
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

  private fun parsed(vararg overrides: Pair<String, Any?>): KeepAliveNotice =
    parseKeepAliveNotice(wire(*overrides)) ?: throw AssertionError("fixture does not parse")

  // A distinguishable update: its text carries the number.
  private fun updateOf(number: Int): KeepAliveNotice = parsed("text" to "$number characters")

  // The page's closing outcome with no work left: the card neutralFrom builds, so the early end applies.
  private fun neutralOutcome(): KeepAliveNotice = parsed(
    "state" to "finishing",
    "title" to "",
    "text" to "",
    "startedAt" to null,
    "stopLabel" to "",
    "publicTitle" to "",
    "target" to null
  )

  private fun groupNotice(): KeepAliveNotice =
    parsed("identity" to mapOf("key" to "g1", "name" to "Group"))

  private fun memberNotice(): KeepAliveNotice =
    parsed("identity" to mapOf("key" to "m1", "name" to "Member"))

  private val instance = "instance"
  private val otherInstance = "other instance"

  private val neverApplied: (String, KeepAliveNotice) -> Unit = { _, _ -> fail("apply must not run") }
  private val neverAppliedOutcome: (String, KeepAliveNotice?) -> Unit = { _, _ -> fail("apply must not run") }

  // For offers to a live instance whose route is the assertion: what apply would do is not under test.
  private val ignoreApplied: (String, KeepAliveNotice) -> Unit = { _, _ -> }
  private val ignoreAppliedOutcome: (String, KeepAliveNotice?) -> Unit = { _, _ -> }

  private fun newHandOff() = KeepAliveHandOff<String>()

  // The seam after start 1 was accepted and its command handled by a live instance.
  private fun handOffAfterFirstStart(): KeepAliveHandOff<String> {
    val handOff = newHandOff()
    handOff.launchStart(1) {}
    handOff.startHandled(1)
    return handOff
  }

  // J1: what is held and replayed.

  // T1, reproducer (S1): an update sent before the instance exists is replayed for the start.
  @Test
  fun anUpdateSentBeforeTheInstanceExistsIsReplayedAtTheStartCommand() {
    val handOff = newHandOff()
    val update = memberNotice()
    handOff.launchStart(1) {}
    assertEquals(OfferRoute.HELD_NO_INSTANCE, handOff.offerUpdate(null, update, neverApplied))
    assertEquals(listOf<HeldMessage>(HeldUpdate(update)), handOff.startHandled(1))
  }

  // T2, reproducer (S2): every held update is replayed in arrival order, none merged.
  @Test
  fun severalHeldUpdatesAreReplayedInArrivalOrder() {
    val handOff = newHandOff()
    handOff.launchStart(1) {}
    for (number in 1..3) {
      handOff.offerUpdate(null, updateOf(number), neverApplied)
    }
    assertEquals(
      listOf<HeldMessage>(HeldUpdate(updateOf(1)), HeldUpdate(updateOf(2)), HeldUpdate(updateOf(3))),
      handOff.startHandled(1)
    )
  }

  // T3, reproducer (S3): a lingering instance with a newer start pending holds the update.
  @Test
  fun aLingeringInstanceWithANewerStartPendingHoldsTheUpdate() {
    val handOff = handOffAfterFirstStart()
    handOff.launchStart(2) {}
    val applied = ArrayList<String>()
    assertEquals(
      OfferRoute.HELD_START_PENDING,
      handOff.offerUpdate(instance, updateOf(1)) { target, _ -> applied.add(target) }
    )
    assertEquals(emptyList<String>(), applied)
  }

  // T4, reproducer (S4): the update and the closing outcome sent after start B are held and replayed in
  // order for B's command.
  @Test
  fun anUpdateAndAnOutcomeAfterTheNewStartAreHeldAndReplayedInOrder() {
    val handOff = handOffAfterFirstStart()
    handOff.launchStart(2) {}
    val update = updateOf(1)
    val outcome = neutralOutcome()
    assertEquals(OfferRoute.HELD_START_PENDING, handOff.offerUpdate(instance, update, ignoreApplied))
    assertEquals(OfferRoute.HELD_START_PENDING, handOff.offerOutcome(instance, outcome, ignoreAppliedOutcome))
    assertEquals(listOf<HeldMessage>(HeldUpdate(update), HeldOutcome(outcome)), handOff.startHandled(2))
  }

  // T5, guard of the new rule (S5): each command replays only its own start's messages, and a repeated
  // command for a start replays nothing.
  @Test
  fun twoStartsAcceptedBeforeEitherCommandReplayOnlyTheirOwnMessages() {
    val handOff = newHandOff()
    handOff.launchStart(1) {}
    handOff.offerUpdate(null, updateOf(1), neverApplied)
    handOff.launchStart(2) {}
    handOff.offerUpdate(null, updateOf(2), neverApplied)
    assertEquals(listOf<HeldMessage>(HeldUpdate(updateOf(1))), handOff.startHandled(1))
    assertEquals(emptyList<HeldMessage>(), handOff.startHandled(1))
    assertEquals(listOf<HeldMessage>(HeldUpdate(updateOf(2))), handOff.startHandled(2))
  }

  // T5b, guard of the new rule: a stale or lower command never reopens direct apply while a newer start
  // is the handled one.
  @Test
  fun aLowerStartCommandNeverMovesTheHandledStartBackwards() {
    val handOff = newHandOff()
    handOff.launchStart(1) {}
    handOff.launchStart(2) {}
    handOff.startHandled(2)
    assertEquals(emptyList<HeldMessage>(), handOff.startHandled(1))
    val applied = ArrayList<String>()
    assertEquals(OfferRoute.APPLY, handOff.offerUpdate(instance, updateOf(1)) { target, _ -> applied.add(target) })
    assertEquals(listOf(instance), applied)
  }

  // T5c, guard of the new rule: a message held for start 1 is never replayed under start 2.
  @Test
  fun aMessageHeldForAnOlderStartIsNeverReplayedUnderTheNewerStart() {
    val handOff = newHandOff()
    handOff.launchStart(1) {}
    handOff.offerUpdate(null, updateOf(1), neverApplied)
    handOff.launchStart(2) {}
    assertEquals(emptyList<HeldMessage>(), handOff.startHandled(2))
    assertEquals(1, handOff.lastSkipped)
    assertEquals(emptyList<HeldMessage>(), handOff.startHandled(1))
  }

  // T5d, guard of the new rule: the dropped count describes the last call only; a call with nothing to
  // drop leaves it at zero.
  @Test
  fun theDroppedCountIsResetByTheNextCall() {
    val handOff = newHandOff()
    handOff.launchStart(1) {}
    handOff.offerUpdate(null, updateOf(1), neverApplied)
    handOff.launchStart(2) {}
    assertEquals(emptyList<HeldMessage>(), handOff.startHandled(2))
    assertEquals(1, handOff.lastSkipped)
    assertEquals(emptyList<HeldMessage>(), handOff.startHandled(2))
    assertEquals(0, handOff.lastSkipped)
  }

  // T6, guard of the new rule (S6): an outcome then an update replay in that order.
  @Test
  fun anOutcomeThenAnUpdateReplayInThatOrder() {
    val handOff = newHandOff()
    handOff.launchStart(1) {}
    val outcome = neutralOutcome()
    handOff.offerOutcome(null, outcome, neverAppliedOutcome)
    handOff.offerUpdate(null, updateOf(1), neverApplied)
    assertEquals(listOf<HeldMessage>(HeldOutcome(outcome), HeldUpdate(updateOf(1))), handOff.startHandled(1))
  }

  // T6b, guard of the new rule: an outcome then two updates replay in that order, the updates not merged.
  @Test
  fun anOutcomeThenTwoUpdatesReplayInThatOrder() {
    val handOff = newHandOff()
    handOff.launchStart(1) {}
    val outcome = neutralOutcome()
    handOff.offerOutcome(null, outcome, neverAppliedOutcome)
    handOff.offerUpdate(null, updateOf(1), neverApplied)
    handOff.offerUpdate(null, updateOf(2), neverApplied)
    assertEquals(
      listOf<HeldMessage>(HeldOutcome(outcome), HeldUpdate(updateOf(1)), HeldUpdate(updateOf(2))),
      handOff.startHandled(1)
    )
  }

  // T7, guard of the new rule (S7): the stop command (start 0) replays nothing and drops nothing, and the handled start
  // stays where it was.
  @Test
  fun theStopCommandNeitherReplaysNorDropsNorMovesTheHandledStart() {
    val handOff = newHandOff()
    handOff.launchStart(1) {}
    handOff.offerUpdate(null, updateOf(1), neverApplied)
    assertEquals(emptyList<HeldMessage>(), handOff.startHandled(0))
    assertEquals(OfferRoute.HELD_START_PENDING, handOff.offerUpdate(instance, updateOf(2), ignoreApplied))
    assertEquals(
      listOf<HeldMessage>(HeldUpdate(updateOf(1)), HeldUpdate(updateOf(2))),
      handOff.startHandled(1)
    )
  }

  // T7b, guard of the new rule: a message offered before any start was accepted is held with start 0,
  // and the stop command (start 0) neither replays nor drops it.
  @Test
  fun aMessageHeldBeforeAnyStartIsKeptByTheStopCommand() {
    val handOff = newHandOff()
    handOff.offerUpdate(null, updateOf(1), neverApplied)
    assertEquals(emptyList<HeldMessage>(), handOff.startHandled(0))
    assertEquals(1, handOff.stopped())
  }

  // T8, guard of the new rule (S8): a new instance of the same start receives the held messages, and it
  // holds until it handles that start.
  @Test
  fun aNewInstanceOfTheSameStartReceivesTheQueueAndHoldsUntilItsCommand() {
    val handOff = handOffAfterFirstStart()
    handOff.instanceGone()
    assertEquals(OfferRoute.HELD_NO_INSTANCE, handOff.offerUpdate(null, updateOf(1), neverApplied))
    assertEquals(OfferRoute.HELD_START_PENDING, handOff.offerUpdate(otherInstance, updateOf(2), ignoreApplied))
    assertEquals(
      listOf<HeldMessage>(HeldUpdate(updateOf(1)), HeldUpdate(updateOf(2))),
      handOff.startHandled(1)
    )
  }

  // T8b, guard of the new rule: an instance gone with messages held keeps them for the next instance.
  @Test
  fun anInstanceGoneKeepsTheHeldMessages() {
    val handOff = handOffAfterFirstStart()
    handOff.launchStart(2) {}
    handOff.offerUpdate(instance, updateOf(1), ignoreApplied)
    handOff.instanceGone()
    assertEquals(listOf<HeldMessage>(HeldUpdate(updateOf(1))), handOff.startHandled(2))
  }

  // T8c, guard of the new rule: at a handled start, the messages of older starts are dropped and counted.
  @Test
  fun aHandledStartDropsTheMessagesOfOlderStarts() {
    val handOff = newHandOff()
    handOff.launchStart(1) {}
    handOff.offerUpdate(null, updateOf(1), neverApplied)
    handOff.instanceGone()
    handOff.launchStart(2) {}
    handOff.offerUpdate(null, updateOf(2), neverApplied)
    assertEquals(listOf<HeldMessage>(HeldUpdate(updateOf(2))), handOff.startHandled(2))
    assertEquals(1, handOff.lastSkipped)
  }

  // T9, guard that passes before and after: once the latest start is handled the offer applies directly.
  @Test
  fun onceTheLatestStartIsHandledAnOfferAppliesDirectly() {
    val handOff = newHandOff()
    handOff.launchStart(1) {}
    handOff.startHandled(1)
    val applied = ArrayList<KeepAliveNotice>()
    val update = updateOf(1)
    assertEquals(OfferRoute.APPLY, handOff.offerUpdate(instance, update) { _, held -> applied.add(held) })
    assertEquals(listOf(update), applied)
    val outcomes = ArrayList<KeepAliveNotice?>()
    assertEquals(OfferRoute.APPLY, handOff.offerOutcome(instance, null) { _, held -> outcomes.add(held) })
    assertEquals(listOf<KeepAliveNotice?>(null), outcomes)
  }

  // T10, guard that passes before and after (S9): a refused launch changes nothing.
  @Test
  fun aRefusedLaunchChangesNothing() {
    val handOff = handOffAfterFirstStart()
    assertEquals(2, handOff.nextStart())
    assertEquals(2, handOff.nextStart())
    try {
      handOff.launchStart(2) { throw IllegalStateException("refused") }
      fail("the refusal must propagate")
    } catch (error: IllegalStateException) {
      assertEquals("refused", error.message)
    }
    assertEquals(2, handOff.nextStart())
    val applied = ArrayList<String>()
    assertEquals(OfferRoute.APPLY, handOff.offerUpdate(instance, updateOf(1)) { target, _ -> applied.add(target) })
    assertEquals(listOf(instance), applied)
  }

  // T11, guard of the new rule (S7): a stop clears the queue and says how many it held.
  @Test
  fun aStopClearsTheQueueAndCountsIt() {
    val handOff = newHandOff()
    handOff.launchStart(1) {}
    handOff.offerUpdate(null, updateOf(1), neverApplied)
    handOff.offerOutcome(null, neutralOutcome(), neverAppliedOutcome)
    assertEquals(2, handOff.stopped())
    assertEquals(emptyList<HeldMessage>(), handOff.startHandled(1))
    assertEquals(0, handOff.stopped())
  }

  // T14, guard of the new rule: the queue holds at most MAX_HELD_MESSAGES; the oldest are dropped.
  @Test
  fun theQueueIsCappedAndTheOldestIsDropped() {
    val handOff = newHandOff()
    handOff.launchStart(1) {}
    val total = MAX_HELD_MESSAGES + 1
    for (number in 1..total) {
      handOff.offerUpdate(null, updateOf(number), neverApplied)
    }
    val replay = handOff.startHandled(1)
    assertEquals(MAX_HELD_MESSAGES, replay.size)
    assertEquals(HeldUpdate(updateOf(2)), replay.first())
    assertEquals(HeldUpdate(updateOf(total)), replay.last())
    assertEquals(1, handOff.capDrops)
  }

  // T15, guard that passes before and after: with no instance an offer never applies; with one it applies on exactly that instance.
  @Test
  fun anOfferAppliesOnTheGivenInstanceOnlyAndNeverWithoutOne() {
    val handOff = newHandOff()
    handOff.launchStart(1) {}
    handOff.offerUpdate(null, updateOf(1), neverApplied)
    handOff.offerOutcome(null, null, neverAppliedOutcome)
    handOff.startHandled(1)
    var seen: String? = null
    handOff.offerUpdate(otherInstance, updateOf(2)) { target, _ -> seen = target }
    assertSame(otherInstance, seen)
  }

  // J2: the order of one start command.

  private class RecordingHost(private val foregroundAccepted: Boolean = true) : StartCommandHost {
    val events = ArrayList<String>()

    override fun showIntentNotice() {
      events.add("intent")
    }

    override fun applyHeld(message: HeldMessage) {
      events.add(if (message is HeldUpdate) "update" else "outcome")
    }

    override fun enterStopTap(): StopTap {
      events.add("tap")
      return StopTap.ENTERED
    }

    override fun startForeground(): Boolean {
      events.add("foreground")
      return foregroundAccepted
    }

    override fun endIfWanted() {
      events.add("end")
    }

    override fun deliverStop(tap: StopTap) {
      events.add("deliver")
    }
  }

  // ST1, reproducer (S4): the replayed update and outcome follow the intent's notice and precede the
  // foreground start; the early end check follows it.
  @Test
  fun aReplayedOutcomeRunsAfterTheIntentNoticeAndTheEndCheckAfterTheForegroundStart() {
    val handOff = newHandOff()
    handOff.launchStart(1) {}
    handOff.offerUpdate(null, updateOf(1), neverApplied)
    handOff.offerOutcome(null, neutralOutcome(), neverAppliedOutcome)
    val host = RecordingHost()
    runStartCommand(handOff, 1, false, host)
    assertEquals(listOf("intent", "update", "outcome", "foreground", "end"), host.events)
  }

  // ST2, guard of the new rule: a replay without an outcome never asks for the early end.
  @Test
  fun aReplayWithoutAnOutcomeNeverRunsTheEndCheck() {
    val handOff = newHandOff()
    handOff.launchStart(1) {}
    handOff.offerUpdate(null, updateOf(1), neverApplied)
    val host = RecordingHost()
    runStartCommand(handOff, 1, false, host)
    assertEquals(listOf("intent", "update", "foreground"), host.events)
  }

  // ST3, guard of the new rule (S10): a refused foreground start ends the step with no end check.
  @Test
  fun aRefusedForegroundStartRunsNoEndCheck() {
    val handOff = newHandOff()
    handOff.launchStart(1) {}
    handOff.offerOutcome(null, neutralOutcome(), neverAppliedOutcome)
    val host = RecordingHost(foregroundAccepted = false)
    runStartCommand(handOff, 1, false, host)
    assertEquals(listOf("intent", "outcome", "foreground"), host.events)
  }

  // ST3b, guard of the new rule: a replayed outcome followed by an update still asks for the early end
  // check; the check runs when any replayed message was an outcome, not only when the last one was.
  @Test
  fun anOutcomeFollowedByAnUpdateStillRunsTheEndCheck() {
    val handOff = newHandOff()
    handOff.launchStart(1) {}
    handOff.offerOutcome(null, neutralOutcome(), neverAppliedOutcome)
    handOff.offerUpdate(null, updateOf(1), neverApplied)
    val host = RecordingHost()
    runStartCommand(handOff, 1, false, host)
    assertEquals(listOf("intent", "outcome", "update", "foreground", "end"), host.events)
  }

  // ST4, guard that passes before and after: the stop command enters the tap before the foreground start
  // and delivers after it.
  @Test
  fun theStopCommandTapsThenStartsForegroundThenDelivers() {
    val handOff = newHandOff()
    handOff.launchStart(1) {}
    val host = RecordingHost()
    runStartCommand(handOff, 0, true, host)
    assertEquals(listOf("intent", "tap", "foreground", "deliver"), host.events)
  }

  // ST4b, guard of the new rule: the stop command leaves the queue for the next start's command.
  @Test
  fun theStopCommandLeavesTheQueueForTheNextStartCommand() {
    val handOff = newHandOff()
    handOff.launchStart(1) {}
    handOff.offerUpdate(null, updateOf(1), neverApplied)
    runStartCommand(handOff, 0, true, RecordingHost())
    assertEquals(listOf<HeldMessage>(HeldUpdate(updateOf(1))), handOff.startHandled(1))
  }

  // J3: the display result of a replay against the messages arriving in order. The host is a model of the
  // service's glue over a real KeepAliveDisplay, not the service.

  private class ModelInstance {
    val display = KeepAliveDisplay(foreground = true)

    fun applyUpdate(notice: KeepAliveNotice) {
      display.pageNotice(notice)
    }

    fun applyOutcome(notice: KeepAliveNotice?) {
      display.outcome(notice)
    }
  }

  private class ModelHost(private val model: ModelInstance, private val intentNotice: KeepAliveNotice) :
    StartCommandHost {
    var endChecks = 0
    var endWantedAtCheck = false

    override fun showIntentNotice() {
      model.display.pageNotice(intentNotice)
    }

    override fun applyHeld(message: HeldMessage) {
      when (message) {
        is HeldUpdate -> model.applyUpdate(message.notice)
        is HeldOutcome -> model.applyOutcome(message.notice)
      }
    }

    override fun enterStopTap(): StopTap = model.display.stopTapped()

    override fun startForeground(): Boolean = true

    override fun endIfWanted() {
      endChecks++
      endWantedAtCheck = model.display.endWanted()
    }

    override fun deliverStop(tap: StopTap) {
    }
  }

  // DM1, reproducer (S1): a group run's member update sent before the instance exists shows the member on
  // the first card, as the same two messages arriving in order do.
  @Test
  fun aMemberUpdateBeforeTheInstanceExistsShowsTheMemberOnTheFirstCard() {
    val handOff = newHandOff()
    handOff.launchStart(1) {}
    val member = memberNotice()
    handOff.offerUpdate(null, member, neverApplied)
    val model = ModelInstance()
    runStartCommand(handOff, 1, false, ModelHost(model, groupNotice()))
    val inOrder = KeepAliveDisplay(foreground = true)
    inOrder.pageNotice(groupNotice())
    inOrder.pageNotice(member)
    assertEquals(NoticeIdentity("m1", "Member"), model.display.current()?.identity)
    assertEquals(inOrder.current(), model.display.current())
  }

  // DM2, reproducer (S4): start B, an update and the closing outcome sent to a lingering instance end
  // showing the outcome with the early end wanted, as B, the update and the outcome applied in order do.
  @Test
  fun anOutcomeSentAfterTheNewStartEndsTheCardAndRunsTheEndCheck() {
    val handOff = KeepAliveHandOff<ModelInstance>()
    val model = ModelInstance()
    handOff.launchStart(1) {}
    runStartCommand(handOff, 1, false, ModelHost(model, parsed("title" to "First run")))
    handOff.launchStart(2) {}
    val update = updateOf(1)
    val outcome = neutralOutcome()
    handOff.offerUpdate(model, update) { target, held -> target.applyUpdate(held) }
    handOff.offerOutcome(model, outcome) { target, held -> target.applyOutcome(held) }
    val host = ModelHost(model, parsed("title" to "Second run"))
    runStartCommand(handOff, 2, false, host)

    val inOrder = KeepAliveDisplay(foreground = true)
    inOrder.pageNotice(parsed("title" to "Second run"))
    inOrder.pageNotice(update)
    inOrder.outcome(outcome)
    assertTrue(inOrder.endWanted())

    assertEquals(outcome, model.display.current())
    assertTrue(model.display.endWanted())
    assertEquals(1, host.endChecks)
    assertTrue(host.endWantedAtCheck)
  }

  // DM3, guard of the new rule: start B, an outcome and then an update replayed together end showing the
  // update, as the same messages applied in order do; the end check ran once and agrees with the display
  // of the in-order run (an update after the outcome leaves the card running, so no end is wanted).
  @Test
  fun anOutcomeFollowedByAnUpdateEndsShowingTheUpdateAndTheEndCheckAgrees() {
    val handOff = newHandOff()
    handOff.launchStart(1) {}
    val outcome = neutralOutcome()
    val update = updateOf(1)
    handOff.offerOutcome(null, outcome, neverAppliedOutcome)
    handOff.offerUpdate(null, update, neverApplied)
    val model = ModelInstance()
    val host = ModelHost(model, parsed("title" to "Second run"))
    runStartCommand(handOff, 1, false, host)

    val inOrder = KeepAliveDisplay(foreground = true)
    inOrder.pageNotice(parsed("title" to "Second run"))
    inOrder.outcome(outcome)
    inOrder.pageNotice(update)

    assertEquals(update, model.display.current())
    assertEquals(inOrder.current(), model.display.current())
    assertEquals(inOrder.endWanted(), model.display.endWanted())
    assertEquals(1, host.endChecks)
    assertEquals(inOrder.endWanted(), host.endWantedAtCheck)
  }
}
