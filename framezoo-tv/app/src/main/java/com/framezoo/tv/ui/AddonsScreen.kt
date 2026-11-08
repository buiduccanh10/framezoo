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
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import coil.compose.SubcomposeAsyncImage
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
            .padding(horizontal = 8.dp, vertical = 2.dp)
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
                        .padding(36.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(14.dp)
                    ) {
                        IconPatch(
                            icon = R.drawable.desktop_extension,
                            contentColor = colors["type.secondary"],
                            size = 56.dp,
                            iconSize = 28.dp
                        )
                        Text(
                            text = t("addons.page.emptyInstalled"),
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
                        .clip(RoundedCornerShape(16.dp))
                        .background(colors["dropdown.contentBackground"].copy(alpha = 0.6f))
                        .border(BorderStroke(1.dp, colors["dropdown.border"].copy(alpha = 0.7f)), RoundedCornerShape(16.dp))
                        .padding(horizontal = 20.dp, vertical = 18.dp)
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        // Left: Addon Logo / Icon
                        Box(
                            modifier = Modifier
                                .size(46.dp)
                                .clip(RoundedCornerShape(12.dp))
                                .background(Color.White.copy(alpha = 0.08f)),
                            contentAlignment = Alignment.Center
                        ) {
                            if (!addon.logo.isNullOrBlank()) {
                                SubcomposeAsyncImage(
                                    model = addon.logo,
                                    contentDescription = "${addon.name} logo",
                                    modifier = Modifier.fillMaxSize().padding(4.dp),
                                    contentScale = ContentScale.Fit,
                                    error = {
                                        Icon(
                                            painter = painterResource(R.drawable.desktop_extension),
                                            contentDescription = null,
                                            tint = colors["type.logo"],
                                            modifier = Modifier.size(24.dp)
                                        )
                                    }
                                )
                            } else {
                                Icon(
                                    painter = painterResource(if (addon.resources.contains("subtitles")) R.drawable.desktop_captions else R.drawable.desktop_extension),
                                    contentDescription = null,
                                    tint = colors["type.logo"],
                                    modifier = Modifier.size(24.dp)
                                )
                            }
                        }

                        Spacer(Modifier.width(16.dp))

                        // Center: Name, Version, Manifest URL, Resource badges, Description
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
                                if (!addon.version.isNullOrBlank()) {
                                    Box(
                                        modifier = Modifier
                                            .clip(RoundedCornerShape(4.dp))
                                            .background(colors["dropdown.altBackground"])
                                            .padding(horizontal = 6.dp, vertical = 2.dp)
                                    ) {
                                        Text(
                                            text = "v${addon.version}",
                                            color = colors["type.secondary"],
                                            fontSize = 11.sp,
                                            fontWeight = FontWeight.Medium
                                        )
                                    }
                                }
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
                            if (!addon.description.isNullOrBlank()) {
                                Text(
                                    text = addon.description,
                                    color = colors["type.secondary"],
                                    fontSize = 12.sp,
                                    maxLines = 2
                                )
                            }
                        }

                        // Right: Controls (Toggle Switch, Remove)
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            TvButton(
                                label = if (addon.enabled) t("addons.page.enabled") else t("addons.page.disabled"),
                                primary = addon.enabled
                            ) {
                                onAction(AddonsAction.ToggleAddon(addon.manifestUrl))
                            }

                            if (!addon.isNative) {
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
    }

    if (showAddDialog) {
        Dialog(onDismissRequest = {
            showAddDialog = false
            onAction(AddonsAction.ClearError)
        }) {
            Column(
                modifier = Modifier
                    .widthIn(min = 360.dp, max = 520.dp)
                    .clip(RoundedCornerShape(20.dp))
                    .background(colors["background.main"])
                    .border(BorderStroke(1.dp, Color.White.copy(alpha = 0.12f)), RoundedCornerShape(20.dp))
                    .padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                Text(
                    text = t("addons.page.addAddonButton"),
                    style = MaterialTheme.typography.headlineMedium,
                    color = colors["type.emphasis"]
                )

                OutlinedTextField(
                    value = uiState.addonUrl,
                    onValueChange = { onAction(AddonsAction.UrlChanged(it)) },
                    label = { Text(t("addons.manager.inputPlaceholder")) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { modalAddRequester.requestFocus() }),
                    colors = tvFieldColors(),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth()
                )

                if (!uiState.errorMessage.isNullOrBlank()) {
                    Text(
                        text = uiState.errorMessage,
                        color = colors["type.danger"],
                        fontSize = 13.sp
                    )
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    TvButton(
                        label = t("actions.cancel")
                    ) {
                        showAddDialog = false
                        onAction(AddonsAction.ClearError)
                    }
                    Spacer(Modifier.width(10.dp))
                    TvButton(
                        label = t("addons.page.addAddonButton"),
                        primary = true,
                        loading = uiState.isLoading,
                        modifier = Modifier.focusRequester(modalAddRequester)
                    ) {
                        onAction(AddonsAction.InstallAddon)
                        if (uiState.errorMessage == null && !uiState.isLoading) {
                            showAddDialog = false
                        }
                    }
                }
            }
        }
    }
}

@Composable
internal fun AddonsScreen(state: FrameZooState) {
    var addonUrl by remember { mutableStateOf("") }
    var isLoading by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    AddonsScreen(
        uiState = AddonsUiState(
            installed = state.installed,
            addonUrl = addonUrl,
            isLoading = isLoading || state.busy,
            errorMessage = errorMessage
        ),
        onAction = { action ->
            when (action) {
                is AddonsAction.UrlChanged -> addonUrl = action.value
                is AddonsAction.ClearError -> errorMessage = null
                is AddonsAction.InstallAddon -> {
                    if (addonUrl.isNotBlank()) {
                        isLoading = true
                        errorMessage = null
                        state.addonUrl = addonUrl
                        state.installAddon()
                        addonUrl = ""
                        isLoading = false
                    }
                }
                is AddonsAction.RemoveAddon -> state.installed.firstOrNull { it.id == action.id || it.manifestUrl == action.id }?.let { state.removeAddon(it) }
                is AddonsAction.ToggleAddon -> state.installed.firstOrNull { it.id == action.id || it.manifestUrl == action.id }?.let { state.toggleAddon(it) }
                is AddonsAction.Refresh -> {}
            }
        },
        onBack = { state.back() }
    )
}
