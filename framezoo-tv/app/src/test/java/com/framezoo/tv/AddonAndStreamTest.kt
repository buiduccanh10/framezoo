package com.framezoo.tv

import com.framezoo.tv.api.Addons
import com.framezoo.tv.api.ComplianceBlocklist
import com.framezoo.tv.api.isAddonDomainBlocked
import com.framezoo.tv.api.isMediaBlockedByTakedown
import com.framezoo.tv.model.Addon
import com.framezoo.tv.model.Stream
import com.framezoo.tv.player.hexInfoHashToUrlEncodedBytes
import com.framezoo.tv.player.parseCompactPeersFromBencode
import com.framezoo.tv.ui.detectStreamQualityCategory
import com.framezoo.tv.ui.formatStreamBytes
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AddonAndStreamTest {

    @Test
    fun testNativeSubtitleAddonConstantMatchesDesktop() {
        assertEquals("community.framezoo.subtitles", Addons.NATIVE_SUBTITLE_ADDON_ID)
    }

    @Test
    fun testAddonModelProperties() {
        val nativeAddon = Addon(
            manifestUrl = "https://framezoo.top/addon/subtitles/manifest.json",
            id = Addons.NATIVE_SUBTITLE_ADDON_ID,
            name = "Framezoo Subtitles",
            resources = setOf("subtitles"),
            enabled = true,
            version = "1.0.0",
            description = "Native subtitle provider (Wyzie, OpenSubtitles, SubSource, Granite)",
            isNative = true
        )
        assertTrue(nativeAddon.isNative)
        assertEquals("1.0.0", nativeAddon.version)
        assertNotNull(nativeAddon.description)
        assertEquals(setOf("subtitles"), nativeAddon.resources)
    }

    @Test
    fun testStreamModelPreservesTorrentMetadata() {
        val stream = Stream(
            name = "Torrentio\n4k HDR",
            url = "magnet:?xt=urn:btih:abcdef1234567890abcdef1234567890abcdef12",
            infoHash = "abcdef1234567890abcdef1234567890abcdef12",
            filename = "Colony.2024.2160p.WEB-DL.mkv",
            title = "Bầy Xác Sống (2024) 2160p WEB-DL\n👤 45  💾 14.2 GB  ⚙️ FLUX",
            description = "DDP5.1 Atmos H.265",
            videoSize = 15247133696L, // ~14.2 GB
            addonName = "Torrentio"
        )

        assertEquals("Torrentio\n4k HDR", stream.name)
        assertEquals("Bầy Xác Sống (2024) 2160p WEB-DL\n👤 45  💾 14.2 GB  ⚙️ FLUX", stream.title)
        assertEquals("DDP5.1 Atmos H.265", stream.description)
        assertEquals(15247133696L, stream.videoSize)
        assertEquals("Torrentio", stream.addonName)
        assertEquals("abcdef1234567890abcdef1234567890abcdef12", stream.infoHash)
        assertEquals("4k", detectStreamQualityCategory(stream))
        assertEquals("14.2 GB", formatStreamBytes(stream.videoSize))
    }

    @Test
    fun testCompactPeersAndInfoHashEncoding() {
        val encoded = hexInfoHashToUrlEncodedBytes("abcdef1234567890abcdef1234567890abcdef12")
        assertEquals("%ab%cd%ef%12%34%56%78%90%ab%cd%ef%12%34%56%78%90%ab%cd%ef%12", encoded)
        assertTrue(Addons.DEFAULT_TRACKERS.isEmpty())

        // Build compact bencode payload: d8:intervali1800e5:peers6:<1.2.3.4:6881>e
        val prefix = "d8:intervali1800e5:peers6:".toByteArray(Charsets.ISO_8859_1)
        val peerBytes = byteArrayOf(1, 2, 3, 4, 0x1A, 0xE1.toByte()) // 1.2.3.4:6881
        val suffix = "e".toByteArray(Charsets.ISO_8859_1)
        val payload = prefix + peerBytes + suffix
        val peers = parseCompactPeersFromBencode(payload)
        assertEquals(listOf("1.2.3.4" to 6881), peers)
    }

    @Test
    fun testComplianceBlocklistMatchers() {
        val blocked = ComplianceBlocklist(
            addonDomains = setOf("bad-addon.example"),
            tmdbIds = setOf("tv:999", "movie:123"),
            imdbIds = setOf("tt7654321"),
            infohashes = setOf("abcdef1234567890abcdef1234567890abcdef12")
        )
        assertTrue(isAddonDomainBlocked("https://sub.bad-addon.example/manifest.json", blocked.addonDomains))
        assertTrue(!isAddonDomainBlocked("https://good-addon.example/manifest.json", blocked.addonDomains))
        assertTrue(isMediaBlockedByTakedown("123", null, "movie", blocked))
        assertTrue(isMediaBlockedByTakedown("999", null, "show", blocked))
        assertTrue(isMediaBlockedByTakedown("555", "tt7654321", "movie", blocked))
        assertTrue(!isMediaBlockedByTakedown("999", null, "movie", blocked))
    }
}
