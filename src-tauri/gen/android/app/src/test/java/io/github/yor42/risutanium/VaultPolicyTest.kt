package io.github.yor42.risutanium

import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executor
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// The lenient MIME decoder skips junk the way the Android decoder can, so only isStrictBase64
// stands between a mangled envelope and the cipher.
class TestBase64Codec : Base64Codec {
  override fun encode(bytes: ByteArray): String = java.util.Base64.getEncoder().encodeToString(bytes)
  override fun decode(text: String): ByteArray = java.util.Base64.getMimeDecoder().decode(text)
}

// A KeyCipher over real AES-GCM keys held in memory. `aliases` is newest first. A forced result
// replaces the outcome for that alias on encrypt and decrypt.
class FakeKeyCipher : KeyCipher {
  val aliases = ArrayList<String>()
  val keys = HashMap<String, SecretKey>()
  val forced = HashMap<String, CipherResult>()
  val generated = ArrayList<String>()
  var listFails = false

  override fun listKeys(): List<String> {
    if (listFails) throw IllegalStateException("SYNTH-KEY-1234 listing")
    return ArrayList(aliases)
  }

  override fun containsAlias(alias: String): Boolean = alias in aliases

  override fun generate(alias: String): CipherResult {
    val key = KeyGenerator.getInstance("AES").also { it.init(256) }.generateKey()
    keys[alias] = key
    aliases.add(0, alias)
    generated.add(alias)
    return CipherResult.Ok(ByteArray(0))
  }

  fun addKey(alias: String, key: SecretKey = KeyGenerator.getInstance("AES").also { it.init(256) }.generateKey()) {
    keys[alias] = key
    aliases.add(0, alias)
  }

  override fun encrypt(alias: String, aad: ByteArray, plain: ByteArray): CipherResult {
    forced[alias]?.let { return it }
    val key = keys[alias] ?: return nullKeyResult(alias in aliases)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, key)
    cipher.updateAAD(aad)
    val sealed = cipher.doFinal(plain)
    return CipherResult.Ok(cipher.iv + sealed)
  }

  override fun decrypt(alias: String, aad: ByteArray, ivAndCiphertext: ByteArray): CipherResult {
    forced[alias]?.let { return it }
    val key = keys[alias] ?: return nullKeyResult(alias in aliases)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, ivAndCiphertext.copyOfRange(0, 12)))
    cipher.updateAAD(aad)
    return try {
      CipherResult.Ok(cipher.doFinal(ivAndCiphertext, 12, ivAndCiphertext.size - 12))
    } catch (error: AEADBadTagException) {
      CipherResult.BadTag
    }
  }
}

fun aliasFor(seed: Int): String = VAULT_ALIAS_PREFIX + "%016x".format(seed.toLong())
fun keyIdFor(seed: Int): ByteArray = VaultEnvelope.keyIdOf(aliasFor(seed))!!

class VaultPolicyTest {
  private fun policy(cipher: KeyCipher, vararg draws: Int): KeyVaultPolicy {
    val queue = ArrayDeque(draws.toList())
    return KeyVaultPolicy(cipher, TestBase64Codec()) { keyIdFor(queue.removeFirst()) }
  }

  private fun code(result: VaultResult): VaultErrorCode = (result as VaultResult.Error).code
  private fun text(result: VaultResult): String = (result as VaultResult.Value).text

  @Test
  fun anEnvelopeNamingAnUnknownAliasIsInvalidatedAndNothingIsGenerated() {
    val cipher = FakeKeyCipher()
    val policy = policy(cipher, 1)
    val envelope = text(policy.wrap("SYNTH-KEY-1234"))
    cipher.aliases.clear()
    cipher.keys.clear()
    cipher.generated.clear()
    assertEquals(VaultErrorCode.INVALIDATED, code(policy.unwrap(envelope)))
    assertTrue(cipher.generated.isEmpty())
  }

  @Test
  fun anInvalidatedKeyOnUnwrapIsInvalidated() {
    val cipher = FakeKeyCipher()
    val policy = policy(cipher, 1)
    val envelope = text(policy.wrap("SYNTH-KEY-1234"))
    cipher.forced[aliasFor(1)] = CipherResult.Invalidated
    assertEquals(VaultErrorCode.INVALIDATED, code(policy.unwrap(envelope)))
  }

