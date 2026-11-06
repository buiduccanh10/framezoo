package com.framezoo.tv

import com.framezoo.tv.model.Media
import com.framezoo.tv.ui.filterSearchResults
import org.junit.Assert.assertEquals
import org.junit.Test

class SearchFiltersTest {
    @Test fun combinesCountryYearAndGenre() {
        val items = listOf(
            Media("1", "movie", "Match", year = "2024", originCountries = listOf("VN"), genreIds = listOf("28")),
            Media("2", "show", "Wrong year", year = "2023", originCountries = listOf("VN"), genreIds = listOf("28")),
            Media("3", "movie", "Wrong country", year = "2024", originCountries = listOf("US"), genreIds = listOf("28")),
            Media("4", "movie", "Wrong genre", year = "2024", originCountries = listOf("VN"), genreIds = listOf("18")),
        )
        assertEquals(listOf("1"), filterSearchResults(items, "VN", "2024", "28").map { it.id })
        assertEquals(items, filterSearchResults(items, "", "", ""))
    }
}
