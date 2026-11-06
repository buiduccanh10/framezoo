package com.framezoo.tv.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.framezoo.tv.R

private enum class SettingsCategory {
    PREFERENCES,
    APPEARANCE,
    CAPTIONS,
    TORRENT,
    CONNECTIONS,
    ACCOUNT
}

@Composable
internal fun SettingsScreen(state: FrameZooState) {
    val colors = LocalFrameZooColors.current
    var selectedCategory by remember { mutableStateOf(SettingsCategory.PREFERENCES) }
    val backRequester = remember { FocusRequester() }
    val backendAction = remember { FocusRequester() }

    Column(modifier = Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(
                text = t("global.pages.settings"),
                style = MaterialTheme.typography.headlineLarge,
                color = colors["type.emphasis"]
            )
            TvButton(
                label = t("discover.page.back"),
                icon = R.drawable.desktop_chevron_left,
                navigation = true,
                modifier = Modifier.focusRequester(backRequester)
            ) {
                state.back()
            }
        }

        Spacer(Modifier.height(20.dp))

        // Categories Tab Row
        val categories = listOf(
            SettingsCategory.PREFERENCES to t("settings.preferences.title"),
            SettingsCategory.APPEARANCE to t("settings.appearance.title"),
            SettingsCategory.CAPTIONS to t("settings.subtitles.title"),
            SettingsCategory.TORRENT to t("settings.torrent.title"),
            SettingsCategory.CONNECTIONS to t("settings.connections.title"),
            SettingsCategory.ACCOUNT to t("settings.account.title")
        )
        LazyRow(
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            contentPadding = PaddingValues(vertical = 4.dp)
        ) {
            items(categories) { (cat, label) ->
                TvButton(
                    label = label,
                    selected = selectedCategory == cat,
                    navigation = true
                ) {
                    selectedCategory = cat
                }
            }
        }

        Spacer(Modifier.height(24.dp))

        // Category Content Area
        Box(modifier = Modifier.fillMaxSize()) {
            when (selectedCategory) {
                SettingsCategory.PREFERENCES -> PreferencesSection(state)
                SettingsCategory.APPEARANCE -> AppearanceSection(state)
                SettingsCategory.CAPTIONS -> CaptionsSection(state)
                SettingsCategory.TORRENT -> TorrentSection(state)
                SettingsCategory.CONNECTIONS -> ConnectionsSection(state, backendAction)
                SettingsCategory.ACCOUNT -> AccountSection(state)
            }
        }
    }
}

@Composable
private fun PreferencesSection(state: FrameZooState) {
    val colors = LocalFrameZooColors.current
    val i18n = LocalI18n.current

    LazyColumn(verticalArrangement = Arrangement.spacedBy(20.dp), contentPadding = PaddingValues(bottom = 40.dp)) {
        item {
            Text(
                text = t("settings.preferences.language"),
                fontSize = 22.sp,
                fontWeight = FontWeight.Bold,
                color = colors["type.emphasis"]
            )
        }
        item {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                val languages = listOf(
                    "vi" to "Tiếng Việt",
                    "en" to "English",
                    "fr" to "Français",
                    "es" to "Español",
                    "de" to "Deutsch",
                    "ja" to "日本語",
                    "ko" to "한국어",
                    "zh" to "中文",
                    "ru" to "Русский",
                    "it" to "Italiano",
                    "pt-BR" to "Português (Brasil)"
                )
                items(languages) { (code, name) ->
                    TvButton(
                        label = name,
                        selected = i18n.language == code,
                        navigation = true
                    ) {
                        state.setLanguage(code)
                    }
                }
            }
        }
    }
}

