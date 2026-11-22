package io.github.yor42.risutanium

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.URI
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FakeHop(
  override val status: Int,
  override val location: String? = null,
  override val contentLength: Long = -1L,
  private val stream: InputStream = ByteArrayInputStream(ByteArray(0))
) : HttpHop {
  var closed = false

  override fun body(): InputStream = stream

  override fun close() {
    closed = true
  }
}

// Answers each opened URI with the next scripted hop for it, in order, and records every open.
class ScriptedOpener : HttpOpener {
  private val script = HashMap<String, ArrayDeque<() -> FakeHop>>()
  val opened = ArrayList<String>()
  val hops = ArrayList<FakeHop>()
  var openThrows: IOException? = null

  fun on(uri: String, make: () -> FakeHop): ScriptedOpener {
    script.getOrPut(uri) { ArrayDeque() }.addLast(make)
    return this
  }

  override fun open(uri: URI): HttpHop {
    opened.add(uri.toString())
    openThrows?.let { throw it }
    val queue = script[uri.toString()] ?: throw AssertionError("unscripted open: $uri")
    val hop = queue.removeFirst()()
    hops.add(hop)
    return hop
  }
}

class FakeSink(private val log: MutableList<String>) : FileSink {
  override val path = "/cache/app-update/update-test.apk"
  val written = ByteArrayOutputStream()
  var deleted = false
  var closed = false
  var outputOpened = false

  override fun output(): OutputStream {
    outputOpened = true
    return object : OutputStream() {
      override fun write(b: Int) {
        written.write(b)
      }

      override fun write(b: ByteArray, off: Int, len: Int) {
        written.write(b, off, len)
      }

      override fun close() {
        if (!closed) log.add("sink.close")
        closed = true
      }
    }
  }

  var sealOk = true
  var sealThrows = false

  override fun seal(): Boolean {
    log.add("sink.seal")
    if (sealThrows) throw IOException("SYNTH seal")
    return sealOk
  }

  override fun delete() {
    deleted = true
  }
}

class AppUpdateJobsTest {
  private val pkg = "io.github.yor42.risutanium"
  private val apkUrl = "https://github.com/yor42/RisuTanium/releases/download/v0.2.0/app.apk"
  private val installedFacts = PackageFacts(pkg, 1000L, setOf("aa"))
  private val goodArchive = PackageFacts(pkg, 1001L, setOf("aa"))
  private val log = ArrayList<String>()
  private val sink = FakeSink(log)

  private fun jobInput(
    size: Long,
    usable: Long = Long.MAX_VALUE,
    uri: String = apkUrl,
    origin: String? = null,
    code: Long = 1001L
  ) = InstallJobInput(URI(uri), size, code, origin, usable, SignerSource.SIGNING_INFO)

  private fun installed() = InstalledFacts {
    log.add("installed.read")
    installedFacts
  }

  private fun archive(facts: PackageFacts? = goodArchive, onRead: () -> Unit = {}) = ArchiveFacts { _, _ ->
    log.add("archive.read")
    onRead()
    facts
  }

  private val never = CancelProbe { false }

  private fun run(
    opener: HttpOpener,
    size: Long,
    archiveFacts: ArchiveFacts = archive(),
    cancel: CancelProbe = never,
    input: InstallJobInput = jobInput(size)
  ) = runInstallJob(input, opener, sink, installed(), archiveFacts, cancel) {}

  private fun serving(bytes: ByteArray, contentLength: Long = -1L): ScriptedOpener =
    ScriptedOpener().on(apkUrl) { FakeHop(200, contentLength = contentLength, stream = ByteArrayInputStream(bytes)) }

  // J-L1
  @Test
  fun readCappedAcceptsTheCapAndRefusesOneMore() {
    val exact = ByteArray(UPDATE_JSON_MAX_BYTES) { 7 }
    assertArrayEquals(exact, readCapped(ByteArrayInputStream(exact), UPDATE_JSON_MAX_BYTES))
    assertNull(readCapped(ByteArrayInputStream(ByteArray(UPDATE_JSON_MAX_BYTES + 1)), UPDATE_JSON_MAX_BYTES))
  }

