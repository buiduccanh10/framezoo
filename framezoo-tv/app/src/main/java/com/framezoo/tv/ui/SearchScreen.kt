package com.framezoo.tv.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items as rowItems
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Border as TvBorder
import androidx.tv.material3.ClickableSurfaceDefaults as TvSurfaceDefaults
import androidx.tv.material3.IconButton as TvIconButton
import androidx.tv.material3.IconButtonDefaults as TvIconButtonDefaults
import androidx.tv.material3.Surface as TvSurface
import com.framezoo.tv.R
import com.framezoo.tv.model.DiscoverOption
import com.framezoo.tv.model.Media
import com.framezoo.tv.ui.features.search.SearchAction
import com.framezoo.tv.ui.features.search.SearchUiState
import java.time.Year
import java.util.Calendar

internal fun getTimeOfDayKey(): String {
    val cal = Calendar.getInstance()
    val hour = cal.get(Calendar.HOUR_OF_DAY)
    val month = cal.get(Calendar.MONTH) + 1
    val day = cal.get(Calendar.DAY_OF_MONTH)
    if (month == 4 && day == 20) return "home.titles.420.default"
    if (month == 6 && day == 9) return "home.titles.69.default"
    if (month == 10 && day == 31) return "home.titles.halloween.default"
    return when {
        hour < 5 -> "home.titles.night.default"
        hour < 12 -> "home.titles.morning.default"
        hour < 19 -> "home.titles.day.default"
        else -> "home.titles.night.default"
    }
}

/**
 * Desktop-matching IconPatch circular button badge.
 */
@Composable
internal fun IconPatch(
    icon: Int,
    contentColor: Color,
    modifier: Modifier = Modifier,
    size: androidx.compose.ui.unit.Dp = 48.dp,
    iconSize: androidx.compose.ui.unit.Dp = 22.dp,
    backgroundColor: Color = LocalFrameZooColors.current["pill.background"]
) {
    Box(
        modifier = modifier
            .size(size)
            .clip(CircleShape)
            .background(backgroundColor),
        contentAlignment = Alignment.Center
    ) {
        Icon(
            painter = painterResource(icon),
            contentDescription = null,
            tint = contentColor,
            modifier = Modifier.size(iconSize)
        )
    }
}

/**
 * Desktop-matching Pill Search Bar (SearchBarInput.tsx).
 */
@Composable
internal fun TvSearchBar(
    query: String,
    onQueryChange: (String) -> Unit,
    onSearch: () -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = t("home.search.placeholder.default")
) {
    val colors = LocalFrameZooColors.current
    var isFocused by remember { mutableStateOf(false) }
    val shape = RoundedCornerShape(28.dp)
    val background by animateColorAsState(
        if (isFocused) colors["search.focused"] else colors["search.background"],
        tween(250),
        label = "searchBarBg"
    )
    val borderColor by animateColorAsState(
        if (isFocused) colors["type.logo"] else Color.White.copy(alpha = 0.12f),
        tween(250),
        label = "searchBarBorder"
    )

    Surface(
        shape = shape,
        color = background,
        border = BorderStroke(if (isFocused) 2.dp else 1.dp, borderColor),
        modifier = modifier
            .fillMaxWidth()
            .height(48.dp)
            .clip(shape)
    ) {
        Row(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 18.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                painter = painterResource(R.drawable.desktop_search),
                contentDescription = null,
                tint = if (isFocused) colors["type.logo"] else colors["search.icon"],
                modifier = Modifier.size(22.dp)
            )

            Spacer(Modifier.width(14.dp))

            Box(
                modifier = Modifier.weight(1f),
                contentAlignment = Alignment.CenterStart
            ) {
                if (query.isEmpty()) {
                    Text(
                        text = placeholder,
                        color = colors["search.placeholder"],
                        fontSize = 16.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }

                BasicTextField(
                    value = query,
                    onValueChange = onQueryChange,
                    singleLine = true,
                    textStyle = TextStyle(
                        color = colors["search.text"],
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Normal
                    ),
                    cursorBrush = SolidColor(colors["type.logo"]),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                    keyboardActions = KeyboardActions(onSearch = { onSearch() }),
                    modifier = Modifier
                        .fillMaxWidth()
                        .onFocusChanged { isFocused = it.isFocused }
                )
            }

            if (query.isNotEmpty()) {
                Spacer(Modifier.width(8.dp))
                TvIconButton(
                    onClick = { onQueryChange("") },
                    modifier = Modifier.size(32.dp),
                    colors = TvIconButtonDefaults.colors(
                        containerColor = colors["pill.background"].copy(alpha = 0.6f),
                        focusedContainerColor = colors["type.logo"]
                    ),
                    scale = TvIconButtonDefaults.scale(focusedScale = 1.08f),
                    border = TvIconButtonDefaults.border(focusedBorder = TvBorder(BorderStroke(2.dp, Color.White), shape = CircleShape)),
                    shape = TvIconButtonDefaults.shape(CircleShape)
                ) {
                    Icon(
                        painter = painterResource(R.drawable.desktop_close),
                        contentDescription = "Clear",
                        tint = Color.White,
                        modifier = Modifier.size(12.dp)
                    )
                }
            }
        }
    }
}

