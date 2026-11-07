package com.framezoo.tv.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.Crossfade
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandHorizontally
import androidx.compose.animation.shrinkHorizontally
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items as gridItems
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.input.key.onPreviewKeyEvent
import android.view.KeyEvent
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import coil.compose.SubcomposeAsyncImage
import coil.ImageLoader
import coil.decode.SvgDecoder
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.foundation.Image
import androidx.tv.material3.Border as TvBorder
import androidx.tv.material3.Surface as TvSurface
import androidx.tv.material3.ClickableSurfaceDefaults as TvSurfaceDefaults
import androidx.tv.material3.IconButton as TvIconButton
import androidx.tv.material3.IconButtonDefaults as TvIconButtonDefaults
import com.framezoo.tv.R
import com.framezoo.tv.model.DiscoverOption
import com.framezoo.tv.model.AddonCatalog
import com.framezoo.tv.model.Media
import com.framezoo.tv.model.FeaturedRatings
import com.framezoo.tv.model.LibraryItem
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.Year

private data class QuickActionItem(val icon: Int, val label: String, val destination: String, val requester: FocusRequester)

@Composable
internal fun DiscoverHeader(state: FrameZooState, modifier: Modifier = Modifier) {
    val colors = LocalFrameZooColors.current
    var expanded by remember { mutableStateOf(false) }
    var accountExpanded by remember { mutableStateOf(false) }
    val logoFocusRequester = remember { FocusRequester() }
    val menuFocusRequester = remember { FocusRequester() }
    val searchFocusRequester = remember { FocusRequester() }
    val bookmarksFocusRequester = remember { FocusRequester() }
    val historyFocusRequester = remember { FocusRequester() }
    val addonsFocusRequester = remember { FocusRequester() }
    val feedbackFocusRequester = remember { FocusRequester() }
    val settingsFocusRequester = remember { FocusRequester() }
    val accountFocusRequester = remember { FocusRequester() }

    BackHandler(enabled = expanded) {
        expanded = false
        try { menuFocusRequester.requestFocus() } catch (_: Exception) {}
    }

    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        val brandShape = RoundedCornerShape(50)
        TvSurface(
            onClick = { state.page = "discover" },
            shape = TvSurfaceDefaults.shape(brandShape),
            modifier = Modifier
                .height(42.dp)
                .focusRequester(logoFocusRequester)
                .focusProperties { right = menuFocusRequester },
            colors = TvSurfaceDefaults.colors(
                containerColor = colors["pill.background"].copy(alpha = 0.85f),
                focusedContainerColor = colors["pill.activeBackground"]
            ),
            scale = TvSurfaceDefaults.scale(focusedScale = 1f),
            border = TvSurfaceDefaults.border(focusedBorder = TvBorder(BorderStroke(2.dp, colors["type.logo"]), shape = brandShape))
        ) {
            Image(
                painterResource(R.drawable.framezoo_brand),
                "FrameZoo",
                Modifier.padding(horizontal = 14.dp, vertical = 7.dp).height(28.dp).width(97.dp)
            )
        }

        Spacer(Modifier.width(10.dp))

        Row(
            modifier = Modifier.onFocusChanged { focusState ->
                expanded = focusState.hasFocus
            },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            val menuRotation by animateFloatAsState(if (expanded) 90f else 0f, tween(300), label = "menu rotation")
            HeaderButton(
                icon = R.drawable.desktop_menu,
                label = "Menu",
                selected = expanded,
                rotation = menuRotation,
                modifier = Modifier
                    .focusRequester(menuFocusRequester)
                    .focusProperties {
                        left = logoFocusRequester
                        right = if (expanded) searchFocusRequester else accountFocusRequester
                    }
            ) {
                expanded = !expanded
                if (expanded) {
                    try { searchFocusRequester.requestFocus() } catch (_: Exception) {}
                }
            }

            AnimatedVisibility(
                visible = expanded,
                enter = fadeIn(tween(200)) + expandHorizontally(tween(250)),
                exit = fadeOut(tween(150)) + shrinkHorizontally(tween(200))
            ) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    val quickActions = listOf(
                        QuickActionItem(R.drawable.desktop_search, t("home.search.sectionTitle"), "search", searchFocusRequester),
                        QuickActionItem(R.drawable.desktop_bookmark, t("home.bookmarks.sectionTitle"), "library", bookmarksFocusRequester),
                        QuickActionItem(R.drawable.desktop_clock, t("home.watchHistory.sectionTitle"), "history", historyFocusRequester),
                        QuickActionItem(R.drawable.desktop_extension, t("navigation.menu.addons"), "addons", addonsFocusRequester),
                        QuickActionItem(R.drawable.desktop_feedback, t("navigation.menu.feedback"), "feedback", feedbackFocusRequester),
                        QuickActionItem(R.drawable.desktop_settings, t("navigation.menu.settings"), "settings", settingsFocusRequester)
                    )
                    quickActions.forEachIndexed { index, item ->
                        val itemModifier = Modifier
                            .focusRequester(item.requester)
                            .focusProperties {
                                left = if (index == 0) menuFocusRequester else quickActions[index - 1].requester
                                right = if (index == quickActions.lastIndex) accountFocusRequester else quickActions[index + 1].requester
                            }
                        HeaderButton(
                            icon = item.icon,
                            label = item.label,
                            selected = state.page == item.destination,
                            modifier = itemModifier
                        ) {
                            expanded = false
                            when (item.destination) {
                                "library" -> state.openLibrary()
                                "history" -> state.openHistory()
                                "addons" -> state.openAddons()
                                "feedback" -> state.openFeedback()
                                else -> state.page = item.destination
                            }
                        }
                    }
                }
            }
        }
        Spacer(Modifier.weight(1f))
        Box {
            TvButton(
                if (state.store.userId == null) t("auth.login.submit") else t("settings.account.title"),
                selected = state.page == "login",
                navigation = true,
                modifier = Modifier
                    .focusRequester(accountFocusRequester)
                    .focusProperties {
                        left = if (expanded) settingsFocusRequester else menuFocusRequester
                    }
            ) { accountExpanded = true }
            DropdownMenu(accountExpanded, { accountExpanded = false }, Modifier.background(colors["pill.background"])) {
                TvButton(if (state.store.userId == null) t("auth.login.submit") else t("settings.account.title"), navigation = true, modifier = Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 2.dp)) { accountExpanded = false; state.openLogin() }
                TvButton(t("home.watchHistory.sectionTitle"), navigation = true, modifier = Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 2.dp)) { accountExpanded = false; state.openHistory() }
                TvButton(t("home.bookmarks.sectionTitle"), navigation = true, modifier = Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 2.dp)) { accountExpanded = false; state.openLibrary() }
                TvButton(t("navigation.menu.addons"), navigation = true, modifier = Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 2.dp)) { accountExpanded = false; state.openAddons() }
                TvButton(t("navigation.menu.feedback"), navigation = true, modifier = Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 2.dp)) { accountExpanded = false; state.openFeedback() }
                TvButton(t("navigation.menu.settings"), navigation = true, modifier = Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 2.dp)) { accountExpanded = false; state.page = "settings" }
                if (state.store.userId != null) TvButton(t("navigation.menu.logout"), navigation = true, modifier = Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 2.dp)) { accountExpanded = false; state.logout() }
            }
        }
    }
}

