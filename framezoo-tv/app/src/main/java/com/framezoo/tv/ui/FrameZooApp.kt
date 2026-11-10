package com.framezoo.tv.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.background
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextFieldColors
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.input.key.onPreviewKeyEvent
import android.view.KeyEvent
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.shape.RoundedCornerShape
import com.framezoo.tv.MainActivity
import coil.compose.AsyncImage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

@Composable
internal fun tvFieldColors(): TextFieldColors {
    val colors = LocalFrameZooColors.current
    return OutlinedTextFieldDefaults.colors(
        focusedTextColor = colors["search.text"], unfocusedTextColor = colors["search.text"],
        focusedContainerColor = colors["search.focused"], unfocusedContainerColor = colors["search.background"],
        focusedBorderColor = colors["type.logo"], unfocusedBorderColor = colors["authentication.border"],
        focusedLabelColor = colors["type.logo"], unfocusedLabelColor = colors["search.placeholder"],
        cursorColor = colors["type.logo"],
    )
}

@Composable
private fun EntryLoadingScreen(title: String?) {
    val colors = LocalFrameZooColors.current
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(colors["background.main"]),
        contentAlignment = Alignment.Center
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
            CircularProgressIndicator(color = colors["type.logo"])
            if (!title.isNullOrBlank()) {
                Text(
                    text = title,
                    color = colors["type.emphasis"],
                    fontSize = 18.sp,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }
    }
}

