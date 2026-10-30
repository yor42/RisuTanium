package io.github.yor42.risutanium

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class BridgeScopeTest {
  private val app = "http://tauri.localhost"

  @Test
  fun mainFrameOfTheAppOriginIsAccepted() {
    assertTrue(acceptsBridgeMessage(true, app, app))
    assertTrue(acceptsBridgeMessage(true, "$app/", app))
    assertTrue(acceptsBridgeMessage(true, app, "$app/"))
  }

  @Test
  fun aMainFrameOfAnotherOriginIsRejected() {
    assertFalse(acceptsBridgeMessage(true, "http://127.0.0.1:6301", app))
    assertFalse(acceptsBridgeMessage(true, "https://tauri.localhost", app))
    assertFalse(acceptsBridgeMessage(true, "http://tauri.localhost.example", app))
  }

  @Test
  fun aSubFrameOfTheAppOriginIsRejected() {
    assertFalse(acceptsBridgeMessage(false, app, app))
    assertFalse(acceptsBridgeMessage(false, "$app/", app))
  }

  @Test
  fun anOpaqueOriginIsRejected() {
    assertFalse(acceptsBridgeMessage(true, "null", app))
    assertFalse(acceptsBridgeMessage(false, "null", app))
    assertFalse(acceptsBridgeMessage(true, "", app))
  }

  @Test
  fun modeFollowsSupportAndTheDebugOnlyForceRequest() {
    // supported, debug, force
    assertEquals(BridgeMode.LISTENER, chooseBridgeMode(true, false, false))
    assertEquals(BridgeMode.LISTENER, chooseBridgeMode(true, true, false))
    assertEquals(BridgeMode.LEGACY, chooseBridgeMode(true, true, true))
    assertEquals(BridgeMode.LISTENER, chooseBridgeMode(true, false, true))
    assertEquals(BridgeMode.LEGACY, chooseBridgeMode(false, false, false))
    assertEquals(BridgeMode.LEGACY, chooseBridgeMode(false, true, false))
    assertEquals(BridgeMode.LEGACY, chooseBridgeMode(false, true, true))
    assertEquals(BridgeMode.LEGACY, chooseBridgeMode(false, false, true))
  }

  @Test
  fun everyBridgeCommandIsRecognised() {
    assertSame(BridgeCommand.SubscribeGestureInset, toCommand("gestureInset", "subscribe", emptyList(), null))
    assertEquals(BridgeCommand.SetBackground(255, 0, 17), toCommand("systemBars", "setBackground", listOf(255, 0, 17), null))
    assertEquals(BridgeCommand.KeepAliveStart("t", "s"), toCommand("keepAlive", "start", listOf("t", "s"), null))
    assertEquals(BridgeCommand.KeepAliveUpdate("t", "s"), toCommand("keepAlive", "update", listOf("t", "s"), null))
    assertSame(BridgeCommand.KeepAliveStop, toCommand("keepAlive", "stop", emptyList(), null))
    assertEquals(BridgeCommand.KeepAliveStopAfter(2500), toCommand("keepAlive", "stopAfter", listOf(2500), null))
    assertSame(
      BridgeCommand.KeepAliveRequestNotificationPermissionOnce,
      toCommand("keepAlive", "requestNotificationPermissionOnce", emptyList(), null)
    )
    assertEquals(BridgeCommand.OpenedFilesTake(7), toCommand("openedFiles", "take", emptyList(), 7))
    assertEquals(BridgeCommand.OpenedFilesConfirm(12L), toCommand("openedFiles", "confirm", listOf(12), null))
  }

  @Test
  fun anUnknownBridgeOrMethodIsDropped() {
    assertNull(toCommand("other", "subscribe", emptyList(), null))
    assertNull(toCommand("gestureInset", "left", emptyList(), null))
    assertNull(toCommand("systemBars", "start", listOf(1, 2, 3), null))
    assertNull(toCommand("keepAlive", "restart", emptyList(), null))
    assertNull(toCommand("openedFiles", "peek", emptyList(), 1))
  }

  @Test
  fun aWrongArityIsDropped() {
    assertNull(toCommand("systemBars", "setBackground", listOf(1, 2), null))
    assertNull(toCommand("systemBars", "setBackground", listOf(1, 2, 3, 4), null))
    assertNull(toCommand("systemBars", "setBackground", emptyList(), null))
    assertNull(toCommand("gestureInset", "subscribe", listOf(1), null))
    assertNull(toCommand("keepAlive", "start", listOf("t"), null))
    assertNull(toCommand("keepAlive", "update", listOf("t", "s", "u"), null))
    assertNull(toCommand("keepAlive", "stop", listOf(1), null))
    assertNull(toCommand("keepAlive", "stopAfter", emptyList(), null))
    assertNull(toCommand("keepAlive", "stopAfter", listOf(1, 2), null))
    assertNull(toCommand("openedFiles", "confirm", emptyList(), null))
    assertNull(toCommand("openedFiles", "confirm", listOf(1, 2), null))
  }

  @Test
  fun aWrongTypeIsDropped() {
    assertNull(toCommand("systemBars", "setBackground", listOf("1", 2, 3), null))
    assertNull(toCommand("systemBars", "setBackground", listOf(1, null, 3), null))
    assertNull(toCommand("keepAlive", "start", listOf("t", 5), null))
    assertNull(toCommand("keepAlive", "start", listOf(null, "s"), null))
    assertNull(toCommand("keepAlive", "stopAfter", listOf("100"), null))
    assertNull(toCommand("openedFiles", "confirm", listOf("3"), null))
    assertNull(toCommand("openedFiles", "confirm", listOf(-1), null))
  }

  @Test
  fun aTakeNeedsAnIntegerId() {
    assertNull(toCommand("openedFiles", "take", emptyList(), null))
    assertNull(toCommand("openedFiles", "take", emptyList(), "3"))
    assertNull(toCommand("openedFiles", "take", emptyList(), 1.5))
    assertNull(toCommand("openedFiles", "take", listOf(1), null))
  }

  @Test
  fun aTakeWithAnIdButBadArgumentsIsAnsweredEmpty() {
    assertEquals(BridgeCommand.OpenedFilesMalformedTake(4), toCommand("openedFiles", "take", listOf(1), 4))
    assertEquals(
      "{\"id\":4,\"result\":[],\"through\":0}",
      encodeTakeReply(4, "[]", 0)
    )
  }

  @Test
  fun wholeNumbersOfAnyKindAreAcceptedAsColourChannels() {
    assertEquals(BridgeCommand.SetBackground(255, 1, 2), toCommand("systemBars", "setBackground", listOf(255, 1L, 2.0), null))
    assertEquals(BridgeCommand.SetBackground(255, 0, 0), toCommand("systemBars", "setBackground", listOf(255.0, 0.0f, 0), null))
    assertEquals(BridgeCommand.SetBackground(-5, 300, 0), toCommand("systemBars", "setBackground", listOf(-5, 300, 0), null))
  }

  @Test
  fun aFractionalOrNonFiniteOrOversizedNumberIsNotAColour() {
    assertNull(toCommand("systemBars", "setBackground", listOf(2.5, 0, 0), null))
    assertNull(toCommand("systemBars", "setBackground", listOf(0, Double.NaN, 0), null))
    assertNull(toCommand("systemBars", "setBackground", listOf(0, 0, Double.POSITIVE_INFINITY), null))
    assertNull(toCommand("systemBars", "setBackground", listOf(0, 0, 4294967296L), null))
    assertNull(toCommand("keepAlive", "stopAfter", listOf(0.5), null))
  }

  @Test
  fun theInsetEventHasTheAgreedShape() {
    assertEquals("{\"event\":\"gestureInset\",\"value\":40.0}", encodeInsetEvent(40.0))
    assertEquals("{\"event\":\"gestureInset\",\"value\":0.0}", encodeInsetEvent(0.0))
    assertEquals("{\"event\":\"gestureInset\",\"value\":24.5}", encodeInsetEvent(24.5))
  }

  @Test
  fun aNonFiniteInsetIsSentAsZero() {
    assertEquals("{\"event\":\"gestureInset\",\"value\":0.0}", encodeInsetEvent(Double.NaN))
    assertEquals("{\"event\":\"gestureInset\",\"value\":0.0}", encodeInsetEvent(Double.POSITIVE_INFINITY))
    assertEquals("{\"event\":\"gestureInset\",\"value\":0.0}", encodeInsetEvent(Double.NEGATIVE_INFINITY))
  }

  @Test
  fun theTakeReplyEmbedsTheResultAndCarriesTheSequence() {
    val result = "[[{\"uri\":\"content://x/1\",\"name\":\"a.charx\"}]]"
    assertEquals(
      "{\"id\":9,\"result\":$result,\"through\":3}",
      encodeTakeReply(9, result, 3)
    )
  }

  @Test
  fun aSnapshotKeepsItsBatches() {
    val queue = PendingBatches<String>()
    queue.enqueue("a")
    queue.enqueue("b")
    val first = queue.snapshot()
    assertEquals(listOf("a", "b"), first.batches)
    assertEquals(2L, first.through)
    val again = queue.snapshot()
    assertEquals(listOf("a", "b"), again.batches)
    assertEquals(2L, again.through)
  }

  @Test
  fun anEmptyQueueSnapshotsAsNothing() {
    val snapshot = PendingBatches<String>().snapshot()
    assertTrue(snapshot.batches.isEmpty())
    assertEquals(0L, snapshot.through)
  }

  @Test
  fun confirmRemovesOnlyUpToItsSequence() {
    val queue = PendingBatches<String>()
    val a = queue.enqueue("a")
    val b = queue.enqueue("b")
    val c = queue.enqueue("c")
    assertTrue(a < b && b < c)
    queue.confirm(b)
    assertEquals(listOf("c"), queue.snapshot().batches)
    assertEquals(c, queue.snapshot().through)
  }

  @Test
  fun aBatchQueuedAfterASnapshotSurvivesItsConfirm() {
    val queue = PendingBatches<String>()
    queue.enqueue("a")
    val taken = queue.snapshot()
    queue.enqueue("b")
    queue.confirm(taken.through)
    assertEquals(listOf("b"), queue.snapshot().batches)
  }

  @Test
  fun confirmingTwiceIsHarmless() {
    val queue = PendingBatches<String>()
    queue.enqueue("a")
    val taken = queue.snapshot()
    queue.confirm(taken.through)
    queue.enqueue("b")
    queue.confirm(taken.through)
    assertEquals(listOf("b"), queue.snapshot().batches)
  }

  @Test
  fun takeAllEmptiesTheQueueInOneStep() {
    val queue = PendingBatches<String>()
    queue.enqueue("a")
    queue.enqueue("b")
    assertEquals(listOf("a", "b"), queue.takeAll())
    assertTrue(queue.snapshot().batches.isEmpty())
    assertTrue(queue.takeAll().isEmpty())
    queue.enqueue("c")
    assertEquals(listOf("c"), queue.takeAll())
  }
}
