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
import com.framezoo.tv.model.Media
import com.framezoo.tv.ui.features.search.SearchAction
import com.framezoo.tv.ui.features.search.SearchUiState
import java.time.Year

@Composable
internal fun SearchScreen(
    uiState: SearchUiState,
    onAction: (SearchAction) -> Unit,
    onOpenMedia: (Media) -> Unit,
    isBookmarked: (String) -> Boolean = { false },
    onToggleBookmark: (Media) -> Unit = {},
    qualityLoader: (suspend (Media) -> String?)? = null,
    onNavigateDiscover: () -> Unit = {},
    onBack: () -> Unit,
    gridState: LazyGridState,
    searchAction: FocusRequester,
    inputModifier: Modifier = Modifier
) {
    val colors = LocalFrameZooColors.current
    val genreIds = uiState.results.flatMap { it.genreIds }.toSet()
    val genres = uiState.genres.filter { it.id in genreIds }
    val filtered = uiState.filteredResults

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
                        onBack()
                    }
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    OutlinedTextField(
                        value = uiState.query,
                        onValueChange = { onAction(SearchAction.QueryChanged(it)) },
                        label = { Text(t("home.search.placeholder.default")) },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                        keyboardActions = KeyboardActions(onSearch = {
                            searchAction.requestFocus()
                            onAction(SearchAction.ExecuteSearch)
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
                        onAction(SearchAction.ExecuteSearch)
                    }
                }

                // Filter row matching desktop FilterDropdowns
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    if (uiState.countries.isNotEmpty()) {
                        FilterMenu(t("discover.filters.country"), uiState.selectedCountry, uiState.countries) {
                            onAction(SearchAction.CountryChanged(it))
                        }
                    }
                    FilterMenu(t("home.bookmarks.edit.yearLabel"), uiState.selectedYear, (Year.now().value downTo 1900).map { DiscoverOption(it.toString(), it.toString()) }) {
                        onAction(SearchAction.YearChanged(it))
                    }
                    if (genres.isNotEmpty()) {
                        FilterMenu(t("discover.carousel.title.genres"), uiState.selectedGenre, genres) {
                            onAction(SearchAction.GenreChanged(it))
                        }
                    }
                }

                if (uiState.query.isNotBlank()) {
                    Text(
                        text = t("home.search.sectionTitle"),
                        style = MaterialTheme.typography.headlineSmall,
                        color = colors["type.emphasis"]
                    )
                }

                if (uiState.isLoading) {
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

                if (!uiState.errorMessage.isNullOrBlank()) {
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(uiState.errorMessage, color = colors["type.danger"])
                        TvButton(t("notFound.reloadButton")) { onAction(SearchAction.ExecuteSearch) }
                    }
                }
            }
        }

        // Skeleton loading items
        if (uiState.isLoading && filtered.isEmpty()) {
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
                TvMediaCard(
                    item = item,
                    onOpen = { onOpenMedia(item) },
                    bookmarked = isBookmarked(item.id),
                    onBookmark = { onToggleBookmark(item) },
                    qualityLoader = qualityLoader
                )
            }
        }

        // Search Suffix matching Desktop SearchSuffix in SearchListPart.tsx
        if (!uiState.isLoading && uiState.query.isNotBlank()) {
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
                            onNavigateDiscover()
                        }
                    } else if (uiState.errorMessage.isNullOrBlank()) {
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

@Composable
internal fun SearchScreen(
    state: FrameZooState,
    gridState: LazyGridState,
    searchAction: FocusRequester,
    inputModifier: Modifier
) {
    val genreIds = state.results.flatMap { it.genreIds }.toSet()
    val genres = state.genres.filter { it.id in genreIds }
    val filtered = filterSearchResults(state.results, state.searchCountry, state.searchYear, state.searchGenre)

    LaunchedEffect(state.query) {
        kotlinx.coroutines.delay(300)
        if (state.query.trim() != state.searchedQuery) state.search()
    }

    SearchScreen(
        uiState = SearchUiState(
            query = state.query,
            results = state.results,
            filteredResults = filtered,
            selectedCountry = state.searchCountry,
            selectedYear = state.searchYear,
            selectedGenre = state.searchGenre,
            genres = genres,
            countries = state.countries,
            isLoading = state.searchLoading,
            errorMessage = state.searchError.ifBlank { null }
        ),
        onAction = { action ->
            when (action) {
                is SearchAction.QueryChanged -> state.query = action.value
                is SearchAction.CountryChanged -> state.searchCountry = action.value
                is SearchAction.YearChanged -> state.searchYear = action.value
                is SearchAction.GenreChanged -> state.searchGenre = action.value
                is SearchAction.ClearFilters -> {
                    state.searchCountry = ""
                    state.searchYear = ""
                    state.searchGenre = ""
                }
                is SearchAction.ExecuteSearch -> state.search()
            }
        },
        onOpenMedia = { state.openDetails(it) },
        isBookmarked = { id -> state.bookmarks.any { it.id == id } },
        onToggleBookmark = { state.bookmark(it) },
        qualityLoader = state.backend::releaseQuality,
        onNavigateDiscover = { state.page = "discover" },
        onBack = { state.back() },
        gridState = gridState,
        searchAction = searchAction,
        inputModifier = inputModifier
    )
}