@Composable
internal fun HeaderButton(
    icon: Int,
    label: String,
    selected: Boolean,
    rotation: Float = 0f,
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    val colors = LocalFrameZooColors.current
    var focused by remember { mutableStateOf(false) }
    val shape = RoundedCornerShape(50)
    val background by animateColorAsState(if (selected || focused) colors["pill.activeBackground"] else colors["pill.background"], tween(300), label = "header background")
    TvIconButton(onClick = onClick, modifier = Modifier.size(42.dp).then(modifier).onFocusChanged { focused = it.isFocused }
        .semantics { contentDescription = label }, shape = TvIconButtonDefaults.shape(shape),
        colors = TvIconButtonDefaults.colors(containerColor = background, focusedContainerColor = background),
        scale = TvIconButtonDefaults.scale(focusedScale = 1f),
        border = TvIconButtonDefaults.border(focusedBorder = TvBorder(BorderStroke(2.dp, colors["type.logo"]), shape = shape))) {
        Icon(painterResource(icon), contentDescription = null, modifier = Modifier.size(19.dp).rotate(rotation),
            tint = if (selected || focused) colors["type.logo"] else colors["type.emphasis"])
    }
}

@Composable
internal fun DiscoverScreen(state: FrameZooState, discoverAction: FocusRequester, listState: LazyListState) {
    val colors = LocalFrameZooColors.current
    val scope = rememberCoroutineScope()
    val categoryFocus = remember { FocusRequester() }
    val tabAll = t("discover.tabs.all")
    val tabSeries = t("discover.tabs.tvshows")
    val tabMovie = t("discover.tabs.movies")
    val filterCountryLabel = t("discover.filters.country")
    val filterYearLabel = t("home.bookmarks.edit.yearLabel")
    val retryLabel = t("notFound.reloadButton")
    val titleGenres = t("discover.carousel.title.genres")
    val titleTrending = t("discover.carousel.title.trending")
    val titlePopular = t("discover.carousel.title.popular")
    val titleProvider = t("discover.carousel.title.providers")
    val titleTopRated = t("discover.carousel.title.topRated")
    val titleEditorPicks = t("discover.carousel.title.editorPicks")
    val titleNewReleases = t("discover.carousel.title.latestReleases")
    val titleForYou = t("discover.carousel.title.forYou")
    val titleBasedOn = t("discover.carousel.title.recommendations")
    val defaultLoadingText = t("discover.page.loading")
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val heroHeight = maxHeight - 16.dp
        LazyColumn(Modifier.fillMaxSize(), state = listState, verticalArrangement = Arrangement.spacedBy(26.dp), contentPadding = PaddingValues(bottom = 48.dp)) {
            item {
                if (state.discover.isNotEmpty()) FeaturedCarousel(state, state.discover.take(15), heroHeight, discoverAction, categoryFocus,
                    onLogo = state.backend::logo, onRatings = state.backend::featuredRatings,
                    onTrailer = state.backend::trailer, randomMovies = { state.backend.discoverSection(com.framezoo.tv.model.DiscoverFilter(category = "movie"), "popular", page = 2) },
                    onRandom = state::playRandom, progressItems = state.progress, onOpen = state::openDetails, onPlay = state::playFeatured)
                else Box(Modifier.fillMaxWidth().height(heroHeight).padding(8.dp).clip(RoundedCornerShape(18.dp)).skeletonShimmer(), contentAlignment = Alignment.Center) {
                    if (state.error.isNotBlank()) Text(state.error, color = colors["type.danger"])
                }
            }
            val watching = state.progress.filter { it.duration > 0 && it.position > 0 && (it.position / it.duration) < 0.95 }
            if (watching.isNotEmpty()) item {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 38.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp)
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        Icon(
                            painter = painterResource(R.drawable.desktop_clock),
                            contentDescription = null,
                            tint = colors["type.emphasis"],
                            modifier = Modifier.size(20.dp)
                        )
                        Text(
                            text = t("home.continueWatching.sectionTitle").uppercase(),
                            color = colors["type.emphasis"],
                            fontWeight = FontWeight.Bold,
                            fontSize = 20.sp,
                            letterSpacing = 1.sp
                        )
                    }
                    LazyRow(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(16.dp),
                        contentPadding = PaddingValues(horizontal = 4.dp, vertical = 6.dp)
                    ) {
                        items(watching, key = { "discover_watching:${it.media.id}:${it.season}:${it.episode}" }) { libItem ->
                            val progressVal = if (libItem.duration > 0) (libItem.position / libItem.duration).toFloat().coerceIn(0f, 1f) else null
                            TvMediaCard(
                                item = libItem.media,
                                onOpen = { state.openDetails(libItem.media) },
                                progress = progressVal,
                                season = libItem.season,
                                episode = libItem.episode,
                                bookmarked = state.bookmarks.any { it.id == libItem.media.id },
                                onBookmark = state::bookmark,
                                qualityLoader = state.backend::releaseQuality
                            )
                        }
                    }
                }
            }
            if (state.bookmarks.isNotEmpty()) item {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 38.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp)
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        Icon(
                            painter = painterResource(R.drawable.desktop_bookmark),
                            contentDescription = null,
                            tint = colors["type.emphasis"],
                            modifier = Modifier.size(20.dp)
                        )
                        Text(
                            text = t("home.bookmarks.sectionTitle").uppercase(),
                            color = colors["type.emphasis"],
                            fontWeight = FontWeight.Bold,
                            fontSize = 20.sp,
                            letterSpacing = 1.sp
                        )
                    }
                    LazyRow(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(16.dp),
                        contentPadding = PaddingValues(horizontal = 4.dp, vertical = 6.dp)
                    ) {
                        items(state.bookmarks.distinctBy { it.id }, key = { "discover_bm:${it.id}" }) { bmMedia ->
                            TvMediaCard(
                                item = bmMedia,
                                onOpen = { state.openDetails(bmMedia) },
                                bookmarked = true,
                                onBookmark = state::bookmark,
                                qualityLoader = state.backend::releaseQuality
                            )
                        }
                    }
                }
            }
            item { Column(Modifier.padding(start = 34.dp, end = 38.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
                val countryFocus = remember { FocusRequester() }
                val yearFocus = remember { FocusRequester() }
                val focusManager = LocalFocusManager.current
                var inCategories by remember { mutableStateOf(false) }
                var inCountry by remember { mutableStateOf(false) }
                var inYear by remember { mutableStateOf(false) }
                var lastCategoryFocus by remember { mutableStateOf<FocusRequester?>(null) }
                var jumpKey by remember { mutableIntStateOf(0) }
                var jumpTarget by remember { mutableStateOf<FocusRequester?>(null) }
                var jumped by remember { mutableStateOf(false) }
                Row(Modifier.onPreviewKeyEvent { event ->
                    val key = event.nativeKeyEvent
                    when {
                        key.action == KeyEvent.ACTION_UP && key.keyCode == jumpKey -> {
                            if (!jumped) focusManager.moveFocus(if (jumpKey == KeyEvent.KEYCODE_DPAD_RIGHT) FocusDirection.Right else FocusDirection.Left)
                            jumpKey = 0; jumpTarget = null; jumped = false; true
                        }
                        key.action == KeyEvent.ACTION_DOWN && key.repeatCount == 0 -> {
                            jumpTarget = when {
                                inCategories && key.keyCode == KeyEvent.KEYCODE_DPAD_RIGHT -> countryFocus
                                inCountry && key.keyCode == KeyEvent.KEYCODE_DPAD_LEFT -> lastCategoryFocus ?: categoryFocus
                                inCountry && key.keyCode == KeyEvent.KEYCODE_DPAD_RIGHT -> yearFocus
                                inYear && key.keyCode == KeyEvent.KEYCODE_DPAD_LEFT -> countryFocus
                                else -> null
                            }
                            jumpKey = if (jumpTarget != null) key.keyCode else 0
                            jumped = false; jumpKey != 0
                        }
                        key.action == KeyEvent.ACTION_DOWN && key.repeatCount > 0 && key.keyCode == jumpKey -> {
                            if (!jumped) {
                                jumped = true
                                jumpTarget?.requestFocus()
                            }
                            true
                        }
                        else -> false
                    }
                }, horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    LazyRow(
                        Modifier.weight(1f).onFocusChanged { inCategories = it.hasFocus }.focusGroup(),
                        contentPadding = PaddingValues(horizontal = 4.dp, vertical = 4.dp),
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        items(listOf(DiscoverOption("all", tabAll), DiscoverOption("tv", tabSeries), DiscoverOption("movie", tabMovie)), key = { it.id }) { option ->
                            val focus = remember(option.id) { FocusRequester() }
                            DisposableEffect(focus) { onDispose { if (lastCategoryFocus === focus) lastCategoryFocus = null } }
                            val modifier = Modifier
                                .then(if (option.id == "all") Modifier.focusRequester(categoryFocus).focusProperties { up = discoverAction } else Modifier)
                                .focusRequester(focus)
                                .onFocusChanged { if (it.isFocused) lastCategoryFocus = focus }
                            CategoryTab(option.name, state.filter.category == option.id, modifier) { state.updateFilter(state.filter.copy(category = option.id)) }
                        }
                        item(key = "tab_genre_spacing") {
                            Spacer(Modifier.width(4.dp))
                        }
                        items(state.genres, key = { "genre:${it.id}" }) { genre ->
                            val genreId = "genre:${genre.id}"
                            val focus = remember(genreId) { FocusRequester() }
                            DisposableEffect(focus) { onDispose { if (lastCategoryFocus === focus) lastCategoryFocus = null } }
                            val modifier = Modifier.focusRequester(focus).onFocusChanged { if (it.isFocused) lastCategoryFocus = focus }
                            GenreChip(genre.name, selected = state.filter.category == genreId, modifier = modifier) {
                                state.updateFilter(state.filter.copy(category = genreId))
                            }
                        }
                    }
                    Box(Modifier.padding(horizontal = 4.dp).width(1.dp).height(20.dp).background(Color.White.copy(alpha = 0.15f)))
                    FilterMenu(filterCountryLabel, state.filter.country, state.countries, modifier = Modifier.focusRequester(countryFocus).onFocusChanged { inCountry = it.hasFocus }) { state.updateFilter(state.filter.copy(country = it)) }
                    FilterMenu(filterYearLabel, state.filter.year, (Year.now().value downTo 1900).map { DiscoverOption(it.toString(), it.toString()) }, modifier = Modifier.focusRequester(yearFocus).onFocusChanged { inYear = it.hasFocus }) { state.updateFilter(state.filter.copy(year = it)) }
                }
            } }
            if (state.discoverError.isNotBlank()) item { Row(Modifier.padding(horizontal = 38.dp), horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(state.discoverError, color = colors["type.danger"]); TvButton(retryLabel) { state.refreshDiscover() }
            } }
            val rows = if (state.filter.category.startsWith("genre:")) listOf("genre" to (state.genres.firstOrNull { it.id == state.filter.category.substringAfter(':') }?.name ?: titleGenres))
                else listOf("trending" to titleTrending) + (if (state.filter.category == "all") listOf("popular" to titlePopular) else emptyList()) + listOf("provider" to (state.providers.firstOrNull { it.id == state.provider }?.name ?: titleProvider),
                    "top" to titleTopRated, "editor" to titleEditorPicks, "latest" to titleNewReleases) +
                    (if (state.filter.category in listOf("movie", "tv") && state.hasPersonalSources) listOf("personal" to titleForYou) else emptyList()) +
                    (if (state.filter.category in listOf("movie", "tv") && state.recommendationSources.isNotEmpty()) listOf("recommendations" to titleBasedOn) else emptyList()) + listOf("genre" to titleGenres)
            rows.forEach { (key, title) ->
                val media = state.sections[key]
                if (media == null && state.discoverLoading) item(key = "loading:$key") { DiscoverSkeleton(title) }
                else if (!media.isNullOrEmpty() || state.rowErrors.containsKey(key) || (media != null && key in listOf("provider", "genre", "recommendations"))) item(key = "row:$key") {
                    DiscoverCarousel(state, key, title, media.orEmpty())
                }
            }
            val addonGroups = state.addonCatalog.filter { state.filter.category !in listOf("movie", "tv") || it.type == if (state.filter.category == "movie") "movie" else "series" }
            addonGroups.forEach { group -> item(key = group.key) {
                DiscoverCarousel(state, group.key, group.addonName, group.items, group)
            } }
            if (state.filter.category != "tv") item { Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                TvButton(t("discover.viewLists"), accent = true) { state.openAllLists() }
            } }
        }
        AnimatedVisibility(visible = listState.firstVisibleItemIndex > 0, modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 12.dp)) {
            TvButton(t("discover.scrollToTop"), navigation = true, icon = R.drawable.desktop_chevron_up) {
                scope.launch { listState.animateScrollToItem(0); if (state.discover.isNotEmpty()) discoverAction.requestFocus() }
            }
        }
    }
}

