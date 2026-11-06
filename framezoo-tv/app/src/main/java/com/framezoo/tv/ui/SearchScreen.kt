package com.framezoo.tv.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.framezoo.tv.R
import com.framezoo.tv.model.DiscoverOption
import java.time.Year
import kotlinx.coroutines.delay

@Composable
internal fun SearchScreen(
    state: FrameZooState,
    gridState: LazyGridState,
    searchAction: FocusRequester,
    inputModifier: Modifier
) {
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

    LazyVerticalGrid(
        columns = GridCells.Adaptive(174.dp),
        state = gridState,
        horizontalArrangement = Arrangement.spacedBy(18.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
        contentPadding = PaddingValues(start = 4.dp, end = 4.dp, top = 6.dp, bottom = 48.dp)
    ) {
        item(span = { GridItemSpan(maxLineSpan) }) {
            Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(
                        text = t("home.search.sectionTitle"),
                        style = MaterialTheme.typography.headlineLarge,
                        color = colors["type.emphasis"]
                    )
                    TvButton(
                        label = t("discover.page.back"),
                        icon = R.drawable.desktop_chevron_left,
                        navigation = true
                    ) {
                        state.back()
                    }
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    OutlinedTextField(
                        value = state.query,
                        onValueChange = { state.query = it },
                        label = { Text(t("home.search.placeholder.default")) },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                        keyboardActions = KeyboardActions(onSearch = {
                            searchAction.requestFocus()
                            state.search()
                        }),
                        colors = tvFieldColors(),
                        shape = RoundedCornerShape(28.dp),
                        modifier = Modifier
                            .fillMaxWidth(0.65f)
                            .then(inputModifier)
                    )

                    TvButton(
                        label = t("home.search.sectionTitle"),
                        icon = R.drawable.desktop_search,
                        modifier = Modifier.focusRequester(searchAction),
                        primary = true
                    ) {
                        state.search()
                    }
                }

                // Filter Menus: Country, Year, Genre
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterMenu(t("discover.filters.country"), state.searchCountry, state.countries) {
                        state.searchCountry = it
                    }
                    FilterMenu(t("home.bookmarks.edit.yearLabel"), state.searchYear, (Year.now().value downTo 1900).map { DiscoverOption(it.toString(), it.toString()) }) {
                        state.searchYear = it
                    }
                    if (genres.isNotEmpty()) {
                        FilterMenu(t("discover.carousel.title.genres"), state.searchGenre, genres) {
                            state.searchGenre = it
                        }
                    }
                }

                if (state.query.isNotBlank()) {
                    Text(
                        text = t("home.search.sectionTitle"),
                        style = MaterialTheme.typography.headlineSmall,
                        color = colors["type.emphasis"]
                    )
                }

                if (state.searchLoading) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        CircularProgressIndicator(
                            color = colors["type.logo"],
                            modifier = Modifier.size(20.dp),
                            strokeWidth = 2.dp
                        )
                        Text(t("home.search.loading"), color = colors["type.secondary"])
                    }
                }

                if (state.searchError.isNotBlank()) {
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(state.searchError, color = colors["type.danger"])
                        TvButton(t("notFound.reloadButton")) { state.search() }
                    }
                }
            }
        }

        // Skeleton loading items
        if (state.searchLoading && filtered.isEmpty()) {
            items(12) {
                Box(
                    modifier = Modifier
                        .width(174.dp)
                        .aspectRatio(2f / 3f)
                        .clip(RoundedCornerShape(12.dp))
                        .background(colors["background.secondary"].copy(alpha = 0.4f))
                )
            }
        } else {
            items(filtered, key = { "${it.type}:${it.id}:${it.addonManifest}" }) { item ->
                val key = "${item.type}:${item.id}:${item.addonManifest}"
                val focus = remember { FocusRequester() }
                LaunchedEffect(state.focusReturnMediaId) {
                    if (state.focusReturnMediaId == key) {
                        focus.requestFocus()
                        state.focusReturnMediaId = null
                    }
                }
                TvMediaCard(
                    item = item,
                    onOpen = state::openDetails,
                    bookmarked = state.bookmarks.any { it.id == item.id },
                    onBookmark = state::bookmark,
                    qualityLoader = state.backend::releaseQuality,
                    modifier = Modifier.focusRequester(focus)
                )
            }
        }

        // Search Suffix matching Desktop SearchSuffix in SearchListPart.tsx
        if (!state.searchLoading && state.query.isNotBlank()) {
            item(span = { GridItemSpan(maxLineSpan) }) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 36.dp, bottom = 20.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    if (filtered.isNotEmpty()) {
                        Text(
                            text = t("home.search.allResults"),
                            color = colors["type.secondary"],
                            fontSize = 16.sp
                        )
                        TvButton(
                            label = t("home.search.discoverMore"),
                            navigation = true
                        ) {
                            state.page = "discover"
                        }
                    } else if (state.searchError.isBlank()) {
                        Icon(
                            painter = painterResource(R.drawable.desktop_eye_slash),
                            contentDescription = null,
                            tint = colors["type.secondary"],
                            modifier = Modifier.size(36.dp)
                        )
                        Text(
                            text = t("home.search.noResults"),
                            color = colors["type.secondary"],
                            fontSize = 16.sp
                        )
                    }
                }
            }
        }
    }
}
