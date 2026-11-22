package io.github.yor42.risutanium

import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.URI
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction

// The two worker job bodies of the in-app update, as plain JVM code behind small seams. The platform
// edge supplies the adapters: an HttpURLConnection opener, PackageManager readers and a File sink.

interface HttpHop : Closeable {
  val status: Int
  val location: String?
  val contentLength: Long
  fun body(): InputStream
}

fun interface HttpOpener {
  fun open(uri: URI): HttpHop
}

interface FileSink {
  val path: String
  fun output(): OutputStream
  fun delete()
}

fun interface InstalledFacts {
  fun read(source: SignerSource): PackageFacts
}

fun interface ArchiveFacts {
  fun read(path: String, source: SignerSource): PackageFacts?
}

fun interface CancelProbe {
  fun isCancelled(): Boolean
}

data class InstalledSummary(val versionCode: Long, val versionName: String)

sealed class HopResult {
  data class Body(val hop: HttpHop) : HopResult()
  object NotPublished : HopResult()
  object Failure : HopResult()
}

sealed class CopyResult {
  data class Complete(val written: Long) : CopyResult()
  object Overlong : CopyResult()
  data class Short(val written: Long) : CopyResult()
  object Cancelled : CopyResult()
}

sealed class CheckResult {
  object Disabled : CheckResult()
  object NotPublished : CheckResult()
  data class Error(val code: UpdateErrorCode) : CheckResult()
  data class Ok(val json: String, val installed: InstalledSummary, val metered: Boolean) : CheckResult()
}

sealed class JobResult {
  object Ok : JobResult()
  object Cancelled : JobResult()
  data class Failed(val code: UpdateErrorCode, val needed: Long? = null) : JobResult()
}

data class InstallJobInput(
  val uri: URI,
  val size: Long,
  val offeredVersionCode: Long,
  val testOrigin: String?,
  val usableSpace: Long,
  val signerSource: SignerSource
)

// Reads at most max + 1 bytes, so an endless body costs at most one byte over the cap.
fun readCapped(input: InputStream, max: Int): ByteArray? {
  val out = ByteArrayOutputStream()
  val buffer = ByteArray(8192)
  var total = 0
  while (total <= max) {
    val want = minOf(buffer.size, max + 1 - total)
    val read = input.read(buffer, 0, want)
    if (read < 0) break
    out.write(buffer, 0, read)
    total += read
  }
  return if (total > max) null else out.toByteArray()
}

// Copies in 64 KiB chunks. Each read requests min(chunk, offered + 1 - written), so at most
// offered + 1 bytes are ever read or written, and the cancel probe is asked before every chunk.
fun copyBounded(
  input: InputStream,
  output: OutputStream,
  offered: Long,
  cancel: CancelProbe,
  onChunk: (Long) -> Unit
): CopyResult {
  val buffer = ByteArray(UPDATE_COPY_CHUNK_BYTES)
  var written = 0L
  while (true) {
    if (cancel.isCancelled()) return CopyResult.Cancelled
    val want = minOf(buffer.size.toLong(), offered + 1 - written).toInt()
    val read = input.read(buffer, 0, want)
    if (read < 0) break
    output.write(buffer, 0, read)
    written += read
    if (!withinOffered(written, offered)) return CopyResult.Overlong
    onChunk(written)
  }
  return if (completeLength(written, offered)) CopyResult.Complete(written) else CopyResult.Short(written)
}

// Follows redirects by hand through nextHop. Every superseded hop is closed; the returned body hop is
// the caller's to close. An IOException from the opener propagates.
fun followHops(opener: HttpOpener, start: URI, phase: UpdatePhase, testOrigin: String?): HopResult {
  var current = start
  var hop = 0
  while (true) {
    val response = opener.open(current)
    var keep = false
    try {
      when (classifyResponse(response.status, phase)) {
        HttpStep.BODY -> {
          keep = true
          return HopResult.Body(response)
        }
        HttpStep.NOT_PUBLISHED -> return HopResult.NotPublished
        HttpStep.FAILURE -> return HopResult.Failure
        HttpStep.REDIRECT -> {
          current = nextHop(current, response.location, hop, testOrigin) ?: return HopResult.Failure
          hop++
        }
      }
    } finally {
      if (!keep) response.close()
    }
  }
}

private fun strictUtf8(bytes: ByteArray): String? = try {
  Charsets.UTF_8.newDecoder()
    .onMalformedInput(CodingErrorAction.REPORT)
    .onUnmappableCharacter(CodingErrorAction.REPORT)
    .decode(ByteBuffer.wrap(bytes))
    .toString()
} catch (error: CharacterCodingException) {
  null
}