@Composable
private fun DiscoverCarousel(state: FrameZooState, key: String, title: String, media: List<Media>, addon: AddonCatalog? = null) {
    val colors = LocalFrameZooColors.current
    val moreFocus = remember { FocusRequester() }
    LaunchedEffect(state.focusReturnSection, media.isNotEmpty()) {
        if (state.focusReturnSection == key && media.isNotEmpty()) {
            moreFocus.requestFocus()
            state.focusReturnSection = null
        }
    }
    Column(Modifier.padding(horizontal = 38.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(title, color = colors["type.emphasis"], fontSize = 27.sp, fontWeight = FontWeight.Bold)
            if (addon != null) Text(t("addons.catalog.badge"), color = colors["type.secondary"], fontSize = 13.sp,
                modifier = Modifier.clip(RoundedCornerShape(4.dp)).background(colors["pill.background"]).padding(horizontal = 8.dp, vertical = 3.dp))
            if (key == "trending") {
                TvButton(t("discover.carousel.today"), selected = state.filter.window == "day", navigation = true) { state.updateFilter(state.filter.copy(window = "day")) }
                TvButton(t("discover.carousel.thisWeek"), selected = state.filter.window == "week", navigation = true) { state.updateFilter(state.filter.copy(window = "week")) }
            }
        }
        if (media.isNotEmpty()) TvButton(t("discover.carousel.more"), modifier = Modifier.focusRequester(moreFocus), navigation = true, trailingIcon = R.drawable.desktop_arrow_right) { state.openMore(key, title, media, addon) }
        if (key == "provider" || (key == "genre" && !state.filter.category.startsWith("genre:"))) {
            val choices = if (key == "provider") state.providers else state.genres
            val selected = if (key == "provider") state.provider else state.carouselGenre
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(choices, key = { it.id }) { option ->
                    TvButton(option.name, selected = option.id == selected, navigation = true) {
                        if (key == "provider") state.selectProvider(option.id) else state.selectGenre(option.id)
                    }
                }
            }
        }
        if (key == "recommendations") {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(state.recommendationSources, key = { "${it.type}:${it.id}" }) { source ->
                    TvButton(source.title, selected = source.id == state.recommendationSource, navigation = true) { state.selectRecommendation(source.id) }
                }
            }
        }
        when {
            key in state.rowLoading -> {
                LazyRow(
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                    contentPadding = PaddingValues(horizontal = 4.dp, vertical = 6.dp)
                ) {
                    items(6) { TvMediaCardSkeleton() }
                }
            }
            key in state.rowErrors -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(state.rowErrors[key].orEmpty(), color = colors["type.danger"]); TvButton(t("notFound.reloadButton")) { state.refreshRow(key) }
            }
            media.isNotEmpty() -> MediaGrid("", media.take(20), state::openDetails, bookmarks = state.bookmarks.map { it.id }.toSet(), onBookmark = state::bookmark, qualityLoader = state.backend::releaseQuality)
            else -> Text(t("home.search.empty.default"), color = colors["type.secondary"])
        }
    }
}

