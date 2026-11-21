package io.github.yor42.risutanium

import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.security.SecureRandom
import java.util.concurrent.Executor
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

// The connection-key vault: every rule here is plain Kotlin with no android imports, so the JVM
// tests run it against a fake KeyCipher. KeystoreCipher is the Android edge; base64 is applied
// there too, behind Base64Codec.
//
// A key is wrapped into an envelope v1: [0x01][keyId 8][IV 12][ciphertext || GCM tag]. The keyId
// names the Keystore alias that holds the AES key. The authenticated header is the fixed context
// text plus the version byte and keyId, so an envelope cannot be retargeted to another key.

const val VAULT_ALIAS_PREFIX = "risutanium.vault.k."

// A plaintext longer than this many UTF-16 units is refused.
const val VAULT_MAX_PLAIN_UNITS = 262144

object VaultEnvelope {
  const val VERSION: Byte = 1
  const val KEY_ID_LENGTH = 8
  const val IV_LENGTH = 12
  const val TAG_LENGTH = 16
  const val KEY_ID_OFFSET = 1
  const val IV_OFFSET = KEY_ID_OFFSET + KEY_ID_LENGTH
  const val BODY_OFFSET = IV_OFFSET + IV_LENGTH
  const val MIN_LENGTH = BODY_OFFSET + TAG_LENGTH

  private val CONTEXT = "risutanium/connection-key/v1".toByteArray(Charsets.UTF_8)

  fun aad(keyId: ByteArray): ByteArray {
    val header = ByteArray(1 + KEY_ID_LENGTH)
    header[0] = VERSION
    System.arraycopy(keyId, 0, header, KEY_ID_OFFSET, KEY_ID_LENGTH)
    return CONTEXT + header
  }

  // ivAndCiphertext is [IV 12][ciphertext || tag].
  fun seal(keyId: ByteArray, ivAndCiphertext: ByteArray): ByteArray {
    val envelope = ByteArray(IV_OFFSET + ivAndCiphertext.size)
    envelope[0] = VERSION
    System.arraycopy(keyId, 0, envelope, KEY_ID_OFFSET, KEY_ID_LENGTH)
    System.arraycopy(ivAndCiphertext, 0, envelope, IV_OFFSET, ivAndCiphertext.size)
    return envelope
  }

  // The keyId and the [IV][ciphertext || tag] part, or null when the bytes are not a v1 envelope.
  fun open(envelope: ByteArray): Pair<ByteArray, ByteArray>? {
    if (envelope.size < MIN_LENGTH || envelope[0] != VERSION) return null
    return Pair(
      envelope.copyOfRange(KEY_ID_OFFSET, IV_OFFSET),
      envelope.copyOfRange(IV_OFFSET, envelope.size)
    )
  }

  fun aliasOf(keyId: ByteArray): String = VAULT_ALIAS_PREFIX + toHex(keyId)

  // The keyId an alias names, or null when the alias is not one of the vault's.
  fun keyIdOf(alias: String): ByteArray? {
    if (!alias.startsWith(VAULT_ALIAS_PREFIX)) return null
    val hex = alias.substring(VAULT_ALIAS_PREFIX.length)
    if (hex.length != KEY_ID_LENGTH * 2 || !hex.all { it in '0'..'9' || it in 'a'..'f' }) return null
    return ByteArray(KEY_ID_LENGTH) { index -> hex.substring(index * 2, index * 2 + 2).toInt(16).toByte() }
  }

  private fun toHex(bytes: ByteArray): String {
    val digits = "0123456789abcdef"
    val out = StringBuilder(bytes.size * 2)
    for (byte in bytes) {
      val value = byte.toInt() and 0xff
      out.append(digits[value shr 4]).append(digits[value and 0x0f])
    }
    return out.toString()
  }
}

// Standard base64 (alphabet A-Za-z0-9+/, length a multiple of 4, at most two trailing '=') with
// no whitespace, so a decoder that skips junk never accepts a mangled envelope.
fun isStrictBase64(text: String): Boolean {
  if (text.length % 4 != 0) return false
  val body = text.trimEnd('=')
  if (text.length - body.length > 2) return false
  return body.all { it in 'A'..'Z' || it in 'a'..'z' || it in '0'..'9' || it == '+' || it == '/' }
}