  @Test
  fun readCappedReadsAtMostOneByteOverTheCapFromAnEndlessStream() {
    var served = 0L
    val endless = object : InputStream() {
      override fun read(): Int {
        served++
        return 1
      }

      override fun read(b: ByteArray, off: Int, len: Int): Int {
        served += len
        java.util.Arrays.fill(b, off, off + len, 1)
        return len
      }
    }
    assertNull(readCapped(endless, 1000))
    assertEquals(1001L, served)
  }

  // J-J1
  @Test
  fun installCancelledBeforeStartOpensNothing() {
    val opener = serving(ByteArray(10))
    assertEquals(JobResult.Cancelled, run(opener, 10L, cancel = CancelProbe { true }))
    assertEquals(0, opener.opened.size)
    assertTrue(sink.deleted)
  }

  // J-J2
  @Test
  fun everyNonOkVerdictFailsWithItsCodeAndDeletes() {
    val cases = listOf(
      null to UpdateErrorCode.NOT_APK,
      PackageFacts("com.other", 1001L, setOf("aa")) to UpdateErrorCode.WRONG_PACKAGE,
      PackageFacts(pkg, 1001L, setOf("bb")) to UpdateErrorCode.WRONG_SIGNER,
      PackageFacts(pkg, 1000L, setOf("aa")) to UpdateErrorCode.NOT_NEWER,
      PackageFacts(pkg, 1002L, setOf("aa")) to UpdateErrorCode.NOT_OFFERED
    )
    for ((facts, code) in cases) {
      val local = FakeSink(ArrayList())
      val result = runInstallJob(
        jobInput(10L), serving(ByteArray(10)), local, installed(), archive(facts), never
      ) {}
      assertEquals(JobResult.Failed(code), result)
      assertTrue("$code deletes", local.deleted)
    }
  }

  // J-J3
  @Test
  fun overlongBodyWithNoLengthHeaderIsRefusedAfterAtMostOfferedPlusOneBytes() {
    val result = run(serving(ByteArray(20)), 10L)
    assertEquals(JobResult.Failed(UpdateErrorCode.INCOMPLETE), result)
    assertTrue(sink.written.size() <= 11)
    assertTrue(sink.deleted)
    assertFalse(log.contains("archive.read"))
  }

  // J-J4 and H2: the stream is closed, and so flushed, before the archive is read.
  @Test
  fun exactBodyWithNoLengthHeaderIsVerifiedAfterTheSinkIsClosedAndKept() {
    val body = ByteArray(10) { it.toByte() }
    val result = run(serving(body), 10L)
    assertEquals(JobResult.Ok, result)
    assertArrayEquals(body, sink.written.toByteArray())
    assertFalse(sink.deleted)
    assertEquals(listOf("sink.close", "sink.seal", "installed.read", "archive.read"), log)
  }

  // The seal refuses later write-mode opens, so it must precede every verification read.
  @Test
  fun aSealFailureFailsAsStorageDeletesAndNeverVerifiesOrHandsOver() {
    sink.sealOk = false
    val result = run(serving(ByteArray(10)), 10L)
    assertEquals(JobResult.Failed(UpdateErrorCode.STORAGE), result)
    assertTrue(sink.deleted)
    assertEquals(listOf("sink.close", "sink.seal"), log)
  }

  @Test
  fun aSealThatThrowsIsAFailureAndDeletes() {
    sink.sealThrows = true
    val result = run(serving(ByteArray(10)), 10L)
    assertTrue(result is JobResult.Failed)
    assertTrue(sink.deleted)
    assertFalse(log.contains("installed.read"))
    assertFalse(log.contains("archive.read"))
  }

  @Test
  fun theFileIsNeverSealedBeforeTheCopyIsComplete() {
    run(serving(ByteArray(9)), 10L)
    assertFalse(log.contains("sink.seal"))
  }

