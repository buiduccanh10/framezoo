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

    @Test fun supportsDesktopRowsAndPagination() {
        val provider = discoverPath(DiscoverFilter(category = "tv", year = "2022", country = "VN"), "provider", "tv", provider = "350", page = 2)
        assertTrue(provider.contains("with_watch_providers=350") && provider.contains("watch_region=US"))
        assertTrue(provider.contains("page=2") && provider.contains("first_air_date_year=2022"))
        val genre = discoverPath(DiscoverFilter(), "genre", "movie", genre = "28")
        assertTrue(genre.contains("/discover/movie?") && genre.contains("with_genres=28"))
        val latest = discoverPath(DiscoverFilter(year = "2024"), "latest", "tv")
        assertTrue(latest.contains("sort_by=first_air_date.desc"))
    }
}