// Base64 without line breaks; the Android implementation uses NO_WRAP, never DEFAULT.
interface Base64Codec {
  fun encode(bytes: ByteArray): String
  fun decode(text: String): ByteArray
}

sealed class CipherResult {
  class Ok(val bytes: ByteArray) : CipherResult()
  object MissingKey : CipherResult()
  object Invalidated : CipherResult()
  object BadTag : CipherResult()
  class Failed(val className: String) : CipherResult()
}

// The Keystore as the policy sees it. There is no delete: nothing in production removes a key.
// listKeys returns the vault's aliases newest first and throws when the provider cannot load. The
// AndroidKeyStore provider logs a listing error and returns an empty list instead, which the policy
// treats as no alias: at most one extra alias per process, and no existing alias is touched.
// encrypt returns [IV 12][ciphertext || tag]; decrypt takes the same layout.
interface KeyCipher {
  fun listKeys(): List<String>
  fun containsAlias(alias: String): Boolean
  fun generate(alias: String): CipherResult
  fun encrypt(alias: String, aad: ByteArray, plain: ByteArray): CipherResult
  fun decrypt(alias: String, aad: ByteArray, ivAndCiphertext: ByteArray): CipherResult
}

enum class VaultErrorCode(val wire: String) {
  INVALIDATED("invalidated"),
  UNREADABLE("unreadable"),
  UNAVAILABLE("unavailable"),
  OTHER("other")
}

sealed class VaultResult {
  data class Value(val text: String) : VaultResult()
  data class Flag(val value: Boolean) : VaultResult()
  data class Error(val code: VaultErrorCode) : VaultResult()
}

// A key the Keystore returned as null is missing only when the listing lacks the alias too. A listed
// alias that yields no key is a provider fault, and must not lead to a new key.
fun nullKeyResult(listed: Boolean): CipherResult = if (listed) CipherResult.Failed("NullKey") else CipherResult.MissingKey

private const val MAX_KEY_ID_DRAWS = 8

