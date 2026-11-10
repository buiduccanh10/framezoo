package com.framezoo.tv

import androidx.compose.ui.graphics.Color
import com.framezoo.tv.model.AccountProfile
import com.framezoo.tv.model.UserIcon
import com.framezoo.tv.model.parseHexColor
import org.junit.Assert.assertEquals
import org.junit.Test

class AccountProfileTest {

    @Test
    fun testDisplayNameResolution() {
        val withNickname = AccountProfile(nickname = "buiduccanh10")
        assertEquals("buiduccanh10", withNickname.displayName())

        val withLongNickname = AccountProfile(nickname = "ThisIsAVeryLongAccountNicknameThatShouldBeTruncated")
        // Truncated if length >= 20 to 19 chars + …
        assertEquals("ThisIsAVeryLongAcco…", withLongNickname.displayName())

        val withDeviceFallback = AccountProfile(nickname = "", deviceName = "Living Room TV")
        assertEquals("Living Room TV", withDeviceFallback.displayName())

        val withDefaultFallback = AccountProfile(nickname = "", deviceName = "")
        assertEquals("Thiết bị không xác định", withDefaultFallback.displayName())
    }

    @Test
    fun testHexColorParser() {
        val fallback = Color(0xFF112233)

        // 6-digit hex
        val red = parseHexColor("#FF0000", fallback)
        assertEquals(Color(0xFFFF0000), red)

        // 3-digit hex
        val white = parseHexColor("#FFF", fallback)
        assertEquals(Color(0xFFFFFFFF), white)

        // 8-digit hex
        val semi = parseHexColor("#80FF0000", fallback)
        assertEquals(Color(0x80FF0000), semi)

        // Invalid or null hex
        assertEquals(fallback, parseHexColor(null, fallback))
        assertEquals(fallback, parseHexColor("", fallback))
        assertEquals(fallback, parseHexColor("not_a_hex", fallback))
    }

    @Test
    fun testGradientColorsResolution() {
        val profile = AccountProfile(
            colorA = "#FF0000",
            colorB = "#00FF00",
            icon = UserIcon.CAT_FACE
        )
        val (start, end) = profile.gradientColors()
        assertEquals(Color(0xFFFF0000), start)
        assertEquals(Color(0xFF00FF00), end)
    }
}
