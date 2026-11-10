package com.framezoo.tv

import com.framezoo.tv.api.ReleaseDate
import com.framezoo.tv.api.releaseQuality
import com.framezoo.tv.api.releaseQualityLabel
import com.framezoo.tv.api.showCinemaBadge
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ReleaseQualityTest {
    @Test fun cardBadgeOnlyShowsForTheatricalMovies() {
        assertTrue(showCinemaBadge("movie", "CAM"))
        assertFalse(showCinemaBadge("movie", "HD"))
        assertFalse(showCinemaBadge("show", "CAM"))
        assertFalse(showCinemaBadge("movie", null))
    }
    @Test fun usesPreferredRegionsAndDigitalBeforeTheatrical() {
        val now = Instant.parse("2026-06-01T00:00:00Z")
        fun date(country: String, type: Int, value: String) = ReleaseDate(country, type, Instant.parse(value))
        val dates = listOf(date("VN", 4, "2026-01-01T00:00:00Z"), date("US", 4, "2026-07-01T00:00:00Z"), date("GB", 3, "2026-02-01T00:00:00Z"))
        assertEquals("CAM", releaseQuality(dates, now))
        assertEquals("HD", releaseQuality(dates, Instant.parse("2026-08-01T00:00:00Z")))
        assertNull(releaseQuality(dates, Instant.parse("2025-01-01T00:00:00Z")))
        assertEquals("CAM", releaseQualityLabel("1080p HDCAM"))
        assertEquals("HD", releaseQualityLabel("WEB-DL 1080p"))
    }
}