@Composable
private fun DiscoverSkeleton(title: String) {
    val colors = LocalFrameZooColors.current
    Column(Modifier.padding(horizontal = 38.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text(title, color = colors["type.emphasis"], fontSize = 27.sp, fontWeight = FontWeight.Bold)
        LazyRow(
            horizontalArrangement = Arrangement.spacedBy(16.dp),
            contentPadding = PaddingValues(horizontal = 4.dp, vertical = 6.dp)
        ) {
            items(6) { TvMediaCardSkeleton() }
        }
    }
}

@Composable
internal fun DiscoverListsScreen(state: FrameZooState, listState: LazyListState) {
    val colors = LocalFrameZooColors.current
    val backFocus = remember { FocusRequester() }
    val newReleasesTitle = t("discover.carousel.title.latestReleases")
    val newReleases4KTitle = t("discover.carousel.title.4kReleases")
    val popularTitle = t("discover.carousel.title.popular")
    val trendingTitle = t("discover.carousel.title.trending")
    LaunchedEffect(Unit) { if (state.focusReturnSection == null) backFocus.requestFocus() }
    LazyColumn(state = listState, verticalArrangement = Arrangement.spacedBy(24.dp), contentPadding = PaddingValues(bottom = 48.dp)) {
        item { Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(18.dp)) {
            TvButton(t("discover.page.back"), modifier = Modifier.focusRequester(backFocus), icon = R.drawable.desktop_chevron_left) { state.back() }
            Text(t("discover.allLists"), color = colors["type.emphasis"], fontSize = 27.sp, fontWeight = FontWeight.Bold)
        } }
        allListRow(state, "latest", newReleasesTitle)
        allListRow(state, "latest4k", newReleases4KTitle)
        state.curatedLists.forEach { list -> item(key = "curated:${list.slug}") {
            LaunchedEffect(list.slug) { state.loadCurated(list) }
            val media = state.curatedItems[list.slug]
            when {
                list.slug in state.curatedErrors -> Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(list.name, color = colors["type.danger"]); TvButton(t("notFound.reloadButton")) { state.loadCurated(list) }
                }
                media == null -> DiscoverSkeleton(list.name)
                media.isNotEmpty() -> DiscoverListRow(state, "curated:${list.slug}", list.name, media)
            }
        } }
        allListRow(state, "popular", popularTitle)
        allListRow(state, "trending", trendingTitle)
        if (state.allListsError.isNotBlank()) item { Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(state.allListsError, color = colors["type.danger"]); TvButton(t("notFound.reloadButton")) { state.openAllLists() }
        } }
    }
}

