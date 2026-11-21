package io.github.yor42.risutanium

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class VaultEnvelopeTest {
  private val codec = TestBase64Codec()

  private fun policy(cipher: FakeKeyCipher, seed: Int = 1) =
    KeyVaultPolicy(cipher, codec) { keyIdFor(seed) }

  private fun value(result: VaultResult): String = (result as VaultResult.Value).text
  private fun code(result: VaultResult): VaultErrorCode = (result as VaultResult.Error).code
  private fun bytesOf(envelope: String): ByteArray = java.util.Base64.getDecoder().decode(envelope)
  private fun textOf(bytes: ByteArray): String = java.util.Base64.getEncoder().encodeToString(bytes)

  @Test
  fun theEnvelopeIsVersionKeyIdIvAndCiphertextWithTag() {
    val cipher = FakeKeyCipher()
    val envelope = bytesOf(value(policy(cipher, 0x0102030405060708.toInt()).wrap("SYNTH")))
    assertEquals(1 + 8 + 12 + "SYNTH".length + 16, envelope.size)
    assertEquals(1, envelope[0].toInt())
    assertArrayEquals(keyIdFor(0x0102030405060708.toInt()), envelope.copyOfRange(1, 9))
    assertEquals(cipher.generated[0], VaultEnvelope.aliasOf(envelope.copyOfRange(1, 9)))
    assertFalse(value(policy(FakeKeyCipher()).wrap("SYNTH")).contains("\n"))
  }

  @Test
  fun aLaterVersionAndTooShortBytesAreUnreadable() {
    val cipher = FakeKeyCipher()
    val policy = policy(cipher)
    val envelope = bytesOf(value(policy.wrap("SYNTH-KEY-1234")))
    val v2 = envelope.copyOf().also { it[0] = 2 }
    assertEquals(VaultErrorCode.UNREADABLE, code(policy.unwrap(textOf(v2))))
    val v0 = envelope.copyOf().also { it[0] = 0 }
    assertEquals(VaultErrorCode.UNREADABLE, code(policy.unwrap(textOf(v0))))
    assertEquals(VaultErrorCode.UNREADABLE, code(policy.unwrap(textOf(envelope.copyOf(VaultEnvelope.MIN_LENGTH - 1)))))
    assertEquals(VaultErrorCode.UNREADABLE, code(policy.unwrap("")))
    assertEquals("SYNTH-KEY-1234", value(policy.unwrap(textOf(envelope))))
  }

  @Test
  fun theKeyIdIsAuthenticatedSoAnEnvelopeCannotBeRetargetedToAnotherKey() {
    val cipher = FakeKeyCipher()
    val policy = policy(cipher, 1)
    val envelope = bytesOf(value(policy.wrap("SYNTH-KEY-1234")))
    // A second alias holds the very same key material, so only the header in the AAD can refuse.
    cipher.addKey(aliasFor(2), cipher.keys[aliasFor(1)]!!)
    val retargeted = envelope.copyOf()
    System.arraycopy(keyIdFor(2), 0, retargeted, 1, 8)
    assertEquals(VaultErrorCode.UNREADABLE, code(policy.unwrap(textOf(retargeted))))
    val flippedIv = envelope.copyOf().also { it[9] = (it[9].toInt() xor 1).toByte() }
    assertEquals(VaultErrorCode.UNREADABLE, code(policy.unwrap(textOf(flippedIv))))
  }

  @Test
  fun koreanAndNonBmpTextRoundTrips() {
    val policy = policy(FakeKeyCipher())
    for (plain in listOf("키-SYNTH-1234", "SYNTH-🔑-key", "", "a\nb\"c\\d\u2028")) {
      assertEquals(plain, value(policy.unwrap(value(policy.wrap(plain)))))
    }
  }

  @Test
  fun plaintextThatIsNotValidUtf8IsUnreadable() {
    val cipher = FakeKeyCipher()
    val policy = policy(cipher)
    value(policy.wrap("SYNTH"))
    val keyId = keyIdFor(1)
    val sealed = (cipher.encrypt(aliasFor(1), VaultEnvelope.aad(keyId), byteArrayOf(0xC3.toByte(), 0x28)) as CipherResult.Ok).bytes
    val envelope = textOf(VaultEnvelope.seal(keyId, sealed))
    assertEquals(VaultErrorCode.UNREADABLE, code(policy.unwrap(envelope)))
  }

  @Test
  fun anEnvelopeWithJunkInTheBase64IsUnreadableEvenWhenTheDecoderSkipsJunk() {
    val policy = policy(FakeKeyCipher())
    val envelope = value(policy.wrap("SYNTH-KEY-1234"))
    assertEquals(VaultErrorCode.UNREADABLE, code(policy.unwrap(envelope.substring(0, 8) + "\n" + envelope.substring(8))))
    assertEquals(VaultErrorCode.UNREADABLE, code(policy.unwrap(envelope.replace('+', '-').replace('/', '_') + "\n")))
    assertEquals(VaultErrorCode.UNREADABLE, code(policy.unwrap(" $envelope")))
  }

  @Test
  fun strictBase64RejectsNewlinesUrlSafeLettersBadLengthAndInnerPadding() {
    assertTrue(isStrictBase64("AAAA"))
    assertTrue(isStrictBase64("AAA="))
    assertTrue(isStrictBase64("AA=="))
    assertTrue(isStrictBase64("a+/9"))
    assertTrue(isStrictBase64(""))
    assertFalse(isStrictBase64("AA\nA"))
    assertFalse(isStrictBase64("AAAA\n"))
    assertFalse(isStrictBase64("AA-_"))
    assertFalse(isStrictBase64("AAA"))
    assertFalse(isStrictBase64("A=AA"))
    assertFalse(isStrictBase64("A==="))
    assertFalse(isStrictBase64("AA=A"))
    assertFalse(isStrictBase64("AAAA===="))
  }

  @Test
  fun theAliasCarriesTheKeyIdInLowercaseHexAndOnlyVaultAliasesParse() {
    val keyId = byteArrayOf(0, 1, 0x7f, 0x80.toByte(), 0xff.toByte(), 0x10, 0xab.toByte(), 0xcd.toByte())
    assertEquals("risutanium.vault.k.00017f80ff10abcd", VaultEnvelope.aliasOf(keyId))
    assertArrayEquals(keyId, VaultEnvelope.keyIdOf("risutanium.vault.k.00017f80ff10abcd"))
    assertEquals(null, VaultEnvelope.keyIdOf("risutanium.vault.k.00017F80FF10ABCD"))
    assertEquals(null, VaultEnvelope.keyIdOf("risutanium.vault.k.00017f80"))
    assertEquals(null, VaultEnvelope.keyIdOf("other.00017f80ff10abcd"))
  }
}
