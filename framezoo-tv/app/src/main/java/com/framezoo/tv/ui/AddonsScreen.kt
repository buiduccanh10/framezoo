package com.framezoo.tv.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.framezoo.tv.R
import com.framezoo.tv.model.Addon
import com.framezoo.tv.ui.features.addons.AddonsAction
import com.framezoo.tv.ui.features.addons.AddonsUiState

@Composable
private fun AddonBadge(label: String, color: Color) {
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(6.dp))
            .background(color.copy(alpha = 0.18f))
            .border(BorderStroke(1.dp, color.copy(alpha = 0.45f)), RoundedCornerShape(6.dp))
            .padding(horizontal = 7.dp, vertical = 2.dp)
    ) {
        Text(
            text = label,
            color = color,
            fontSize = 11.sp,
            fontWeight = FontWeight.SemiBold
        )
    }
}

@Composable
internal fun AddonsScreen(
    uiState: AddonsUiState,
    onAction: (AddonsAction) -> Unit,
    onBack: () -> Unit
) {
    val colors = LocalFrameZooColors.current
    val backRequester = remember { FocusRequester() }
    val addAddonRequester = remember { FocusRequester() }
    val modalAddRequester = remember { FocusRequester() }
    var showAddDialog by remember { mutableStateOf(false) }

    LazyColumn(
        verticalArrangement = Arrangement.spacedBy(16.dp),
        contentPadding = PaddingValues(bottom = 48.dp),
        modifier = Modifier.fillMaxSize()
    ) {
        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    text = t("addons.page.title"),
                    style = MaterialTheme.typography.headlineLarge,
                    color = colors["type.emphasis"]
                )
                TvButton(
                    label = t("addons.page.addAddonButton"),
                    icon = R.drawable.desktop_plus,
                    accent = true,
                    modifier = Modifier.focusRequester(addAddonRequester)
                ) {
                    showAddDialog = true
                }
            }
        }

        item {
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
        }

        item {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.padding(top = 8.dp)
            ) {
                Icon(
                    painter = painterResource(R.drawable.desktop_extension),
                    contentDescription = null,
                    tint = colors["type.emphasis"],
                    modifier = Modifier.size(22.dp)
                )
                Text(
                    text = t("addons.page.installedHeading"),
                    color = colors["type.emphasis"],
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Bold
                )
            }
        }

        if (uiState.installed.isEmpty()) {
            item {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(16.dp))
                        .border(
                            BorderStroke(1.dp, colors["authentication.border"]),
                            RoundedCornerShape(16.dp)
                        )
                        .background(colors["background.secondary"].copy(alpha = 0.5f))
                        .padding(32.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Icon(
                            painter = painterResource(R.drawable.desktop_extension),
                            contentDescription = null,
                            tint = colors["type.secondary"],
                            modifier = Modifier.size(48.dp)
                        )
                        Text(
                            text = t("addons.player.emptyExplanation"),
                            color = colors["type.secondary"],
                            fontSize = 16.sp,
                            fontWeight = FontWeight.Medium
                        )
                    }
                }
            }
        } else {
            items(uiState.installed, key = { it.manifestUrl }) { addon ->
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(14.dp))
                        .background(colors["background.secondary"].copy(alpha = 0.6f))
                        .border(BorderStroke(1.dp, colors["settings.card.border"].copy(alpha = 0.5f)), RoundedCornerShape(14.dp))
                        .padding(horizontal = 20.dp, vertical = 16.dp)
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Column(
                            verticalArrangement = Arrangement.spacedBy(6.dp),
                            modifier = Modifier.weight(1f).padding(end = 16.dp)
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(10.dp)
                            ) {
                                Text(
                                    text = addon.name,
                                    color = colors["type.emphasis"],
                                    fontSize = 18.sp,
                                    fontWeight = FontWeight.Bold
                                )
                                Text(
                                    text = addon.manifestUrl,
                                    color = colors["type.secondary"],
                                    fontSize = 12.sp,
                                    maxLines = 1
                                )
                            }
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                if (addon.resources.contains("stream")) AddonBadge("Streams", Color(0xFF48D3FF))
                                if (addon.resources.contains("subtitles")) AddonBadge("Subtitles", Color(0xFFC53BB0))
                                if (addon.resources.contains("catalog")) AddonBadge("Catalogs", Color(0xFF4CAF50))
                                if (addon.resources.contains("meta")) AddonBadge("Metadata", Color(0xFFFFB300))
                            }
                        }

                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            TvButton(
                                label = if (addon.enabled) t("addons.page.enabled") else t("addons.page.disabled"),
                                primary = addon.enabled
                            ) {
                                onAction(AddonsAction.ToggleAddon(addon.manifestUrl))
                            }

                            TvButton(
                                label = t("addons.page.removeAddon"),
                                icon = R.drawable.desktop_close
                            ) {
                                onAction(AddonsAction.RemoveAddon(addon.manifestUrl))
                            }
                        }
                    }
                }
            }
        }
    }

    if (showAddDialog) {
        Dialog(
            onDismissRequest = { showAddDialog = false },
            properties = DialogProperties(usePlatformDefaultWidth = false)
        ) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color.Black.copy(alpha = 0.75f)),
                contentAlignment = Alignment.Center
            ) {
                Box(
                    modifier = Modifier
                        .width(580.dp)
                        .clip(RoundedCornerShape(20.dp))
                        .background(colors["background.main"])
                        .border(BorderStroke(1.dp, colors["authentication.border"]), RoundedCornerShape(20.dp))
                        .padding(28.dp)
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(18.dp)) {
                        Text(
                            text = t("addons.manager.title"),
                            style = MaterialTheme.typography.headlineMedium,
                            color = colors["type.emphasis"]
                        )
                        Text(
                            text = t("addons.manager.subtitle"),
                            color = colors["type.secondary"],
                            fontSize = 13.sp
                        )
                        OutlinedTextField(
                            value = uiState.addonUrl,
                            onValueChange = { onAction(AddonsAction.UrlChanged(it)) },
                            placeholder = { Text("https://addon.example.com/manifest.json") },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                            keyboardActions = KeyboardActions(onDone = { modalAddRequester.requestFocus() }),
                            colors = tvFieldColors(),
                            shape = RoundedCornerShape(12.dp),
                            modifier = Modifier.fillMaxWidth()
                        )
                        if (!uiState.errorMessage.isNullOrBlank()) {
                            Text(uiState.errorMessage, color = colors["type.danger"], fontSize = 13.sp)
                        }
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.End
                        ) {
                            TvButton(
                                label = t("actions.cancel")
                            ) {
                                showAddDialog = false
                            }
                            Spacer(Modifier.width(12.dp))
                            TvButton(
                                label = t("addons.manager.add"),
                                accent = true,
                                loading = uiState.isLoading,
                                modifier = Modifier.focusRequester(modalAddRequester)
                            ) {
                                onAction(AddonsAction.InstallAddon)
                                showAddDialog = false
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
internal fun AddonsScreen(state: FrameZooState) {
    AddonsScreen(
        uiState = AddonsUiState(
            installed = state.installed,
            addonUrl = state.addonUrl,
            isLoading = state.busy,
            errorMessage = state.error.ifBlank { null }
        ),
        onAction = { action ->
            when (action) {
                is AddonsAction.UrlChanged -> state.addonUrl = action.value
                is AddonsAction.InstallAddon -> state.installAddon()
                is AddonsAction.RemoveAddon -> state.installed.firstOrNull { it.manifestUrl == action.id }?.let { state.removeAddon(it) }
                is AddonsAction.ToggleAddon -> state.installed.firstOrNull { it.manifestUrl == action.id }?.let { state.toggleAddon(it) }
                is AddonsAction.ClearError -> state.error = ""
                is AddonsAction.Refresh -> {}
            }
        },
        onBack = { state.back() }
    )
}
