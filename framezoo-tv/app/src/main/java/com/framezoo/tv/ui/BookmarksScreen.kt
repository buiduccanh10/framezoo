package com.framezoo.tv.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items as rowItems
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.tv.material3.Border as TvBorder
import androidx.tv.material3.ClickableSurfaceDefaults as TvSurfaceDefaults
import androidx.tv.material3.Surface as TvSurface
import com.framezoo.tv.R
import com.framezoo.tv.model.Media
import com.framezoo.tv.model.UserIcon
import com.framezoo.tv.model.UserIconGraphic
import com.framezoo.tv.ui.features.auth.IconPickerTab
import com.framezoo.tv.ui.features.bookmarks.BookmarksAction
import com.framezoo.tv.ui.features.bookmarks.BookmarksUiState

@Composable
internal fun BookmarksScreen(
    uiState: BookmarksUiState,
    onAction: (BookmarksAction) -> Unit,
    onOpenMedia: (Media) -> Unit,
    qualityLoader: (suspend (Media) -> String?)? = null,
    onEditGroup: ((oldGroup: String, newGroup: String) -> Unit)? = null,
    onDeleteGroup: ((group: String) -> Unit)? = null,
    onReorderGroups: ((newOrder: List<String>) -> Unit)? = null,
    onBack: () -> Unit
) {
    val colors = LocalFrameZooColors.current
    val gridState = rememberLazyGridState()
    val backRequester = remember { FocusRequester() }
    val editRequester = remember { FocusRequester() }
    var editingGroup by remember { mutableStateOf<String?>(null) }
    var showReorderDialog by remember { mutableStateOf(false) }

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
                        if (uiState.isEditing && uiState.bookmarkGroups.isNotEmpty() && onEditGroup != null) {
                            val targetGroup = uiState.selectedGroup ?: uiState.bookmarkGroups.first()
                            TvButton(
                                label = "${t("lists.actions.edit")}: ${parseBookmarkGroup(targetGroup).name}",
                                icon = R.drawable.desktop_edit,
                                navigation = true
                            ) {
                                editingGroup = targetGroup
                            }
                        }
                        if (uiState.bookmarkGroups.size > 1 && onReorderGroups != null) {
                            TvButton(
                                label = t("home.bookmarks.groups.reorder.button"),
                                navigation = true
                            ) {
                                showReorderDialog = true
                            }
                        }
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
                            val cleanName = parseBookmarkGroup(group).name
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

    val activeEditGroup = editingGroup
    if (activeEditGroup != null && onEditGroup != null) {
        EditGroupDialog(
            group = activeEditGroup,
            affectedCount = uiState.bookmarkDetails.count { activeEditGroup in it.groups },
            onDismiss = { editingGroup = null },
            onDelete = onDeleteGroup?.let { del -> { del(activeEditGroup); editingGroup = null } },
            onSave = { formatted ->
                onEditGroup(activeEditGroup, formatted)
                editingGroup = null
            }
        )
    }

    if (showReorderDialog && onReorderGroups != null) {
        EditGroupOrderDialog(
            groups = uiState.bookmarkGroups,
            onDismiss = { showReorderDialog = false },
            onSave = { ordered ->
                onReorderGroups(ordered)
                showReorderDialog = false
            }
        )
    }
}

