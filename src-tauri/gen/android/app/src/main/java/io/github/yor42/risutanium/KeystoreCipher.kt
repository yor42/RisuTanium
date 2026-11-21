package io.github.yor42.risutanium

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import java.util.Collections
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

// The Android edge of the vault: base64 without line breaks (NO_WRAP, never DEFAULT, which inserts
// newlines) and the AndroidKeyStore. The rules that use them are in VaultPolicy.kt.
class AndroidBase64Codec : Base64Codec {
  override fun encode(bytes: ByteArray): String = Base64.encodeToString(bytes, Base64.NO_WRAP)
  override fun decode(text: String): ByteArray = Base64.decode(text, Base64.NO_WRAP)
}

private const val PROVIDER = "AndroidKeyStore"
private const val TRANSFORMATION = "AES/GCM/NoPadding"
private const val TAG_BITS = 128

// AES-256-GCM keys in the AndroidKeyStore: no user-authentication, StrongBox or unlocked-device
// requirement. A failure is reported by class name only.
class KeystoreCipher : KeyCipher {
  private val store: KeyStore by lazy { KeyStore.getInstance(PROVIDER).also { it.load(null) } }

  override fun listKeys(): List<String> {
    val aliases = Collections.list(store.aliases()).filter { it.startsWith(VAULT_ALIAS_PREFIX) }
    return aliases.sortedByDescending { store.getCreationDate(it)?.time ?: 0L }
  }

  override fun containsAlias(alias: String): Boolean = store.containsAlias(alias)

  override fun generate(alias: String): CipherResult = try {
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, PROVIDER)
    generator.init(
      KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .setRandomizedEncryptionRequired(true)
        .build()
    )
    generator.generateKey()
    CipherResult.Ok(ByteArray(0))
  } catch (error: Exception) {
    CipherResult.Failed(error.javaClass.name)
  }

  override fun encrypt(alias: String, aad: ByteArray, plain: ByteArray): CipherResult = try {
    val key = keyOf(alias)
    if (key == null) {
      missingOrFailed(alias)
    } else {
      val cipher = Cipher.getInstance(TRANSFORMATION)
      cipher.init(Cipher.ENCRYPT_MODE, key)
      cipher.updateAAD(aad)
      val sealed = cipher.doFinal(plain)
      CipherResult.Ok(cipher.iv + sealed)
    }
  } catch (error: KeyPermanentlyInvalidatedException) {
    CipherResult.Invalidated
  } catch (error: Exception) {
    CipherResult.Failed(error.javaClass.name)
  }

  override fun decrypt(alias: String, aad: ByteArray, ivAndCiphertext: ByteArray): CipherResult = try {
    val key = keyOf(alias)
    if (key == null) {
      missingOrFailed(alias)
    } else {
      val cipher = Cipher.getInstance(TRANSFORMATION)
      val iv = ivAndCiphertext.copyOfRange(0, VaultEnvelope.IV_LENGTH)
      cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, iv))
      cipher.updateAAD(aad)
      CipherResult.Ok(cipher.doFinal(ivAndCiphertext, VaultEnvelope.IV_LENGTH, ivAndCiphertext.size - VaultEnvelope.IV_LENGTH))
    }
  } catch (error: KeyPermanentlyInvalidatedException) {
    CipherResult.Invalidated
  } catch (error: AEADBadTagException) {
    CipherResult.BadTag
  } catch (error: Exception) {
    CipherResult.Failed(error.javaClass.name)
  }

  private fun keyOf(alias: String): SecretKey? = store.getKey(alias, null) as? SecretKey

  private fun missingOrFailed(alias: String): CipherResult = nullKeyResult(store.aliases().asSequence().any { it == alias })

  // Debug only: removes every vault alias.
  fun deleteAllVaultKeys() {
    for (alias in listKeys()) store.deleteEntry(alias)
  }
}
