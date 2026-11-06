package com.framezoo.tv.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.framezoo.tv.R
import com.framezoo.tv.model.DiscoverOption
import java.time.Year
import kotlinx.coroutines.delay

@Composable
internal fun SearchScreen(state: FrameZooState, gridState: LazyGridState, searchAction: FocusRequester, inputModifier: Modifier) {
    val colors = LocalFrameZooColors.current
    val genreIds = state.results.flatMap { it.genreIds }.toSet()
    val genres = state.genres.filter { it.id in genreIds }
    LaunchedEffect(state.query) {
        delay(300)
        if (state.query.trim() != state.searchedQuery) state.search()
    }
    val filtered = filterSearchResults(state.results, state.searchCountry, state.searchYear, state.searchGenre)
    LaunchedEffect(state.focusReturnMediaId) {
        val key = state.focusReturnMediaId ?: return@LaunchedEffect
        val index = filtered.indexOfFirst { "${it.type}:${it.id}:${it.addonManifest}" == key }
        if (index >= 0) gridState.scrollToItem(index + 1) else state.focusReturnMediaId = null
    }
    LazyVerticalGrid(GridCells.Adaptive(174.dp), state = gridState, horizontalArrangement = Arrangement.spacedBy(18.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp), contentPadding = PaddingValues(start = 4.dp, end = 4.dp, top = 6.dp, bottom = 48.dp)) {
        item(span = { GridItemSpan(maxLineSpan) }) {
            Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Text(t("global.pages.search"), style = MaterialTheme.typography.headlineLarge)
                OutlinedTextField(state.query, { state.query = it }, label = { Text(t("home.search.placeholder.default")) }, singleLine = true,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                    keyboardActions = KeyboardActions(onSearch = { searchAction.requestFocus(); state.search() }),
                    colors = tvFieldColors(), shape = RoundedCornerShape(28.dp), modifier = Modifier.fillMaxWidth(.6f).then(inputModifier))
                TvButton(t("home.search.sectionTitle"), icon = R.drawable.desktop_search, modifier = Modifier.focusRequester(searchAction), primary = true) { state.search() }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterMenu(t("discover.filters.country"), state.searchCountry, state.countries) { state.searchCountry = it }
                    FilterMenu(t("home.bookmarks.edit.yearLabel"), state.searchYear, (Year.now().value downTo 1900).map { DiscoverOption(it.toString(), it.toString()) }) { state.searchYear = it }
                    if (genres.isNotEmpty()) FilterMenu(t("discover.carousel.title.genres"), state.searchGenre, genres) { state.searchGenre = it }
                }
                Text(t("home.search.sectionTitle"), style = MaterialTheme.typography.headlineSmall)
                when {
                    state.searchLoading -> Text(t("home.search.loading"), color = colors["type.secondary"])
                    state.searchError.isNotBlank() -> Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text(state.searchError, color = colors["type.danger"]); TvButton(t("notFound.reloadButton")) { state.search() }
                    }
                    filtered.isEmpty() -> Text(t("home.search.noResults"), color = colors["type.secondary"])
                }
            }
        }
        items(filtered, key = { "${it.type}:${it.id}:${it.addonManifest}" }) { item ->
            val key = "${item.type}:${item.id}:${item.addonManifest}"
            val focus = remember { FocusRequester() }
            LaunchedEffect(state.focusReturnMediaId) { if (state.focusReturnMediaId == key) { focus.requestFocus(); state.focusReturnMediaId = null } }
            TvMediaCard(item, state::openDetails, bookmarked = state.bookmarks.any { it.id == item.id },
                onBookmark = state::bookmark, qualityLoader = state.backend::releaseQuality, modifier = Modifier.focusRequester(focus))
        }
    }
}
