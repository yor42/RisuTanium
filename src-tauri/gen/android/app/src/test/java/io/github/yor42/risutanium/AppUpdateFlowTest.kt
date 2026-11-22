package io.github.yor42.risutanium

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AppUpdateFlowTest {
  private val names = ArrayDeque(listOf("n1", "n2", "n3", "n4", "n5"))

  private fun flow(supplier: () -> String = { names.removeFirst() }) = AppUpdateFlow(supplier)

  private fun cancelled(gen: Long) = FlowAction.Reply(gen, UpdateReply.Failure(UpdateErrorCode.CANCELLED))

  private fun running(f: AppUpdateFlow, foreground: Boolean = true): Pair<Long, String> {
    if (foreground) f.resumed()
    val start = f.accept().single() as FlowAction.StartJob
    return start.gen to start.name
  }

  // J-F1
  @Test
  fun processStartSweepsOnlyOnce() {
    val f = flow()
    assertEquals(listOf(FlowAction.DeleteAll), f.processStart())
    assertEquals(emptyList<FlowAction>(), f.processStart())
  }

  // J-F2
  @Test
  fun acceptInIdleStartsAFreshNameAndASecondAcceptIsBusy() {
    val f = flow()
    assertEquals(listOf(FlowAction.StartJob(1L, "n1")), f.accept())
    assertEquals(
      listOf(FlowAction.Reply(NO_GENERATION, UpdateReply.Failure(UpdateErrorCode.BUSY))),
      f.accept()
    )
    assertEquals(FlowState.Running(1L, "n1"), f.state)
    assertEquals(1L, f.newestGen)
  }

  // J-F3
  @Test
  fun newCheckInRunningMarksCancelsDeletesAndAnswersCancelled() {
    val f = flow()
    val (gen, _) = running(f)
    assertEquals(
      listOf(FlowAction.MarkCancelled(gen), FlowAction.DeleteAll, cancelled(gen)),
      f.newCheck()
    )
    assertEquals(FlowState.Idle, f.state)
    assertEquals(emptyList<FlowAction>(), f.jobFinished(gen, JobResult.Ok))
    assertEquals(FlowState.Idle, f.state)
  }

  // J-F4
  @Test
  fun jobFailureDeletesAndReplies() {
    val f = flow()
    val (gen, _) = running(f)
    assertEquals(
      listOf(
        FlowAction.DeleteAll,
        FlowAction.Reply(gen, UpdateReply.Failure(UpdateErrorCode.STORAGE, 7L))
      ),
      f.jobFinished(gen, JobResult.Failed(UpdateErrorCode.STORAGE, 7L))
    )
    assertEquals(FlowState.Idle, f.state)
  }

  // J-F5
  @Test
  fun okLaunchesWhileForegroundAndWaitsWhilePaused() {
    val f = flow()
    val (gen, name) = running(f)
    assertEquals(listOf(FlowAction.Launch(gen, name)), f.jobFinished(gen, JobResult.Ok))
    assertEquals(FlowState.Installing(gen, name), f.state)

    val g = flow()
    val (gen2, name2) = running(g, foreground = false)
    assertEquals(emptyList<FlowAction>(), g.jobFinished(gen2, JobResult.Ok))
    assertEquals(FlowState.Launching(gen2, name2), g.state)
    assertEquals(listOf(FlowAction.Launch(gen2, name2)), g.resumed())
    assertEquals(FlowState.Installing(gen2, name2), g.state)
  }

  @Test
  fun pausedAgainBeforeOkStillWaits() {
    val f = flow()
    val (gen, name) = running(f)
    f.paused()
    assertEquals(emptyList<FlowAction>(), f.jobFinished(gen, JobResult.Ok))
    assertEquals(FlowState.Launching(gen, name), f.state)
  }

  // J-F6
  @Test
  fun cancelInLaunchingDeletesAndAnswersCancelled() {
    val f = flow()
    val (gen, name) = running(f, foreground = false)
    f.jobFinished(gen, JobResult.Ok)
    assertEquals(FlowState.Launching(gen, name), f.state)
    assertEquals(listOf(FlowAction.DeleteAll, cancelled(gen)), f.cancel())
    assertEquals(FlowState.Idle, f.state)
    assertEquals(emptyList<FlowAction>(), f.resumed())
  }

  // J-F7 (E6): the launch was emitted by jobFinished while foreground, so the state is Installing.
  @Test
  fun launchRefusedAfterJobFinishedDeletesAndRepliesPermission() {
    val f = flow()
    val (gen, _) = running(f)
    f.jobFinished(gen, JobResult.Ok)
    assertEquals(
      listOf(FlowAction.DeleteAll, FlowAction.Reply(gen, UpdateReply.Failure(UpdateErrorCode.PERMISSION))),
      f.launchRefused(gen)
    )
    assertEquals(FlowState.Idle, f.state)
  }

  // J-F8
  @Test
  fun launchFailedRevokesThenDeletesThenRepliesFailed() {
    val f = flow()
    val (gen, name) = running(f)
    f.jobFinished(gen, JobResult.Ok)
    assertEquals(
      listOf(
        FlowAction.RevokeGrant(name),
        FlowAction.DeleteAll,
        FlowAction.Reply(gen, UpdateReply.Outcome(InstallOutcome.NOT_INSTALLED))
      ),
      f.launchFailed(gen)
    )
    assertEquals(FlowState.Idle, f.state)
  }

  // J-F9
  @Test
  fun installerReturnedRevokesBeforeDeleteThenReplies() {
    val f = flow()
    val (gen, name) = running(f)
    f.jobFinished(gen, JobResult.Ok)
    assertEquals(
      listOf(
        FlowAction.RevokeGrant(name),
        FlowAction.DeleteAll,
        FlowAction.Reply(gen, UpdateReply.Outcome(InstallOutcome.NOT_INSTALLED))
      ),
      f.installerReturned()
    )
    assertEquals(FlowState.Idle, f.state)
    assertEquals(emptyList<FlowAction>(), f.installerReturned())
  }

  // J-F10
  @Test
  fun cancelInInstallingDoesNothing() {
    val f = flow()
    val (gen, name) = running(f)
    f.jobFinished(gen, JobResult.Ok)
    assertEquals(emptyList<FlowAction>(), f.cancel())
    assertEquals(FlowState.Installing(gen, name), f.state)
  }

  // J-F11
  @Test
  fun newCheckInInstallingRevokesThenDeletesThenAnswersCancelled() {
    val f = flow()
    val (gen, name) = running(f)
    f.jobFinished(gen, JobResult.Ok)
    assertEquals(
      listOf(FlowAction.RevokeGrant(name), FlowAction.DeleteAll, cancelled(gen)),
      f.newCheck()
    )
    assertEquals(FlowState.Idle, f.state)
    assertEquals(emptyList<FlowAction>(), f.installerReturned())
  }

  @Test
  fun newPageIsNewCheck() {
    val f = flow()
    val (gen, name) = running(f)
    f.jobFinished(gen, JobResult.Ok)
    assertEquals(listOf(FlowAction.RevokeGrant(name), FlowAction.DeleteAll, cancelled(gen)), f.newPage())
  }

  // J-F12
  @Test
  fun aNameIsNeverIssuedTwice() {
    val f = flow(scripted("dup", "dup", "dup", "other"))
    val first = f.accept().single() as FlowAction.StartJob
    assertEquals("dup", first.name)
    f.jobFinished(first.gen, JobResult.Failed(UpdateErrorCode.NETWORK))
    val second = f.accept().single() as FlowAction.StartJob
    assertEquals("other", second.name)
    assertNotEquals(first.name, second.name)
  }

  private fun scripted(vararg values: String): () -> String {
    val queue = ArrayDeque(values.toList())
    return { queue.removeFirst() }
  }

  @Test
  fun aSupplierThatNeverYieldsAFreshNameFailsLoudly() {
    val f = flow { "same" }
    val first = f.accept().single() as FlowAction.StartJob
    f.jobFinished(first.gen, JobResult.Failed(UpdateErrorCode.NETWORK))
    var failed = false
    try {
      f.accept()
    } catch (error: IllegalStateException) {
      failed = true
    }
    assertTrue(failed)
    assertEquals(FlowState.Idle, f.state)
  }

  @Test
  fun randomNamesAre128BitHex() {
    val name = randomUpdateName()
    assertTrue(Regex("update-[0-9a-f]{32}\\.apk").matches(name))
    assertNotEquals(name, randomUpdateName())
  }

  // J-F13
  @Test
  fun cancelBeforeAnyJobEventMakesTheOkResultCancelled() {
    val f = flow()
    val (gen, _) = running(f)
    assertEquals(listOf(FlowAction.MarkCancelled(gen)), f.cancel())
    assertTrue(f.isCancelled(gen))
    assertEquals(listOf(FlowAction.DeleteAll, cancelled(gen)), f.jobFinished(gen, JobResult.Ok))
    assertEquals(FlowState.Idle, f.state)
  }

  @Test
  fun aCancelledGenerationRepliesCancelledEvenWhenTheJobFailed() {
    val f = flow()
    val (gen, _) = running(f)
    f.cancel()
    assertEquals(
      listOf(FlowAction.DeleteAll, cancelled(gen)),
      f.jobFinished(gen, JobResult.Failed(UpdateErrorCode.NETWORK))
    )
  }

  @Test
  fun aCancelledJobResultRepliesCancelled() {
    val f = flow()
    val (gen, _) = running(f)
    assertEquals(listOf(FlowAction.DeleteAll, cancelled(gen)), f.jobFinished(gen, JobResult.Cancelled))
  }

  // J-F14
  @Test
  fun newCheckInLaunchingDeletesAnswersCancelledAndNothingResumes() {
    val f = flow()
    val (gen, _) = running(f, foreground = false)
    f.jobFinished(gen, JobResult.Ok)
    assertEquals(listOf(FlowAction.DeleteAll, cancelled(gen)), f.newCheck())
    assertEquals(emptyList<FlowAction>(), f.resumed())
  }

  @Test
  fun newCheckInIdleOnlyDeletes() {
    val f = flow()
    assertEquals(listOf(FlowAction.DeleteAll), f.newCheck())
  }

  // E4: a Cancel in Idle must not cancel a later generation.
  @Test
  fun cancelInIdleNeverAffectsALaterGeneration() {
    val f = flow()
    assertEquals(emptyList<FlowAction>(), f.cancel())
    val (gen, _) = running(f)
    assertFalse(f.isCancelled(gen))
  }

  // H1: jobFinished acts only while Running for that generation.
  @Test
  fun aSecondJobFinishedForTheSameGenerationIsIgnored() {
    val f = flow()
    val (gen, name) = running(f)
    f.jobFinished(gen, JobResult.Ok)
    assertEquals(emptyList<FlowAction>(), f.jobFinished(gen, JobResult.Ok))
    assertEquals(FlowState.Installing(gen, name), f.state)

    val g = flow()
    val (gen2, _) = running(g)
    g.jobFinished(gen2, JobResult.Failed(UpdateErrorCode.NETWORK))
    assertEquals(emptyList<FlowAction>(), g.jobFinished(gen2, JobResult.Failed(UpdateErrorCode.NETWORK)))
    g.cancel()
    assertEquals(emptyList<FlowAction>(), g.jobFinished(gen2, JobResult.Ok))
  }

  @Test
  fun anOldJobResultNeverTouchesANewerRunningGeneration() {
    val f = flow()
    val (old, _) = running(f)
    f.newCheck()
    val (current, name) = running(f)
    assertEquals(emptyList<FlowAction>(), f.jobFinished(old, JobResult.Ok))
    assertEquals(FlowState.Running(current, name), f.state)
  }

  @Test
  fun launchEventsOfAnotherGenerationAreIgnored() {
    val f = flow()
    val (gen, name) = running(f)
    f.jobFinished(gen, JobResult.Ok)
    assertEquals(emptyList<FlowAction>(), f.launchRefused(gen + 1))
    assertEquals(emptyList<FlowAction>(), f.launchFailed(gen + 1))
    assertEquals(FlowState.Installing(gen, name), f.state)
  }
}