  @Test
  fun aBadTagIsUnreadableNotOther() {
    val cipher = FakeKeyCipher()
    val policy = policy(cipher, 1)
    val envelope = text(policy.wrap("SYNTH-KEY-1234"))
    cipher.forced[aliasFor(1)] = CipherResult.BadTag
    assertEquals(VaultErrorCode.UNREADABLE, code(policy.unwrap(envelope)))
  }

  @Test
  fun aFailedProviderIsOtherAndGeneratesNothing() {
    val cipher = FakeKeyCipher()
    val policy = policy(cipher, 1, 2)
    val envelope = text(policy.wrap("SYNTH-KEY-1234"))
    cipher.forced[aliasFor(1)] = CipherResult.Failed("java.security.ProviderException")
    cipher.generated.clear()
    assertEquals(VaultErrorCode.OTHER, code(policy.unwrap(envelope)))
    assertEquals(VaultErrorCode.OTHER, code(policy.wrap("SYNTH-KEY-5678")))
    assertTrue(cipher.generated.isEmpty())
  }

  @Test
  fun theFirstWrapGeneratesOneAliasAndLaterWrapsReuseIt() {
    val cipher = FakeKeyCipher()
    val policy = policy(cipher, 7, 8)
    val first = text(policy.wrap("SYNTH-KEY-1234"))
    val second = text(policy.wrap("SYNTH-KEY-5678"))
    assertEquals(listOf(aliasFor(7)), cipher.generated)
    assertEquals("SYNTH-KEY-1234", text(policy.unwrap(first)))
    assertEquals("SYNTH-KEY-5678", text(policy.unwrap(second)))
  }

  @Test
  fun anInvalidatedNewestAliasFallsBackToTheOlderWorkingOneWithoutGenerating() {
    val cipher = FakeKeyCipher()
    cipher.addKey(aliasFor(1))
    cipher.addKey(aliasFor(2))
    cipher.forced[aliasFor(2)] = CipherResult.Invalidated
    val policy = policy(cipher, 3)
    val envelope = text(policy.wrap("SYNTH-KEY-1234"))
    assertTrue(cipher.generated.isEmpty())
    assertEquals("SYNTH-KEY-1234", text(policy.unwrap(envelope)))
    assertTrue(VaultEnvelope.open(java.util.Base64.getDecoder().decode(envelope))!!.first.contentEquals(keyIdFor(1)))
  }

  @Test
  fun whenEveryAliasIsInvalidatedANewOneIsGeneratedAndTheOldEnvelopeStillDecrypts() {
    val cipher = FakeKeyCipher()
    cipher.addKey(aliasFor(1))
    val policy = policy(cipher, 2)
    val old = text(policy.wrap("SYNTH-KEY-OLD"))
    cipher.forced[aliasFor(1)] = CipherResult.Invalidated
    val fresh = text(policy.wrap("SYNTH-KEY-NEW"))
    assertEquals(listOf(aliasFor(2)), cipher.generated)
    assertEquals("SYNTH-KEY-NEW", text(policy.unwrap(fresh)))
    cipher.forced.clear()
    assertEquals("SYNTH-KEY-OLD", text(policy.unwrap(old)))
  }

  @Test
  fun aSecondGenerationInOneProcessIsRefused() {
    val cipher = FakeKeyCipher()
    cipher.addKey(aliasFor(1))
    val policy = policy(cipher, 2, 3)
    cipher.forced[aliasFor(1)] = CipherResult.Invalidated
    text(policy.wrap("SYNTH-KEY-1234"))
    cipher.forced[aliasFor(2)] = CipherResult.Invalidated
    assertEquals(VaultErrorCode.OTHER, code(policy.wrap("SYNTH-KEY-1234")))
    assertEquals(listOf(aliasFor(2)), cipher.generated)
  }