@Composable
internal fun FrameZooApp(
    initialPage: String? = null,
    detailId: String? = null,
    detailType: String? = null,
    detailTitle: String? = null
) {
    val context = LocalContext.current
    val activity = context as MainActivity
    val discoverAction = remember { FocusRequester() }
    val discoverListState = rememberLazyListState()
    val allListsState = rememberLazyListState()
    val moreGridState = rememberLazyGridState()
    val searchGridState = rememberLazyGridState()
    val searchListState = rememberLazyListState()
    val searchAction = remember { FocusRequester() }
    val addonAction = remember { FocusRequester() }
    val backendAction = remember { FocusRequester() }
    val passwordField = remember { FocusRequester() }
    val loginAction = remember { FocusRequester() }
    val scope = rememberCoroutineScope()
    val state = remember(context) { FrameZooState(context, scope) }
    var renderedMoreGeneration by remember { mutableStateOf(0) }
    LaunchedEffect(state) { state.initialize() }
    LaunchedEffect(initialPage) {
        if (!initialPage.isNullOrBlank()) {
            state.page = initialPage
        }
    }
    LaunchedEffect(detailId, detailType) {
        if (!detailId.isNullOrBlank()) {
            state.openDetails(com.framezoo.tv.model.Media(id = detailId, type = detailType ?: "movie", title = detailTitle ?: ""))
        }
    }
    LaunchedEffect(state.moreGeneration) {
        if (renderedMoreGeneration != state.moreGeneration) { moreGridState.scrollToItem(0); renderedMoreGeneration = state.moreGeneration }
    }
    BackHandler(state.page != "discover") {
        // PlayerScreen owns the same back action, but Compose can recompose it
        // while clearing a failed/loading stream. Keep the outer handler from
        // skipping the source picker during that transition.
        if (state.page == "player" && state.playing != null && !state.playbackReady) {
            state.player.stop()
            state.returnToSourcePicker()
        } else {
            state.back()
        }
    }

    with(state) {
        CompositionLocalProvider(LocalI18n provides i18n) {
            FrameZooTheme(theme, customPrimary, customSecondary, customTertiary) {
                val colors = LocalFrameZooColors.current
                Surface(color = MaterialTheme.colorScheme.background, contentColor = MaterialTheme.colorScheme.onBackground) {
                    Box(Modifier.fillMaxSize()) {
                    Column(Modifier.fillMaxSize().then(
                        if (page in listOf("discover", "search", "details", "player", "sources", "trailer", "login", "settings")) Modifier
                        else Modifier.padding(horizontal = 48.dp, vertical = 32.dp)
                    )) {
                        if (page !in listOf("player", "sources", "discover", "search", "details", "trailer", "login", "settings")) {
                            DiscoverHeader(state)
                            Spacer(Modifier.height(28.dp))
                        }
                        if (error.isNotBlank() && page !in listOf("details", "player", "sources")) Text(error, color = colors["type.danger"], modifier = Modifier.padding(vertical = 10.dp))
                        val isConnectionError = page == "error" || (page == "discover" && discover.isEmpty() && (discoverError.isNotBlank() || error.isNotBlank()))
                        if (isConnectionError) {
                            ErrorScreen(
                                state = state,
                                onReload = { refreshDiscover() },
                                onGoHome = { page = "discover"; refreshDiscover() }
                            )
                        } else {
                            when (page) {
                                "discover" -> DiscoverScreen(state, discoverAction, discoverListState)
                                "discover-more" -> DiscoverMoreScreen(state, moreGridState)
                                "discover-lists" -> DiscoverListsScreen(state, allListsState)
                                "search" -> SearchScreen(state, searchListState, searchGridState, searchAction, Modifier)
                                "details" -> selected?.let { item -> DetailsScreen(state, item) }
                                    ?: EntryLoadingScreen(detailTitle)
                                "trailer" -> TrailerScreen(state)
                                "feedback" -> FeedbackScreen(state)
                                "sources", "player" -> selected?.let { item ->
                                    val currentEp = episode
                                    var nextEp by remember(item.id, currentEp?.season, currentEp?.number) { mutableStateOf<com.framezoo.tv.model.Episode?>(null) }
                                    LaunchedEffect(item.id, currentEp?.season, currentEp?.number, seasons) {
                                        nextEp = if (item.type == "show" && currentEp != null) {
                                            try { nextEpisode(item, currentEp) }
                                            catch (e: CancellationException) { throw e }
                                            catch (_: Exception) { null }
                                        } else null
                                    }
                                    key(item.id, currentEp?.season, currentEp?.number) {
                                        PlayerScreen(
                                        state = state,
                                        player = player,
                                        item = item,
                                        episode = currentEp,
                                        stream = playing,
                                        subtitles = subtitles,
                                        backend = backend,
                                        resume = resume(item, currentEp),
                                        resumeDuration = resumeDuration(item, currentEp),
                                        onNextEpisode = nextEp?.let { ep -> { loadSources(item, ep) } },
                                        onSelectEpisode = { ep -> loadSources(item, ep) },
                                        onStopped = { pos, duration -> stopped(item, currentEp, pos, duration) },
                                        onExit = { exitPlayer() }
                                        )
                                    }
                                } ?: EntryLoadingScreen(detailTitle)
                                "library" -> BookmarksScreen(state)
                                "history" -> WatchHistoryScreen(state)
                                "addons" -> AddonsScreen(state)
                                "settings" -> SettingsScreen(state)
                                "login" -> AuthScreen(state)
                                "not-found" -> ErrorScreen(state, is404 = true, onReload = { refreshDiscover() }, onGoHome = { page = "discover" })
                            }
                        }
                    }
                    val isConnectionError = page == "error" || (page == "discover" && discover.isEmpty() && (discoverError.isNotBlank() || error.isNotBlank()))
                    if (page in listOf("discover", "search") && !isConnectionError) DiscoverHeader(
                        state = state,
                        modifier = Modifier.align(Alignment.TopCenter).padding(horizontal = 24.dp, vertical = 20.dp)
                            .onPreviewKeyEvent { event ->
                                if (event.nativeKeyEvent.action == KeyEvent.ACTION_DOWN && event.nativeKeyEvent.keyCode == KeyEvent.KEYCODE_DPAD_UP) {
                                    if (page == "discover" && (discoverListState.firstVisibleItemIndex > 0 || discoverListState.firstVisibleItemScrollOffset > 0)) {
                                        scope.launch { discoverListState.animateScrollToItem(0) }
                                        true
                                    } else if (page == "search" && (searchListState.firstVisibleItemIndex > 0 || searchListState.firstVisibleItemScrollOffset > 0)) {
                                        scope.launch { searchListState.animateScrollToItem(0) }
                                        true
                                    } else false
                                } else false
                            }
                            .then(
                                if (page == "discover" && discover.isNotEmpty() && discoverListState.firstVisibleItemIndex == 0) Modifier.focusProperties { down = discoverAction }
                                else if (page == "search" && state.query.isBlank() && searchListState.firstVisibleItemIndex == 0) Modifier.focusProperties { down = searchAction }
                                else Modifier
                            )
                    )
                    if (watchPartyDialogOpen) WatchPartyJoinDialog(state)
                    }
                }
            }
        }
    }
}
