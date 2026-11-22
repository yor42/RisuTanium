package io.github.yor42.risutanium

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// The parts of the Android edge that carry a decision and need no platform class: the signer
// digest, the request guard and the permission settings round trip.
class AppUpdateServiceTest {
  private val abcSha256 = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"

  // A sealed file refuses a write-mode open (what a file:// write from the page does) but is still
  // deleted, because deletion needs the directory's write bit, not the file's.
  @Test
  fun aSealedUpdateFileRefusesWritesYetCanStillBeDeleted() {
    val dir = java.nio.file.Files.createTempDirectory("risu-seal").toFile()
    val file = java.io.File(dir, "update-test.apk")
    try {
      val sink = UpdateFileSink(dir, file)
      sink.output().use { it.write(byteArrayOf(1, 2, 3)) }
      assertTrue(sink.seal())
      assertFalse(file.canWrite())
      var refused = false
      try {
        java.io.FileOutputStream(file).close()
      } catch (error: java.io.IOException) {
        refused = true
      }
      assertTrue(refused)
      assertEquals(3L, file.length())
      sink.delete()
      assertFalse(file.exists())
    } finally {
      file.setWritable(true)
      file.delete()
      dir.delete()
    }
  }

  @Test
  fun aSignerIsTheSha256HexOfItsCertificate() {
    assertEquals(setOf(abcSha256), signerSet(listOf("abc".toByteArray())))
  }

  @Test
  fun theSignerSetIgnoresOrderAndDuplicates() {
    val a = "cert-a".toByteArray()
    val b = "cert-b".toByteArray()
    assertEquals(signerSet(listOf(a, b)), signerSet(listOf(b, a, a)))
    assertEquals(2, signerSet(listOf(a, b)).size)
  }

  @Test
  fun differentCertificatesGiveDifferentSigners() {
    assertFalse(signerSet(listOf("cert-a".toByteArray())) == signerSet(listOf("cert-b".toByteArray())))
  }

  @Test
  fun aMissingOrEmptyCertificateListIsTheEmptySetWhichVerdictRefuses() {
    assertTrue(signerSet(null).isEmpty())
    assertTrue(signerSet(emptyList()).isEmpty())
    val installed = PackageFacts("io.github.yor42.risutanium", 1000, setOf(abcSha256))
    val archive = PackageFacts("io.github.yor42.risutanium", 1001, signerSet(null))
    assertEquals(Verdict.WRONG_SIGNER, verdict(installed, archive, 1001))
  }

  private fun run(call: ((String) -> Unit) -> Unit): List<String> {
    val delivered = ArrayList<String>()
    guardedRequest(3, "check", { delivered.add(it) }, {}, call)
    return delivered
  }

  @Test
  fun aThrowBeforeAnyReplyIsAnsweredWithAnOtherError() {
    val delivered = run { throw IllegalStateException("boom") }
    assertEquals(
      listOf("{\"id\":3,\"method\":\"appUpdate.check\",\"update\":\"error\",\"code\":\"other\"}"),
      delivered
    )
  }

  @Test
  fun aThrowAfterTheTerminalReplyAddsNoSecondReply() {
    val delivered = run { deliver ->
      deliver("{\"id\":3,\"method\":\"appUpdate.check\",\"update\":\"disabled\"}")
      throw IllegalStateException("late")
    }
    assertEquals(listOf("{\"id\":3,\"method\":\"appUpdate.check\",\"update\":\"disabled\"}"), delivered)
  }

  @Test
  fun aProgressEventIsNotATerminalReply() {
    val delivered = run { deliver ->
      deliver(encodeUpdateProgress(10, 100))
      throw IllegalStateException("after progress")
    }
    assertEquals(2, delivered.size)
    assertEquals(encodeUpdateProgress(10, 100), delivered[0])
    assertTrue(delivered[1].contains("\"code\":\"other\""))
  }

  @Test
  fun aRequestThatDoesNotThrowIsPassedThroughUntouched() {
    val delivered = run { deliver -> deliver("x") }
    assertEquals(listOf("x"), delivered)
  }

  private class Settings(var allowed: Boolean = false, var launches: Boolean = true) {
    var launchCalls = 0
    val settingsRequests = InstallSettingsRequests(
      { allowed },
      { launchCalls += 1; launches },
      {}
    )
    val replies = ArrayList<String>()
    fun open(id: Int) = settingsRequests.open(id) { replies.add(it) }
  }

  private fun allowedReply(id: Int, allowed: Boolean) =
    "{\"id\":$id,\"method\":\"appUpdate.openInstallSettings\",\"update\":\"ok\",\"allowed\":$allowed}"

  @Test
  fun theSettingsRequestWaitsForTheReturnAndReportsTheValueThen() {
    val s = Settings(allowed = false)
    s.open(1)
    assertEquals(1, s.launchCalls)
    assertTrue(s.replies.isEmpty())
    s.allowed = true
    s.settingsRequests.returned()
    assertEquals(listOf(allowedReply(1, true)), s.replies)
    s.settingsRequests.returned()
    assertEquals(1, s.replies.size)
  }

  @Test
  fun aSettingsPageThatCannotOpenIsAnsweredAtOnceWithTheCurrentValue() {
    val s = Settings(allowed = true, launches = false)
    s.open(2)
    assertEquals(listOf(allowedReply(2, true)), s.replies)
    s.settingsRequests.returned()
    assertEquals(1, s.replies.size)
  }

  @Test
  fun aSettingsLaunchThatThrowsIsAnsweredAtOnce() {
    val replies = ArrayList<String>()
    val requests = InstallSettingsRequests({ false }, { throw SecurityException("no") }, {})
    requests.open(3) { replies.add(it) }
    assertEquals(listOf(allowedReply(3, false)), replies)
  }

  @Test
  fun aNewerSettingsRequestSupersedesTheOlderOneWhichIsAnsweredAtOnce() {
    val s = Settings(allowed = false)
    s.open(4)
    s.open(5)
    assertEquals(1, s.launchCalls)
    assertEquals(listOf(allowedReply(4, false)), s.replies)
    s.allowed = true
    s.settingsRequests.returned()
    assertEquals(listOf(allowedReply(4, false), allowedReply(5, true)), s.replies)
  }

  @Test
  fun everySettingsRequestIsAnsweredExactlyOnce() {
    val s = Settings()
    s.open(1)
    s.open(2)
    s.settingsRequests.returned()
    s.settingsRequests.returned()
    s.open(3)
    s.settingsRequests.returned()
    assertEquals(3, s.replies.size)
    assertEquals(listOf(1, 2, 3), s.replies.map { Regex("\"id\":(\\d+)").find(it)!!.groupValues[1].toInt() })
  }
}
