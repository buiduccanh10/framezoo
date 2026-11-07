package com.framezoo.tv.ui

import androidx.compose.foundation.BorderStroke
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
import androidx.tv.material3.Border as TvBorder
import androidx.tv.material3.ClickableSurfaceDefaults as TvSurfaceDefaults
import androidx.tv.material3.Surface as TvSurface
import com.framezoo.tv.R
import com.framezoo.tv.model.Media
import com.framezoo.tv.ui.features.bookmarks.BookmarksAction
import com.framezoo.tv.ui.features.bookmarks.BookmarksUiState

@Composable
internal fun BookmarksScreen(
    uiState: BookmarksUiState,
    onAction: (BookmarksAction) -> Unit,
    onOpenMedia: (Media) -> Unit,
    qualityLoader: (suspend (Media) -> String?)? = null,
    onBack: () -> Unit
) {
    val colors = LocalFrameZooColors.current
    val gridState = rememberLazyGridState()
    val backRequester = remember { FocusRequester() }
    val editRequester = remember { FocusRequester() }

    val bookmarks = uiState.filteredBookmarks.distinctBy { it.id }

    if (uiState.bookmarks.isEmpty()) {
        Column(
            modifier = Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            IconPatch(
                icon = R.drawable.desktop_bookmark,
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
                // Top Header Row
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(
                        text = t("home.bookmarks.sectionTitle"),
                        style = MaterialTheme.typography.headlineLarge,
                        color = colors["type.emphasis"]
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        TvButton(
                            label = if (uiState.isEditing) t("home.mediaList.stopEditing") else t("lists.actions.edit"),
                            icon = if (uiState.isEditing) R.drawable.desktop_checkmark else R.drawable.desktop_edit,
                            primary = uiState.isEditing,
                            modifier = Modifier.focusRequester(editRequester)
                        ) {
                            onAction(BookmarksAction.ToggleEditMode)
                        }
                    }
                }

                // Back Button
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

                // Sliding Group Filter Tabs (Matching Desktop AllBookmarks.tsx)
                if (uiState.bookmarkGroups.isNotEmpty()) {
                    LazyRow(
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        item {
                            val selected = uiState.selectedGroup == null
                            GenreFilterChip(
                                label = "${t("discover.tabs.all")} (${uiState.bookmarks.size})",
                                selected = selected,
                                onClick = { onAction(BookmarksAction.SelectGroup(null)) }
                            )
                        }
                        rowItems(uiState.bookmarkGroups) { group ->
                            val count = uiState.bookmarkDetails.count { group in it.groups }
                            val cleanName = group.replace(Regex("^\\[.*?\\]"), "").trim()
                            val selected = uiState.selectedGroup == group
                            GenreFilterChip(
                                label = "$cleanName ($count)",
                                selected = selected,
                                onClick = { onAction(BookmarksAction.SelectGroup(group)) }
                            )
                        }
                    }
                }

                Spacer(Modifier.height(4.dp))
            }
        }

        if (bookmarks.isEmpty()) {
            item(span = { GridItemSpan(maxLineSpan) }) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 40.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = t("home.search.empty.default"),
                        color = colors["type.secondary"],
                        fontSize = 16.sp
                    )
                }
            }
        } else {
            items(bookmarks, key = { it.id }) { item ->
                Box(contentAlignment = Alignment.TopEnd) {
                    TvMediaCard(
                        item = item,
                        onOpen = {
                            if (!uiState.isEditing) onOpenMedia(item)
                            else onAction(BookmarksAction.DeleteBookmark(item))
                        },
                        bookmarked = true,
                        onBookmark = if (uiState.isEditing) null else { { onAction(BookmarksAction.DeleteBookmark(it)) } },
                        qualityLoader = qualityLoader
                    )
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
}

@Composable
internal fun BookmarksScreen(state: FrameZooState) {
    var editing by remember { mutableStateOf(false) }
    var selectedGroup by remember { mutableStateOf<String?>(null) }

    BookmarksScreen(
        uiState = BookmarksUiState(
            bookmarks = state.bookmarks,
            bookmarkDetails = state.bookmarkDetails,
            bookmarkGroups = state.bookmarkGroups,
            selectedGroup = selectedGroup,
            isEditing = editing
        ),
        onAction = { action ->
            when (action) {
                is BookmarksAction.ToggleEditMode -> editing = !editing
                is BookmarksAction.DeleteBookmark -> state.removeBookmark(action.media)
                is BookmarksAction.SelectGroup -> selectedGroup = action.group
                is BookmarksAction.Refresh -> {}
            }
        },
        onOpenMedia = { state.openDetails(it) },
        qualityLoader = state.backend::releaseQuality,
        onBack = { state.back() }
    )
}
