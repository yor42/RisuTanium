package io.github.yor42.risutanium

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatTargetTest {
  private val open = ACTION_OPEN_CHAT

  @Test
  fun aTargetNeedsTheOpenChatActionAndTwoFittingStrings() {
    assertEquals(NoticeTarget("g1", "c1"), chatTargetOf(open, "g1", "c1"))
    assertNull(chatTargetOf(null, "g1", "c1"))
    assertNull(chatTargetOf("android.intent.action.VIEW", "g1", "c1"))
    assertNull(chatTargetOf("android.intent.action.MAIN", "g1", "c1"))
    assertNull(chatTargetOf("$open ", "g1", "c1"))
    assertNull(chatTargetOf(open, null, "c1"))
    assertNull(chatTargetOf(open, "g1", null))
  }

  @Test
  fun anEmptyStringOrOneOverTheLimitIsRefused() {
    assertNull(chatTargetOf(open, "", "c1"))
    assertNull(chatTargetOf(open, "g1", ""))
    assertEquals(NoticeTarget("a".repeat(200), "c".repeat(200)), chatTargetOf(open, "a".repeat(200), "c".repeat(200)))
    assertNull(chatTargetOf(open, "a".repeat(201), "c1"))
    assertNull(chatTargetOf(open, "g1", "c".repeat(201)))
  }

  @Test
  fun aControlCharacterIsRefusedInEitherString() {
    for (control in listOf("\u0000", "\n", "\r", "\t", "\u001b", "\u007f", "\u0085", "\u009f")) {
      assertNull("char ${control.codePointAt(0)} in chaId", chatTargetOf(open, "g${control}1", "c1"))
      assertNull("char ${control.codePointAt(0)} in chatId", chatTargetOf(open, "g1", "c${control}1"))
    }
    assertEquals(NoticeTarget("g 1", "c-1_é"), chatTargetOf(open, "g 1", "c-1_é"))
  }

  @Test
  fun aReadThatThrowsGivesNoTarget() {
    val fine = { name: String -> if (name == EXTRA_TARGET_CHA_ID) "g1" else "c1" }
    assertEquals(NoticeTarget("g1", "c1"), targetFromIntent({ open }, fine))
    assertNull(targetFromIntent({ throw IllegalStateException("action") }, fine))
    assertNull(targetFromIntent({ open }, { throw RuntimeException("bad parcel") }))
    assertNull(targetFromIntent({ open }, { name -> if (name == EXTRA_TARGET_CHAT_ID) throw RuntimeException("bad parcel") else "g1" }))
    assertNull(targetFromIntent({ null }, fine))
    assertNull(targetFromIntent({ open }, { null }))
  }

  private val safeLiteral = Regex("^\\{\"chaId\":\"(\\\\u[0-9a-f]{4}|[A-Za-z0-9_-])*\",\"chatId\":\"(\\\\u[0-9a-f]{4}|[A-Za-z0-9_-])*\"\\}$")

  private fun decodedStrings(literal: String): List<String> {
    val values = Regex("\"(chaId|chatId)\":\"([^\"]*)\"").findAll(literal).map { it.groupValues[2] }.toList()
    return values.map { raw ->
      Regex("\\\\u([0-9a-f]{4})").replace(raw) { match -> match.groupValues[1].toInt(16).toChar().toString() }
    }
  }

  @Test
  fun theLiteralForThePageEscapesEverythingOutsideTheSafeSet() {
    val hostile = "\"</script> ');x//  \\"
    val literal = encodeChatTarget(NoticeTarget(hostile, "c1"))

    assertTrue(literal, safeLiteral.matches(literal))
    assertFalse(literal.contains("<"))
    assertFalse(literal.contains("'"))
    assertFalse(literal.contains(" "))
    assertFalse(literal.contains(" "))
    assertFalse(literal.contains(";"))
    assertFalse(literal.contains("\\\\"))
    assertEquals(listOf(hostile, "c1"), decodedStrings(literal))
  }

  @Test
  fun theLiteralKeepsNonAsciiAndSurrogatePairsIntact() {
    val chaId = "캐릭터-😀"
    val literal = encodeChatTarget(NoticeTarget(chaId, "c_1"))

    assertTrue(literal, safeLiteral.matches(literal))
    assertEquals(listOf(chaId, "c_1"), decodedStrings(literal))
  }

  @Test
  fun noTargetIsTheLiteralNull() {
    assertEquals("null", encodeChatTarget(null))
  }

  @Test
  fun differentTargetsGetDifferentDataUris() {
    val first = targetDataUri(NoticeTarget("g1", "c1"))
    assertEquals(first, targetDataUri(NoticeTarget("g1", "c1")))
    assertNotEquals(first, targetDataUri(NoticeTarget("g1", "c2")))
    assertNotEquals(first, targetDataUri(NoticeTarget("g2", "c1")))
    assertNotEquals(targetDataUri(NoticeTarget("a/b", "c")), targetDataUri(NoticeTarget("a", "b/c")))
    assertNotEquals(targetDataUri(NoticeTarget("a%2Fb", "c")), targetDataUri(NoticeTarget("a/b", "c")))
    assertTrue(first, first.startsWith("risutanium-notice://chat/"))
  }

  @Test
  fun aDataUriHoldsNoRawSeparatorFromTheIds() {
    val uri = targetDataUri(NoticeTarget("a b/c?d#e", "é"))
    val path = uri.removePrefix("risutanium-notice://chat/")

    assertEquals(1, path.count { it == '/' })
    assertFalse(path.contains(" "))
    assertFalse(path.contains("?"))
    assertFalse(path.contains("#"))
    assertTrue(path, path.contains("%C3%A9"))
  }
}
