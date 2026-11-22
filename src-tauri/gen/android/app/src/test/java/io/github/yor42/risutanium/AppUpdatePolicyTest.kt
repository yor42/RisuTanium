package io.github.yor42.risutanium

import java.net.URI
import java.util.Properties
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AppUpdatePolicyTest {
  private val testOrigin = "http://127.0.0.1:8765"
  private val base = "https://github.com/yor42/RisuTanium/releases/download/v0.2.0/app.apk"

  private fun resourceLines(name: String): List<String> {
    val stream = javaClass.classLoader!!.getResourceAsStream("app-update-v1/$name")!!
    return stream.use { it.readBytes() }.toString(Charsets.UTF_8).split('\n').map { it.trimEnd('\r') }
  }

  private fun contract(): Properties {
    val properties = Properties()
    javaClass.classLoader!!.getResourceAsStream("app-update-v1/contract.properties")!!.use { properties.load(it) }
    return properties
  }

  // J-U: every row of the frozen urls.txt.
  @Test
  fun acceptApkUrlAgreesWithEveryFrozenRow() {
    var rows = 0
    for (line in resourceLines("urls.txt")) {
      if (line.isEmpty() || line.startsWith("#")) continue
      val verb = line.substringBefore(' ')
      val url = line.substringAfter(' ')
      val accepted = acceptApkUrl(url, null) != null
      if (verb == "accept") assertTrue("accept row refused: $url", accepted)
      else if (verb == "reject") assertFalse("reject row accepted: $url", accepted)
      else throw AssertionError("unknown row: $line")
      rows++
    }
    assertTrue(rows >= 20)
  }

  @Test
  fun acceptApkUrlRefusesOverlongUrl() {
    val filler = "a".repeat(UPDATE_URL_MAX)
    assertNull(acceptApkUrl("https://github.com/yor42/RisuTanium/releases/download/v1/$filler.apk", null))
  }

  @Test
  fun acceptApkUrlCasefoldsHostOnly() {
    assertNotNull(acceptApkUrl("https://GitHub.Com/yor42/RisuTanium/releases/download/v1/app.apk", null))
    assertNull(acceptApkUrl("https://github.com/YOR42/RisuTanium/releases/download/v1/app.apk", null))
  }

  @Test
  fun testOriginIsRefusedWithoutAnOriginAndAcceptedWithOne() {
    val url = "$testOrigin/update.apk"
    assertNull(acceptApkUrl(url, null))
    assertNotNull(acceptApkUrl(url, testOrigin))
    assertNull(acceptApkUrl("$testOrigin/a/update.apk", testOrigin))
    assertNull(acceptApkUrl("$testOrigin/update.apk?x=1", testOrigin))
    assertNull(acceptApkUrl("$testOrigin/update.zip", testOrigin))
    assertNull(acceptApkUrl(base, testOrigin))
    assertNull(acceptApkUrl("http://127.0.0.1:8766/update.apk", testOrigin))
  }

  private fun hop(location: String?, hop: Int = 0, from: String = base, origin: String? = null): URI? =
    nextHop(URI(from), location, hop, origin)

  // J-R
  @Test
  fun nextHopAcceptsTheAssetHostsAndTheRepositoryPath() {
    assertNotNull(hop("https://release-assets.githubusercontent.com/github-production-release-asset/1/abc?sp=r&sig=a%3Db"))
    assertNotNull(hop("https://objects.githubusercontent.com/x/y"))
    assertNotNull(hop("https://RELEASE-ASSETS.GITHUBUSERCONTENT.COM/x"))
    assertNotNull(hop("https://github.com/yor42/RisuTanium/releases/download/v0.2.1/app.apk"))
  }

  @Test
  fun nextHopRefusesOtherSchemesAndHosts() {
    assertNull(hop("http://objects.githubusercontent.com/x"))
    assertNull(hop("https://evil.example/x"))
    assertNull(hop("https://githubusercontent.com.evil.io/x"))
    assertNull(hop("https://githubusercontent.com/x"))
    assertNull(hop("https://evilgithubusercontent.com/x"))
    assertNull(hop("https://user@objects.githubusercontent.com/x"))
    assertNull(hop(null))
  }

  @Test
  fun nextHopResolvesRelativeLocations() {
    val next = hop("/yor42/RisuTanium/releases/download/v0.2.1/other.apk")
    assertEquals("https://github.com/yor42/RisuTanium/releases/download/v0.2.1/other.apk", next.toString())
  }

  @Test
  fun nextHopRefusesGithubPathsOutsideTheRepositoryDownloads() {
    assertNull(hop("https://github.com/other/Repo/releases/download/v1/a.apk"))
    assertNull(hop("https://github.com/yor42/RisuTanium/releases/download/v1/%2e%2e/a.apk"))
    assertNull(hop("https://github.com/yor42/RisuTanium/releases/download/v1/a%2Fb.apk"))
    assertNull(hop("https://github.com/yor42/RisuTanium/releases/download/v1/../../x"))
    assertNull(hop("https://github.com/yor42/RisuTanium/releases/download/./v1/a.apk"))
    assertNull(hop("../../../x", from = "https://github.com/yor42/RisuTanium/releases/download/v1/a.apk"))
    assertNull(hop("../v2/a.apk", from = "https://github.com/yor42/RisuTanium/releases/download/v1/a.apk"))
  }

  @Test
  fun nextHopStopsAfterTheRedirectCap() {
    val ok = "https://objects.githubusercontent.com/x"
    assertNotNull(hop(ok, hop = UPDATE_MAX_REDIRECTS - 1))
    assertNull(hop(ok, hop = UPDATE_MAX_REDIRECTS))
  }

  @Test
  fun nextHopFollowsNothingWithATestOrigin() {
    assertNull(hop("https://objects.githubusercontent.com/x", origin = testOrigin, from = "$testOrigin/a.apk"))
  }

  // J-S
  @Test
  fun acceptContentLengthTakesAbsentOrEqualOnly() {
    assertTrue(acceptContentLength(-1L, 100L))
    assertTrue(acceptContentLength(100L, 100L))
    assertFalse(acceptContentLength(99L, 100L))
    assertFalse(acceptContentLength(101L, 100L))
    assertFalse(acceptContentLength(0L, 100L))
  }

  @Test
  fun offeredSizeAndVersionCodeBoundsComeFromTheContract() {
    val properties = contract()
    val apkMax = properties.getProperty("apkMaxBytes").toLong()
    assertEquals(apkMax, UPDATE_APK_MAX_BYTES)
    assertEquals(properties.getProperty("jsonMaxBytes").toInt(), UPDATE_JSON_MAX_BYTES)
    assertEquals(properties.getProperty("urlMax").toInt(), UPDATE_URL_MAX)
    assertEquals(properties.getProperty("versionCodeMax").toInt(), UPDATE_VERSION_CODE_MAX)
    assertEquals(properties.getProperty("versionCodeMin").toInt(), 1)
    assertTrue(acceptOfferedSize(1L))
    assertTrue(acceptOfferedSize(apkMax))
    assertFalse(acceptOfferedSize(0L))
    assertFalse(acceptOfferedSize(apkMax + 1))
    assertFalse(acceptOfferedSize(-5L))
    assertTrue(acceptVersionCode(1L))
    assertTrue(acceptVersionCode(UPDATE_VERSION_CODE_MAX.toLong()))
    assertFalse(acceptVersionCode(0L))
    assertFalse(acceptVersionCode(UPDATE_VERSION_CODE_MAX.toLong() + 1))
  }

  @Test
  fun enoughSpaceNeedsTwiceTheSizePlusTheMargin() {
    val size = 280_000_000L
    val needed = 2 * size + UPDATE_SPACE_MARGIN_BYTES
    assertEquals(needed, requiredSpace(size))
    assertTrue(enoughSpace(needed, size))
    assertFalse(enoughSpace(needed - 1, size))
    assertFalse(enoughSpace(Long.MAX_VALUE, Long.MAX_VALUE))
    assertTrue(enoughSpace(Long.MAX_VALUE, UPDATE_APK_MAX_BYTES))
  }

  @Test
  fun lengthRulesTreatTheByteCountAsTheAuthority() {
    assertTrue(withinOffered(10L, 10L))
    assertFalse(withinOffered(11L, 10L))
    assertTrue(completeLength(10L, 10L))
    assertFalse(completeLength(9L, 10L))
    assertFalse(completeLength(11L, 10L))
  }

  @Test
  fun classifyResponseTable() {
    assertEquals(HttpStep.BODY, classifyResponse(200, UpdatePhase.APK))
    for (status in listOf(206, 304, 300, 403, 500)) {
      assertEquals("status $status", HttpStep.FAILURE, classifyResponse(status, UpdatePhase.APK))
      assertEquals("status $status", HttpStep.FAILURE, classifyResponse(status, UpdatePhase.CHECK))
    }
    for (status in listOf(301, 302, 303, 307, 308)) {
      assertEquals(HttpStep.REDIRECT, classifyResponse(status, UpdatePhase.CHECK))
    }
    assertEquals(HttpStep.NOT_PUBLISHED, classifyResponse(404, UpdatePhase.CHECK))
    assertEquals(HttpStep.FAILURE, classifyResponse(404, UpdatePhase.APK))
  }

  // J-V
  private val keyA = "aa11"
  private val keyB = "bb22"
  private val pkg = "io.github.yor42.risutanium"
  private val installed = PackageFacts(pkg, 1000L, setOf(keyA))

  private fun archive(
    packageName: String = pkg,
    code: Long = 1001L,
    signers: Set<String> = setOf(keyA)
  ) = PackageFacts(packageName, code, signers)

  @Test
  fun verdictOkOnlyForTheOfferedNewerSamePackageSameSigners() {
    assertEquals(Verdict.OK, verdict(installed, archive(), 1001L))
  }

  @Test
  fun verdictRefusesAMissingArchiveAndAForeignPackage() {
    assertEquals(Verdict.NOT_AN_APK, verdict(installed, null, 1001L))
    assertEquals(Verdict.WRONG_PACKAGE, verdict(installed, archive(packageName = "com.other"), 1001L))
  }

  @Test
  fun verdictRequiresExactlyTheInstalledSignerSet() {
    assertEquals(Verdict.WRONG_SIGNER, verdict(PackageFacts(pkg, 1000L, setOf(keyA, keyB)), archive(signers = setOf(keyA)), 1001L))
    assertEquals(Verdict.WRONG_SIGNER, verdict(installed, archive(signers = setOf(keyA, keyB)), 1001L))
    assertEquals(Verdict.WRONG_SIGNER, verdict(installed, archive(signers = setOf(keyB)), 1001L))
  }

  @Test
  fun verdictFailsClosedOnAnEmptySignerSet() {
    assertEquals(Verdict.WRONG_SIGNER, verdict(installed, archive(signers = emptySet()), 1001L))
    assertEquals(Verdict.WRONG_SIGNER, verdict(PackageFacts(pkg, 1000L, emptySet()), archive(), 1001L))
    assertEquals(Verdict.WRONG_SIGNER, verdict(PackageFacts(pkg, 1000L, emptySet()), archive(signers = emptySet()), 1001L))
  }

  @Test
  fun verdictRequiresAStrictlyHigherVersionCodeThatIsTheOfferedOne() {
    assertEquals(Verdict.NOT_NEWER, verdict(installed, archive(code = 1000L), 1000L))
    assertEquals(Verdict.NOT_NEWER, verdict(installed, archive(code = 999L), 999L))
    assertEquals(Verdict.NOT_OFFERED, verdict(installed, archive(code = 1002L), 1001L))
    assertEquals(Verdict.NOT_OFFERED, verdict(installed, archive(code = 1001L), 1002L))
  }

  @Test
  fun verdictChecksInTheDocumentedOrder() {
    val allWrong = archive(packageName = "com.other", code = 1L, signers = setOf(keyB))
    assertEquals(Verdict.WRONG_PACKAGE, verdict(installed, allWrong, 5L))
    val signerAndVersion = archive(code = 1L, signers = setOf(keyB))
    assertEquals(Verdict.WRONG_SIGNER, verdict(installed, signerAndVersion, 5L))
  }

  // J-G1
  @Test
  fun signerSourceSwitchesAtApi28() {
    assertEquals(SignerSource.LEGACY, signerSource(24))
    assertEquals(SignerSource.LEGACY, signerSource(27))
    assertEquals(SignerSource.SIGNING_INFO, signerSource(28))
    assertEquals(SignerSource.SIGNING_INFO, signerSource(29))
    assertEquals(SignerSource.SIGNING_INFO, signerSource(36))
  }

  // J-C1..J-C3
  @Test
  fun checkEnabledAndEndpoint() {
    assertTrue(checkEnabled(false, null))
    assertFalse(checkEnabled(true, null))
    assertTrue(checkEnabled(true, testOrigin))
    assertEquals(UPDATE_ENDPOINT, endpointFor(null))
    assertEquals("$testOrigin/latest-android.json", endpointFor(testOrigin))
  }

  @Test
  fun effectiveTestOriginIsNullOutsideDebugBuilds() {
    assertNull(effectiveTestOrigin(false, testOrigin))
    assertEquals(testOrigin, effectiveTestOrigin(true, testOrigin))
    assertNull(effectiveTestOrigin(true, null))
    assertNull(effectiveTestOrigin(true, ""))
  }

  // J-E
  @Test
  fun encodersCarryIdAndMethod() {
    assertEquals(
      "{\"id\":7,\"method\":\"appUpdate.install\",\"update\":\"ok\",\"outcome\":\"notInstalled\"}",
      encodeUpdateReply(7, "install", UpdateReply.Outcome(InstallOutcome.NOT_INSTALLED))
    )
    assertEquals(
      "{\"id\":3,\"method\":\"appUpdate.installPermission\",\"update\":\"ok\",\"allowed\":false}",
      encodeUpdateReply(3, "installPermission", UpdateReply.Allowed(false))
    )
    assertEquals("{\"id\":1,\"method\":\"appUpdate.check\",\"update\":\"disabled\"}", encodeUpdateReply(1, "check", UpdateReply.Disabled))
    assertEquals("{\"id\":1,\"method\":\"appUpdate.check\",\"update\":\"notPublished\"}", encodeUpdateReply(1, "check", UpdateReply.NotPublished))
  }

  @Test
  fun checkOkEscapesTheJsonBodyAsOneStringField() {
    val hostile = "{\"a\":\"\",\"installedVersionCode\":9,\"x\":\"\u2028}"
    val reply = encodeCheckOk(4, hostile, 1000L, "0.1.0", true)
    assertEquals(
      "{\"id\":4,\"method\":\"appUpdate.check\",\"update\":\"ok\"," +
        "\"json\":\"{\\\"a\\\":\\\"\\\",\\\"installedVersionCode\\\":9,\\\"x\\\":\\\"\\u2028}\"," +
        "\"installedVersionCode\":1000,\"installedVersionName\":\"0.1.0\",\"metered\":true}",
      reply
    )
  }

  @Test
  fun errorRepliesNameTheWireCodeAndTheNeededBytes() {
    assertEquals(
      "{\"id\":2,\"method\":\"appUpdate.install\",\"update\":\"error\",\"code\":\"storage\",\"needed\":600000000}",
      encodeUpdateReply(2, "install", UpdateReply.Failure(UpdateErrorCode.STORAGE, 600000000L))
    )
    assertEquals(
      "{\"id\":2,\"method\":\"appUpdate.check\",\"update\":\"error\",\"code\":\"tooLarge\"}",
      encodeUpdateReply(2, "check", UpdateReply.Failure(UpdateErrorCode.TOO_LARGE))
    )
    val wires = UpdateErrorCode.values().map { it.wire }.toSet()
    assertEquals(
      setOf(
        "busy", "badRequest", "network", "tooLarge", "storage", "incomplete", "notApk", "wrongPackage",
        "wrongSigner", "notNewer", "notOffered", "permission", "cancelled", "other"
      ),
      wires
    )
  }

  @Test
  fun progressEventHasNoId() {
    assertEquals("{\"event\":\"appUpdateProgress\",\"received\":5,\"total\":10}", encodeUpdateProgress(5L, 10L))
  }

  // J-J17
  @Test
  fun progressThrottle() {
    assertTrue(shouldEmitProgress(0L, 1000L, -1, 0, false))
    assertFalse(shouldEmitProgress(1000L, 1100L, 5, 5, false))
    assertTrue(shouldEmitProgress(1000L, 1250L, 5, 5, false))
    assertTrue(shouldEmitProgress(1000L, 1010L, 5, 6, false))
    assertTrue(shouldEmitProgress(1000L, 1001L, 100, 100, true))
  }
}
