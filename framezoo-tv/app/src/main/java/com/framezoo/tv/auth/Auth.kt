package com.framezoo.tv.auth


import org.bouncycastle.crypto.digests.SHA256Digest
import org.bouncycastle.crypto.generators.PKCS5S2ParametersGenerator
import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters
import org.bouncycastle.crypto.params.KeyParameter
import org.bouncycastle.crypto.signers.Ed25519Signer
import java.util.Base64

object Auth {
    private fun base64Url(bytes: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)

    fun key(password: String): Ed25519PrivateKeyParameters {
        val pbkdf = PKCS5S2ParametersGenerator(SHA256Digest())
        pbkdf.init(password.toByteArray(Charsets.UTF_8), "mnemonic".toByteArray(), 2048)
        return Ed25519PrivateKeyParameters((pbkdf.generateDerivedParameters(256) as KeyParameter).key, 0)
    }

    fun publicKey(key: Ed25519PrivateKeyParameters): String = base64Url(key.generatePublicKey().encoded)

    fun signature(key: Ed25519PrivateKeyParameters, challenge: String): String {
        val signer = Ed25519Signer()
        signer.init(true, key)
        val bytes = challenge.toByteArray(Charsets.UTF_8)
        signer.update(bytes, 0, bytes.size)
        return base64Url(signer.generateSignature())
    }
}
