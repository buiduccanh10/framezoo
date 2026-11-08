package com.framezoo.tv

import com.framezoo.tv.api.Addons
import com.framezoo.tv.model.Addon
import com.framezoo.tv.model.Stream
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
    }
}