  @Test
  fun aDebugDeleteLetsTheNextWrapGenerateAgain() {
    val cipher = FakeKeyCipher()
    val policy = policy(cipher, 1, 2)
    policy.wrap("SYNTH-KEY-1234")
    cipher.aliases.clear()
    cipher.keys.clear()
    policy.keysDeleted()
    text(policy.wrap("SYNTH-KEY-1234"))
    assertEquals(listOf(aliasFor(1), aliasFor(2)), cipher.generated)
  }

  @Test
  fun aListedAliasWithoutAKeyIsOtherNotMissing() {
    val cipher = FakeKeyCipher()
    cipher.aliases.add(aliasFor(1))
    val policy = policy(cipher, 2)
    assertEquals(VaultErrorCode.OTHER, code(policy.wrap("SYNTH-KEY-1234")))
    assertTrue(cipher.generated.isEmpty())
  }

  @Test
  fun aNullKeyIsMissingOnlyWhenTheListingLacksTheAlias() {
    assertTrue(nullKeyResult(false) === CipherResult.MissingKey)
    assertEquals("NullKey", (nullKeyResult(true) as CipherResult.Failed).className)
  }

  @Test
  fun anAliasThatAlreadyExistsIsNeverDrawnAgain() {
    val cipher = FakeKeyCipher()
    cipher.addKey(aliasFor(5))
    cipher.forced[aliasFor(5)] = CipherResult.MissingKey
    val policy = policy(cipher, 5, 6)
    text(policy.wrap("SYNTH-KEY-1234"))
    assertEquals(listOf(aliasFor(6)), cipher.generated)
  }

  @Test
  fun aWrapAboveTheLimitIsOtherAndAnEmptyListingProviderFailureIsUnavailable() {
    val cipher = FakeKeyCipher()
    val policy = policy(cipher, 1)
    assertEquals(VaultErrorCode.OTHER, code(policy.wrap("x".repeat(VAULT_MAX_PLAIN_UNITS + 1))))
    text(policy.wrap("x".repeat(VAULT_MAX_PLAIN_UNITS)))
    cipher.listFails = true
    assertEquals(VaultErrorCode.UNAVAILABLE, code(policy.wrap("SYNTH-KEY-1234")))
    assertEquals(VaultResult.Flag(false), policy.available())
    cipher.listFails = false
    assertEquals(VaultResult.Flag(true), policy.available())
  }

  @Test
  fun twoRunnersOfOneServiceRacingAWrapWithNoAliasGenerateOnce() {
    val cipher = RendezvousCipher()
    val policy = KeyVaultPolicy(cipher, TestBase64Codec()) { keyIdFor(cipher.nextDraw()) }
    val service = VaultService(policy, Executors.newSingleThreadExecutor())
    val done = CountDownLatch(2)
    val replies = java.util.Collections.synchronizedList(ArrayList<String>())
    val onThread = Executor { job -> Thread(job).start() }
    val runnerA = VaultRequestRunner(service, onThread, { it.run() }, { })
    val runnerB = VaultRequestRunner(service, onThread, { it.run() }, { })
    val deliver = { reply: String -> replies.add(reply); done.countDown() }
    runnerA.run(BridgeCommand.VaultWrap(1, "SYNTH-KEY-1234"), deliver)
    runnerB.run(BridgeCommand.VaultWrap(2, "SYNTH-KEY-5678"), deliver)
    assertTrue(done.await(10, TimeUnit.SECONDS))
    service.worker.shutdown()
    assertEquals(1, cipher.generated.size)
    assertEquals(2, replies.count { it.contains("\"vault\":\"ok\"") })
  }

  @Test
  fun theRunnerNeverRunsInlineAndRepliesThroughPostMain() {
    val cipher = FakeKeyCipher()
    val service = VaultService(policy(cipher, 1), Executors.newSingleThreadExecutor())
    val queued = ArrayList<Runnable>()
    val posted = ArrayList<Runnable>()
    val delivered = ArrayList<String>()
    val runner = VaultRequestRunner(service, { queued.add(it) }, { posted.add(it) }, { })
    runner.run(BridgeCommand.VaultAvailable(9)) { delivered.add(it) }
    assertTrue(delivered.isEmpty())
    assertEquals(1, queued.size)
    queued[0].run()
    assertTrue(delivered.isEmpty())
    assertEquals(1, posted.size)
    posted[0].run()
    assertEquals(listOf("{\"id\":9,\"method\":\"keyVault.available\",\"vault\":\"ok\",\"value\":true}"), delivered)
    service.worker.shutdown()
  }