fun runCheckJob(
  enabled: Boolean,
  endpoint: String,
  testOrigin: String?,
  opener: HttpOpener,
  installedSummary: () -> InstalledSummary,
  metered: () -> Boolean
): CheckResult {
  if (!enabled) return CheckResult.Disabled
  return try {
    when (val hop = followHops(opener, URI(endpoint), UpdatePhase.CHECK, testOrigin)) {
      is HopResult.NotPublished -> CheckResult.NotPublished
      is HopResult.Failure -> CheckResult.Error(UpdateErrorCode.NETWORK)
      is HopResult.Body -> hop.hop.use { readCheckBody(it, installedSummary, metered) }
    }
  } catch (error: IOException) {
    CheckResult.Error(UpdateErrorCode.NETWORK)
  } catch (error: Exception) {
    CheckResult.Error(UpdateErrorCode.OTHER)
  }
}

private fun readCheckBody(hop: HttpHop, installedSummary: () -> InstalledSummary, metered: () -> Boolean): CheckResult {
  val bytes = readCapped(hop.body(), UPDATE_JSON_MAX_BYTES) ?: return CheckResult.Error(UpdateErrorCode.TOO_LARGE)
  val json = strictUtf8(bytes) ?: return CheckResult.Error(UpdateErrorCode.OTHER)
  val isMetered = try {
    metered()
  } catch (error: Exception) {
    false
  }
  return CheckResult.Ok(json, installedSummary(), isMetered)
}

// The sink's file is deleted on every result except Ok. The output stream is closed, and so
// flushed, as soon as the copy is complete and before the archive is read, because the zip's central
// directory must be on disk at verify time.
fun runInstallJob(
  input: InstallJobInput,
  opener: HttpOpener,
  sink: FileSink,
  installed: InstalledFacts,
  archive: ArchiveFacts,
  cancel: CancelProbe,
  onProgress: (Long) -> Unit
): JobResult {
  var result: JobResult = JobResult.Failed(UpdateErrorCode.OTHER)
  var stream: OutputStream? = null
  try {
    result = installAttempt(input, opener, sink, installed, archive, cancel, onProgress) { stream = it }
  } catch (error: IOException) {
    result = JobResult.Failed(UpdateErrorCode.NETWORK)
  } catch (error: Exception) {
    result = JobResult.Failed(UpdateErrorCode.OTHER)
  } finally {
    try {
      stream?.close()
    } catch (error: IOException) {
      // The result is already decided; a failed close only matters to the archive read, which failed first.
    }
    if (result !is JobResult.Ok) {
      try {
        sink.delete()
      } catch (error: Exception) {
        // Nothing more can be done for this file here; the next sweep removes it.
      }
    }
  }
  return result
}

private fun installAttempt(
  input: InstallJobInput,
  opener: HttpOpener,
  sink: FileSink,
  installed: InstalledFacts,
  archive: ArchiveFacts,
  cancel: CancelProbe,
  onProgress: (Long) -> Unit,
  streamOpened: (OutputStream) -> Unit
): JobResult {
  if (cancel.isCancelled()) return JobResult.Cancelled
  if (!enoughSpace(input.usableSpace, input.size)) {
    return JobResult.Failed(UpdateErrorCode.STORAGE, requiredSpace(input.size))
  }
  val hop = when (val followed = followHops(opener, input.uri, UpdatePhase.APK, input.testOrigin)) {
    is HopResult.Body -> followed.hop
    else -> return JobResult.Failed(UpdateErrorCode.NETWORK)
  }
  hop.use {
    if (!acceptContentLength(it.contentLength, input.size)) return JobResult.Failed(UpdateErrorCode.INCOMPLETE)
    val output = sink.output()
    streamOpened(output)
    val copied = copyBounded(it.body(), output, input.size, cancel, onProgress)
    val written = when (copied) {
      is CopyResult.Cancelled -> return JobResult.Cancelled
      is CopyResult.Overlong -> return JobResult.Failed(UpdateErrorCode.INCOMPLETE)
      is CopyResult.Short -> return JobResult.Failed(UpdateErrorCode.INCOMPLETE)
      is CopyResult.Complete -> copied.written
    }
    output.close()
    if (!completeLength(written, input.size)) return JobResult.Failed(UpdateErrorCode.INCOMPLETE)
  }
  if (cancel.isCancelled()) return JobResult.Cancelled
  val installedFacts = installed.read(input.signerSource)
  val archiveFacts = archive.read(sink.path, input.signerSource)
  val failure = when (verdict(installedFacts, archiveFacts, input.offeredVersionCode)) {
    Verdict.OK -> null
    Verdict.NOT_AN_APK -> UpdateErrorCode.NOT_APK
    Verdict.WRONG_PACKAGE -> UpdateErrorCode.WRONG_PACKAGE
    Verdict.WRONG_SIGNER -> UpdateErrorCode.WRONG_SIGNER
    Verdict.NOT_NEWER -> UpdateErrorCode.NOT_NEWER
    Verdict.NOT_OFFERED -> UpdateErrorCode.NOT_OFFERED
  }
  if (failure != null) return JobResult.Failed(failure)
  if (cancel.isCancelled()) return JobResult.Cancelled
  return JobResult.Ok
}
