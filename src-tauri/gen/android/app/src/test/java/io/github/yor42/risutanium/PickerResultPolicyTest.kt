package io.github.yor42.risutanium

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class PickerResultPolicyTest {
  private val own = "io.github.yor42.risutanium"
  private val resultOk = -1
  private val resultCanceled = 0
  private val firstUser = 1

  private class Fake(val data: String?, val clips: List<String?>?)

  private class Row(val accept: Boolean, val text: String) {
    override fun toString(): String = (if (accept) "accept " else "refuse ") + text
  }

  private fun rows(): List<Row> {
    val stream = javaClass.classLoader!!.getResourceAsStream("picker-result-v1/uris.txt")!!
    return stream.use { it.readBytes().toString(Charsets.UTF_8) }
      .split("\n")
      .map { it.trimEnd('\r') }
      .filter { it.isNotEmpty() }
      .map {
        val tab = it.indexOf('\t')
        val kind = it.substring(0, tab)
        assertTrue(it, kind == "accept" || kind == "refuse")
        Row(kind == "accept", it.substring(tab + 1))
      }
  }

  private fun refuseTexts(): List<String> = rows().filter { !it.accept }.map { it.text }

  private fun acceptTexts(): List<String> = rows().filter { it.accept }.map { it.text }

  private fun run(code: Int, data: Fake?, ownId: String = own): Pair<Int, Fake?> =
    checkedActivityResult(
      code,
      data,
      ownId,
      { it.data },
      { it.clips?.size },
      { i, n -> i.clips!![n] },
    )

  private fun assertCancelled(label: String, result: Pair<Int, Fake?>) {
    assertEquals(label, resultCanceled, result.first)
    assertNull(label, result.second)
  }

  private fun assertPassed(label: String, code: Int, intent: Fake?, result: Pair<Int, Fake?>) {
    assertEquals(label, code, result.first)
    assertSame(label, intent, result.second)
  }

  @Test
  fun fixtureHoldsBothKindsOfRows() {
    assertTrue(acceptTexts().size >= 10)
    assertTrue(refuseTexts().size >= 30)
  }

  // K1
  @Test
  fun everyRefusedRowAsDataUnderOkIsCancelled() {
    val failures = refuseTexts().filter {
      val result = run(resultOk, Fake(it, null))
      !(result.first == resultCanceled && result.second == null)
    }
    assertTrue("returned unchanged: $failures", failures.isEmpty())
  }

  // K2
  @Test
  fun everyRefusedRowAsClipItemInAnyPositionIsCancelled() {
    val good = "content://media/external/images/media/1"
    val failures = ArrayList<String>()
    for (bad in refuseTexts()) {
      val layouts = listOf(
        listOf(bad, good, good),
        listOf(good, bad, good),
        listOf(good, good, bad),
      )
      for (clips in layouts) {
        val result = run(resultOk, Fake(null, clips))
        if (!(result.first == resultCanceled && result.second == null)) failures.add("$clips")
      }
    }
    assertTrue("returned unchanged: $failures", failures.isEmpty())
  }

  @Test
  fun goodDataWithABadClipIsCancelled() {
    val result = run(resultOk, Fake("content://media/external/images/media/1", listOf("file:///C:/dv603/x")))
    assertCancelled("good data, bad clip", result)
  }

  @Test
  fun badDataWithAGoodClipIsCancelled() {
    val result = run(resultOk, Fake("file:///C:/dv603/x", listOf("content://media/external/images/media/1")))
    assertCancelled("bad data, good clip", result)
  }

  @Test
  fun aNullClipItemIsCancelled() {
    assertCancelled("null item", run(resultOk, Fake(null, listOf("content://media/external/images/media/1", null))))
  }

  @Test
  fun aClipOfZeroItemsIsCancelled() {
    assertCancelled("zero items", run(resultOk, Fake(null, emptyList())))
  }

  // K3
  @Test
  fun aBadUriUnderAUserResultCodeIsCancelled() {
    assertCancelled("first user", run(firstUser, Fake("file:///C:/dv603/x", null)))
  }

  @Test
  fun aCancelThatCarriesABadUriIsCancelled() {
    assertCancelled("cancel with bad uri", run(resultCanceled, Fake("file:///C:/dv603/x", null)))
  }

  @Test
  fun aThrowingReaderIsCancelled() {
    val intent = Fake("content://media/external/images/media/1", null)
    val result = checkedActivityResult<Fake>(
      resultOk,
      intent,
      own,
      { throw IllegalStateException("reader failed") },
      { null },
      { _, _ -> null },
    )
    assertCancelled("throwing reader", result)
  }

  @Test
  fun aUserCancelThatCarriesAGoodUriBecomesACancelWithoutAnIntent() {
    val result = run(resultCanceled, Fake("content://media/external/images/media/1", null))
    assertCancelled("cancel with good uri", result)
  }

  @Test
  fun aThrowingClipCountIsCancelled() {
    val intent = Fake(null, listOf("content://media/external/images/media/1"))
    val result = checkedActivityResult<Fake>(
      resultOk,
      intent,
      own,
      { it.data },
      { throw IllegalStateException("clip count failed") },
      { i, n -> i.clips!![n] },
    )
    assertCancelled("throwing clip count", result)
  }

  @Test
  fun aThrowingClipUriIsCancelled() {
    val intent = Fake(null, listOf("content://media/external/images/media/1"))
    val result = checkedActivityResult<Fake>(
      resultOk,
      intent,
      own,
      { it.data },
      { it.clips?.size },
      { _, _ -> throw IllegalStateException("clip uri failed") },
    )
    assertCancelled("throwing clip uri", result)
  }

  @Test
  fun anEmptyOwnIdRefusesEveryUri() {
    val result = run(resultOk, Fake("content://media/external/images/media/1", null), ownId = "")
    assertCancelled("empty own", result)
  }

  // K4
  @Test
  fun everyAcceptedRowAsDataClipOrBothPassesTheSameInstance() {
    for (text in acceptTexts()) {
      val asData = Fake(text, null)
      assertPassed("data $text", resultOk, asData, run(resultOk, asData))
      val asClip = Fake(null, listOf(text))
      assertPassed("clip $text", resultOk, asClip, run(resultOk, asClip))
      val both = Fake(text, listOf(text, text))
      assertPassed("both $text", resultOk, both, run(resultOk, both))
    }
  }

  @Test
  fun aNullIntentPassesUnderEveryCode() {
    for (code in listOf(resultOk, resultCanceled, firstUser, 7)) {
      val result = run(code, null)
      assertEquals(code, result.first)
      assertNull(result.second)
    }
  }

  @Test
  fun anIntentWithoutUrisPassesUnchanged() {
    val intent = Fake(null, null)
    for (code in listOf(resultOk, firstUser)) {
      assertPassed("no uris, code $code", code, intent, run(code, intent))
    }
  }

  @Test
  fun aUserCancelWithoutAnIntentStaysCancelled() {
    assertCancelled("user cancel", run(resultCanceled, null))
  }

  // K5
  @Test
  fun predicateRefusesEveryRefuseRowAndAcceptsEveryAcceptRow() {
    val wrong = rows().filter { isForeignContentUri(it.text, own) != it.accept }
    assertTrue("predicate disagrees with the fixture: $wrong", wrong.isEmpty())
  }

  @Test
  fun predicateRefusesLocalhostInEveryCaseAndWithAUserPrefix() {
    val forms = listOf("localhost", "LOCALHOST", "LocalHost", "0@localhost", "10@LocalHost", "10@LOCALHOST")
    val wrong = forms.filter { isForeignContentUri("content://$it/C:/dv603/x", own) }
    assertTrue("accepted: $wrong", wrong.isEmpty())
  }

  @Test
  fun predicateRefusesAnEmptyAuthority() {
    assertFalse(isForeignContentUri("content:///C:/dv603/x", own))
    assertFalse(isForeignContentUri("content://0@/x", own))
  }

  @Test
  fun predicateRefusesTheOwnIdInEveryFormAndAcceptsALongerName() {
    val refused = listOf(
      own,
      "$own.fileprovider",
      "$own.androidx-startup",
      "$own.x",
      "0@$own",
      "10@$own.fileprovider",
      own.uppercase(),
      "Io.Github.Yor42.Risutanium.fileprovider",
    )
    val wrong = refused.filter { isForeignContentUri("content://$it/x", own) }
    assertTrue("accepted: $wrong", wrong.isEmpty())
    assertTrue(isForeignContentUri("content://${own}2/x", own))
  }

  // K6
  @Test
  fun authorityCharacterSetIsExactlyLettersDigitsDotUnderscoreHyphen() {
    val accepted = ArrayList<Char>()
    for (code in 0..127) {
      val c = code.toChar()
      if (isForeignContentUri("content://com.ex${c}ample/x", own)) accepted.add(c)
    }
    val expected = ArrayList<Char>()
    for (code in 0..127) {
      val c = code.toChar()
      if (c in 'A'..'Z' || c in 'a'..'z' || c in '0'..'9' || c == '.' || c == '_' || c == '-' || c == '/' || c == '?' || c == '#') {
        expected.add(c)
      }
    }
    assertEquals(expected, accepted)
  }

  // K7
  @Test
  fun eachCallReturnsItsOwnResultInATwoResultSequence() {
    val bad = Fake("file:///C:/dv603/x", null)
    val good = Fake("content://media/external/images/media/1", null)
    assertCancelled("first, refused", run(resultOk, bad))
    assertPassed("second, good", resultOk, good, run(resultOk, good))
  }
}