  @Test
  fun anExceptionInTheWorkIsAnOtherReplyAndTheLogHoldsOnlyAClassName() {
    val cipher = object : KeyCipher {
      override fun listKeys(): List<String> = listOf(aliasFor(1))
      override fun containsAlias(alias: String): Boolean = true
      override fun generate(alias: String): CipherResult = CipherResult.Failed("x")
      override fun encrypt(alias: String, aad: ByteArray, plain: ByteArray): CipherResult =
        throw IllegalStateException("SYNTH-KEY-1234 in the exception text")
      override fun decrypt(alias: String, aad: ByteArray, ivAndCiphertext: ByteArray): CipherResult = CipherResult.MissingKey
    }
    val service = VaultService(KeyVaultPolicy(cipher, TestBase64Codec()), Executors.newSingleThreadExecutor())
    val logged = ArrayList<String>()
    val delivered = ArrayList<String>()
    val runner = VaultRequestRunner(service, { it.run() }, { it.run() }, { logged.add(it) })
    runner.run(BridgeCommand.VaultWrap(3, "SYNTH-KEY-1234")) { delivered.add(it) }
    assertEquals(listOf("{\"id\":3,\"method\":\"keyVault.wrap\",\"vault\":\"error\",\"code\":\"other\"}"), delivered)
    assertEquals(1, logged.size)
    assertFalse(logged[0].contains("SYNTH-KEY"))
    assertTrue(logged[0].contains("IllegalStateException"))
    service.worker.shutdown()
  }

  @Test
  fun aDebugDeleteRunsOnTheWorkerAndFreesTheGenerationAllowance() {
    val cipher = FakeKeyCipher()
    val policy = policy(cipher, 1, 2)
    val queued = ArrayList<Runnable>()
    val service = VaultService(policy, object : java.util.concurrent.AbstractExecutorService() {
      override fun execute(command: Runnable) { queued.add(command) }
      override fun shutdown() {}
      override fun shutdownNow(): MutableList<Runnable> = ArrayList()
      override fun isShutdown(): Boolean = false
      override fun isTerminated(): Boolean = false
      override fun awaitTermination(timeout: Long, unit: TimeUnit): Boolean = true
    })
    policy.wrap("SYNTH-KEY-1234")
    var deleted = false
    service.deleteAllKeys({ deleted = true; cipher.aliases.clear(); cipher.keys.clear() }, { })
    assertFalse(deleted)
    queued[0].run()
    assertTrue(deleted)
    text(policy.wrap("SYNTH-KEY-1234"))
    assertEquals(2, cipher.generated.size)
  }
}

// Holds the first caller of listKeys until a second caller arrives or a short time passes, so a
// policy per listener would let both see "no alias" and both generate.
class RendezvousCipher : KeyCipher {
  private val inner = FakeKeyCipher()
  private val second = CountDownLatch(2)
  private var draws = 0
  val generated: List<String> get() = inner.generated

  @Synchronized
  fun nextDraw(): Int = ++draws

  override fun listKeys(): List<String> {
    val snapshot = inner.listKeys()
    second.countDown()
    second.await(500, TimeUnit.MILLISECONDS)
    return snapshot
  }

  override fun containsAlias(alias: String): Boolean = inner.containsAlias(alias)
  @Synchronized
  override fun generate(alias: String): CipherResult = inner.generate(alias)
  @Synchronized
  override fun encrypt(alias: String, aad: ByteArray, plain: ByteArray): CipherResult = inner.encrypt(alias, aad, plain)
  @Synchronized
  override fun decrypt(alias: String, aad: ByteArray, ivAndCiphertext: ByteArray): CipherResult = inner.decrypt(alias, aad, ivAndCiphertext)
}
