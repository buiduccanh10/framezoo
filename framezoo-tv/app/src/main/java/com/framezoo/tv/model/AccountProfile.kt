package com.framezoo.tv.model

import androidx.compose.ui.graphics.Color

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

/**
 * Mirrors framezoo-desktop `Account` and `AccountProfile` models (Avatar.tsx, LinksDropdown.tsx, stores/auth).
 */
data class AccountProfile(
    val colorA: String = "#6366F1",
    val colorB: String = "#EC4899",
    val icon: UserIcon = UserIcon.DEFAULT,
    val nickname: String = "",
    val userId: String? = null,
    val deviceName: String? = null
) {
    /**
     * Resolves display name matching desktop logic:
     * Nickname -> Decrypted Device Name -> Fallback string ("Thiết bị không xác định").
     * Truncated with ellipsis if >= 20 characters matching Desktop line 89-91 of Avatar.tsx.
     */
    fun displayName(fallback: String = "Thiết bị không xác định", truncate: Boolean = true): String {
        val raw = nickname.trim().takeIf { it.isNotEmpty() }
            ?: deviceName?.trim()?.takeIf { it.isNotEmpty() }
        if (raw != null) {
            return if (truncate && raw.length >= 20) "${raw.take(19)}…" else raw
        }
        return fallback
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
