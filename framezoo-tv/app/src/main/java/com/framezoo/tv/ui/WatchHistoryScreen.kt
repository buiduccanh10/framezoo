package com.framezoo.tv.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
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
import com.framezoo.tv.R
import com.framezoo.tv.model.LibraryItem

@Composable
internal fun WatchHistoryScreen(state: FrameZooState) {
    val colors = LocalFrameZooColors.current
    val gridState = rememberLazyGridState()
    var editing by remember { mutableStateOf(false) }
    val backRequester = remember { FocusRequester() }
    val editRequester = remember { FocusRequester() }

    // Group items by base media (for shows, pick most recently watched)
    val historyItems = remember(state.history) {
        state.history.distinctBy { "${it.media.type}:${it.media.id}" }
    }

    if (historyItems.isEmpty()) {
        Column(
            modifier = Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Icon(
                painter = painterResource(R.drawable.desktop_clock),
                contentDescription = null,
                tint = colors["type.logo"],
                modifier = Modifier.size(54.dp)
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
                state.back()
            }
        }
        return
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
                        if (editing) {
                            TvButton(
                                label = t("settings.torrent.clearCache"),
                                icon = R.drawable.desktop_close
                            ) {
                                state.clearHistory()
                                editing = false
                            }
                        }
                        TvButton(
                            label = if (editing) t("home.mediaList.stopEditing") else t("lists.actions.edit"),
                            icon = if (editing) R.drawable.desktop_checkmark else R.drawable.desktop_edit,
                            primary = editing,
                            modifier = Modifier.focusRequester(editRequester)
                        ) {
                            editing = !editing
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
                        state.back()
                    }
                }

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
                    onOpen = { if (!editing) state.openDetails(item.media) else state.removeHistory(item.media) },
                    progress = progress,
                    qualityLoader = state.backend::releaseQuality
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
                if (editing) {
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
