package com.framezoo.tv.storage

import com.framezoo.tv.BuildConfig

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import java.net.URI
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class SecureStore(context: Context) {
    private val prefs = context.getSharedPreferences("framezoo_tv", Context.MODE_PRIVATE)
    private val alias = "framezoo_tv_session"

    var backendUrl: String
        get() = prefs.getString("backend", BuildConfig.BACKEND_URL) ?: BuildConfig.BACKEND_URL
        set(value) {
            val url = value.trim().trimEnd('/')
            val uri = try { URI(url) } catch (_: Exception) { throw IllegalArgumentException("Backend URL không hợp lệ") }
            require((uri.scheme == "https" || (BuildConfig.DEBUG && uri.scheme == "http")) &&
                !uri.host.isNullOrBlank() && uri.userInfo == null && uri.query == null && uri.fragment == null) {
                "Backend URL phải là HTTP(S) hợp lệ; bản release yêu cầu HTTPS"
            }
            if (backendUrl != url) clearSession()
            prefs.edit().putString("backend", url).apply()
        }

    var trailerEnabled: Boolean
        get() = prefs.getBoolean("trailerEnabled", true)
        set(value) { prefs.edit().putBoolean("trailerEnabled", value).apply() }

    var trailerMuted: Boolean
        get() = prefs.getBoolean("trailerMuted", true)
        set(value) { prefs.edit().putBoolean("trailerMuted", value).apply() }

    var theme: String
        get() = prefs.getString("theme", "ember") ?: "ember"
        set(value) { prefs.edit().putString("theme", value).apply() }

    var customPrimary: String
        get() = prefs.getString("customPrimary", "classic") ?: "classic"
        set(value) { prefs.edit().putString("customPrimary", value).apply() }

    var customSecondary: String
        get() = prefs.getString("customSecondary", "classic") ?: "classic"
        set(value) { prefs.edit().putString("customSecondary", value).apply() }

    var customTertiary: String
        get() = prefs.getString("customTertiary", "classic") ?: "classic"
        set(value) { prefs.edit().putString("customTertiary", value).apply() }

    var userId: String?
        get() = prefs.getString("user", null)
        set(value) { prefs.edit().putString("user", value).apply() }

    var accessToken: String?
        get() = decrypt(prefs.getString("access", null))
        set(value) { prefs.edit().putString("access", value?.let(::encrypt)).apply() }

    var refreshToken: String?
        get() = decrypt(prefs.getString("refresh", null))
        set(value) { prefs.edit().putString("refresh", value?.let(::encrypt)).apply() }

    fun clearSession() { prefs.edit().remove("user").remove("access").remove("refresh").apply() }

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        return generator.generateKey()
    }

    private fun encrypt(text: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        return Base64.encodeToString(cipher.iv + cipher.doFinal(text.toByteArray()), Base64.NO_WRAP)
    }

    private fun decrypt(text: String?): String? = try {
        if (text == null) null else {
            val raw = Base64.decode(text, Base64.NO_WRAP)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, raw.copyOfRange(0, 12)))
            String(cipher.doFinal(raw.copyOfRange(12, raw.size)), Charsets.UTF_8)
        }
    } catch (_: Exception) { null }
}
