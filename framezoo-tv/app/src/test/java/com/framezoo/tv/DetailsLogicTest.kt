package com.framezoo.tv

import com.framezoo.tv.ui.detailProviderAsset
import com.framezoo.tv.ui.detailEpisodeAired
import com.framezoo.tv.ui.initialDetailSeason
import java.time.LocalDate
import org.junit.Assert.*
import org.junit.Test

class DetailsLogicTest {
    @Test fun providerAssetsMatchDesktop() {
        assertEquals("prime", detailProviderAsset("Prime Video"))
        assertEquals("appletv", detailProviderAsset("Apple TV+"))
        assertEquals("newservice", detailProviderAsset("New Service"))
    }
    @Test fun episodeAvailabilityAndInitialSeason() {
        val today = LocalDate.of(2026, 11, 6)
        assertTrue(detailEpisodeAired("2026-11-06", today))
        assertTrue(detailEpisodeAired("2026-11-05", today))
        assertFalse(detailEpisodeAired("2026-11-07", today))
        assertFalse(detailEpisodeAired("", today))
        assertEquals(2, initialDetailSeason(listOf(1, 2), null, 2))
        assertEquals(1, initialDetailSeason(listOf(1, 2), 3, 4))
        assertEquals(1, initialDetailSeason(listOf(1, 2), 1, 2))
        assertNull(initialDetailSeason(emptyList(), 1, 2))
    }
}
