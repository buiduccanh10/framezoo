package com.framezoo.tv

import com.framezoo.tv.model.LibraryItem
import com.framezoo.tv.model.Media
import com.framezoo.tv.ui.personalSources
import org.junit.Assert.assertEquals
import org.junit.Test

class PersonalRecommendationsTest {
    @Test fun choosesRecentDistinctSourcesAndRespectsTypeAndLimits() {
        fun media(id: String, type: String = "movie") = Media(id, type, id)
        val history = (1..7).map { LibraryItem(media("$it"), watchedAt = "2026-01-0$it") } +
            LibraryItem(media("99", "show"), watchedAt = "2026-02-01")
        val progress = listOf(LibraryItem(media("7")), LibraryItem(media("8")), LibraryItem(media("9")))
        assertEquals(listOf("7", "6", "5", "4", "3", "8", "10"),
            personalSources("movie", history, progress, listOf(media("10"), media("11"))).map { it.id })
    }
}
