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
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
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

    if (bookmarks.isEmpty()) {
        Column(
            modifier = Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Icon(
                painter = painterResource(R.drawable.desktop_bookmark),
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

                Spacer(Modifier.height(8.dp))
            }
        }

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

@Composable
internal fun BookmarksScreen(state: FrameZooState) {
    var editing by remember { mutableStateOf(false) }
    BookmarksScreen(
        uiState = BookmarksUiState(
            bookmarks = state.bookmarks,
            bookmarkDetails = state.bookmarkDetails,
            bookmarkGroups = state.bookmarkGroups,
            isEditing = editing
        ),
        onAction = { action ->
            when (action) {
                is BookmarksAction.ToggleEditMode -> editing = !editing
                is BookmarksAction.DeleteBookmark -> state.removeBookmark(action.media)
                is BookmarksAction.SelectGroup -> {}
                is BookmarksAction.Refresh -> {}
            }
        },
        onOpenMedia = { state.openDetails(it) },
        qualityLoader = state.backend::releaseQuality,
        onBack = { state.back() }
    )
}
