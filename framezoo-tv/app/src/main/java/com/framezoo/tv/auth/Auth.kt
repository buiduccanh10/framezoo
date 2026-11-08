package com.framezoo.tv.auth

import org.bouncycastle.crypto.digests.SHA256Digest
import org.bouncycastle.crypto.generators.PKCS5S2ParametersGenerator
import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters
import org.bouncycastle.crypto.params.KeyParameter
import org.bouncycastle.crypto.signers.Ed25519Signer
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

object Auth {
    private val PASSWORD_REGEX = Regex("^(?=.*[A-Za-z])(?=.*\\d)[A-Za-z\\d\\W_]{8,}$")
    private val PASSPHRASE_REGEX = Regex("^[a-zA-Z0-9\\s\\-_.,!?@#$%^&*()+=:;\"'<>\\[\\]{}|\\\\/`~]+$")
    private val secureRandom = SecureRandom()

    private fun base64Url(bytes: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    fun base64(bytes: ByteArray): String = Base64.getEncoder().encodeToString(bytes)
    fun fromBase64(b64: String): ByteArray = Base64.getDecoder().decode(b64)

    fun seed(password: String): ByteArray {
        val pbkdf = PKCS5S2ParametersGenerator(SHA256Digest())
        pbkdf.init(password.toByteArray(Charsets.UTF_8), "mnemonic".toByteArray(Charsets.UTF_8), 2048)
        return (pbkdf.generateDerivedParameters(256) as KeyParameter).key
    }

    fun key(password: String): Ed25519PrivateKeyParameters = Ed25519PrivateKeyParameters(seed(password), 0)

    fun publicKey(key: Ed25519PrivateKeyParameters): String = base64Url(key.generatePublicKey().encoded)

    fun signature(key: Ed25519PrivateKeyParameters, challenge: String): String {
        val signer = Ed25519Signer()
        signer.init(true, key)
        val bytes = challenge.toByteArray(Charsets.UTF_8)
        signer.update(bytes, 0, bytes.size)
        return base64Url(signer.generateSignature())
    }

    /**
     * Mirrors `encryptData(data, secret)` in `framezoo-desktop/renderer-src/src/backend/accounts/crypto.ts`.
     * Format: `base64(iv).base64(encryptedData).base64(tag)` using 16-byte IV and AES-256-GCM.
     */
    fun encryptData(data: String, secret: ByteArray): String {
        require(secret.size == 32) { "Secret must be 256-bit" }
        val iv = ByteArray(16).also(secureRandom::nextBytes)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(secret, "AES"), GCMParameterSpec(128, iv))
        val encrypted = cipher.doFinal(data.toByteArray(Charsets.UTF_8))
        val encryptedData = encrypted.copyOfRange(0, encrypted.size - 16)
        val tag = encrypted.copyOfRange(encrypted.size - 16, encrypted.size)
        return "${base64(iv)}.${base64(encryptedData)}.${base64(tag)}"
    }

    /**
     * Mirrors `decryptData(data, secret)` in `framezoo-desktop/renderer-src/src/backend/accounts/crypto.ts`.
     */
    fun decryptData(data: String, secret: ByteArray): String {
        require(secret.size == 32) { "Secret must be 256-bit" }
        val parts = data.split(".")
        require(parts.size == 3 && parts.all { it.isNotBlank() }) { "Invalid encrypted data" }
        val iv = fromBase64(parts[0])
        val encryptedData = fromBase64(parts[1])
        val tag = fromBase64(parts[2])
        val ciphertext = encryptedData + tag
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(secret, "AES"), GCMParameterSpec(128, iv))
        return String(cipher.doFinal(ciphertext), Charsets.UTF_8)
    }

    fun verifyValidPassword(password: String): Boolean = PASSWORD_REGEX.matches(password)

    fun verifyValidMnemonic(mnemonic: String): Boolean =
        mnemonic.length >= 8 && PASSPHRASE_REGEX.matches(mnemonic)
}
