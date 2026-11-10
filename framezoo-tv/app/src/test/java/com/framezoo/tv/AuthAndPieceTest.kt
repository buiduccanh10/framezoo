package com.framezoo.tv

import com.framezoo.tv.auth.Auth
import com.framezoo.tv.model.mapPiece
import com.framezoo.tv.model.resolveDeviceSession
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AuthAndPieceTest {
    @Test fun loginVectorMatchesMobile() {
        val key = Auth.key("correct horse battery staple")
        assertEquals("h_73RkyU6DvKcBl3qDkbkYxLgM06v3xBEc7kgcrSQX0", Auth.publicKey(key))
        assertEquals("3j_AJ7GoQutrXz4viOqA77KhovEuG4bqabqreDW0wryBocP8WzoiIFjlgPPANVCvB_pnjufhYX2XCG5x14dDDA", Auth.signature(key, "framezoo-tv-test"))
    }

    @Test fun mapsBoundaryBytesToPieces() {
        assertEquals(0, mapPiece(0, 4 * 1024 * 1024))
        assertEquals(0, mapPiece(4L * 1024 * 1024 - 1, 4 * 1024 * 1024))
        assertEquals(1, mapPiece(4L * 1024 * 1024, 4 * 1024 * 1024))
    }

    @Test fun encryptAndDecryptDeviceDataMatchesDesktopFormat() {
        val seed = Auth.seed("correct horse battery staple")
        val encrypted = Auth.encryptData("Android TV", seed)
        assertEquals(3, encrypted.split(".").size)
        val decrypted = Auth.decryptData(encrypted, seed)
        assertEquals("Android TV", decrypted)
    }

    @Test fun passwordValidationMatchesDesktopRules() {
        assertTrue(Auth.verifyValidPassword("Password123"))
        assertTrue(Auth.verifyValidPassword("alllowercase123"))
        assertTrue(Auth.verifyValidMnemonic("correct horse battery staple"))
        assertFalse(Auth.verifyValidPassword("short1A"))
        assertFalse(Auth.verifyValidPassword("1234567890"))
        assertFalse(Auth.verifyValidPassword("NoNumbersHere"))
        assertFalse(Auth.verifyValidMnemonic("   "))
    }

    @Test fun resolveDeviceSessionDecryptsAndParsesBrowserAndOs() {
        val seed = Auth.seed("correct horse battery staple")
        val encryptedName = Auth.encryptData("Living Room TV", seed)
        val session = resolveDeviceSession(
            id = "sess-1",
            userId = "user-1",
            createdAt = "2026-11-08T00:00:00Z",
            accessedAt = "2026-11-08T01:00:00Z",
            rawDevice = encryptedName,
            userAgent = "Mozilla/5.0 (Linux; Android 14; TV) Chrome/120.0.0.0",
            currentSessionId = "sess-1",
            seedBase64 = Auth.base64(seed)
        )
        assertEquals("Living Room TV", session.displayName)
        assertTrue(session.subtitle.contains("Chrome"))
        assertTrue(session.subtitle.contains("Android"))
        assertTrue(session.isCurrent)
    }
}