  // J-J5
  @Test
  fun aContentLengthDifferentFromOfferedFailsBeforeAnyBodyByte() {
    var read = false
    val body = object : InputStream() {
      override fun read(): Int {
        read = true
        return -1
      }

      override fun read(b: ByteArray, off: Int, len: Int): Int {
        read = true
        return -1
      }
    }
    val opener = ScriptedOpener().on(apkUrl) { FakeHop(200, contentLength = 11L, stream = body) }
    assertEquals(JobResult.Failed(UpdateErrorCode.INCOMPLETE), run(opener, 10L))
    assertFalse(read)
    assertTrue(sink.deleted)
    assertFalse(sink.outputOpened)
  }

  @Test
  fun aMatchingContentLengthIsAccepted() {
    assertEquals(JobResult.Ok, run(serving(ByteArray(10), contentLength = 10L), 10L))
  }

  // J-J6
  private fun chain(redirects: Int, finalStatus: Int): ScriptedOpener {
    val opener = ScriptedOpener()
    var from = apkUrl
    for (i in 1..redirects) {
      val to = "https://objects.githubusercontent.com/hop$i"
      val target = to
      opener.on(from) { FakeHop(302, location = target) }
      from = to
    }
    opener.on(from) { FakeHop(finalStatus, stream = ByteArrayInputStream(ByteArray(10))) }
    return opener
  }

  @Test
  fun sixChainedRedirectsFailAfterExactlySixOpens() {
    val opener = chain(6, 200)
    assertEquals(JobResult.Failed(UpdateErrorCode.NETWORK), run(opener, 10L))
    assertEquals(6, opener.opened.size)
    assertTrue(sink.deleted)
  }

  @Test
  fun fiveChainedRedirectsAreFollowed() {
    val opener = chain(5, 200)
    assertEquals(JobResult.Ok, run(opener, 10L))
    assertEquals(6, opener.opened.size)
  }

  // J-J7
  @Test
  fun a404InTheApkPhaseIsANetworkFailureAndInTheCheckPhaseNotPublished() {
    val opener = ScriptedOpener().on(apkUrl) { FakeHop(404) }
    assertEquals(JobResult.Failed(UpdateErrorCode.NETWORK), run(opener, 10L))
    assertTrue(sink.deleted)

    val checkOpener = ScriptedOpener().on(UPDATE_ENDPOINT) { FakeHop(404) }
    assertEquals(
      CheckResult.NotPublished,
      runCheckJob(true, UPDATE_ENDPOINT, null, checkOpener, { InstalledSummary(1L, "v") }, { false })
    )
  }

  // J-J8
  @Test
  fun cancelSetBetweenVerifyAndReturnIsCancelledAndDeleted() {
    var cancelled = false
    val result = run(
      serving(ByteArray(10)), 10L,
      archiveFacts = archive { cancelled = true },
      cancel = CancelProbe { cancelled }
    )
    assertEquals(JobResult.Cancelled, result)
    assertTrue(sink.deleted)
  }

  // J-J9
  @Test
  fun cancelAfterTheFirstChunkStopsTheCopy() {
    val size = UPDATE_COPY_CHUNK_BYTES * 4L
    var asked = 0
    val body = ByteArrayInputStream(ByteArray(size.toInt()))
    val opener = ScriptedOpener().on(apkUrl) { FakeHop(200, stream = body) }
    val result = run(opener, size, cancel = CancelProbe { ++asked > 2 })
    assertEquals(JobResult.Cancelled, result)
    assertTrue(sink.written.size() <= 2 * UPDATE_COPY_CHUNK_BYTES)
    assertTrue(sink.deleted)
    assertFalse(log.contains("archive.read"))
  }