private fun LazyListScope.allListRow(state: FrameZooState, key: String, title: String) {
    val media = state.allLists[key]
    if (media == null && state.allListsLoading) item(key = "loading:$key") { DiscoverSkeleton(title) }
    else if (!media.isNullOrEmpty()) item(key = "list:$key") { DiscoverListRow(state, key, title, media) }
}

@Composable
private fun DiscoverListRow(state: FrameZooState, key: String, title: String, media: List<Media>) {
    val moreFocus = remember { FocusRequester() }
    LaunchedEffect(state.focusReturnSection) {
        if (state.focusReturnSection == key) { moreFocus.requestFocus(); state.focusReturnSection = null }
    }
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(title, color = LocalFrameZooColors.current["type.emphasis"], fontSize = 24.sp, fontWeight = FontWeight.Bold)
        TvButton(t("discover.carousel.more"), modifier = Modifier.focusRequester(moreFocus), navigation = true, trailingIcon = R.drawable.desktop_arrow_right) { state.openMore(key, title, media) }
        MediaGrid("", media.take(20), state::openDetails, bookmarks = state.bookmarks.map { it.id }.toSet(), onBookmark = state::bookmark, qualityLoader = state.backend::releaseQuality)
    }
}

@Composable
internal fun DiscoverMoreScreen(state: FrameZooState, gridState: LazyGridState) {
    val colors = LocalFrameZooColors.current
    val backFocus = remember { FocusRequester() }
    LaunchedEffect(Unit) { if (state.focusReturnMediaId == null) backFocus.requestFocus() }
    LaunchedEffect(state.focusReturnMediaId) {
        val key = state.focusReturnMediaId ?: return@LaunchedEffect
        val index = state.moreItems.indexOfFirst { "${it.type}:${it.id}:${it.addonManifest}" == key }
        if (index >= 0) gridState.scrollToItem(index + 1) else { state.focusReturnMediaId = null; backFocus.requestFocus() }
    }
    LazyVerticalGrid(columns = GridCells.Adaptive(174.dp), state = gridState, verticalArrangement = Arrangement.spacedBy(18.dp),
        horizontalArrangement = Arrangement.spacedBy(18.dp), contentPadding = PaddingValues(start = 4.dp, end = 4.dp, top = 6.dp, bottom = 48.dp)) {
        item(span = { GridItemSpan(maxLineSpan) }) {
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                    TvButton(t("discover.page.back"), modifier = Modifier.focusRequester(backFocus), icon = R.drawable.desktop_chevron_left) { state.back() }
                    val title = when (state.moreSection) {
                        "provider" -> state.providersFor(state.moreFilter.category).firstOrNull { it.id == state.moreProvider }?.name ?: state.moreTitle
                        "genre" -> if (state.moreFilter.category.startsWith("genre:")) state.moreTitle else state.genres.firstOrNull { it.id == state.moreGenre }?.name ?: state.moreTitle
                        else -> state.moreTitle
                    }
                    Text(title, color = colors["type.emphasis"], fontSize = 27.sp, fontWeight = FontWeight.Bold)
                }
                if (state.moreSection in listOf("trending", "popular", "top", "latest", "editor", "genre", "provider", "personal", "recommendations")) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        FilterMenu(t("discover.filters.country"), state.moreFilter.country, state.countries) { state.updateMoreFilter(value = state.moreFilter.copy(country = it)) }
                        FilterMenu(t("home.bookmarks.edit.yearLabel"), state.moreFilter.year, (Year.now().value downTo 1900).map { DiscoverOption(it.toString(), it.toString()) }) { state.updateMoreFilter(value = state.moreFilter.copy(year = it)) }
                        if (state.moreSection == "provider") FilterMenu(t("discover.carousel.title.providers"), state.moreProvider, state.providersFor(state.moreFilter.category), allowAll = false) { state.updateMoreFilter(selectedProvider = it) }
                        if (state.moreSection == "genre" && !state.moreFilter.category.startsWith("genre:")) FilterMenu(t("discover.carousel.title.genres"), state.moreGenre, state.genres, allowAll = false) { state.updateMoreFilter(selectedGenre = it) }
                        if (state.moreSection == "trending") {
                            TvButton(t("discover.carousel.today"), selected = state.moreFilter.window == "day", navigation = true) { state.updateMoreFilter(value = state.moreFilter.copy(window = "day")) }
                            TvButton(t("discover.carousel.thisWeek"), selected = state.moreFilter.window == "week", navigation = true) { state.updateMoreFilter(value = state.moreFilter.copy(window = "week")) }
                        }
                    }
                    if (state.moreSection == "recommendations") FilterMenu(t("discover.carousel.title.recommendations"), state.moreRecommendation,
                        state.recommendationSources.map { DiscoverOption(it.id, it.title) }, allowAll = false) { state.updateMoreFilter(selectedRecommendation = it) }
                }
            }
        }
        gridItems(state.moreItems, key = { "${it.type}:${it.id}:${it.addonManifest}" }) { media ->
            val focus = remember { FocusRequester() }
            val key = "${media.type}:${media.id}:${media.addonManifest}"
            LaunchedEffect(state.focusReturnMediaId) { if (state.focusReturnMediaId == key) { focus.requestFocus(); state.focusReturnMediaId = null } }
            TvMediaCard(media, state::openDetails, bookmarked = state.bookmarks.any { it.id == media.id }, onBookmark = state::bookmark, qualityLoader = state.backend::releaseQuality, modifier = Modifier.focusRequester(focus))
        }
        item(span = { GridItemSpan(maxLineSpan) }) {
            when {
                state.moreLoading -> Row(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    repeat(6) {
                        TvMediaCardSkeleton()
                    }
                }
                state.moreError.isNotBlank() -> Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(state.moreError, color = colors["type.danger"]); TvButton(t("notFound.reloadButton")) { if (state.moreItems.isEmpty()) state.updateMoreFilter(force = true) else state.loadMore() }
                }
                state.moreHasNext -> Box(Modifier.fillMaxWidth().padding(vertical = 12.dp), contentAlignment = Alignment.Center) {
                    TvButton(t("discover.page.loadMore"), icon = R.drawable.desktop_chevron_down) { state.loadMore() }
                }
                state.moreItems.isEmpty() -> Text(t("home.search.empty.default"), color = colors["type.secondary"])
            }
        }
    }
}

