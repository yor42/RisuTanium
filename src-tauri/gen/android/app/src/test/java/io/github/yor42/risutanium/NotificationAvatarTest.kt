package io.github.yor42.risutanium

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class NotificationAvatarTest {
  private fun dataUrl(mime: String = "image/webp", payload: String = "UklGRg==") = "data:$mime;base64,$payload"

  // J7: what may be decoded into a large icon.

  @Test
  fun aPngAWebpAndAJpegDataUrlAreAccepted() {
    for (mime in listOf("image/png", "image/webp", "image/jpeg")) {
      val data = avatarDataOf(dataUrl(mime = mime))
      assertNotNull(mime, data)
      assertEquals(mime, data!!.mime)
      assertEquals("UklGRg==", data.base64)
    }
  }

  @Test
  fun anyOtherMimeTypeIsRefused() {
    for (mime in listOf("image/gif", "image/svg+xml", "image/bmp", "text/html", "application/octet-stream", "image/PNG", "image/png;charset=utf-8", "")) {
      assertNull(mime, avatarDataOf(dataUrl(mime = mime)))
    }
  }

  @Test
  fun aDataUrlThatIsNotBase64DataIsRefused() {
    assertNull(avatarDataOf("https://example.test/a.png"))
    assertNull(avatarDataOf("data:image/png,UklGRg=="))
    assertNull(avatarDataOf("image/png;base64,UklGRg=="))
    assertNull(avatarDataOf(""))
    assertNull(avatarDataOf("data:image/png;base64,"))
    assertNull(avatarDataOf("data:image/png;base64"))
  }

  @Test
  fun onlyTheBase64AlphabetIsAccepted() {
    assertNotNull(avatarDataOf(dataUrl(payload = "AZaz09+/")))
    assertNotNull(avatarDataOf(dataUrl(payload = "QUI=")))
    assertNotNull(avatarDataOf(dataUrl(payload = "QQ==")))
    for (payload in listOf("QU I=", "QUI-", "QUI_", "QU\nI=", "QUéI", "<script>", "QUI=QUI=", "=QUI", "QUI===")) {
      assertNull(payload, avatarDataOf(dataUrl(payload = payload)))
    }
  }

  @Test
  fun theWholeDataUrlHasAtMostFourHundredThousandCharacters() {
    val header = "data:image/webp;base64,"
    val atLimit = header + "A".repeat(400_000 - header.length)
    assertEquals(400_000, atLimit.length)
    assertNotNull(avatarDataOf(atLimit))
    assertNull(avatarDataOf(atLimit + "A"))
  }

  @Test
  fun aSideOfFourThousandByOneThousandScalesToTwoFiftySixBySixtyFour() {
    assertEquals(Pair(256, 64), scaledDims(4000, 1000, 256))
    assertEquals(Pair(64, 256), scaledDims(1000, 4000, 256))
    assertEquals(Pair(256, 256), scaledDims(512, 512, 256))
  }

  @Test
  fun aSmallImageIsLeftAlone() {
    assertEquals(Pair(10, 10), scaledDims(10, 10, 256))
    assertEquals(Pair(256, 256), scaledDims(256, 256, 256))
    assertEquals(Pair(256, 100), scaledDims(256, 100, 256))
  }

  @Test
  fun aSideNeverScalesBelowOnePixel() {
    assertEquals(Pair(256, 1), scaledDims(4000, 1, 256))
    assertEquals(Pair(256, 1), scaledDims(257, 1, 256))
    assertEquals(Pair(1, 256), scaledDims(1, 100_000, 256))
    assertEquals(Pair(1, 1), scaledDims(0, 0, 256))
    assertEquals(Pair(1, 3), scaledDims(-5, 3, 256))
  }

  @Test
  fun theDecodeSampleKeepsTheLongSideAtOrAboveTheTarget() {
    assertEquals(8, sampleSize(4000, 1000, 256))
    assertEquals(1, sampleSize(256, 256, 256))
    assertEquals(1, sampleSize(300, 300, 256))
    assertEquals(2, sampleSize(512, 512, 256))
    assertEquals(1, sampleSize(10, 10, 256))
    assertEquals(1, sampleSize(0, 0, 256))
    for ((width, height) in listOf(Pair(4000, 1000), Pair(1000, 4000), Pair(2048, 2048), Pair(9999, 3))) {
      val sample = sampleSize(width, height, 256)
      assertEquals("$width x $height power of two", 0, sample and (sample - 1))
      val longSide = maxOf(width, height)
      assertEquals("$width x $height keeps the target", true, longSide / sample >= 256)
    }
  }

  // The numbers go to the expanded text: the collapsed view keeps the state line only (SPEC 6).

  private fun notice(
    state: NoticeState = NoticeState.GENERATING,
    title: String = "Generating a reply…",
    text: String = "",
    identity: NoticeIdentity? = null,
    stopLabel: String = "Stop"
  ) = KeepAliveNotice(
    state = state,
    title = title,
    text = text,
    startedAtMs = 1_000_000L,
    stopLabel = stopLabel,
    publicTitle = title,
    stoppingTitle = "Stopping…",
    stoppedTitle = "Stopped",
    identity = identity,
    avatar = null,
    target = NoticeTarget("g1", "c1")
  )

  private val alice = NoticeIdentity("c1", "Alice")

  @Test
  fun theGeneratingNumbersGoToTheBigTextAfterTheStateLine() {
    val plan = noticePlan(notice(text = "1,204 characters", identity = alice), false, 34)
    assertEquals("Alice", plan.title)
    assertEquals("Generating a reply…", plan.text)
    assertEquals("Generating a reply…\n1,204 characters", plan.bigText)
  }

  @Test
  fun anUnnamedGeneratingNoticeKeepsTheCollapsedTextEmptyAndTheNumbersInTheBigText() {
    val plan = noticePlan(notice(text = "1,204 characters"), false, 34)
    assertEquals("Generating a reply…", plan.title)
    assertEquals("", plan.text)
    assertEquals("1,204 characters", plan.bigText)
  }

  @Test
  fun aGeneratingNoticeWithoutNumbersHasNoBigText() {
    assertNull(noticePlan(notice(identity = alice), false, 34).bigText)
    assertNull(noticePlan(notice(), false, 34).bigText)
  }

  @Test
  fun onlyGeneratingCarriesNumbers() {
    for (state in listOf(NoticeState.SPEAKING, NoticeState.IMAGE, NoticeState.WORKING, NoticeState.FINISHING)) {
      assertNull(state.wire, noticePlan(notice(state = state, text = "5 characters", identity = alice), false, 34).bigText)
    }
    val failed = noticePlan(notice(state = NoticeState.FAILED, title = "Reply failed", text = "Open the app to see why.", identity = alice, stopLabel = ""), false, 34)
    assertNull(failed.bigText)
    assertEquals("Reply failed · Open the app to see why.", failed.text)
  }

  @Test
  fun stoppingShowsNoNumbers() {
    val plan = noticePlan(notice(text = "1,204 characters", identity = alice), true, 34)
    assertNull(plan.bigText)
    assertEquals("Stopping…", plan.text)
  }
}
