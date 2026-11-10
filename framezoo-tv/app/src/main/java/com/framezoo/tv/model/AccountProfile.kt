package com.framezoo.tv.model

import androidx.compose.ui.graphics.Color
import com.framezoo.tv.auth.Auth

/**
 * Parses hex color strings safely (supports 3, 6, 8 hex digits, e.g. #RGB, #RRGGBB, #AARRGGBB).
 */
fun parseHexColor(hex: String?, fallback: Color): Color {
    if (hex.isNullOrBlank()) return fallback
    return try {
        val clean = hex.trim().removePrefix("#")
        when (clean.length) {
            3 -> {
                val r = clean.substring(0, 1).repeat(2).toInt(16)
                val g = clean.substring(1, 2).repeat(2).toInt(16)
                val b = clean.substring(2, 3).repeat(2).toInt(16)
                Color(r, g, b)
            }
            6 -> Color(clean.toLong(16) or 0x00000000FF000000L)
            8 -> Color(clean.toLong(16))
            else -> fallback
        }
    } catch (_: Exception) {
        fallback
    }
}

fun resolveDisplayName(
    nickname: String?,
    rawDeviceName: String?,
    seedBase64: String?,
    unknownDeviceLabel: String = "Thiết bị không xác định",
    truncate: Boolean = true
): String {
    val nick = nickname?.trim()?.takeIf { it.isNotEmpty() }
    if (nick != null) {
        return if (truncate && nick.length >= 20) "${nick.take(19)}…" else nick
    }
    if (!rawDeviceName.isNullOrBlank() && !seedBase64.isNullOrBlank()) {
        try {
            val seed = Auth.fromBase64(seedBase64)
            val decrypted = Auth.decryptData(rawDeviceName, seed).trim()
            if (decrypted.isNotEmpty()) {
                return if (truncate && decrypted.length >= 20) "${decrypted.take(19)}…" else decrypted
            }
        } catch (_: Exception) {}
    }
    val fallback = rawDeviceName?.trim()?.takeIf { it.isNotEmpty() && !it.contains(".") } ?: unknownDeviceLabel
    if (fallback == unknownDeviceLabel) return unknownDeviceLabel
    return if (truncate && fallback.length >= 20) "${fallback.take(19)}…" else fallback
}

/**
 * Mirrors framezoo-desktop `Account` and `AccountProfile` models (Avatar.tsx, LinksDropdown.tsx, stores/auth).
 */
data class AccountProfile(
    val colorA: String = "#6366F1",
    val colorB: String = "#EC4899",
    val icon: UserIcon = UserIcon.DEFAULT,
    val nickname: String = "",
    val email: String? = null,
    val userId: String? = null,
    val deviceName: String? = null,
    val seedBase64: String? = null
) {
    /**
     * Resolves display name matching desktop logic:
     * Nickname -> Decrypted Device Name -> Fallback string ("Thiết bị không xác định").
     * Truncated with ellipsis if >= 20 characters matching Desktop line 89-91 of Avatar.tsx.
     */
    fun displayName(fallback: String = "Thiết bị không xác định", truncate: Boolean = true): String {
        return resolveDisplayName(nickname, deviceName, seedBase64, fallback, truncate)
    }

    /**
     * Resolves the start and end colors for the linear gradient avatar background.
     */
    fun gradientColors(): Pair<Color, Color> {
        val start = parseHexColor(colorA, Color(0xFF6366F1))
        val end = parseHexColor(colorB, Color(0xFFEC4899))
        return start to end
    }
}

/**
 * Mirrors `OtpChallengeResponse` in `framezoo-desktop/renderer-src/src/backend/accounts/emailOtp.ts`.
 */
data class OtpChallenge(
    val challengeId: String,
    val expiresIn: Int = 600,
    val resendAfter: Int = 60,
    val message: String = ""
)

/**
 * Mirrors `SessionResponse` and `DeviceListPart.tsx` device item in `framezoo-desktop`.
 */
data class DeviceSession(
    val id: String,
    val userId: String,
    val createdAt: String,
    val accessedAt: String,
    val rawDevice: String,
    val userAgent: String,
    val isCurrent: Boolean,
    val displayName: String,
    val subtitle: String
)

fun resolveDeviceSession(
    id: String,
    userId: String,
    createdAt: String,
    accessedAt: String,
    rawDevice: String,
    userAgent: String,
    currentSessionId: String?,
    seedBase64: String?,
    unknownDeviceLabel: String = "Thiết bị không xác định"
): DeviceSession {
    val decrypted = if (!seedBase64.isNullOrBlank() && rawDevice.contains(".")) {
        runCatching { Auth.decryptData(rawDevice, Auth.fromBase64(seedBase64)) }.getOrNull()
    } else {
        rawDevice.takeIf { it.isNotBlank() && !it.contains(".") }
    }

    val ua = userAgent
    val os = when {
        ua.contains("Android", ignoreCase = true) -> "Android"
        ua.contains("Windows", ignoreCase = true) -> "Windows"
        ua.contains("Mac OS", ignoreCase = true) || ua.contains("Macintosh", ignoreCase = true) -> "macOS"
        ua.contains("iPhone", ignoreCase = true) || ua.contains("iPad", ignoreCase = true) -> "iOS"
        ua.contains("Linux", ignoreCase = true) -> "Linux"
        else -> ""
    }
    val browser = when {
        ua.contains("Electron", ignoreCase = true) || ua.contains("Framezoo", ignoreCase = true) -> "Framezoo Desktop"
        ua.contains("Edg/", ignoreCase = true) -> "Edge"
        ua.contains("Chrome/", ignoreCase = true) -> "Chrome"
        ua.contains("Firefox/", ignoreCase = true) -> "Firefox"
        ua.contains("Safari/", ignoreCase = true) -> "Safari"
        else -> ""
    }

    val hasCustomName = !decrypted.isNullOrBlank() && decrypted != "Browser"
    val displayName = when {
        hasCustomName -> decrypted!!
        browser.isNotBlank() && os.isNotBlank() -> "$browser · $os"
        browser.isNotBlank() -> browser
        os.isNotBlank() -> os
        else -> unknownDeviceLabel
    }

    val subtitleParts = buildList {
        if (browser.isNotBlank() && !displayName.contains(browser, ignoreCase = true)) add(browser)
        if (os.isNotBlank() && !displayName.contains(os, ignoreCase = true)) add(os)
        if (isEmpty()) add(if (os == "Android") "Android TV" else "Desktop")
    }

    return DeviceSession(
        id = id,
        userId = userId,
        createdAt = createdAt,
        accessedAt = accessedAt,
        rawDevice = rawDevice,
        userAgent = userAgent,
        isCurrent = id == currentSessionId,
        displayName = displayName,
        subtitle = subtitleParts.joinToString(" · ")
    )
}
