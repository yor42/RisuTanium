package io.github.yor42.risutanium

import java.net.URI
import java.net.URISyntaxException
import java.util.Locale

// Pure rules of the in-app update. Nothing here touches the platform, so every rule runs in a JVM
// test. The release fixtures under src/test/resources/app-update-v1 pin the same bounds for the
// page parser and the release producer.

const val UPDATE_ENDPOINT = "https://github.com/yor42/RisuTanium/releases/latest/download/latest-android.json"
const val UPDATE_JSON_MAX_BYTES = 262144

// Not a product ceiling: it stays below Int.MAX_VALUE and 2 GiB on every parse path.
const val UPDATE_APK_MAX_BYTES = 2_000_000_000L
const val UPDATE_VERSION_CODE_MAX = 2_100_000_000
const val UPDATE_MAX_REDIRECTS = 5
const val UPDATE_SPACE_MARGIN_BYTES = 32L * 1024 * 1024
const val UPDATE_URL_MAX = 2048
const val UPDATE_COPY_CHUNK_BYTES = 64 * 1024

private const val GITHUB_HOST = "github.com"
private const val RELEASE_DOWNLOAD_PREFIX = "/yor42/RisuTanium/releases/download/"
private const val ASSET_HOST_SUFFIX = ".githubusercontent.com"
private val SEGMENT = Regex("[A-Za-z0-9._-]{1,128}")
private val APK_SEGMENT = Regex("[A-Za-z0-9._-]{1,128}\\.apk")

private fun parseUri(text: String): URI? = try {
  URI(text)
} catch (error: URISyntaxException) {
  null
}

private fun lower(text: String?): String? = text?.lowercase(Locale.ROOT)

// The one authority for an APK URL the page may offer. A debug build with a test origin accepts only
// `<origin>/<one segment>.apk` instead; no loopback literal lives in this file.
fun acceptApkUrl(url: String, testOrigin: String?): URI? {
  if (url.isEmpty() || url.length > UPDATE_URL_MAX || url.indexOf('%') >= 0) return null
  if (testOrigin != null) {
    val prefix = "$testOrigin/"
    if (!url.startsWith(prefix)) return null
    if (!APK_SEGMENT.matches(url.substring(prefix.length))) return null
    return parseUri(url)
  }
  val uri = parseUri(url) ?: return null
  if (lower(uri.scheme) != "https") return null
  if (lower(uri.rawAuthority) != GITHUB_HOST || lower(uri.host) != GITHUB_HOST) return null
  if (uri.rawUserInfo != null || uri.port != -1 || uri.rawQuery != null || uri.rawFragment != null) return null
  val path = uri.rawPath ?: return null
  if (!path.startsWith(RELEASE_DOWNLOAD_PREFIX)) return null
  val segments = path.substring(RELEASE_DOWNLOAD_PREFIX.length).split('/')
  if (segments.size != 2) return null
  val (tag, file) = segments
  if (tag == "." || tag == ".." || !SEGMENT.matches(tag) || !APK_SEGMENT.matches(file)) return null
  return uri
}

// The next URI of a redirect chain, or null when the hop is refused. A test origin gets no redirects.
// github.com is followed only under this repository's release downloads; the asset hosts only as
// `*.githubusercontent.com` (the leading dot is required).
fun nextHop(current: URI, location: String?, hop: Int, testOrigin: String?): URI? {
  if (testOrigin != null || location == null || hop >= UPDATE_MAX_REDIRECTS) return null
  val pathPart = location.substringBefore('?').substringBefore('#')
  if (pathPart.split('/').any { it == "." || it == ".." }) return null
  val resolved = try {
    current.resolve(location)
  } catch (error: IllegalArgumentException) {
    return null
  }
  if (resolved.normalize() != resolved) return null
  if (lower(resolved.scheme) != "https" || resolved.rawUserInfo != null) return null
  val host = lower(resolved.host) ?: return null
  if (host == GITHUB_HOST) {
    val path = resolved.rawPath ?: return null
    if (!path.startsWith(RELEASE_DOWNLOAD_PREFIX) || path.indexOf('%') >= 0) return null
    return resolved
  }
  return if (host.endsWith(ASSET_HOST_SUFFIX)) resolved else null
}

enum class UpdatePhase { CHECK, APK }

enum class HttpStep { BODY, REDIRECT, NOT_PUBLISHED, FAILURE }

fun classifyResponse(status: Int, phase: UpdatePhase): HttpStep = when (status) {
  200 -> HttpStep.BODY
  301, 302, 303, 307, 308 -> HttpStep.REDIRECT
  404 -> if (phase == UpdatePhase.CHECK) HttpStep.NOT_PUBLISHED else HttpStep.FAILURE
  else -> HttpStep.FAILURE
}

// -1 is an absent header. Identity encoding is requested, so a present length is the file length.
fun acceptContentLength(header: Long, offered: Long): Boolean = header == -1L || header == offered

fun withinOffered(written: Long, offered: Long): Boolean = written <= offered

fun completeLength(written: Long, offered: Long): Boolean = written == offered

fun acceptOfferedSize(size: Long): Boolean = size in 1L..UPDATE_APK_MAX_BYTES

fun acceptVersionCode(code: Long): Boolean = code in 1L..UPDATE_VERSION_CODE_MAX.toLong()

// The installer stages its own copy while the cache copy exists, hence twice the size.
fun requiredSpace(size: Long): Long = 2 * size + UPDATE_SPACE_MARGIN_BYTES