@Composable
private fun AppearanceSection(state: FrameZooState) {
    val colors = LocalFrameZooColors.current
    val customPrimaryLabel = t("settings.appearance.customParts.primary")
    val customSecondaryLabel = t("settings.appearance.customParts.secondary")
    val customTertiaryLabel = t("settings.appearance.customParts.tertiary")

    LazyColumn(verticalArrangement = Arrangement.spacedBy(18.dp), contentPadding = PaddingValues(bottom = 40.dp)) {
        item {
            Text(
                text = t("settings.appearance.title"),
                fontSize = 22.sp,
                fontWeight = FontWeight.Bold,
                color = colors["type.emphasis"]
            )
        }
        items(themeNames.chunked(5)) { names ->
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                names.forEach { name ->
                    TvThemePreview(name, selected = state.theme.equals(name, true)) {
                        state.updateTheme(name)
                    }
                }
            }
        }
        if (state.theme == "custom") {
            listOf(
                Triple("primary", customPrimaryLabel, state.customPrimary),
                Triple("secondary", customSecondaryLabel, state.customSecondary),
                Triple("tertiary", customTertiaryLabel, state.customTertiary),
            ).forEach { (part, label, value) ->
                item { Text(label, fontSize = 18.sp, fontWeight = FontWeight.Bold, color = colors["type.emphasis"]) }
                item {
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        items(themeNames.filter { it != "custom" }) { name ->
                            TvThemePreview(name, selected = value == name) {
                                state.updateCustomPart(part, name)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun CaptionsSection(state: FrameZooState) {
    val colors = LocalFrameZooColors.current

    LazyColumn(verticalArrangement = Arrangement.spacedBy(18.dp), contentPadding = PaddingValues(bottom = 40.dp)) {
        item {
            Text(
                text = t("settings.subtitles.title"),
                fontSize = 22.sp,
                fontWeight = FontWeight.Bold,
                color = colors["type.emphasis"]
            )
        }

        // Live Subtitle Preview Card matching desktop CaptionPreview
        item {
            val previewQuote = t("settings.subtitles.previewQuote")
            val fontSizeSp = (18 * state.subtitleFontSize / 100).sp
            val textColor = try { Color(android.graphics.Color.parseColor(state.subtitleColor)) } catch (_: Exception) { Color.White }
            val bgColor = Color.Black.copy(alpha = state.subtitleBackgroundOpacity / 100f)

            Box(
                modifier = Modifier
                    .fillMaxWidth(0.75f)
                    .height(140.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(
                        Brush.radialGradient(
                            listOf(Color(0xFFEEAA45), Color(0xFF48D3FF).copy(alpha = 0.5f), Color(0xFF3B27B2))
                        )
                    ),
                contentAlignment = Alignment.BottomCenter
            ) {
                Box(
                    modifier = Modifier
                        .padding(16.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .background(bgColor)
                        .padding(horizontal = 14.dp, vertical = 6.dp)
                ) {
                    Text(
                        text = previewQuote,
                        color = textColor,
                        fontSize = fontSizeSp,
                        fontWeight = FontWeight.SemiBold
                    )
                }
            }
        }

        // Font Size
        item {
            Text(
                text = t("settings.subtitles.textSizeLabel"),
                fontSize = 17.sp,
                fontWeight = FontWeight.SemiBold,
                color = colors["type.secondary"]
            )
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                listOf(75, 100, 125, 150).forEach { size ->
                    TvButton(
                        label = "$size%",
                        selected = state.subtitleFontSize == size,
                        navigation = true
                    ) {
                        state.updateSubtitleFontSize(size)
                    }
                }
            }
        }

        // Text Color
        item {
            Text(
                text = t("settings.subtitles.colorLabel"),
                fontSize = 17.sp,
                fontWeight = FontWeight.SemiBold,
                color = colors["type.secondary"]
            )
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                val colorOptions = listOf(
                    "#FFFFFF" to "White",
                    "#FFFF00" to "Yellow",
                    "#00FF00" to "Green",
                    "#00FFFF" to "Cyan"
                )
                colorOptions.forEach { (hex, label) ->
                    TvButton(
                        label = label,
                        selected = state.subtitleColor.equals(hex, ignoreCase = true),
                        navigation = true
                    ) {
                        state.updateSubtitleColor(hex)
                    }
                }
            }
        }

        // Background Opacity
        item {
            Text(
                text = t("settings.subtitles.backgroundLabel"),
                fontSize = 17.sp,
                fontWeight = FontWeight.SemiBold,
                color = colors["type.secondary"]
            )
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                listOf(0, 25, 50, 75, 100).forEach { opacity ->
                    TvButton(
                        label = "$opacity%",
                        selected = state.subtitleBackgroundOpacity == opacity,
                        navigation = true
                    ) {
                        state.updateSubtitleBackgroundOpacity(opacity)
                    }
                }
            }
        }
    }
}

@Composable
private fun TorrentSection(state: FrameZooState) {
    val colors = LocalFrameZooColors.current

    LazyColumn(verticalArrangement = Arrangement.spacedBy(18.dp), contentPadding = PaddingValues(bottom = 40.dp)) {
        item {
            Text(
                text = t("settings.torrent.title"),
                fontSize = 22.sp,
                fontWeight = FontWeight.Bold,
                color = colors["type.emphasis"]
            )
        }
        item {
            Text(
                text = t("settings.torrent.maxSizeLabel"),
                fontSize = 17.sp,
                fontWeight = FontWeight.SemiBold,
                color = colors["type.secondary"]
            )
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                listOf("5gb" to "5 GB", "10gb" to "10 GB", "20gb" to "20 GB", "unlimited" to "Unlimited").forEach { (id, label) ->
                    TvButton(
                        label = label,
                        selected = state.torrentCacheSize == id,
                        navigation = true
                    ) {
                        state.updateTorrentCacheSize(id)
                    }
                }
            }
        }
        item {
            Text(
                text = t("settings.torrent.cacheSizeBehaviorDescription"),
                color = colors["type.secondary"],
                fontSize = 14.sp,
                modifier = Modifier.fillMaxWidth(0.7f)
            )
        }
    }
}

@Composable
private fun ConnectionsSection(state: FrameZooState, backendAction: FocusRequester) {
    val colors = LocalFrameZooColors.current

    LazyColumn(verticalArrangement = Arrangement.spacedBy(18.dp), contentPadding = PaddingValues(bottom = 40.dp)) {
        item {
            Text(
                text = t("settings.connections.title"),
                fontSize = 22.sp,
                fontWeight = FontWeight.Bold,
                color = colors["type.emphasis"]
            )
        }
        item {
            OutlinedTextField(
                value = state.backendUrl,
                onValueChange = { state.backendUrl = it },
                label = { Text(t("auth.backendSelection.customBackend")) },
                placeholder = { Text("https://") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { backendAction.requestFocus() }),
                colors = tvFieldColors(),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth(0.7f)
            )
        }
        item {
            TvButton(
                label = t("settings.save"),
                primary = true,
                modifier = Modifier.focusRequester(backendAction)
            ) {
                state.saveBackend()
            }
        }
    }
}

@Composable
private fun AccountSection(state: FrameZooState) {
    val colors = LocalFrameZooColors.current

    LazyColumn(verticalArrangement = Arrangement.spacedBy(18.dp), contentPadding = PaddingValues(bottom = 40.dp)) {
        item {
            Text(
                text = t("settings.account.title"),
                fontSize = 22.sp,
                fontWeight = FontWeight.Bold,
                color = colors["type.emphasis"]
            )
        }
        item {
            if (state.store.userId != null) {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(
                        text = "ID: ${state.store.userId}",
                        color = colors["type.emphasis"],
                        fontSize = 17.sp,
                        fontWeight = FontWeight.Medium
                    )
                    TvButton(
                        label = t("navigation.menu.logout")
                    ) {
                        state.logout()
                    }
                }
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(
                        text = t("auth.login.failedToReachServer"),
                        color = colors["type.secondary"]
                    )
                    TvButton(
                        label = t("auth.login.submit"),
                        primary = true
                    ) {
                        state.openLogin()
                    }
                }
            }
        }
    }
}
