package io.github.yor42.risutanium

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class BarColorGateTest {
  private val colorA = 0xFFFFFFFF.toInt()
  private val colorB = 0xFF00011C.toInt()
  private val colorC = 0xFF123456.toInt()

  private class RecordingEffects(var postResult: Boolean = true) : BarColorGateEffects {
    val postedIds = mutableListOf<Long>()
    val timeouts = mutableListOf<Pair<Long, Long>>()
    var cancels = 0
    var outstandingTimeout = false
    val applied = mutableListOf<Pair<Int, BarColorVia>>()

    override fun postVisualState(requestId: Long): Boolean {
      postedIds.add(requestId)
      return postResult
    }

    override fun postTimeout(episode: Long, delayMs: Long) {
      timeouts.add(Pair(episode, delayMs))
      outstandingTimeout = true
    }

    override fun cancelTimeout() {
      cancels++
      outstandingTimeout = false
    }

    override fun apply(color: Int, via: BarColorVia) {
      applied.add(Pair(color, via))
    }
  }

  @Test
  fun aRequestWaitsForTheCallbackAndAppliesOnceOnReady() {
    val fx = RecordingEffects()
    val gate = BarColorGate(fx)
    gate.request(colorA)
    assertEquals(1, fx.postedIds.size)
    assertEquals(1, fx.timeouts.size)
    assertEquals(BAR_COLOR_READY_TIMEOUT_MS, fx.timeouts[0].second)
    assertTrue(fx.applied.isEmpty())
    val id = fx.postedIds[0]
    gate.onReady(id)
    assertEquals(listOf(Pair(colorA, BarColorVia.READY)), fx.applied)
    assertTrue(!fx.outstandingTimeout)
    gate.onTimeout(fx.timeouts[0].first)
    gate.onReady(id)
    assertEquals(1, fx.applied.size)
  }

  @Test
  fun aSupersededRequestsCallbackAppliesNothingAndTheLatestAppliesOnItsOwn() {
    val fx = RecordingEffects()
    val gate = BarColorGate(fx)
    gate.request(colorA)
    gate.request(colorB)
    val idA = fx.postedIds[0]
    val idB = fx.postedIds[1]
    gate.onReady(idA)
    assertTrue(fx.applied.isEmpty())
    gate.onReady(idB)
    assertEquals(listOf(Pair(colorB, BarColorVia.READY)), fx.applied)
    gate.onReady(idA)
    assertEquals(1, fx.applied.size)
  }

  @Test
  fun anAppliedRequestsRepeatedCallbackNeverReachesTheNextRequest() {
    val fx = RecordingEffects()
    val gate = BarColorGate(fx)
    gate.request(colorA)
    val idA = fx.postedIds[0]
    gate.onReady(idA)
    gate.request(colorB)
    val idB = fx.postedIds[1]
    gate.onReady(idA)
    assertEquals(1, fx.applied.size)
    gate.onReady(idB)
    assertEquals(listOf(Pair(colorA, BarColorVia.READY), Pair(colorB, BarColorVia.READY)), fx.applied)
  }

  @Test
  fun theTimeoutAppliesTheColourOnceAndALateCallbackDoesNothing() {
    val fx = RecordingEffects()
    val gate = BarColorGate(fx)
    gate.request(colorA)
    gate.onTimeout(fx.timeouts[0].first)
    assertEquals(listOf(Pair(colorA, BarColorVia.TIMEOUT)), fx.applied)
    gate.onReady(fx.postedIds[0])
    assertEquals(1, fx.applied.size)
  }

  @Test
  fun theTimeoutAppliesTheLatestColourNeverAnOlderOne() {
    val fx = RecordingEffects()
    val gate = BarColorGate(fx)
    gate.request(colorA)
    gate.request(colorB)
    gate.onTimeout(fx.timeouts[0].first)
    assertEquals(listOf(Pair(colorB, BarColorVia.TIMEOUT)), fx.applied)
    gate.onReady(fx.postedIds[0])
    gate.onReady(fx.postedIds[1])
    assertEquals(1, fx.applied.size)
  }

  @Test
  fun oneEpisodeSchedulesOneTimeoutWithTheFixedDelay() {
    val fx = RecordingEffects()
    val gate = BarColorGate(fx)
    gate.request(colorA)
    gate.request(colorB)
    gate.request(colorC)
    assertEquals(1, fx.timeouts.size)
    assertEquals(BAR_COLOR_READY_TIMEOUT_MS, fx.timeouts[0].second)
    assertEquals(250L, BAR_COLOR_READY_TIMEOUT_MS)
  }

  @Test
  fun aRequestWithoutAViewAppliesAtOnceAndLeavesNoTimeout() {
    val fx = RecordingEffects(postResult = false)
    val gate = BarColorGate(fx)
    gate.request(colorA)
    assertEquals(listOf(Pair(colorA, BarColorVia.NO_VIEW)), fx.applied)
    assertTrue(!fx.outstandingTimeout)
    gate.onTimeout(fx.timeouts[0].first)
    assertEquals(1, fx.applied.size)
  }

  @Test
  fun aFailedPostWhileAnotherIsPendingAppliesTheLatestAtOnce() {
    val fx = RecordingEffects()
    val gate = BarColorGate(fx)
    gate.request(colorA)
    fx.postResult = false
    gate.request(colorB)
    assertEquals(listOf(Pair(colorB, BarColorVia.NO_VIEW)), fx.applied)
    assertTrue(!fx.outstandingTimeout)
    gate.onReady(fx.postedIds[0])
    gate.onTimeout(fx.timeouts[0].first)
    assertEquals(1, fx.applied.size)
  }

  @Test
  fun afterDisposeNothingIsPostedOrApplied() {
    val fx = RecordingEffects()
    val gate = BarColorGate(fx)
    gate.request(colorA)
    gate.dispose()
    assertTrue(!fx.outstandingTimeout)
    gate.onReady(fx.postedIds[0])
    gate.onTimeout(fx.timeouts[0].first)
    assertTrue(fx.applied.isEmpty())
    gate.request(colorC)
    assertEquals(1, fx.postedIds.size)
    assertTrue(fx.applied.isEmpty())
  }

  @Test
  fun aStaleEpisodesTimeoutDoesNotTouchTheNextEpisode() {
    val fx = RecordingEffects()
    val gate = BarColorGate(fx)
    gate.request(colorA)
    gate.onReady(fx.postedIds[0])
    gate.request(colorB)
    assertEquals(2, fx.timeouts.size)
    val episode1 = fx.timeouts[0].first
    val episode2 = fx.timeouts[1].first
    gate.onTimeout(episode1)
    assertEquals(1, fx.applied.size)
    gate.onTimeout(episode2)
    assertEquals(listOf(Pair(colorA, BarColorVia.READY), Pair(colorB, BarColorVia.TIMEOUT)), fx.applied)
  }

  @Test
  fun aFailedPostOnTheFirstRequestOfAnEpisodeStillStartsTheNextEpisodeFresh() {
    val fx = RecordingEffects(postResult = false)
    val gate = BarColorGate(fx)
    gate.request(colorA)
    fx.postResult = true
    gate.request(colorB)
    assertEquals(2, fx.timeouts.size)
    gate.onReady(fx.postedIds[1])
    assertEquals(listOf(Pair(colorA, BarColorVia.NO_VIEW), Pair(colorB, BarColorVia.READY)), fx.applied)
  }
}