@Composable
private fun EditGroupDialog(
    group: String,
    affectedCount: Int,
    onDismiss: () -> Unit,
    onDelete: (() -> Unit)?,
    onSave: (String) -> Unit
) {
    val colors = LocalFrameZooColors.current
    val parsed = remember(group) { parseBookmarkGroup(group) }
    var nameInput by remember(group) { mutableStateOf(parsed.name) }
    var selectedIcon by remember(group) { mutableStateOf(parsed.icon) }
    var activeTab by remember(group) {
        mutableStateOf(if (parsed.icon in UserIcon.EMOJI_ICONS) IconPickerTab.EMOJI else IconPickerTab.CLASSIC)
    }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Box(
            modifier = Modifier
                .width(540.dp)
                .clip(RoundedCornerShape(20.dp))
                .background(colors["background.main"])
                .border(BorderStroke(1.dp, colors["authentication.border"]), RoundedCornerShape(20.dp))
                .padding(24.dp)
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Text(
                    text = t("home.bookmarks.groups.editGroup.title"),
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Bold,
                    color = colors["type.emphasis"]
                )
                Text(
                    text = t("home.bookmarks.groups.editGroup.description"),
                    fontSize = 13.5.sp,
                    color = colors["type.secondary"]
                )
                OutlinedTextField(
                    value = nameInput,
                    onValueChange = { nameInput = it },
                    label = { Text(t("home.bookmarks.groups.editGroup.nameLabel")) },
                    placeholder = { Text(t("home.bookmarks.groups.editGroup.namePlaceholder")) },
                    singleLine = true,
                    colors = tvFieldColors(),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth()
                )
                TvIconPicker(
                    label = t("settings.account.profile.icon"),
                    selectedIcon = selectedIcon,
                    activeTab = activeTab,
                    onTabChanged = { activeTab = it },
                    onIconSelected = { selectedIcon = it }
                )
                Text(
                    text = t("home.bookmarks.groups.editGroup.affectsBookmarks", "count" to affectedCount),
                    fontSize = 12.5.sp,
                    color = colors["type.secondary"]
                )
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    if (onDelete != null) {
                        TvButton(label = t("lists.actions.delete"), navigation = true, onClick = onDelete)
                    } else {
                        Spacer(Modifier.width(1.dp))
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        TvButton(label = t("home.bookmarks.groups.editGroup.cancel"), navigation = true, onClick = onDismiss)
                        val canSave = nameInput.trim().isNotEmpty()
                        TvButton(
                            label = t("home.bookmarks.groups.editGroup.save"),
                            accent = canSave,
                            navigation = true,
                            modifier = Modifier.alpha(if (canSave) 1f else 0.45f)
                        ) {
                            if (canSave) onSave(formatBookmarkGroup(selectedIcon, nameInput))
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun EditGroupOrderDialog(
    groups: List<String>,
    onDismiss: () -> Unit,
    onSave: (List<String>) -> Unit
) {
    val colors = LocalFrameZooColors.current
    var ordered by remember(groups) { mutableStateOf(groups) }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Box(
            modifier = Modifier
                .width(500.dp)
                .heightIn(max = 540.dp)
                .clip(RoundedCornerShape(20.dp))
                .background(colors["background.main"])
                .border(BorderStroke(1.dp, colors["authentication.border"]), RoundedCornerShape(20.dp))
                .padding(24.dp)
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    text = t("home.bookmarks.groups.reorder.title"),
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Bold,
                    color = colors["type.emphasis"]
                )
                Text(
                    text = t("home.bookmarks.groups.reorder.description"),
                    fontSize = 13.5.sp,
                    color = colors["type.secondary"]
                )
                LazyColumn(
                    modifier = Modifier.weight(1f, fill = false),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    itemsIndexed(ordered) { idx, group ->
                        val parsed = parseBookmarkGroup(group)
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(10.dp))
                                .background(colors["background.secondary"].copy(alpha = 0.45f))
                                .border(BorderStroke(1.dp, colors["authentication.border"]), RoundedCornerShape(10.dp))
                                .padding(horizontal = 12.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(10.dp)
                            ) {
                                when (val g = parsed.icon.toGraphic()) {
                                    is UserIconGraphic.Emoji -> Text(g.char, fontSize = 18.sp)
                                    is UserIconGraphic.VectorRes -> Icon(
                                        painter = painterResource(g.resId),
                                        contentDescription = null,
                                        tint = colors["type.emphasis"],
                                        modifier = Modifier.size(18.dp)
                                    )
                                }
                                Text(
                                    text = parsed.name,
                                    color = colors["type.emphasis"],
                                    fontSize = 15.sp,
                                    fontWeight = FontWeight.Medium
                                )
                            }
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                TvButton(
                                    label = "▲",
                                    navigation = true,
                                    modifier = Modifier.alpha(if (idx > 0) 1f else 0.35f)
                                ) {
                                    if (idx > 0) ordered = moveListItem(ordered, idx, idx - 1)
                                }
                                TvButton(
                                    label = "▼",
                                    navigation = true,
                                    modifier = Modifier.alpha(if (idx < ordered.lastIndex) 1f else 0.35f)
                                ) {
                                    if (idx < ordered.lastIndex) ordered = moveListItem(ordered, idx, idx + 1)
                                }
                            }
                        }
                    }
                }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    TvButton(label = t("home.bookmarks.groups.reorder.cancel"), navigation = true, onClick = onDismiss)
                    Spacer(Modifier.width(10.dp))
                    TvButton(label = t("home.bookmarks.groups.reorder.save"), accent = true, navigation = true) {
                        onSave(ordered)
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
        onEditGroup = { oldGroup, newGroup ->
            state.renameBookmarkGroup(oldGroup, newGroup)
            if (selectedGroup == oldGroup) selectedGroup = newGroup
        },
        onDeleteGroup = { group ->
            state.deleteBookmarkGroup(group)
            if (selectedGroup == group) selectedGroup = null
        },
        onReorderGroups = { ordered ->
            state.reorderBookmarkGroups(ordered)
        },
        onBack = { state.back() }
    )
}
