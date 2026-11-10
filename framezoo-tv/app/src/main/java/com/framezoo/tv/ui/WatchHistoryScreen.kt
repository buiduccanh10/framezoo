package com.framezoo.tv.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items as rowItems
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import com.framezoo.tv.R
import com.framezoo.tv.model.LibraryItem
import com.framezoo.tv.model.Media
import com.framezoo.tv.ui.features.history.WatchHistoryAction
import com.framezoo.tv.ui.features.history.WatchHistoryUiState

@Composable
internal fun WatchHistoryScreen(
    uiState: WatchHistoryUiState,
    onAction: (WatchHistoryAction) -> Unit,
    onOpenMedia: (Media) -> Unit,
    qualityLoader: (suspend (Media) -> String?)? = null,
    onBack: () -> Unit
) {
    val colors = LocalFrameZooColors.current
    val gridState = rememberLazyGridState()
    val backRequester = remember { FocusRequester() }
    val editRequester = remember { FocusRequester() }
    var confirmClearAll by remember { mutableStateOf(false) }

    val historyItems = remember(uiState.history) {
        uiState.history.distinctBy { "${it.media.type}:${it.media.id}" }
    }

    val continueWatchingItems = remember(uiState.progress) {
        uiState.progress.filter { it.duration > 0 && it.position > 0 && (it.position / it.duration) < 0.95 }
            .distinctBy { "${it.media.type}:${it.media.id}" }
    }

    if (historyItems.isEmpty() && continueWatchingItems.isEmpty()) {
        Column(
            modifier = Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            IconPatch(
                icon = R.drawable.desktop_clock,
                contentColor = colors["type.logo"],
                size = 64.dp,
                iconSize = 32.dp
            )
            Spacer(Modifier.height(18.dp))
            Text(
                text = t("home.search.empty.default"),
                color = colors["type.secondary"],
                fontSize = 20.sp,
                fontWeight = FontWeight.Medium
            )
            Spacer(Modifier.height(24.dp))
            TvButton(
                label = t("notFound.goHome"),
                accent = true,
                icon = R.drawable.desktop_chevron_left
            ) {
                onBack()
            }
        }
        return
    }

    // Confirmation dialog for clearing history
    if (confirmClearAll) {
        Dialog(onDismissRequest = { confirmClearAll = false }) {
            Column(
                modifier = Modifier
                    .widthIn(min = 320.dp, max = 460.dp)
                    .clip(RoundedCornerShape(18.dp))
                    .background(colors["background.main"])
                    .padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                Text(
                    text = t("home.watchHistory.sectionTitle"),
                    color = colors["type.emphasis"],
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    text = t("lists.delete.confirm").replace(" \"{{name}}\"?", ""),
                    color = colors["type.text"],
                    fontSize = 15.sp,
                    lineHeight = 22.sp
                )
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    TvButton(
                        label = t("actions.cancel")
                    ) {
                        confirmClearAll = false
                    }
                    Spacer(Modifier.width(12.dp))
                    TvButton(
                        label = t("lists.actions.delete"),
                        primary = true
                    ) {
                        confirmClearAll = false
                        onAction(WatchHistoryAction.ClearAll)
                    }
                }
            }
        }
    }

    LazyVerticalGrid(
        columns = GridCells.Adaptive(174.dp),
        state = gridState,
        horizontalArrangement = Arrangement.spacedBy(18.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
        contentPadding = PaddingValues(bottom = 48.dp),
        modifier = Modifier.fillMaxSize()
    ) {
        item(span = { GridItemSpan(maxLineSpan) }) {
            Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(
                        text = t("home.watchHistory.sectionTitle"),
                        style = MaterialTheme.typography.headlineLarge,
                        color = colors["type.emphasis"]
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        if (uiState.isEditing) {
                            TvButton(
                                label = t("lists.actions.delete"),
                                icon = R.drawable.desktop_close
                            ) {
                                confirmClearAll = true
                            }
                        }
                        TvButton(
                            label = if (uiState.isEditing) t("home.mediaList.stopEditing") else t("lists.actions.edit"),
                            icon = if (uiState.isEditing) R.drawable.desktop_checkmark else R.drawable.desktop_edit,
                            primary = uiState.isEditing,
                            modifier = Modifier.focusRequester(editRequester)
                        ) {
                            onAction(WatchHistoryAction.ToggleEditMode)
                        }
                    }
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    TvButton(
                        label = t("discover.page.back"),
                        icon = R.drawable.desktop_chevron_left,
                        navigation = true,
                        modifier = Modifier.focusRequester(backRequester)
                    ) {
                        onBack()
                    }
                }

                // Continue Watching section (if available)
                if (continueWatchingItems.isNotEmpty()) {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            Icon(
                                painter = painterResource(R.drawable.desktop_play),
                                contentDescription = null,
                                tint = colors["type.logo"],
                                modifier = Modifier.size(18.dp)
                            )
                            Text(
                                text = t("home.continueWatching.sectionTitle"),
                                color = colors["type.emphasis"],
                                fontSize = 19.sp,
                                fontWeight = FontWeight.Bold
                            )
                        }
                        LazyRow(
                            horizontalArrangement = Arrangement.spacedBy(14.dp),
                            contentPadding = PaddingValues(vertical = 4.dp)
                        ) {
                            rowItems(continueWatchingItems, key = { "cw:${it.media.type}:${it.media.id}" }) { item ->
                                val progress = if (item.duration > 0) (item.position / item.duration).toFloat().coerceIn(0f, 1f) else null
                                TvMediaCard(
                                    item = item.media,
                                    onOpen = { onOpenMedia(item.media) },
                                    progress = progress,
                                    qualityLoader = qualityLoader
                                )
                            }
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                }

                // Recently Watched heading
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Icon(
                        painter = painterResource(R.drawable.desktop_clock),
                        contentDescription = null,
                        tint = colors["type.secondary"],
                        modifier = Modifier.size(20.dp)
                    )
                    Text(
                        text = t("home.watchHistory.recentlyWatched"),
                        color = colors["type.secondary"],
                        fontSize = 18.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                }

                Spacer(Modifier.height(4.dp))
            }
        }

        items(historyItems, key = { "${it.media.type}:${it.media.id}" }) { item ->
            val progress = if (item.duration > 0) (item.position / item.duration).toFloat().coerceIn(0f, 1f) else null
            Box(contentAlignment = Alignment.TopEnd) {
                TvMediaCard(
                    item = item.media,
                    onOpen = {
                        if (!uiState.isEditing) onOpenMedia(item.media)
                        else onAction(WatchHistoryAction.DeleteItem(item))
                    },
                    progress = progress,
                    qualityLoader = qualityLoader
                )
                if (item.season != null && item.episode != null) {
                    Box(
                        modifier = Modifier
                            .align(Alignment.TopStart)
                            .padding(8.dp)
                            .clip(RoundedCornerShape(6.dp))
                            .background(colors["pill.background"].copy(alpha = 0.85f))
                            .padding(horizontal = 6.dp, vertical = 3.dp)
                    ) {
                        Text(
                            text = "S${item.season} E${item.episode}",
                            color = colors["type.emphasis"],
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }
                }
                if (uiState.isEditing) {
                    Box(
                        modifier = Modifier
                            .padding(8.dp)
                            .clip(RoundedCornerShape(50))
                            .background(colors["type.danger"])
                            .padding(horizontal = 8.dp, vertical = 4.dp)
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(4.dp)
                        ) {
                            Icon(
                                painter = painterResource(R.drawable.desktop_close),
                                contentDescription = null,
                                tint = Color.White,
                                modifier = Modifier.size(12.dp)
                            )
                            Text(
                                text = t("lists.actions.delete"),
                                color = Color.White,
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Bold
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
internal fun WatchHistoryScreen(state: FrameZooState) {
    var editing by remember { mutableStateOf(false) }
    WatchHistoryScreen(
        uiState = WatchHistoryUiState(
            history = state.history,
            progress = state.progress,
            isEditing = editing
        ),
        onAction = { action ->
            when (action) {
                is WatchHistoryAction.ToggleEditMode -> editing = !editing
                is WatchHistoryAction.DeleteItem -> state.removeHistory(action.item.media)
                is WatchHistoryAction.ClearAll -> {
                    state.clearHistory()
                    editing = false
                }
                is WatchHistoryAction.Refresh -> {}
            }
        },
        onOpenMedia = { state.openDetails(it) },
        qualityLoader = state.backend::releaseQuality,
        onBack = { state.back() }
    )
}
