package com.framezoo.tv.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
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
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.framezoo.tv.R
import com.framezoo.tv.model.Media

@Composable
internal fun BookmarksScreen(state: FrameZooState) {
    val colors = LocalFrameZooColors.current
    val gridState = rememberLazyGridState()
    var editing by remember { mutableStateOf(false) }
    val backRequester = remember { FocusRequester() }
    val editRequester = remember { FocusRequester() }

    val bookmarks = state.bookmarks.distinctBy { it.id }

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
                        text = t("home.bookmarks.sectionTitle"),
                        style = MaterialTheme.typography.headlineLarge,
                        color = colors["type.emphasis"]
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
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

                Spacer(Modifier.height(8.dp))
            }
        }

        items(bookmarks, key = { it.id }) { item ->
            Box(contentAlignment = Alignment.TopEnd) {
                TvMediaCard(
                    item = item,
                    onOpen = { if (!editing) state.openDetails(item) else state.removeBookmark(item) },
                    bookmarked = true,
                    onBookmark = if (editing) null else { { state.bookmark(it) } },
                    qualityLoader = state.backend::releaseQuality
                )
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
                                tint = androidx.compose.ui.graphics.Color.White,
                                modifier = Modifier.size(12.dp)
                            )
                            Text(
                                text = t("lists.actions.delete"),
                                color = androidx.compose.ui.graphics.Color.White,
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