@Composable
private fun CategoryTab(label: String, selected: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val colors = LocalFrameZooColors.current
    val shape = RoundedCornerShape(50)
    var focused by remember { mutableStateOf(false) }
    TvSurface(
        onClick = onClick,
        modifier = modifier.height(36.dp).onFocusChanged { focused = it.isFocused },
        shape = TvSurfaceDefaults.shape(shape),
        colors = TvSurfaceDefaults.colors(
            containerColor = Color.Transparent,
            focusedContainerColor = if (focused) Color.White.copy(alpha = 0.08f) else Color.Transparent
        ),
        scale = TvSurfaceDefaults.scale(focusedScale = 1.0f),
        border = TvSurfaceDefaults.border(
            border = TvBorder.None,
            focusedBorder = TvBorder(BorderStroke(2.dp, if (selected) colors["type.logo"] else Color.White.copy(alpha = 0.6f)), shape = shape)
        )
    ) {
        Box(
            modifier = Modifier.fillMaxHeight().padding(horizontal = 12.dp),
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = label,
                color = if (selected) colors["type.logo"] else if (focused) colors["type.emphasis"] else colors["type.secondary"],
                fontSize = if (selected) 17.sp else 16.sp,
                fontWeight = if (selected) FontWeight.Bold else FontWeight.SemiBold,
                maxLines = 1,
                textAlign = TextAlign.Center
            )
        }
    }
}

@Composable
private fun GenreChip(label: String, selected: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val colors = LocalFrameZooColors.current
    val shape = RoundedCornerShape(50)
    var focused by remember { mutableStateOf(false) }
    TvSurface(
        onClick = onClick,
        modifier = modifier.height(36.dp).onFocusChanged { focused = it.isFocused },
        shape = TvSurfaceDefaults.shape(shape),
        colors = TvSurfaceDefaults.colors(
            containerColor = colors["mediaCard.hoverBackground"],
            focusedContainerColor = colors["pill.activeBackground"]
        ),
        scale = TvSurfaceDefaults.scale(focusedScale = 1.0f),
        border = TvSurfaceDefaults.border(
            border = TvBorder.None,
            focusedBorder = TvBorder(BorderStroke(2.dp, if (selected) colors["type.logo"] else Color.White), shape = shape)
        )
    ) {
        Box(
            modifier = Modifier.fillMaxHeight().padding(horizontal = 14.dp),
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = label,
                color = if (selected) colors["type.logo"] else if (focused) colors["type.emphasis"] else colors["type.secondary"],
                fontSize = 13.5.sp,
                fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
                maxLines = 1,
                textAlign = TextAlign.Center
            )
        }
    }
}