fun enoughSpace(usable: Long, size: Long): Boolean {
  if (size < 0 || size > (Long.MAX_VALUE - UPDATE_SPACE_MARGIN_BYTES) / 2) return false
  return usable >= requiredSpace(size)
}

enum class SignerSource { LEGACY, SIGNING_INFO }

// API 28 and later report the signing set through signingInfo; 24..27 only have the legacy signatures.
fun signerSource(sdkInt: Int): SignerSource = if (sdkInt >= 28) SignerSource.SIGNING_INFO else SignerSource.LEGACY

// Null whenever this is not a debug build, so no configured value can reach a release build.
fun effectiveTestOrigin(debugBuild: Boolean, configured: String?): String? =
  if (debugBuild && !configured.isNullOrEmpty()) configured else null

fun checkEnabled(debugBuild: Boolean, effectiveOrigin: String?): Boolean = !debugBuild || effectiveOrigin != null

fun endpointFor(effectiveOrigin: String?): String =
  if (effectiveOrigin != null) "$effectiveOrigin/latest-android.json" else UPDATE_ENDPOINT

data class PackageFacts(val packageName: String, val versionCode: Long, val signers: Set<String>)

enum class Verdict { OK, NOT_AN_APK, WRONG_PACKAGE, WRONG_SIGNER, NOT_NEWER, NOT_OFFERED }

// The archive replaces the installed app only when it is that package, signed by exactly the
// installed signer set, strictly newer and the very version the page offered. An empty signer set
// on either side fails closed.
fun verdict(installed: PackageFacts, archive: PackageFacts?, offeredVersionCode: Long): Verdict {
  if (archive == null) return Verdict.NOT_AN_APK
  if (archive.packageName != installed.packageName) return Verdict.WRONG_PACKAGE
  if (installed.signers.isEmpty() || archive.signers.isEmpty()) return Verdict.WRONG_SIGNER
  if (installed.signers != archive.signers) return Verdict.WRONG_SIGNER
  if (archive.versionCode <= installed.versionCode) return Verdict.NOT_NEWER
  if (archive.versionCode != offeredVersionCode) return Verdict.NOT_OFFERED
  return Verdict.OK
}

enum class UpdateErrorCode(val wire: String) {
  BUSY("busy"),
  BAD_REQUEST("badRequest"),
  NETWORK("network"),
  TOO_LARGE("tooLarge"),
  STORAGE("storage"),
  INCOMPLETE("incomplete"),
  NOT_APK("notApk"),
  WRONG_PACKAGE("wrongPackage"),
  WRONG_SIGNER("wrongSigner"),
  NOT_NEWER("notNewer"),
  NOT_OFFERED("notOffered"),
  PERMISSION("permission"),
  CANCELLED("cancelled"),
  OTHER("other")
}

// The hand-off does not ask the installer for a result code, so any return while the app is alive means
// the update was not installed (a successful install replaces and kills the process).
enum class InstallOutcome(val wire: String) {
  NOT_INSTALLED("notInstalled")
}

sealed class UpdateReply {
  object Disabled : UpdateReply()
  object NotPublished : UpdateReply()
  data class Allowed(val allowed: Boolean) : UpdateReply()
  data class Outcome(val outcome: InstallOutcome) : UpdateReply()
  data class Failure(val code: UpdateErrorCode, val needed: Long? = null) : UpdateReply()
}

// Every reply names its request's id and method; the page settles a request only on that pair.
// `method` is the short name the page sent, without the bridge prefix.
private fun replyHead(id: Int, method: String): String =
  "{\"id\":$id,\"method\":${jsonString("appUpdate.$method")}"

fun encodeUpdateReply(id: Int, method: String, reply: UpdateReply): String {
  val head = replyHead(id, method)
  return when (reply) {
    is UpdateReply.Disabled -> "$head,\"update\":\"disabled\"}"
    is UpdateReply.NotPublished -> "$head,\"update\":\"notPublished\"}"
    is UpdateReply.Allowed -> "$head,\"update\":\"ok\",\"allowed\":${reply.allowed}}"
    is UpdateReply.Outcome -> "$head,\"update\":\"ok\",\"outcome\":${jsonString(reply.outcome.wire)}}"
    is UpdateReply.Failure -> {
      val needed = if (reply.needed != null) ",\"needed\":${reply.needed}" else ""
      "$head,\"update\":\"error\",\"code\":${jsonString(reply.code.wire)}$needed}"
    }
  }
}

// The release JSON travels as one escaped string, so its content can never add or end a field.
fun encodeCheckOk(id: Int, json: String, installedVersionCode: Long, installedVersionName: String, metered: Boolean): String =
  "${replyHead(id, "check")},\"update\":\"ok\",\"json\":${jsonString(json)}," +
    "\"installedVersionCode\":$installedVersionCode,\"installedVersionName\":${jsonString(installedVersionName)}," +
    "\"metered\":$metered}"

fun encodeUpdateProgress(received: Long, total: Long): String =
  "{\"event\":\"appUpdateProgress\",\"received\":$received,\"total\":$total}"

// First progress, every whole-percent change and the final one are emitted; otherwise at most one per 250 ms.
// lastPercent < 0 means nothing was emitted yet.
fun shouldEmitProgress(lastMs: Long, nowMs: Long, lastPercent: Int, percent: Int, final: Boolean): Boolean {
  if (final || lastPercent < 0 || percent != lastPercent) return true
  return nowMs - lastMs >= 250
}
