package io.github.yor42.risutanium

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
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

  // The notice as the page sends it, with the fields a test changes passed in.
  private fun notice(vararg changes: Pair<String, Any?>): Map<String, Any?> {
    val map = HashMap<String, Any?>()
    map["v"] = 2
    map["key"] = "cha/chat"
    map["name"] = "Ada"
    map["text"] = "Replied"
    map["publicTitle"] = "New reply"
    map["chaId"] = "cha"
    map["chatId"] = "chat"
    map["avatar"] = "data:image/webp;base64,UklGRg=="
    map["silent"] = true
    for ((field, value) in changes) map[field] = value
    return map
  }

  @Test
  fun aReplyNoticeIsReadWhole() {
    val parsed = parseReplyNotice(notice())
    assertEquals(
      ReplyNotice("cha/chat", "Ada", "Replied", "New reply", NoticeTarget("cha", "chat"), "data:image/webp;base64,UklGRg==", true),
      parsed
    )
    assertFalse(parseReplyNotice(notice("silent" to false))!!.silent)
  }

  @Test
  fun theTagOfTheNotificationIsThePagesKey() {
    val plan = replyNoticePlan(parseReplyNotice(notice("key" to "group-1/group-chat", "chaId" to "group-1", "chatId" to "group-chat"))!!)
    assertEquals("group-1/group-chat", plan.tag)
  }

  @Test
  fun thePlanTitlesTheNoticeWithTheNameAndTheFixedTextOnly() {
    val plan = replyNoticePlan(parseReplyNotice(notice())!!)
    assertEquals("Ada", plan.title)
    assertEquals("Replied", plan.text)
    assertEquals("data:image/webp;base64,UklGRg==", plan.avatar)
    assertEquals(NoticeTarget("cha", "chat"), plan.target)
    assertTrue(plan.silent)
  }

  // J8: what a locked screen shows is the public title and nothing else.
  @Test
  fun thePublicVersionCarriesThePublicTitleAndNeitherTheNameNorAnIcon() {
    val plan = replyNoticePlan(parseReplyNotice(notice())!!)
    assertEquals(ReplyPublicPlan("New reply"), plan.publicVersion)
    assertFalse(plan.publicVersion.title.contains("Ada"))
    assertEquals(listOf("title"), ReplyPublicPlan::class.java.declaredFields.map { it.name })
  }

  @Test
  fun everyChatHasADataOfItsOwnForItsTapIntent() {
    val first = replyNoticePlan(parseReplyNotice(notice())!!)
    val second = replyNoticePlan(parseReplyNotice(notice("key" to "cha/other", "chatId" to "other"))!!)
    val again = replyNoticePlan(parseReplyNotice(notice())!!)
    assertTrue(targetDataUri(first.target!!) != targetDataUri(second.target!!))
    assertEquals(targetDataUri(first.target!!), targetDataUri(again.target!!))
  }

  @Test
  fun aVersionThatIsNotTwoOrAKeyThatDoesNotFitDropsTheNotice() {
    assertNull(parseReplyNotice(notice("v" to 1)))
    assertNull(parseReplyNotice(notice("v" to "2")))
    assertNull(parseReplyNotice(notice("v" to null)))
    assertNull(parseReplyNotice(notice("key" to "")))
    assertNull(parseReplyNotice(notice("key" to "k".repeat(201))))
    assertNull(parseReplyNotice(notice("key" to 7)))
    assertNotNull(parseReplyNotice(notice("key" to "k".repeat(200))))
  }

  @Test
  fun theSilentFlagIsABooleanOrTheNoticeIsDropped() {
    assertNull(parseReplyNotice(notice("silent" to "true")))
    assertNull(parseReplyNotice(notice("silent" to 1)))
    assertNull(parseReplyNotice(notice("silent" to null)))
  }

  @Test
  fun aTargetThatDoesNotFitIsDroppedWithoutRejectingTheNotice() {
    assertNull(parseReplyNotice(notice("chaId" to ""))!!.target)
    assertNull(parseReplyNotice(notice("chatId" to "c".repeat(201)))!!.target)
    assertNull(parseReplyNotice(notice("chaId" to "a\nb"))!!.target)
    assertNull(parseReplyNotice(notice("chatId" to 5))!!.target)
    assertNotNull(parseReplyNotice(notice("chaId" to "c".repeat(200)))!!.target)
  }

  @Test
  fun anEmptyOrMissingAvatarIsNone() {
    assertNull(parseReplyNotice(notice("avatar" to ""))!!.avatar)
    assertNull(parseReplyNotice(notice("avatar" to null))!!.avatar)
    assertNull(parseReplyNotice(notice("avatar" to 3))!!.avatar)
  }

  @Test
  fun stringsAreCappedWithoutSplittingASurrogatePair() {
    val pair = "😀"
    val longName = "a".repeat(255) + pair
    val cappedName = parseReplyNotice(notice("name" to longName))!!.name
    assertEquals("a".repeat(255), cappedName)
    assertEquals(256, parseReplyNotice(notice("name" to "n".repeat(300)))!!.name.length)
    assertEquals(512, parseReplyNotice(notice("text" to "t".repeat(600)))!!.text.length)
    assertEquals(256, parseReplyNotice(notice("publicTitle" to "p".repeat(300)))!!.publicTitle.length)
    assertEquals("", parseReplyNotice(notice("name" to 5))!!.name)
  }
}
