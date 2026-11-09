package io.github.yor42.risutanium

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ReplyNotificationsPolicyTest {
  @Test
  fun aRuntimePermissionNotGrantedIsAskedFirst() {
    // sdk, granted, appEnabled, channelBlocked
    assertEquals(EnableStep.Ask, enableStep(33, false, false, false))
    assertEquals(EnableStep.Ask, enableStep(34, false, true, false))
    assertEquals(EnableStep.Ask, enableStep(36, false, false, true))
  }

  @Test
  fun aGrantedPermissionWithNotificationsOnIsDone() {
    assertEquals(EnableStep.Done, enableStep(33, true, true, false))
    assertEquals(EnableStep.Done, enableStep(36, true, true, false))
    assertEquals(EnableStep.Done, enableStep(26, false, true, false))
  }

  @Test
  fun notificationsOrTheChannelSwitchedOffSendTheUserToTheSettings() {
    assertEquals(EnableStep.OpenSettings, enableStep(34, true, false, false))
    assertEquals(EnableStep.OpenSettings, enableStep(34, true, true, true))
    assertEquals(EnableStep.OpenSettings, enableStep(30, false, false, false))
    assertEquals(EnableStep.OpenSettings, enableStep(28, false, true, true))
    assertEquals(EnableStep.OpenSettings, enableStep(24, false, false, false))
  }

  @Test
  fun belowTheRuntimePermissionNothingIsAsked() {
    assertEquals(EnableStep.Done, enableStep(32, false, true, false))
    assertEquals(EnableStep.Done, enableStep(24, false, true, false))
  }

  @Test
  fun aRefusedAskOpensTheSettingsAndAGrantIsDone() {
    assertEquals(EnableStep.OpenSettings, afterAsk(false))
    assertEquals(EnableStep.Done, afterAsk(true))
  }

  @Test
  fun theStateHasTheAgreedShape() {
    assertEquals("{\"optedIn\":true,\"enabled\":false}", encodeReplyNotificationsState(true, false))
    assertEquals("{\"optedIn\":false,\"enabled\":false}", encodeReplyNotificationsState(false, false))
    assertEquals("{\"optedIn\":true,\"enabled\":true}", encodeReplyNotificationsState(true, true))
  }

  @Test
  fun anAppWithNotificationsOffIsNeverEnabled() {
    assertFalse(replyNotificationsEnabled(false, 34, 3))
    assertFalse(replyNotificationsEnabled(false, 34, null))
    assertFalse(replyNotificationsEnabled(false, 24, null))
  }

  @Test
  fun aChannelSwitchedOffIsNotEnabled() {
    assertFalse(replyNotificationsEnabled(true, 34, CHANNEL_IMPORTANCE_NONE))
    assertFalse(replyNotificationsEnabled(true, 26, 0))
  }

  @Test
  fun aChannelThatDoesNotExistYetIsNotBlocked() {
    assertTrue(replyNotificationsEnabled(true, 34, null))
    assertTrue(replyNotificationsEnabled(true, 26, null))
  }

  @Test
  fun anExistingChannelAboveNoneIsEnabled() {
    assertTrue(replyNotificationsEnabled(true, 34, 3))
    assertTrue(replyNotificationsEnabled(true, 34, 2))
    assertTrue(replyNotificationsEnabled(true, 34, 1))
  }

  @Test
  fun belowChannelsOnlyTheAppSwitchCounts() {
    assertTrue(replyNotificationsEnabled(true, 25, 0))
    assertTrue(replyNotificationsEnabled(true, 24, null))
    assertFalse(replyNotificationsEnabled(false, 25, 3))
  }

  @Test
  fun aKeyIsOneToTwoHundredCharacters() {
    assertTrue(isReplyKey("a"))
    assertTrue(isReplyKey("k".repeat(200)))
    assertFalse(isReplyKey(""))
    assertFalse(isReplyKey("k".repeat(201)))
  }
}