/**
 * Desktop-matching Genre Filter Chip (rounded-full pill button).
 */
@Composable
internal fun GenreFilterChip(
    label: String,
    selected: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    val colors = LocalFrameZooColors.current
    var focused by remember { mutableStateOf(false) }
    val shape = RoundedCornerShape(50)
    val background by animateColorAsState(
        if (selected) colors["type.logo"]
        else if (focused) colors["pill.activeBackground"]
        else colors["pill.background"].copy(alpha = 0.65f),
        tween(200),
        label = "chipBg"
    )
    val textColor = if (selected || focused) Color.White else colors["type.secondary"]

    TvSurface(
        onClick = onClick,
        shape = TvSurfaceDefaults.shape(shape),
        colors = TvSurfaceDefaults.colors(
            containerColor = background,
            focusedContainerColor = if (selected) colors["type.logo"] else colors["pill.activeBackground"]
        ),
        scale = TvSurfaceDefaults.scale(focusedScale = 1.05f),
        border = TvSurfaceDefaults.border(
            focusedBorder = TvBorder(
                BorderStroke(2.dp, if (selected) Color.White else colors["type.logo"]),
                shape = shape
            )
        ),
        modifier = modifier.height(36.dp).onFocusChanged { focused = it.isFocused }
    ) {
        Box(
            modifier = Modifier.padding(horizontal = 16.dp),
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = label,
                color = textColor,
                fontSize = 13.sp,
                fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium
            )
        }
    }
}

/**
 * Desktop-matching Dropdown Filter Pill for Country / Year.
 */