  // J-J10
  @Test
  fun tooLittleSpaceFailsWithTheNeededBytesAndOpensNothing() {
    val size = 1000L
    val needed = 2 * size + UPDATE_SPACE_MARGIN_BYTES
    val opener = serving(ByteArray(1000))
    val short = run(opener, size, input = jobInput(size, usable = needed - 1))
    assertEquals(JobResult.Failed(UpdateErrorCode.STORAGE, needed), short)
    assertEquals(0, opener.opened.size)
    assertTrue(sink.deleted)
    assertEquals(JobResult.Ok, run(serving(ByteArray(1000)), size, input = jobInput(size, usable = needed)))
  }

  // J-J11
  @Test
  fun anIoErrorMidBodyIsANetworkFailureAndAThrowingReaderIsOther() {
    val failing = object : InputStream() {
      private var sent = false
      override fun read(): Int = throw IOException("SYNTH reset")
      override fun read(b: ByteArray, off: Int, len: Int): Int {
        if (sent) throw IOException("SYNTH reset")
        sent = true
        b[off] = 1
        return 1
      }
    }
    val opener = ScriptedOpener().on(apkUrl) { FakeHop(200, stream = failing) }
    assertEquals(JobResult.Failed(UpdateErrorCode.NETWORK), run(opener, 10L))
    assertTrue(sink.deleted)

    val second = FakeSink(ArrayList())
    val other = runInstallJob(
      jobInput(10L), serving(ByteArray(10)), second, installed(),
      ArchiveFacts { _, _ -> throw IllegalStateException("SYNTH reader") }, never
    ) {}
    assertEquals(JobResult.Failed(UpdateErrorCode.OTHER), other)
    assertTrue(second.deleted)
  }

  @Test
  fun anOpenerIoErrorIsANetworkFailure() {
    val opener = ScriptedOpener()
    opener.openThrows = IOException("SYNTH unreachable")
    assertEquals(JobResult.Failed(UpdateErrorCode.NETWORK), run(opener, 10L))
    assertTrue(sink.deleted)
  }

  // J-J12
  @Test
  fun shortBodyIsIncompleteAndDeleted() {
    assertEquals(JobResult.Failed(UpdateErrorCode.INCOMPLETE), run(serving(ByteArray(9)), 10L))
    assertTrue(sink.deleted)
    assertFalse(log.contains("archive.read"))
  }

  // J-J13 (E6)
  @Test
  fun installedFactsAreReadOnceAfterTheCopyAndBeforeTheArchive() {
    assertEquals(JobResult.Ok, run(serving(ByteArray(10)), 10L))
    assertEquals(1, log.count { it == "installed.read" })
    assertTrue(log.indexOf("sink.close") < log.indexOf("installed.read"))
    assertTrue(log.indexOf("installed.read") < log.indexOf("archive.read"))
  }

  @Test
  fun installedFactsAreNeverReadOnAFailedCopy() {
    run(serving(ByteArray(9)), 10L)
    run(ScriptedOpener().on(apkUrl) { FakeHop(404) }, 10L)
    assertFalse(log.contains("installed.read"))
  }

  // J-J14
  @Test
  fun everySupersededRedirectHopIsClosed() {
    val opener = chain(3, 200)
    assertEquals(JobResult.Ok, run(opener, 10L))
    val superseded = opener.hops.dropLast(1)
    assertEquals(3, superseded.size)
    assertTrue(superseded.all { it.closed })
    assertTrue(opener.hops.last().closed)
  }

  @Test
  fun aRefusedRedirectClosesItsHop() {
    val opener = ScriptedOpener().on(apkUrl) { FakeHop(302, location = "https://evil.example/x") }
    assertEquals(JobResult.Failed(UpdateErrorCode.NETWORK), run(opener, 10L))
    assertTrue(opener.hops.single().closed)
  }

  // J-J15
  private fun check(opener: HttpOpener, metered: () -> Boolean = { false }, enabled: Boolean = true, origin: String? = null,
    endpoint: String = UPDATE_ENDPOINT) =
    runCheckJob(enabled, endpoint, origin, opener, { InstalledSummary(1000L, "0.1.0") }, metered)