@Composable
internal fun FilterMenu(label: String, selected: String, options: List<DiscoverOption>, allowAll: Boolean = true, modifier: Modifier = Modifier, onSelect: (String) -> Unit) {
    val colors = LocalFrameZooColors.current
    val allLabel = t("discover.tabs.all")
    var expanded by remember { mutableStateOf(false) }
    var focused by remember { mutableStateOf(false) }
    val selectedName = options.firstOrNull { it.id == selected }?.name
    val displayText = if (selected.isNotBlank() && selectedName != null) "$label: $selectedName" else label

    Box(modifier) {
        TvSurface(
            onClick = { expanded = true },
            shape = TvSurfaceDefaults.shape(RoundedCornerShape(50)),
            colors = TvSurfaceDefaults.colors(
                containerColor = colors["mediaCard.hoverBackground"],
                focusedContainerColor = colors["pill.activeBackground"]
            ),
            scale = TvSurfaceDefaults.scale(focusedScale = 1.0f),
            border = TvSurfaceDefaults.border(
                border = TvBorder.None,
                focusedBorder = TvBorder(BorderStroke(2.dp, Color.White), shape = RoundedCornerShape(50))
            ),
            modifier = Modifier.height(36.dp).onFocusChanged { focused = it.isFocused }
        ) {
            Row(
                modifier = Modifier.fillMaxHeight().padding(horizontal = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                Text(
                    text = displayText,
                    color = if (selected.isNotBlank() || focused) colors["type.emphasis"] else colors["type.secondary"],
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
            if (allowAll) {
                TvButton(
                    label = "$allLabel $label",
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 2.dp),
                    navigation = true
                ) {
                    onSelect("")
                    expanded = false
                }
            }
            options.forEach { option ->
                TvButton(
                    label = option.name,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 2.dp),
                    navigation = true,
                    selected = option.id == selected
                ) {
                    onSelect(option.id)
                    expanded = false
                }
            }
        }
    }
}

@Composable
private fun FeaturedCarousel(state: FrameZooState, items: List<Media>, height: androidx.compose.ui.unit.Dp, discoverAction: FocusRequester, nextFocusDown: FocusRequester? = null, onLogo: suspend (Media) -> String?, onRatings: suspend (Media) -> FeaturedRatings, onTrailer: suspend (Media) -> String?, randomMovies: suspend () -> List<Media>, onRandom: (Media) -> Unit, progressItems: List<LibraryItem>, onOpen: (Media) -> Unit, onPlay: (Media) -> Unit) {
    val colors = LocalFrameZooColors.current
    var index by remember(items) { mutableIntStateOf(0) }
    var actionFocused by remember { mutableStateOf(false) }
    LaunchedEffect(items, index, actionFocused) { if (!actionFocused) { delay(8000); index = (index + 1) % items.size } }
    val item = items[index]
    val trailerEnabled = state.trailerEnabled
    val trailerMuted = state.trailerMuted
    var trailerKey by remember(item.id, item.type) { mutableStateOf<String?>(null) }
    LaunchedEffect(item.id, item.type, trailerEnabled) {
        trailerKey = if (trailerEnabled) try { onTrailer(item) } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (_: Exception) { null } else null
    }
    var logo by remember(item.id, item.type) { mutableStateOf<String?>(null) }
    LaunchedEffect(item.id, item.type) {
        try { logo = onLogo(item) } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (_: Exception) { logo = null }
    }
    var ratings by remember(item.id, item.type) { mutableStateOf(FeaturedRatings()) }
    LaunchedEffect(item.id, item.type) {
        try { ratings = onRatings(item) } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (_: Exception) { ratings = FeaturedRatings() }
    }
    Box(Modifier.fillMaxWidth().height(height).padding(8.dp).onFocusChanged { actionFocused = it.hasFocus }.clip(RoundedCornerShape(18.dp)).background(colors["background.secondary"])) {
        Crossfade(targetState = item, animationSpec = tween(800), label = "featured backdrop") { featured ->
            if (!featured.backdrop.isNullOrBlank()) {
                SubcomposeAsyncImage(
                    model = featured.backdrop,
                    contentDescription = featured.title,
                    modifier = Modifier.fillMaxSize(),
                    contentScale = ContentScale.Crop,
                    loading = { Box(Modifier.fillMaxSize().skeletonShimmer()) }
                )
            }
        }
        if (trailerEnabled && trailerKey != null) TrailerBackground(trailerKey!!, trailerMuted, Modifier.fillMaxSize())
        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color.Black.copy(alpha = .24f), Color.Transparent, Color.Black.copy(alpha = .95f)))))
        Box(Modifier.fillMaxSize().background(Brush.horizontalGradient(listOf(Color.Black.copy(alpha = .65f), Color.Transparent))))
        Column(Modifier.align(Alignment.BottomStart).fillMaxWidth(.58f).padding(start = 40.dp, bottom = 60.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (logo != null) AsyncImage(logo, item.title, Modifier.widthIn(max = 350.dp).heightIn(max = 100.dp), contentScale = ContentScale.Fit)
            else Text(item.title, color = Color.White, fontSize = 40.sp, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (item.rating > 0) {
                    Image(painterResource(R.drawable.desktop_tmdb), contentDescription = "TMDB", modifier = Modifier.width(28.dp).height(16.dp))
                    Text("%.1f".format(item.rating) + if (item.voteCount > 0) " (%,d)".format(item.voteCount) else "", color = Color.White, fontSize = 16.sp)
                    Text("·", color = Color.White, fontSize = 16.sp)
                }
                ratings.imdbRating?.let { rating ->
                    RatingIcon("imdb.svg", "IMDb")
                    Text("%.1f".format(rating) + (ratings.imdbVotes?.let { " (%,d)".format(it) } ?: ""), color = Color.White, fontSize = 16.sp)
                    Text("·", color = Color.White, fontSize = 16.sp)
                }
                ratings.tomatoScore?.let { score ->
                    RatingIcon(when (ratings.tomatoIcon) { "certified_fresh" -> "Certified_Fresh.svg"; "fresh" -> "Fresh.svg"; else -> "Rotten.svg" }, "Rotten Tomatoes")
                    Text("$score%", color = Color.White, fontSize = 16.sp)
                    Text("·", color = Color.White, fontSize = 16.sp)
                }
                ratings.audienceScore?.let { score ->
                    RatingIcon(when (ratings.audienceIcon) { "upright" -> "Popcorn_Fresh.svg"; "spilled" -> "Popcorn_Rotten.svg"; else -> "Popcorn_Empty.svg" }, "Popcornmeter")
                    Text("$score%", color = Color.White, fontSize = 16.sp)
                    Text("·", color = Color.White, fontSize = 16.sp)
                }
                Text(listOfNotNull(item.year.takeIf { it.isNotBlank() }, if (item.type == "show") t("media.types.show") else t("media.types.movie")).joinToString("  ·  "), color = Color.White, fontSize = 16.sp)
            }
            if (item.description.isNotBlank()) Text(item.description, color = Color.White.copy(alpha = .9f), maxLines = 3, overflow = TextOverflow.Ellipsis, fontSize = 16.sp)
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                TvButton(if (progressItems.any { it.media.id == item.id && it.media.type == item.type && it.position > 0 }) t("details.resume") else t("details.play"), modifier = Modifier.focusRequester(discoverAction).then(if (nextFocusDown != null) Modifier.focusProperties { down = nextFocusDown } else Modifier), accent = true, icon = R.drawable.desktop_play) { onPlay(item) }
                TvButton(t("discover.featured.moreInfo"), modifier = if (nextFocusDown != null) Modifier.focusProperties { down = nextFocusDown } else Modifier, icon = R.drawable.desktop_question) { onOpen(item) }
            }
            progressItems.firstOrNull { it.media.id == item.id && it.media.type == item.type && it.position > 0 && it.duration > 0 }?.let { progress ->
                val ratio = (progress.position / progress.duration).toFloat().coerceIn(0f, 1f)
                Row(Modifier.widthIn(max = 350.dp).fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(if (progress.season != null && progress.episode != null) "${t("details.season")} ${progress.season} · ${t("details.episode")} ${progress.episode}" else t("home.continueWatching.sectionTitle"), color = Color.White, fontSize = 13.sp)
                    Text("${(ratio * 100).toInt()}%", color = Color.White, fontSize = 13.sp)
                }
                Box(Modifier.widthIn(max = 350.dp).fillMaxWidth().height(5.dp).clip(RoundedCornerShape(50)).background(colors["progress.background"])) {
                    Box(Modifier.fillMaxWidth(ratio).height(5.dp).background(colors["progress.filled"]))
                }
            }
        }
        Box(Modifier.align(Alignment.CenterStart).padding(start = 12.dp)) {
            HeaderButton(R.drawable.desktop_chevron_left, "Previous slide", false) { index = (index - 1 + items.size) % items.size }
        }
        Box(Modifier.align(Alignment.CenterEnd).padding(end = 12.dp)) {
            HeaderButton(R.drawable.desktop_chevron_right, "Next slide", false) { index = (index + 1) % items.size }
        }
        Row(Modifier.align(Alignment.BottomEnd).padding(end = 22.dp, bottom = 18.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            HeaderButton(if (trailerEnabled) R.drawable.desktop_image else R.drawable.desktop_video,
                if (trailerEnabled) "Show image" else "Show trailer", trailerEnabled) { state.toggleTrailer() }
            HeaderButton(if (trailerMuted) R.drawable.desktop_volume_x else R.drawable.desktop_volume,
                if (trailerMuted) "Unmute trailer" else "Mute trailer", !trailerMuted) { state.toggleTrailerAudio() }
            RandomMovieButton(randomMovies, onRandom)
        }
        Row(Modifier.align(Alignment.BottomCenter).padding(bottom = 18.dp), horizontalArrangement = Arrangement.spacedBy(7.dp)) {
            items.indices.forEach { dot ->
                Box(Modifier.size(if (dot == index) 9.dp else 7.dp).clip(RoundedCornerShape(50))
                    .background(if (dot == index) Color.White else Color.White.copy(alpha = .45f)))
            }
        }
    }
}

