package com.framezoo.tv.storage

import com.framezoo.tv.BuildConfig

import android.content.Context
import android.os.Build
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

    val backendUrl: String = resolveBackendUrl(BuildConfig.BACKEND_URL)

    init {
        val lastBackend = prefs.getString("last_backend_url", null)
        if (lastBackend != null && lastBackend != backendUrl) {
            clearSession()
        }
        prefs.edit().putString("last_backend_url", backendUrl).remove("backend").apply()
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

    var language: String
        get() = prefs.getString("language", if (java.util.Locale.getDefault().language == "vi") "vi" else "en") ?: "vi"
        set(value) { prefs.edit().putString("language", value).apply() }

    var customPrimary: String
        get() = prefs.getString("customPrimary", "classic") ?: "classic"
        set(value) { prefs.edit().putString("customPrimary", value).apply() }

    var customSecondary: String
        get() = prefs.getString("customSecondary", "classic") ?: "classic"
        set(value) { prefs.edit().putString("customSecondary", value).apply() }

    var customTertiary: String
        get() = prefs.getString("customTertiary", "classic") ?: "classic"
        set(value) { prefs.edit().putString("customTertiary", value).apply() }

    var subtitleFontSize: Int
        get() = prefs.getInt("subFontSize", 100)
        set(value) { prefs.edit().putInt("subFontSize", value).apply() }

    var subtitleColor: String
        get() = prefs.getString("subColor", "#FFFFFF") ?: "#FFFFFF"
        set(value) { prefs.edit().putString("subColor", value).apply() }

    var subtitleBackgroundOpacity: Int
        get() = prefs.getInt("subBgOpacity", 50)
        set(value) { prefs.edit().putInt("subBgOpacity", value).apply() }

    var torrentCacheSize: String
        get() = prefs.getString("torrentCacheSize", "5gb") ?: "5gb"
        set(value) { prefs.edit().putString("torrentCacheSize", value).apply() }

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

internal fun resolveBackendUrl(rawUrl: String): String {
    val trimmed = rawUrl.trim().trimEnd('/')
    if (!BuildConfig.DEBUG) return trimmed
    return try {
        val uri = URI(trimmed)
        val host = uri.host ?: return trimmed
        if ((host == "localhost" || host == "127.0.0.1") && isEmulator()) {
            val port = if (uri.port != -1) ":${uri.port}" else ""
            "${uri.scheme}://10.0.2.2$port${uri.rawPath ?: ""}"
        } else {
            trimmed
        }
    } catch (_: Exception) {
        trimmed
    }
}

private fun isEmulator(): Boolean {
    return (Build.FINGERPRINT.startsWith("generic")
        || Build.FINGERPRINT.startsWith("unknown")
        || Build.MODEL.contains("google_sdk")
        || Build.MODEL.contains("Emulator")
        || Build.MODEL.contains("Android SDK built for x86")
        || Build.MANUFACTURER.contains("Genymotion")
        || Build.HARDWARE.contains("goldfish")
        || Build.HARDWARE.contains("ranchu")
        || Build.PRODUCT.contains("sdk")
        || Build.PRODUCT.contains("google_sdk")
        || Build.PRODUCT.contains("sdk_x86")
        || Build.PRODUCT.contains("vbox86p")
        || Build.PRODUCT.contains("emulator")
        || Build.PRODUCT.contains("simulator"))
}