@Composable
internal fun DropdownFilterPill(
    label: String,
    selectedId: String,
    options: List<DiscoverOption>,
    modifier: Modifier = Modifier,
    onSelect: (String) -> Unit
) {
    val colors = LocalFrameZooColors.current
    val allLabel = t("discover.tabs.all")
    var expanded by remember { mutableStateOf(false) }
    val selectedName = options.firstOrNull { it.id == selectedId }?.name
    val displayText = if (selectedId.isNotBlank() && selectedName != null) "$label: $selectedName" else label
    val isSelected = selectedId.isNotBlank()
    val focusBorderColor = if (isSelected) Color.White else colors["type.logo"]

    Box(modifier) {
        TvSurface(
            onClick = { expanded = true },
            shape = TvSurfaceDefaults.shape(RoundedCornerShape(50)),
            colors = TvSurfaceDefaults.colors(
                containerColor = colors["mediaCard.hoverBackground"],
                focusedContainerColor = colors["pill.activeBackground"]
            ),
            scale = TvSurfaceDefaults.scale(focusedScale = 1.05f),
            border = TvSurfaceDefaults.border(
                focusedBorder = TvBorder(BorderStroke(2.dp, focusBorderColor), shape = RoundedCornerShape(50))
            ),
            modifier = Modifier.height(36.dp)
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                Text(
                    text = displayText,
                    color = colors["type.secondary"],
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Medium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Icon(
                    painter = painterResource(R.drawable.desktop_up_down_arrow),
                    contentDescription = null,
                    tint = colors["dropdown.secondary"],
                    modifier = Modifier.size(11.dp)
                )
            }
        }

        DropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
            modifier = Modifier
                .heightIn(max = 350.dp)
                .background(colors["pill.background"])
        ) {
            TvButton(
                label = "$allLabel $label",
                modifier = Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 2.dp),
                navigation = true
            ) {
                onSelect("")
                expanded = false
            }
            options.forEach { option ->
                TvButton(
                    label = option.name,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 2.dp),
                    navigation = true,
                    selected = option.id == selectedId
                ) {
                    onSelect(option.id)
                    expanded = false
                }
            }
        }
    }
}

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
    val genreIds = remember(uiState.results) { uiState.results.flatMap { it.genreIds }.toSet() }
    val genres = remember(uiState.genres, genreIds) { uiState.genres.filter { it.id in genreIds } }
    val filtered = uiState.filteredResults
    val timeGreetingKey = remember { getTimeOfDayKey() }
    val continueWatching = remember(uiState.progressItems, uiState.watchingSortBy) {
        val filteredItems = uiState.progressItems.filter { it.duration > 0 && it.position > 0 && (it.position / it.duration) < 0.95 }
        when (uiState.watchingSortBy) {
            "titleAsc" -> filteredItems.sortedBy { it.media.title.lowercase() }
            "titleDesc" -> filteredItems.sortedByDescending { it.media.title.lowercase() }
            "yearAsc" -> filteredItems.sortedBy { it.media.year.toIntOrNull() ?: 0 }
            "yearDesc" -> filteredItems.sortedByDescending { it.media.year.toIntOrNull() ?: 0 }
            else -> filteredItems
        }
    }

    LazyVerticalGrid(
        columns = GridCells.Adaptive(174.dp),
        state = gridState,
        horizontalArrangement = Arrangement.spacedBy(18.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
        contentPadding = PaddingValues(start = 4.dp, end = 4.dp, top = 6.dp, bottom = 48.dp),
        modifier = Modifier.fillMaxSize()
    ) {
        item(span = { GridItemSpan(maxLineSpan) }) {
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(if (uiState.query.isBlank()) 10.dp else 18.dp)
            ) {
                // When query is blank: Desktop HeroTitle ("What would you like to watch this afternoon?")
                if (uiState.query.isBlank()) {
                    Text(
                        text = t(timeGreetingKey),
                        style = MaterialTheme.typography.headlineMedium.copy(
                            fontWeight = FontWeight.Bold,
                            fontSize = 28.sp
                        ),
                        color = Color.White,
                        textAlign = TextAlign.Center,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 24.dp)
                    )
                }

                // Centered Desktop-style SearchBar
                Box(
                    modifier = Modifier.fillMaxWidth(),
                    contentAlignment = Alignment.Center
                ) {
                    TvSearchBar(
                        query = uiState.query,
                        onQueryChange = { onAction(SearchAction.QueryChanged(it)) },
                        onSearch = { onAction(SearchAction.ExecuteSearch) },
                        modifier = Modifier
                            .fillMaxWidth(if (uiState.query.isBlank()) 0.72f else 1f)
                            .then(inputModifier)
                    )
                }

                // When searching, show SectionHeading and Desktop Filter Bar
                if (uiState.query.isNotBlank()) {
                    Spacer(Modifier.height(6.dp))

                    // SectionHeading (Matching Desktop SectionHeading.tsx)
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        Icon(
                            painter = painterResource(R.drawable.desktop_search),
                            contentDescription = null,
                            tint = colors["type.logo"],
                            modifier = Modifier.size(20.dp)
                        )
                        Text(
                            text = t("home.search.sectionTitle").uppercase(),
                            color = colors["type.emphasis"],
                            fontWeight = FontWeight.Bold,
                            fontSize = 15.sp,
                            letterSpacing = 1.sp
                        )
                    }

                    // Desktop-matching Filter Bar (Genre Chips + Divider + Country/Year Dropdowns)
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .focusRequester(searchAction),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        // Horizontal scrollable genre filter chips
                        LazyRow(
                            modifier = Modifier.weight(1f),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            item {
                                GenreFilterChip(
                                    label = t("home.search.genreFilterAll"),
                                    selected = uiState.selectedGenre.isBlank(),
                                    onClick = { onAction(SearchAction.GenreChanged("")) }
                                )
                            }
                            rowItems(genres, key = { it.id }) { genre ->
                                GenreFilterChip(
                                    label = genre.name,
                                    selected = uiState.selectedGenre == genre.id,
                                    onClick = { onAction(SearchAction.GenreChanged(genre.id)) }
                                )
                            }
                        }

                        // Divider line matching Desktop w-px h-6 bg-white/10
                        Box(
                            modifier = Modifier
                                .padding(horizontal = 12.dp)
                                .width(1.dp)
                                .height(22.dp)
                                .background(Color.White.copy(alpha = 0.15f))
                        )

                        // Country Dropdown
                        if (uiState.countries.isNotEmpty()) {
                            DropdownFilterPill(
                                label = t("discover.filters.country"),
                                selectedId = uiState.selectedCountry,
                                options = uiState.countries
                            ) {
                                onAction(SearchAction.CountryChanged(it))
                            }
                            Spacer(Modifier.width(8.dp))
                        }

                        // Year Dropdown
                        DropdownFilterPill(
                            label = t("home.bookmarks.edit.yearLabel"),
                            selectedId = uiState.selectedYear,
                            options = (Year.now().value downTo 1900).map { DiscoverOption(it.toString(), it.toString()) }
                        ) {
                            onAction(SearchAction.YearChanged(it))
                        }
                    }
                }

                // Loading Indicator bar if searching
                if (uiState.isLoading) {
                    Row(
                        modifier = Modifier.padding(vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        CircularProgressIndicator(
                            color = colors["type.logo"],
                            modifier = Modifier.size(18.dp),
                            strokeWidth = 2.dp
                        )
                        Text(
                            text = t("home.search.loading"),
                            color = colors["type.secondary"],
                            fontSize = 14.sp
                        )
                    }
                }

                // Error Message bar if error occurred
                if (!uiState.errorMessage.isNullOrBlank()) {
                    Row(
                        modifier = Modifier.padding(vertical = 4.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(uiState.errorMessage, color = colors["type.danger"], fontSize = 14.sp)
                        TvButton(t("notFound.reloadButton")) { onAction(SearchAction.ExecuteSearch) }
                    }
                }
            }
        }

        // When query is blank: Desktop Home/Search content (WatchingCarousel + Trending)
        if (uiState.query.isBlank()) {
            if (continueWatching.isNotEmpty()) {
                item(span = { GridItemSpan(maxLineSpan) }) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 8.dp, bottom = 4.dp)
                    ) {
                        // Section Heading matching Desktop SectionHeading.tsx (Clock icon + Title + Edit Button)
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 4.dp, vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(
                                painter = painterResource(R.drawable.desktop_clock),
                                contentDescription = null,
                                tint = colors["type.emphasis"],
                                modifier = Modifier.size(18.dp)
                            )
                            Spacer(Modifier.width(10.dp))
                            Text(
                                text = t("home.continueWatching.sectionTitle").uppercase(),
                                color = colors["type.emphasis"],
                                fontWeight = FontWeight.Bold,
                                fontSize = 15.sp,
                                letterSpacing = 1.sp
                            )
                            Spacer(Modifier.weight(1f))

                            // Desktop Edit Pencil Button
                            val editShape = RoundedCornerShape(50)
                            var editFocused by remember { mutableStateOf(false) }
                            TvSurface(
                                onClick = { onAction(SearchAction.ToggleEditingWatching) },
                                shape = TvSurfaceDefaults.shape(editShape),
                                colors = TvSurfaceDefaults.colors(
                                    containerColor = if (uiState.editingWatching) colors["type.logo"] else colors["mediaCard.hoverBackground"],
                                    focusedContainerColor = colors["pill.activeBackground"]
                                ),
                                scale = TvSurfaceDefaults.scale(focusedScale = 1.08f),
                                border = TvSurfaceDefaults.border(
                                    focusedBorder = TvBorder(BorderStroke(2.dp, if (uiState.editingWatching) Color.White else colors["type.logo"]), shape = editShape)
                                ),
                                modifier = Modifier
                                    .size(36.dp)
                                    .onFocusChanged { editFocused = it.isFocused }
                            ) {
                                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                                    Icon(
                                        painter = painterResource(R.drawable.desktop_edit),
                                        contentDescription = "Edit",
                                        tint = if (uiState.editingWatching || editFocused) Color.White else colors["type.secondary"],
                                        modifier = Modifier.size(16.dp)
                                    )
                                }
                            }
                        }

                        // Sorting dropdown when editing
                        if (uiState.editingWatching) {
                            val sortOptions = listOf(
                                DiscoverOption("date", t("home.continueWatching.sorting.options.date")),
                                DiscoverOption("titleAsc", t("home.continueWatching.sorting.options.titleAsc")),
                                DiscoverOption("titleDesc", t("home.continueWatching.sorting.options.titleDesc")),
                                DiscoverOption("yearAsc", t("home.continueWatching.sorting.options.yearAsc")),
                                DiscoverOption("yearDesc", t("home.continueWatching.sorting.options.yearDesc"))
                            )
                            DropdownFilterPill(
                                label = sortOptions.firstOrNull { it.id == uiState.watchingSortBy }?.name ?: t("home.continueWatching.sorting.options.date"),
                                selectedId = uiState.watchingSortBy,
                                options = sortOptions,
                                modifier = Modifier.padding(start = 4.dp, top = 4.dp, bottom = 8.dp)
                            ) { newSort ->
                                onAction(SearchAction.ChangeWatchingSort(newSort))
                            }
                        }

                        // Horizontal Continue Watching Carousel (LazyRow matching WatchingCarousel.tsx)
                        LazyRow(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(16.dp),
                            contentPadding = PaddingValues(horizontal = 4.dp, vertical = 6.dp)
                        ) {
                            rowItems(continueWatching, key = { "watching:${it.media.id}:${it.season}:${it.episode}" }) { libItem ->
                                val progressVal = if (libItem.duration > 0) (libItem.position / libItem.duration).toFloat().coerceIn(0f, 1f) else null
                                TvMediaCard(
                                    item = libItem.media,
                                    onOpen = {
                                        if (uiState.editingWatching) {
                                            onAction(SearchAction.RemoveProgressItem(libItem))
                                        } else {
                                            onOpenMedia(libItem.media)
                                        }
                                    },
                                    progress = progressVal,
                                    season = libItem.season,
                                    episode = libItem.episode,
                                    closable = uiState.editingWatching,
                                    onClose = { onAction(SearchAction.RemoveProgressItem(libItem)) },
                                    bookmarked = isBookmarked(libItem.media.id),
                                    onBookmark = onToggleBookmark,
                                    qualityLoader = qualityLoader
                                )
                            }
                        }
                    }
                }
            }

            // Trending / Recommended row below continue watching (or as primary discover row)
            if (uiState.recommendedMedia.isNotEmpty()) {
                item(span = { GridItemSpan(maxLineSpan) }) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 8.dp, bottom = 4.dp)
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 4.dp, vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            Icon(
                                painter = painterResource(R.drawable.desktop_film),
                                contentDescription = null,
                                tint = colors["type.emphasis"],
                                modifier = Modifier.size(18.dp)
                            )
                            Text(
                                text = t("discover.carousel.title.trending").uppercase(),
                                color = colors["type.emphasis"],
                                fontWeight = FontWeight.Bold,
                                fontSize = 15.sp,
                                letterSpacing = 1.sp
                            )
                        }

                        LazyRow(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(16.dp),
                            contentPadding = PaddingValues(horizontal = 4.dp, vertical = 6.dp)
                        ) {
                            rowItems(uiState.recommendedMedia, key = { "rec:${it.type}:${it.id}" }) { item ->
                                TvMediaCard(
                                    item = item,
                                    onOpen = { onOpenMedia(item) },
                                    bookmarked = isBookmarked(item.id),
                                    onBookmark = onToggleBookmark,
                                    qualityLoader = qualityLoader
                                )
                            }
                        }
                    }
                }
            } else if (continueWatching.isEmpty()) {
                item(span = { GridItemSpan(maxLineSpan) }) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 40.dp, bottom = 40.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(14.dp)
                    ) {
                        IconPatch(
                            icon = R.drawable.desktop_search,
                            contentColor = colors["type.logo"],
                            size = 54.dp,
                            iconSize = 26.dp
                        )
                        Text(
                            text = t("home.search.empty.default"),
                            color = colors["type.secondary"],
                            fontSize = 17.sp,
                            fontWeight = FontWeight.Normal
                        )
                    }
                }
            }
        }

        // Skeleton loading items
        if (uiState.isLoading && filtered.isEmpty() && uiState.query.isNotBlank()) {
            items(12) {
                TvMediaCardSkeleton()
            }
        } else if (uiState.query.isNotBlank()) {
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
                    verticalArrangement = Arrangement.spacedBy(14.dp)
                ) {
                    if (filtered.isNotEmpty()) {
                        Text(
                            text = t("home.search.allResults"),
                            color = colors["type.dimmed"],
                            fontSize = 16.sp
                        )
                        TvSurface(
                            onClick = onNavigateDiscover,
                            shape = TvSurfaceDefaults.shape(RoundedCornerShape(12.dp)),
                            colors = TvSurfaceDefaults.colors(
                                containerColor = colors["largeCard.background"],
                                focusedContainerColor = colors["pill.activeBackground"]
                            ),
                            scale = TvSurfaceDefaults.scale(focusedScale = 1.05f),
                            border = TvSurfaceDefaults.border(
                                focusedBorder = TvBorder(BorderStroke(2.dp, colors["type.logo"]), shape = RoundedCornerShape(12.dp))
                            ),
                            modifier = Modifier.height(42.dp)
                        ) {
                            Box(
                                modifier = Modifier.padding(horizontal = 24.dp),
                                contentAlignment = Alignment.Center
                            ) {
                                Text(
                                    text = t("home.search.discoverMore"),
                                    color = colors["type.dimmed"],
                                    fontSize = 15.sp,
                                    fontWeight = FontWeight.Bold
                                )
                            }
                        }
                    } else if (uiState.errorMessage.isNullOrBlank()) {
                        IconPatch(
                            icon = R.drawable.desktop_eye_slash,
                            contentColor = colors["type.logo"],
                            size = 54.dp,
                            iconSize = 26.dp
                        )
                        Text(
                            text = t("home.search.noResults"),
                            color = colors["type.secondary"],
                            fontSize = 16.sp
                        )
                    } else {
                        IconPatch(
                            icon = R.drawable.desktop_warning,
                            contentColor = colors["type.danger"],
                            size = 54.dp,
                            iconSize = 26.dp
                        )
                        Text(
                            text = t("home.search.failed"),
                            color = colors["type.danger"],
                            fontSize = 16.sp
                        )
                        Spacer(Modifier.height(4.dp))
                        TvButton(
                            label = t("notFound.reloadButton"),
                            primary = true
                        ) {
                            onAction(SearchAction.ExecuteSearch)
                        }
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
    var editingWatching by remember { mutableStateOf(false) }
    var watchingSortBy by remember { mutableStateOf("date") }

    val genreIds = remember(state.results) { state.results.flatMap { it.genreIds }.toSet() }
    val genres = remember(state.genres, genreIds) { state.genres.filter { it.id in genreIds } }
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
            errorMessage = state.searchError.ifBlank { null },
            progressItems = state.progress,
            editingWatching = editingWatching,
            watchingSortBy = watchingSortBy,
            recommendedMedia = state.discover.take(15)
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
                is SearchAction.ToggleEditingWatching -> editingWatching = !editingWatching
                is SearchAction.ChangeWatchingSort -> watchingSortBy = action.sort
                is SearchAction.RemoveProgressItem -> state.removeProgressItem(action.item)
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