  private fun checkBody(bytes: ByteArray) = ScriptedOpener().on(UPDATE_ENDPOINT) {
    FakeHop(200, stream = ByteArrayInputStream(bytes))
  }

  @Test
  fun checkDisabledOpensNothing() {
    val opener = ScriptedOpener()
    assertEquals(CheckResult.Disabled, check(opener, enabled = false))
    assertEquals(0, opener.opened.size)
  }

  @Test
  fun checkReturnsTheExactTextAtTheCapAndTooLargeOneByteOver() {
    val text = "x".repeat(UPDATE_JSON_MAX_BYTES)
    val ok = check(checkBody(text.toByteArray()), metered = { true })
    assertEquals(CheckResult.Ok(text, InstalledSummary(1000L, "0.1.0"), true), ok)
    assertEquals(CheckResult.Error(UpdateErrorCode.TOO_LARGE), check(checkBody(ByteArray(UPDATE_JSON_MAX_BYTES + 1) { 120 })))
  }

  @Test
  fun checkInvalidUtf8IsOther() {
    assertEquals(CheckResult.Error(UpdateErrorCode.OTHER), check(checkBody(byteArrayOf(0x7b, 0xC3.toByte(), 0x28, 0x7d))))
  }

  @Test
  fun aThrowingMeteredProbeReadsAsFalse() {
    val result = check(checkBody("{}".toByteArray()), metered = { throw IllegalStateException("SYNTH metered") })
    assertEquals(CheckResult.Ok("{}", InstalledSummary(1000L, "0.1.0"), false), result)
  }

  @Test
  fun checkNetworkAndOtherFailures() {
    assertEquals(CheckResult.Error(UpdateErrorCode.NETWORK), check(ScriptedOpener().on(UPDATE_ENDPOINT) { FakeHop(500) }))
    val broken = ScriptedOpener()
    broken.openThrows = IOException("SYNTH down")
    assertEquals(CheckResult.Error(UpdateErrorCode.NETWORK), check(broken))
    val boom = HttpOpener { throw IllegalStateException("SYNTH") }
    assertEquals(CheckResult.Error(UpdateErrorCode.OTHER), check(boom))
  }

  @Test
  fun checkBodyHopIsClosed() {
    val opener = checkBody("{}".toByteArray())
    check(opener)
    assertTrue(opener.hops.single().closed)
  }

  // J-J16
  @Test
  fun checkWithATestOriginUsesItsEndpointAndFollowsNoRedirect() {
    val origin = "http://127.0.0.1:8765"
    val endpoint = "$origin/latest-android.json"
    val ok = ScriptedOpener().on(endpoint) { FakeHop(200, stream = ByteArrayInputStream("{}".toByteArray())) }
    assertEquals(CheckResult.Ok("{}", InstalledSummary(1000L, "0.1.0"), false), check(ok, origin = origin, endpoint = endpoint))
    assertEquals(listOf(endpoint), ok.opened)

    val redirect = ScriptedOpener().on(endpoint) { FakeHop(302, location = "https://objects.githubusercontent.com/x") }
    assertEquals(CheckResult.Error(UpdateErrorCode.NETWORK), check(redirect, origin = origin, endpoint = endpoint))
    assertEquals(1, redirect.opened.size)
  }

  @Test
  fun copyBoundedReportsProgressPerChunk() {
    val chunks = ArrayList<Long>()
    val out = ByteArrayOutputStream()
    val result = copyBounded(ByteArrayInputStream(ByteArray(UPDATE_COPY_CHUNK_BYTES + 5)), out, UPDATE_COPY_CHUNK_BYTES + 5L, never) { chunks.add(it) }
    assertEquals(CopyResult.Complete(UPDATE_COPY_CHUNK_BYTES + 5L), result)
    assertEquals(listOf(UPDATE_COPY_CHUNK_BYTES.toLong(), UPDATE_COPY_CHUNK_BYTES + 5L), chunks)
  }
}
