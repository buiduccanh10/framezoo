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
        get() = prefs.getString("language", "vi") ?: "vi"
        set(value) { prefs.edit().putString("language", value).apply() }

    var enableAutoplay: Boolean
        get() = prefs.getBoolean("enableAutoplay", true)
        set(value) { prefs.edit().putBoolean("enableAutoplay", value).apply() }

    var enableSkipCredits: Boolean
        get() = prefs.getBoolean("enableSkipCredits", true)
        set(value) { prefs.edit().putBoolean("enableSkipCredits", value).apply() }

    var enableAutoSkipSegments: Boolean
        get() = prefs.getBoolean("enableAutoSkipSegments", true)
        set(value) { prefs.edit().putBoolean("enableAutoSkipSegments", value).apply() }

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

    var subtitleBackgroundBlurEnabled: Boolean
        get() = prefs.getBoolean("subBgBlurEnabled", false)
        set(value) { prefs.edit().putBoolean("subBgBlurEnabled", value).apply() }

    var subtitleFontStyle: String
        get() = prefs.getString("subFontStyle", "default") ?: "default"
        set(value) { prefs.edit().putString("subFontStyle", value).apply() }

    var subtitleBold: Boolean
        get() = prefs.getBoolean("subBold", false)
        set(value) { prefs.edit().putBoolean("subBold", value).apply() }

    var subtitleVerticalPosition: Int
        get() = prefs.getInt("subVerticalPosition", 1)
        set(value) { prefs.edit().putInt("subVerticalPosition", value).apply() }

    var torrentCacheSize: String
        get() = prefs.getString("torrentCacheSize", "5gb") ?: "5gb"
        set(value) { prefs.edit().putString("torrentCacheSize", value).apply() }

    var torrentProfile: String
        get() = prefs.getString("torrentProfile", "default") ?: "default"
        set(value) { prefs.edit().putString("torrentProfile", value).apply() }

    var localProgress: String?
        get() = prefs.getString("local_progress", null)
        set(value) { prefs.edit().putString("local_progress", value).apply() }

    var userId: String?
        get() = prefs.getString("user", null)
        set(value) { prefs.edit().putString("user", value).apply() }

    var userSessionId: String?
        get() = prefs.getString("user_session_id", null)
        set(value) { prefs.edit().putString("user_session_id", value).apply() }

    var userEmail: String?
        get() = prefs.getString("user_email", null)
        set(value) { prefs.edit().putString("user_email", value).apply() }

    var userNickname: String?
        get() = prefs.getString("user_nickname", null)
        set(value) { prefs.edit().putString("user_nickname", value).apply() }

    var userDeviceName: String?
        get() = prefs.getString("user_device_name", null)
        set(value) { prefs.edit().putString("user_device_name", value).apply() }

    var userProfileColorA: String?
        get() = prefs.getString("user_profile_color_a", null)
        set(value) { prefs.edit().putString("user_profile_color_a", value).apply() }

    var userProfileColorB: String?
        get() = prefs.getString("user_profile_color_b", null)
        set(value) { prefs.edit().putString("user_profile_color_b", value).apply() }

    var userProfileIcon: String?
        get() = prefs.getString("user_profile_icon", null)
        set(value) { prefs.edit().putString("user_profile_icon", value).apply() }

    var userSeed: String?
        get() = decrypt(prefs.getString("user_seed", null))
        set(value) { prefs.edit().putString("user_seed", value?.let(::encrypt)).apply() }

    var accessToken: String?
        get() = decrypt(prefs.getString("access", null))
        set(value) { prefs.edit().putString("access", value?.let(::encrypt)).apply() }

    var refreshToken: String?
        get() = decrypt(prefs.getString("refresh", null))
        set(value) { prefs.edit().putString("refresh", value?.let(::encrypt)).apply() }

    var rememberLogin: Boolean
        get() = prefs.getBoolean("remember_login", false)
        set(value) { prefs.edit().putBoolean("remember_login", value).apply() }

    var rememberedIdentifier: String?
        get() = prefs.getString("remembered_identifier", null)
        set(value) { prefs.edit().putString("remembered_identifier", value).apply() }

    var rememberedPassword: String?
        get() = decrypt(prefs.getString("remembered_password", null))
        set(value) { prefs.edit().putString("remembered_password", value?.let(::encrypt)).apply() }

    fun saveRememberedCredentials(identifier: String, password: String) {
        rememberLogin = true
        rememberedIdentifier = identifier
        rememberedPassword = password
    }

    fun clearRememberedCredentials() {
        prefs.edit()
            .putBoolean("remember_login", false)
            .remove("remembered_identifier")
            .remove("remembered_password")
            .apply()
    }

    fun clearSession() {
        prefs.edit()
            .remove("user")
            .remove("user_session_id")
            .remove("user_email")
            .remove("user_seed")
            .remove("access")
            .remove("refresh")
            .remove("user_nickname")
            .remove("user_device_name")
            .remove("user_profile_color_a")
            .remove("user_profile_color_b")
            .remove("user_profile_icon")
            .apply()
    }
    fun clearLocalProgress() { prefs.edit().remove("local_progress").apply() }

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
