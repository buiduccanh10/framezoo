package com.framezoo.tv

import com.framezoo.tv.model.Stream
import com.framezoo.tv.ui.detectStreamQualityCategory
import com.framezoo.tv.ui.findPreferredStream
import com.framezoo.tv.ui.streamPreference
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class StreamPreferenceTest {
    @Test fun choosesSameBingeGroupOrBestReleaseForNextEpisode() {
        val previous = Stream("Torrentio\n1080p", "magnet:old", title = "Dexter.S02E07.1080p.BluRay.PSA.mkv", addonId = "torrentio", bingeGroup = "1080")
        val differentAddon = previous.copy(addonId = "other")
        val group = previous.copy(url = "magnet:new", title = "Dexter.S02E08.1080p.BluRay.PSA.mkv")
        val differentQuality = group.copy(name = "Torrentio\n4K", title = "Dexter.S02E08.2160p.BluRay.PSA.mkv", bingeGroup = "4k")
        assertEquals(group, findPreferredStream(listOf(differentAddon, differentQuality, group), streamPreference(previous)))
        val rotatedGroup = group.copy(bingeGroup = "rotated")
        assertEquals(rotatedGroup, findPreferredStream(listOf(differentQuality, rotatedGroup), streamPreference(previous)))
        assertNull(findPreferredStream(listOf(differentAddon), streamPreference(previous)))
    }

    @Test fun qualityUsesExplicitResolutionRatherThanUhdLabel() {
        assertEquals("1080p", detectStreamQualityCategory(Stream("UHD 1080p", "https://example.test/video")))
        assertEquals("1440p", detectStreamQualityCategory(Stream("QHD", "https://example.test/video")))
        assertEquals("4k", detectStreamQualityCategory(Stream("2160p", "https://example.test/video")))
    }
}