@Composable
internal fun RatingIcon(asset: String, description: String) {
    val context = LocalContext.current
    val loader = remember(context) { ImageLoader.Builder(context).components { add(SvgDecoder.Factory()) }.build() }
    AsyncImage(model = "file:///android_asset/ratings/$asset", contentDescription = description, modifier = Modifier.size(20.dp), imageLoader = loader)
}

@Composable
private fun RandomMovieButton(load: suspend () -> List<Media>, onPlay: (Media) -> Unit, modifier: Modifier = Modifier) {
    var movies by remember { mutableStateOf<List<Media>>(emptyList()) }
    var choice by remember { mutableStateOf<Media?>(null) }
    var countdown by remember { mutableIntStateOf(0) }
    var isRolling by remember { mutableStateOf(false) }
    val diceRotation by animateFloatAsState(if (isRolling) 360f else 0f, tween(500), label = "diceRoll")

    LaunchedEffect(Unit) {
        try { movies = load() } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (_: Exception) { movies = emptyList() }
    }
    LaunchedEffect(choice) {
        val movie = choice ?: return@LaunchedEffect
        countdown = 5
        while (countdown > 0) { delay(1000); countdown-- }
        choice = null
        onPlay(movie)
    }

    val colors = LocalFrameZooColors.current
    val shape = RoundedCornerShape(50)

    if (choice != null && countdown > 0) {
        TvSurface(
            onClick = { choice = null; countdown = 0 },
            shape = TvSurfaceDefaults.shape(shape),
            colors = TvSurfaceDefaults.colors(
                containerColor = colors["pill.activeBackground"],
                focusedContainerColor = colors["type.logo"]
            ),
            scale = TvSurfaceDefaults.scale(focusedScale = 1.05f),
            border = TvSurfaceDefaults.border(focusedBorder = TvBorder(BorderStroke(2.dp, Color.White), shape = shape)),
            modifier = modifier.height(44.dp)
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Text(
                    text = choice?.title ?: "",
                    color = Color.White,
                    fontWeight = FontWeight.Bold,
                    fontSize = 14.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Box(
                    modifier = Modifier
                        .size(26.dp)
                        .clip(CircleShape)
                        .background(colors["type.logo"]),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = "$countdown",
                        color = Color.White,
                        fontWeight = FontWeight.Black,
                        fontSize = 14.sp
                    )
                }
            }
        }
    } else {
        TvIconButton(
            onClick = {
                isRolling = !isRolling
                choice = movies.randomOrNull()
            },
            modifier = modifier.size(44.dp).semantics { contentDescription = "Random movie" },
            shape = TvIconButtonDefaults.shape(shape),
            colors = TvIconButtonDefaults.colors(
                containerColor = colors["pill.background"].copy(alpha = 0.65f),
                focusedContainerColor = colors["pill.activeBackground"]
            ),
            scale = TvIconButtonDefaults.scale(focusedScale = 1.1f),
            border = TvIconButtonDefaults.border(focusedBorder = TvBorder(BorderStroke(2.dp, colors["type.logo"]), shape = shape))
        ) {
            Icon(
                painter = painterResource(R.drawable.desktop_dice),
                contentDescription = "Random",
                tint = Color.White,
                modifier = Modifier.size(22.dp).rotate(diceRotation)
            )
        }
    }
}