// One per process (VaultService.shared). Calls are serialised on the policy, so two listeners can
// never both find no alias and both generate.
class KeyVaultPolicy(
  val cipher: KeyCipher,
  val codec: Base64Codec,
  private val drawKeyId: () -> ByteArray = ::randomKeyId
) {
  private var generated = false

  @Synchronized
  fun available(): VaultResult = try {
    cipher.listKeys()
    VaultResult.Flag(true)
  } catch (error: Exception) {
    VaultResult.Flag(false)
  }

  // Aliases are tried newest first and the first that encrypts wins. A new alias is generated only
  // when there is none, or every one reported a missing or invalidated key; a Failed result with no
  // success never generates, because the key may still be fine.
  @Synchronized
  fun wrap(plain: String): VaultResult {
    if (plain.length > VAULT_MAX_PLAIN_UNITS) return VaultResult.Error(VaultErrorCode.OTHER)
    val aliases = try {
      cipher.listKeys().filter { VaultEnvelope.keyIdOf(it) != null }
    } catch (error: Exception) {
      return VaultResult.Error(VaultErrorCode.UNAVAILABLE)
    }
    val bytes = plain.toByteArray(Charsets.UTF_8)
    var failed = false
    for (alias in aliases) {
      val keyId = VaultEnvelope.keyIdOf(alias) ?: continue
      when (val result = cipher.encrypt(alias, VaultEnvelope.aad(keyId), bytes)) {
        is CipherResult.Ok -> return VaultResult.Value(codec.encode(VaultEnvelope.seal(keyId, result.bytes)))
        is CipherResult.MissingKey, is CipherResult.Invalidated -> Unit
        is CipherResult.BadTag, is CipherResult.Failed -> failed = true
      }
    }
    if (failed) return VaultResult.Error(VaultErrorCode.OTHER)
    return generateAndWrap(bytes)
  }

  private fun generateAndWrap(plain: ByteArray): VaultResult {
    if (generated) return VaultResult.Error(VaultErrorCode.OTHER)
    var keyId: ByteArray? = null
    try {
      for (attempt in 0 until MAX_KEY_ID_DRAWS) {
        val candidate = drawKeyId()
        if (!cipher.containsAlias(VaultEnvelope.aliasOf(candidate))) {
          keyId = candidate
          break
        }
      }
    } catch (error: Exception) {
      return VaultResult.Error(VaultErrorCode.OTHER)
    }
    if (keyId == null) return VaultResult.Error(VaultErrorCode.OTHER)
    val alias = VaultEnvelope.aliasOf(keyId)
    generated = true
    if (cipher.generate(alias) !is CipherResult.Ok) return VaultResult.Error(VaultErrorCode.OTHER)
    val result = cipher.encrypt(alias, VaultEnvelope.aad(keyId), plain)
    if (result !is CipherResult.Ok) return VaultResult.Error(VaultErrorCode.OTHER)
    return VaultResult.Value(codec.encode(VaultEnvelope.seal(keyId, result.bytes)))
  }

  // Never generates: a key the envelope names that the Keystore no longer has is invalidated.
  @Synchronized
  fun unwrap(envelopeText: String): VaultResult {
    val unreadable = VaultResult.Error(VaultErrorCode.UNREADABLE)
    if (!isStrictBase64(envelopeText)) return unreadable
    val envelope = try {
      codec.decode(envelopeText)
    } catch (error: Exception) {
      return unreadable
    }
    val (keyId, body) = VaultEnvelope.open(envelope) ?: return unreadable
    val alias = VaultEnvelope.aliasOf(keyId)
    return when (val result = cipher.decrypt(alias, VaultEnvelope.aad(keyId), body)) {
      is CipherResult.Ok -> strictUtf8(result.bytes)?.let { VaultResult.Value(it) } ?: unreadable
      is CipherResult.MissingKey, is CipherResult.Invalidated -> VaultResult.Error(VaultErrorCode.INVALIDATED)
      is CipherResult.BadTag -> unreadable
      is CipherResult.Failed -> VaultResult.Error(VaultErrorCode.OTHER)
    }
  }

  // A debug delete leaves no alias, so the next wrap may generate again.
  @Synchronized
  fun keysDeleted() {
    generated = false
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
}

private fun randomKeyId(): ByteArray = ByteArray(VaultEnvelope.KEY_ID_LENGTH).also { SecureRandom().nextBytes(it) }

// The one policy and the one worker of the process. Every HostMessageListener shares them, because
// a configuration recreation leaves two listeners alive.
class VaultService(val policy: KeyVaultPolicy, val worker: ExecutorService) {
  // Debug only. Runs on the worker, which is serial, so a page request that follows sees the result.
  fun deleteAllKeys(delete: () -> Unit, log: (String) -> Unit) {
    worker.execute {
      try {
        delete()
      } catch (error: Exception) {
        log(droppedMessageLog(error))
      }
      policy.keysDeleted()
    }
  }

  companion object {
    val keystore: KeystoreCipher by lazy { KeystoreCipher() }

    val shared: VaultService by lazy {
      VaultService(KeyVaultPolicy(keystore, AndroidBase64Codec()), Executors.newSingleThreadExecutor())
    }
  }
}

// Runs a vault request on the executor and posts the encoded reply back through postMain. The
// reply always carries the request's id and method, and an exception becomes an `other` error.
class VaultRequestRunner(
  private val service: VaultService,
  private val executor: Executor,
  private val postMain: (Runnable) -> Unit,
  private val log: (String) -> Unit
) {
  fun run(command: VaultCommand, deliver: (String) -> Unit) {
    executor.execute {
      val result = try {
        handle(command)
      } catch (error: Exception) {
        log(droppedMessageLog(error))
        VaultResult.Error(VaultErrorCode.OTHER)
      }
      val reply = encodeVaultReply(command.id, command.replyMethod, result)
      postMain(Runnable { deliver(reply) })
    }
  }

  private fun handle(command: VaultCommand): VaultResult = when (command) {
    is BridgeCommand.VaultAvailable -> service.policy.available()
    is BridgeCommand.VaultWrap -> service.policy.wrap(command.plain)
    is BridgeCommand.VaultUnwrap -> service.policy.unwrap(command.envelope)
    is BridgeCommand.KeyVaultMalformed -> VaultResult.Error(VaultErrorCode.OTHER)
    else -> VaultResult.Error(VaultErrorCode.OTHER)
  }
}

// What is logged for a message that could not be handled: the class name only, because the
// exception text can quote the message, which may hold a key or an envelope.
fun droppedMessageLog(error: Throwable): String = "host message dropped: ${error.javaClass.name}"
