package com.framezoo.tv

import com.framezoo.tv.model.BookmarkDetails
import com.framezoo.tv.model.Media
import com.framezoo.tv.ui.features.bookmarks.BookmarksUiState
import com.framezoo.tv.ui.features.settings.SettingsAction
import com.framezoo.tv.ui.features.settings.SettingsTab
import com.framezoo.tv.ui.features.settings.SettingsUiState
import org.junit.Assert.assertEquals
import org.junit.Test

class BookmarksUiStateTest {

    @Test
    fun testBookmarksFilteringByGroup() {
        val media1 = Media(id = "1", type = "movie", title = "Movie 1")
        val media2 = Media(id = "2", type = "movie", title = "Movie 2")
        val details = listOf(
            BookmarkDetails(media1, groups = listOf("Favorites"), favoriteEpisodes = emptyList()),
            BookmarkDetails(media2, groups = listOf("Action"), favoriteEpisodes = emptyList())
        )

        val stateNoFilter = BookmarksUiState(
            bookmarks = listOf(media1, media2),
            bookmarkDetails = details,
            selectedGroup = null
        )
        assertEquals(2, stateNoFilter.filteredBookmarks.size)

        val stateFavorites = stateNoFilter.copy(selectedGroup = "Favorites")
        assertEquals(1, stateFavorites.filteredBookmarks.size)
        assertEquals("1", stateFavorites.filteredBookmarks[0].id)
    }

    @Test
    fun testSettingsUiStateDefaults() {
        val defaultState = SettingsUiState()
        assertEquals(SettingsTab.PREFERENCES, defaultState.selectedTab)
        assertEquals("ember", defaultState.theme)
        assertEquals(100, defaultState.subtitleFontSize)
        assertEquals("#FFFFFF", defaultState.subtitleColor)
    }
}
