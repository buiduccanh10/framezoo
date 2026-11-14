package com.framezoo.tv

import com.framezoo.tv.model.Media
import com.framezoo.tv.ui.normalizeSearchText
import com.framezoo.tv.ui.rankSearchResults
import org.junit.Assert.assertEquals
import org.junit.Test

class SearchRankingTest {
    @Test
    fun normalizeStripsVietnameseDiacriticsAndHandlesDStroke() {
        assertEquals("dao hai tac", normalizeSearchText("Đảo Hải Tặc"))
        assertEquals("nguoi nhen 2", normalizeSearchText("Người Nhện: 2!"))
    }

    @Test
    fun ranksExactPrefixWordAndOriginalTitleMatchesAheadOfPopularity() {
        val substringPopular = Media(
            id = "1",
            type = "movie",
            title = "Inside the Matrix Documentary",
            popularity = 999.0
        )
        val exactLocalized = Media(
            id = "2",
            type = "movie",
            title = "Ma Trận",
            originalTitle = "The Matrix",
            popularity = 10.0
        )
        val prefixMatch = Media(
            id = "3",
            type = "movie",
            title = "The Matrix Reloaded",
            popularity = 50.0
        )
        val ranked = rankSearchResults("the matrix", listOf(substringPopular, prefixMatch, exactLocalized))
        assertEquals(listOf("2", "3", "1"), ranked.map { it.id })
    }

    @Test
    fun usesPopularityAsTiebreakerWhenMatchScoresAreEqual() {
        val lowPop = Media(id = "a", type = "movie", title = "Dune: Part One", popularity = 20.0)
        val highPop = Media(id = "b", type = "movie", title = "Dune: Part Two", popularity = 200.0)
        val ranked = rankSearchResults("dune", listOf(lowPop, highPop))
        assertEquals(listOf("b", "a"), ranked.map { it.id })
    }
}
