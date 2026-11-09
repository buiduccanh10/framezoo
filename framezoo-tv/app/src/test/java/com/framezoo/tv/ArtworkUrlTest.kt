package com.framezoo.tv

import com.framezoo.tv.api.tmdbImageUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ArtworkUrlTest {
    @Test fun missingAndExistingArtwork() {
        assertNull(tmdbImageUrl(null))
        assertNull(tmdbImageUrl("null"))
        assertNull(tmdbImageUrl(""))
        assertEquals("https://image.tmdb.org/t/p/w500/poster.jpg", tmdbImageUrl("/poster.jpg"))
        assertEquals("https://example.com/poster.jpg", tmdbImageUrl("https://example.com/poster.jpg"))
    }
}
