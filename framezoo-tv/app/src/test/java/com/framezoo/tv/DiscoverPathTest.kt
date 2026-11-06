package com.framezoo.tv

import com.framezoo.tv.api.discoverPath
import com.framezoo.tv.model.DiscoverFilter
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DiscoverPathTest {
    @Test fun constructsTmdbRequests() {
        assertEquals("/api/tmdb/trending/tv/week?language=vi-VN", discoverPath(DiscoverFilter(window = "week"), "trending", "tv"))
        assertEquals("/api/tmdb/trending/tv/week?language=vi-VN", discoverPath(DiscoverFilter(year = "2024", window = "week"), "trending", "tv"))
        val movie = discoverPath(DiscoverFilter(category = "genre:28", country = "VN", year = "2024"), "popular", "movie")
        assertTrue(movie.startsWith("/api/tmdb/discover/movie?"))
        assertTrue(movie.contains("with_origin_country=VN") && movie.contains("primary_release_year=2024") && movie.contains("with_genres=28"))
        val tv = discoverPath(DiscoverFilter(year = "2023"), "netflix", "tv")
        assertTrue(tv.contains("first_air_date_year=2023") && tv.contains("with_watch_providers=8") && tv.contains("watch_region=VN"))
    }
}
