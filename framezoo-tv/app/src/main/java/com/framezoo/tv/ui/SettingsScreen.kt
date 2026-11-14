package com.framezoo.tv.ui

import android.view.KeyEvent
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.framezoo.tv.BuildConfig
import com.framezoo.tv.R
import com.framezoo.tv.auth.Auth
import com.framezoo.tv.model.AccountProfile
import com.framezoo.tv.model.DeviceSession
import com.framezoo.tv.model.OtpChallenge
import com.framezoo.tv.model.UserIcon
import com.framezoo.tv.model.parseHexColor
import com.framezoo.tv.ui.features.auth.IconPickerTab
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

private enum class SettingsCategory(val searchKeywords: String) {
    ACCOUNT("account profile nickname email password otp sessions delete logout tài khoản hồ sơ mật khẩu"),
    PREFERENCES("preferences language autoplay skip credits segments order categories home section tùy chọn ngôn ngữ tự động chuyên mục thứ tự"),
    APPEARANCE("appearance theme colors palette custom giao diện chủ đề màu sắc"),
    CAPTIONS("subtitles captions font size color blur border shadow delay position primary secondary phụ đề cỡ chữ viền bóng"),
    CONNECTIONS("connections tidb theintrodb intro api key token submit kết nối")
}

@Composable
internal fun SettingsScreen(state: FrameZooState) {
    val colors = LocalFrameZooColors.current
    val focusManager = LocalFocusManager.current
    var selectedCategory by remember { mutableStateOf(SettingsCategory.ACCOUNT) }
    var searchQuery by remember { mutableStateOf("") }
    val backRequester = remember { FocusRequester() }

    Row(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 32.dp, vertical = 24.dp),
        horizontalArrangement = Arrangement.spacedBy(28.dp)
    ) {
        // Left Column: Sidebar matching desktop SidebarPart.tsx
        Column(
            modifier = Modifier
                .width(260.dp)
                .fillMaxHeight(),
            verticalArrangement = Arrangement.SpaceBetween
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    TvButton(
                        label = t("discover.page.back"),
                        icon = R.drawable.desktop_chevron_left,
                        navigation = true,
                        modifier = Modifier.focusRequester(backRequester)
                    ) {
                        state.back()
                    }
                    Text(
                        text = t("global.pages.settings"),
                        fontSize = 22.sp,
                        fontWeight = FontWeight.Bold,
                        color = colors["type.emphasis"]
                    )
                }

                BasicTextField(
                    value = searchQuery,
                    onValueChange = { searchQuery = it },
                    singleLine = true,
                    textStyle = TextStyle(color = colors["type.emphasis"], fontSize = 14.sp),
                    cursorBrush = SolidColor(colors["type.emphasis"]),
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .background(colors["background.main"].copy(alpha = 0.7f))
                        .border(BorderStroke(1.dp, colors["authentication.border"]), RoundedCornerShape(10.dp))
                        .onPreviewKeyEvent { event ->
                            if (event.nativeKeyEvent.action == KeyEvent.ACTION_DOWN &&
                                event.nativeKeyEvent.keyCode == KeyEvent.KEYCODE_DPAD_DOWN
                            ) focusManager.moveFocus(FocusDirection.Down) else false
                        }
                        .padding(horizontal = 12.dp, vertical = 10.dp),
                    decorationBox = { inner ->
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            Icon(
                                painter = painterResource(R.drawable.desktop_search),
                                contentDescription = null,
                                tint = colors["type.secondary"],
                                modifier = Modifier.size(16.dp)
                            )
                            Box(modifier = Modifier.weight(1f)) {
                                if (searchQuery.isEmpty()) {
                                    Text(
                                        text = t("settings.search.placeholder"),
                                        color = colors["type.secondary"],
                                        fontSize = 13.5.sp
                                    )
                                }
                                inner()
                            }
                        }
                    }
                )

                val allCategories = listOf(
                    Triple(SettingsCategory.ACCOUNT, t("settings.account.title"), R.drawable.desktop_user),
                    Triple(SettingsCategory.PREFERENCES, t("settings.preferences.title"), R.drawable.desktop_settings),
                    Triple(SettingsCategory.APPEARANCE, t("settings.appearance.title"), R.drawable.user_icon_brush),
                    Triple(SettingsCategory.CAPTIONS, t("settings.subtitles.title"), R.drawable.desktop_captions),
                    Triple(SettingsCategory.CONNECTIONS, t("settings.connections.title"), R.drawable.desktop_web)
                )
                val queryClean = searchQuery.trim().lowercase()
                val visibleCategories = remember(queryClean, allCategories) {
                    if (queryClean.isEmpty()) allCategories
                    else allCategories.filter { (cat, label, _) ->
                        label.lowercase().contains(queryClean) || cat.searchKeywords.contains(queryClean)
                    }
                }
                LaunchedEffect(visibleCategories) {
                    if (visibleCategories.isNotEmpty() && visibleCategories.none { it.first == selectedCategory }) {
                        selectedCategory = visibleCategories.first().first
                    }
                }

                Column(
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 4.dp, vertical = 4.dp)
                ) {
                    if (visibleCategories.isEmpty()) {
                        Text(
                            text = t("home.search.empty.default"),
                            color = colors["type.secondary"],
                            fontSize = 13.sp,
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp)
                        )
                    } else {
                        visibleCategories.forEach { (cat, label, iconRes) ->
                            val isSelected = selectedCategory == cat
                            TvButton(
                                label = label,
                                icon = iconRes,
                                selected = isSelected,
                                navigation = true,
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                selectedCategory = cat
                            }
                        }
                    }
                }
            }

            // App Version Card matching SidebarPart.tsx lines 173-179
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(colors["background.secondary"].copy(alpha = 0.25f))
                    .border(BorderStroke(1.dp, colors["authentication.border"]), RoundedCornerShape(12.dp))
                    .padding(horizontal = 16.dp, vertical = 12.dp)
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(
                        text = t("settings.sidebar.info.appVersion"),
                        fontSize = 11.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = colors["type.secondary"]
                    )
                    Text(
                        text = "v${BuildConfig.VERSION_NAME}",
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Medium,
                        color = colors["type.emphasis"]
                    )
                }
            }
        }

        // Right Column: Settings Content Pane
        Box(
            modifier = Modifier
                .weight(1f)
                .fillMaxHeight()
                .clip(RoundedCornerShape(20.dp))
                .background(colors["background.secondary"].copy(alpha = 0.35f))
                .border(BorderStroke(1.dp, colors["authentication.border"]), RoundedCornerShape(20.dp))
                .padding(26.dp)
        ) {
            when (selectedCategory) {
                SettingsCategory.ACCOUNT -> AccountSection(state)
                SettingsCategory.PREFERENCES -> PreferencesSection(state)
                SettingsCategory.APPEARANCE -> AppearanceSection(state)
                SettingsCategory.CAPTIONS -> CaptionsSection(state)
                SettingsCategory.CONNECTIONS -> ConnectionsSection(state)
            }
        }
    }
}

@Composable
private fun PreferencesSection(state: FrameZooState) {
    val colors = LocalFrameZooColors.current
    val i18n = LocalI18n.current

    LazyColumn(
        verticalArrangement = Arrangement.spacedBy(20.dp),
        contentPadding = PaddingValues(bottom = 40.dp)
    ) {
        item {
            Text(
                text = t("settings.preferences.title"),
                fontSize = 24.sp,
                fontWeight = FontWeight.Bold,
                color = colors["type.emphasis"]
            )
        }

        // Language Card matching PreferencesPart.tsx
        item {
            SettingsCardContainer {
                Text(
                    text = t("settings.preferences.language"),
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold,
                    color = colors["type.emphasis"]
                )
                Text(
                    text = t("settings.preferences.languageDescription"),
                    fontSize = 14.sp,
                    color = colors["type.secondary"]
                )
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

        // Autoplay & Skip Credits & Auto Skip Segments Card matching PreferencesPart.tsx
        item {
            SettingsCardContainer {
                Text(
                    text = t("settings.preferences.autoplay"),
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold,
                    color = colors["type.emphasis"]
                )
                Text(
                    text = t("settings.preferences.autoplayDescription"),
                    fontSize = 14.sp,
                    color = colors["type.secondary"]
                )
                TvCheckboxRow(
                    checked = state.enableAutoplay,
                    label = t("settings.preferences.autoplayLabel"),
                    onToggle = { state.toggleAutoplay() }
                )

                if (state.enableAutoplay) {
                    Column(
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .background(colors["background.main"].copy(alpha = 0.5f))
                            .border(BorderStroke(1.dp, colors["authentication.border"]), RoundedCornerShape(12.dp))
                            .padding(14.dp)
                    ) {
                        Text(
                            text = t("settings.preferences.skipCredits"),
                            fontSize = 15.sp,
                            fontWeight = FontWeight.Bold,
                            color = colors["type.emphasis"]
                        )
                        Text(
                            text = t("settings.preferences.skipCreditsDescription"),
                            fontSize = 13.sp,
                            color = colors["type.secondary"]
                        )
                        TvCheckboxRow(
                            checked = state.enableSkipCredits,
                            label = t("settings.preferences.skipCreditsLabel"),
                            onToggle = { state.toggleSkipCredits() }
                        )

                        Spacer(Modifier.height(4.dp))

                        Text(
                            text = t("settings.preferences.autoSkipSegments"),
                            fontSize = 15.sp,
                            fontWeight = FontWeight.Bold,
                            color = colors["type.emphasis"]
                        )
                        Text(
                            text = t("settings.preferences.autoSkipSegmentsDescription"),
                            fontSize = 13.sp,
                            color = colors["type.secondary"]
                        )
                        TvCheckboxRow(
                            checked = state.enableAutoSkipSegments,
                            label = t("settings.preferences.autoSkipSegmentsLabel"),
                            onToggle = { state.toggleAutoSkipSegments() }
                        )
                    }
                }
            }
        }

        // Category Order Card matching PreferencesPart.tsx (`sectionOrder`)
        item {
            SettingsCardContainer {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(
                            text = t("settings.preferences.homeSectionOrder"),
                            fontSize = 18.sp,
                            fontWeight = FontWeight.Bold,
                            color = colors["type.emphasis"]
                        )
                        Text(
                            text = t("settings.preferences.homeSectionOrderDescription"),
                            fontSize = 13.5.sp,
                            color = colors["type.secondary"]
                        )
                    }
                    TvButton(
                        label = t("settings.preferences.resetHomeSectionOrder"),
                        navigation = true
                    ) {
                        state.resetHomeSectionOrder()
                    }
                }
                val order = state.homeSectionOrder
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    order.forEachIndexed { idx, key ->
                        val sectionTitle = when (key) {
                            "trending" -> t("discover.carousel.title.trending")
                            "popular" -> t("discover.carousel.title.popular")
                            "provider" -> t("discover.carousel.title.providers")
                            "top" -> t("discover.carousel.title.topRated")
                            "editor" -> t("discover.carousel.title.editorPicks")
                            "latest" -> t("discover.carousel.title.latestReleases")
                            "personal" -> t("discover.carousel.title.forYou")
                            "recommendations" -> t("discover.carousel.title.recommendations")
                            "genre" -> t("discover.carousel.title.genres")
                            "addons" -> t("discover.carousel.title.addons")
                            else -> key
                        }
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(10.dp))
                                .background(colors["background.main"].copy(alpha = 0.55f))
                                .border(BorderStroke(1.dp, colors["authentication.border"]), RoundedCornerShape(10.dp))
                                .padding(horizontal = 14.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text(
                                text = "${idx + 1}. $sectionTitle",
                                color = colors["type.emphasis"],
                                fontSize = 14.5.sp,
                                fontWeight = FontWeight.Medium
                            )
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                TvButton(
                                    label = "▲",
                                    navigation = true,
                                    modifier = Modifier.alpha(if (idx > 0) 1f else 0.35f)
                                ) {
                                    if (idx > 0) state.moveHomeSection(idx, -1)
                                }
                                TvButton(
                                    label = "▼",
                                    navigation = true,
                                    modifier = Modifier.alpha(if (idx < order.lastIndex) 1f else 0.35f)
                                ) {
                                    if (idx < order.lastIndex) state.moveHomeSection(idx, 1)
                                }
                            }
                        }
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
                fontSize = 24.sp,
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
    var editingSecondary by remember { mutableStateOf(false) }

    val curFontSize = if (editingSecondary) state.secondarySubtitleFontSize else state.subtitleFontSize
    val curColor = if (editingSecondary) state.secondarySubtitleColor else state.subtitleColor
    val curOpacity = if (editingSecondary) state.secondarySubtitleBackgroundOpacity else state.subtitleBackgroundOpacity
    val curBlurEnabled = if (editingSecondary) state.secondarySubtitleBackgroundBlurEnabled else state.subtitleBackgroundBlurEnabled
    val curBlur = if (editingSecondary) state.secondarySubtitleBackgroundBlur else state.subtitleBackgroundBlur
    val curFontStyle = if (editingSecondary) state.secondarySubtitleFontStyle else state.subtitleFontStyle
    val curBorderThickness = if (editingSecondary) state.secondarySubtitleBorderThickness else state.subtitleBorderThickness
    val curBold = if (editingSecondary) state.secondarySubtitleBold else state.subtitleBold
    val curVerticalPos = if (editingSecondary) state.secondarySubtitleVerticalPosition else state.subtitleVerticalPosition

    LazyColumn(verticalArrangement = Arrangement.spacedBy(16.dp), contentPadding = PaddingValues(bottom = 40.dp)) {
        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = t("settings.subtitles.title"),
                    fontSize = 24.sp,
                    fontWeight = FontWeight.Bold,
                    color = colors["type.emphasis"]
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TvButton(
                        label = t("player.menus.subtitles.primary"),
                        selected = !editingSecondary,
                        navigation = true
                    ) { editingSecondary = false }
                    TvButton(
                        label = t("player.menus.subtitles.secondary"),
                        selected = editingSecondary,
                        navigation = true
                    ) { editingSecondary = true }
                }
            }
        }

        // Live Subtitle Preview Card matching desktop CaptionPreview
        item {
            val previewQuote = t("settings.subtitles.previewQuote")
            val fontSizeSp = (18 * curFontSize / 100).sp
            val textColor = parseHexColor(curColor, Color.White)
            val blurAlphaBoost = if (curBlurEnabled) (curBlur / 100f) * 0.2f else 0f
            val bgColor = Color.Black.copy(alpha = ((curOpacity / 100f) + blurAlphaBoost).coerceIn(0f, 1f))
            val fontWeight = if (curBold) FontWeight.Bold else FontWeight.Medium
            val textShadow = when (curFontStyle) {
                "dropShadow" -> Shadow(Color.Black.copy(alpha = 0.9f), Offset(3f, 3f), 6f)
                "raised" -> Shadow(Color.Black.copy(alpha = 0.9f), Offset(0f, 3f), 2f)
                "depressed" -> Shadow(Color.Black.copy(alpha = 0.9f), Offset(0f, -3f), 2f)
                else -> Shadow(Color.Black.copy(alpha = 0.45f), Offset(1f, 1f), 2f)
            }

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
                contentAlignment = if (curVerticalPos == 3) Alignment.Center else Alignment.BottomCenter
            ) {
                Box(
                    modifier = Modifier
                        .padding(16.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .background(bgColor)
                        .then(
                            if (curBlurEnabled && curBlur > 0) {
                                Modifier.border(BorderStroke(1.dp, Color.White.copy(alpha = 0.14f)), RoundedCornerShape(6.dp))
                            } else Modifier
                        )
                        .padding(horizontal = 14.dp, vertical = 6.dp)
                ) {
                    if (curFontStyle == "Border") {
                        Text(
                            text = previewQuote,
                            style = TextStyle(
                                color = Color.Black,
                                fontSize = fontSizeSp,
                                fontWeight = fontWeight,
                                drawStyle = Stroke(width = (curBorderThickness * 3f).coerceIn(1.5f, 18f))
                            )
                        )
                    }
                    Text(
                        text = previewQuote,
                        style = TextStyle(
                            color = textColor,
                            fontSize = fontSizeSp,
                            fontWeight = fontWeight,
                            shadow = if (curFontStyle == "Border") null else textShadow
                        )
                    )
                }
            }
        }

        // Background Opacity
        item {
            Text(
                text = t("settings.subtitles.backgroundLabel"),
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold,
                color = colors["type.secondary"]
            )
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                listOf(0, 25, 50, 75, 100).forEach { opacity ->
                    TvButton(
                        label = "$opacity%",
                        selected = curOpacity == opacity,
                        navigation = true
                    ) {
                        state.updateSubtitleBackgroundOpacity(opacity, editingSecondary)
                    }
                }
            }
        }

        // Background Blur Toggle + Intensity
        item {
            TvCheckboxRow(
                checked = curBlurEnabled,
                label = t("settings.subtitles.backgroundBlurEnabledLabel"),
                onToggle = { state.toggleSubtitleBackgroundBlur(editingSecondary) }
            )
        }
        if (curBlurEnabled) {
            item {
                Text(
                    text = t("settings.subtitles.backgroundBlurLabel"),
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = colors["type.secondary"]
                )
            }
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    listOf(0, 25, 50, 75, 100).forEach { blur ->
                        TvButton(
                            label = "$blur%",
                            selected = curBlur == blur,
                            navigation = true
                        ) {
                            state.updateSubtitleBackgroundBlur(blur, editingSecondary)
                        }
                    }
                }
            }
        }

        // Font Size
        item {
            Text(
                text = t("settings.subtitles.textSizeLabel"),
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold,
                color = colors["type.secondary"]
            )
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                listOf(75, 100, 125, 150, 200).forEach { size ->
                    TvButton(
                        label = "$size%",
                        selected = curFontSize == size,
                        navigation = true
                    ) {
                        state.updateSubtitleFontSize(size, editingSecondary)
                    }
                }
            }
        }

        // Text Style matching CaptionsPart.tsx
        item {
            Text(
                text = t("settings.subtitles.textStyle.title"),
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold,
                color = colors["type.secondary"]
            )
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                val styles = listOf(
                    "default" to t("settings.subtitles.textStyle.default"),
                    "raised" to t("settings.subtitles.textStyle.raised"),
                    "depressed" to t("settings.subtitles.textStyle.depressed"),
                    "Border" to t("settings.subtitles.textStyle.Border"),
                    "dropShadow" to t("settings.subtitles.textStyle.dropShadow")
                )
                styles.forEach { (id, label) ->
                    TvButton(
                        label = label,
                        selected = curFontStyle == id,
                        navigation = true
                    ) {
                        state.updateSubtitleFontStyle(id, editingSecondary)
                    }
                }
            }
        }

        if (curFontStyle == "Border") {
            item {
                Text(
                    text = "${t("settings.subtitles.BorderThicknessLabel")}: ${"%.1f".format(java.util.Locale.US, curBorderThickness)}",
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = colors["type.secondary"]
                )
            }
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    TvButton(label = "−", navigation = true) {
                        state.updateSubtitleBorderThickness(curBorderThickness - 0.5f, editingSecondary)
                    }
                    TvButton(label = "1.0", selected = curBorderThickness == 1.0f, navigation = true) {
                        state.updateSubtitleBorderThickness(1.0f, editingSecondary)
                    }
                    TvButton(label = "+", navigation = true) {
                        state.updateSubtitleBorderThickness(curBorderThickness + 0.5f, editingSecondary)
                    }
                }
            }
        }

        // Bold Toggle
        item {
            TvCheckboxRow(
                checked = curBold,
                label = t("settings.subtitles.textBoldLabel"),
                onToggle = { state.toggleSubtitleBold(editingSecondary) }
            )
        }

        // Text Color matching CaptionSettingsView.tsx (`#ffffff`, `#80b1fa`, `#e2e535`, `#10b239`, `#f472b6`)
        item {
            Text(
                text = t("settings.subtitles.colorLabel"),
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold,
                color = colors["type.secondary"]
            )
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                val colorOptions = listOf(
                    "#FFFFFF" to "White",
                    "#80B1FA" to "Blue",
                    "#E2E535" to "Yellow",
                    "#10B239" to "Green",
                    "#F472B6" to "Pink"
                )
                colorOptions.forEach { (hex, label) ->
                    TvButton(
                        label = label,
                        selected = curColor.equals(hex, ignoreCase = true),
                        navigation = true
                    ) {
                        state.updateSubtitleColor(hex, editingSecondary)
                    }
                }
            }
        }

        // Vertical Position (`low` = 1, `high` = 3)
        item {
            Text(
                text = t("settings.subtitles.verticalPositionLabel"),
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold,
                color = colors["type.secondary"]
            )
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                TvButton(
                    label = t("settings.subtitles.low"),
                    selected = curVerticalPos == 1,
                    navigation = true
                ) {
                    state.updateSubtitleVerticalPosition(1, editingSecondary)
                }
                TvButton(
                    label = t("settings.subtitles.high"),
                    selected = curVerticalPos == 3,
                    navigation = true
                ) {
                    state.updateSubtitleVerticalPosition(3, editingSecondary)
                }
            }
        }

        // Reset Button
        item {
            TvButton(
                label = t("settings.reset"),
                navigation = true
            ) {
                state.resetSubtitleStyling(editingSecondary)
            }
        }
    }
}

@Composable
private fun ConnectionsSection(state: FrameZooState) {
    val colors = LocalFrameZooColors.current
    var tidbKeyInput by remember(state.tidbKey) { mutableStateOf(state.tidbKey) }
    var revealKey by remember { mutableStateOf(false) }
    var savedNotice by remember { mutableStateOf(false) }

    LazyColumn(
        verticalArrangement = Arrangement.spacedBy(20.dp),
        contentPadding = PaddingValues(bottom = 40.dp)
    ) {
        item {
            Text(
                text = t("settings.connections.title"),
                fontSize = 24.sp,
                fontWeight = FontWeight.Bold,
                color = colors["type.emphasis"]
            )
        }
        item {
            SettingsCardContainer {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "TheIntroDB",
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Bold,
                        color = colors["type.emphasis"]
                    )
                    if (state.canSubmitTidb) {
                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(50))
                                .background(colors["buttons.purple"].copy(alpha = 0.25f))
                                .border(BorderStroke(1.dp, colors["buttons.purple"]), RoundedCornerShape(50))
                                .padding(horizontal = 10.dp, vertical = 4.dp)
                        ) {
                            Text(
                                text = "✓ Active",
                                color = colors["type.emphasis"],
                                fontSize = 12.sp,
                                fontWeight = FontWeight.SemiBold
                            )
                        }
                    }
                }
                Text(
                    text = t("settings.connections.tidb.description"),
                    fontSize = 14.sp,
                    color = colors["type.secondary"]
                )
                OutlinedTextField(
                    value = tidbKeyInput,
                    onValueChange = { tidbKeyInput = it; savedNotice = false },
                    label = { Text(t("settings.connections.tidb.tokenLabel")) },
                    singleLine = true,
                    visualTransformation = if (revealKey) VisualTransformation.None else PasswordVisualTransformation(),
                    colors = tvFieldColors(),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth()
                )
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    TvButton(
                        label = t("settings.save"),
                        accent = true,
                        navigation = true
                    ) {
                        state.updateTidbKey(tidbKeyInput)
                        savedNotice = true
                    }
                    if (tidbKeyInput.isNotBlank() || state.tidbKey.isNotBlank()) {
                        TvButton(
                            label = t("lists.actions.delete"),
                            navigation = true
                        ) {
                            tidbKeyInput = ""
                            state.updateTidbKey("")
                            savedNotice = true
                        }
                    }
                    val label = if (revealKey) t("settings.preferences.showLess") else t("settings.preferences.showMore")
                    TvButton(
                        label = label,
                        navigation = true
                    ) {
                        revealKey = !revealKey
                    }
                }
                if (savedNotice) {
                    Text(
                        text = "✓ ${t("settings.save")}",
                        color = colors["type.logo"],
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                }
            }
        }
    }
}

@Composable
private fun AccountSection(state: FrameZooState) {
    val colors = LocalFrameZooColors.current
    val scope = rememberCoroutineScope()
    val userId = state.userId

    var nicknameInput by remember(state.userNickname) { mutableStateOf(state.userNickname.orEmpty()) }
    var savingProfile by remember { mutableStateOf(false) }
    var accountMessage by remember { mutableStateOf<String?>(null) }

    var showProfileEditModal by remember { mutableStateOf(false) }
    var showPasswordChangeModal by remember { mutableStateOf(false) }
    var showEmailChangeModal by remember { mutableStateOf(false) }
    var showDeleteConfirmModal by remember { mutableStateOf(false) }

    var sessions by remember { mutableStateOf<List<DeviceSession>>(emptyList()) }
    var sessionsLoading by remember { mutableStateOf(false) }
    var sessionsError by remember { mutableStateOf(false) }

    fun loadSessions() {
        if (userId == null) return
        scope.launch {
            sessionsLoading = true
            sessionsError = false
            try {
                sessions = state.backend.getSessions()
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                sessionsError = true
            } finally {
                sessionsLoading = false
            }
        }
    }

    LaunchedEffect(userId) {
        if (userId != null) {
            loadSessions()
        }
    }

    LazyColumn(
        verticalArrangement = Arrangement.spacedBy(20.dp),
        contentPadding = PaddingValues(bottom = 40.dp)
    ) {
        item {
            Text(
                text = t("settings.account.title"),
                fontSize = 24.sp,
                fontWeight = FontWeight.Bold,
                color = colors["type.emphasis"]
            )
        }

        if (userId == null) {
            // RegisterCalloutPart matching Desktop RegisterCalloutPart.tsx
            item {
                SettingsCardContainer {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(
                            modifier = Modifier.weight(1f),
                            verticalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            Text(
                                text = t("settings.account.register.title"),
                                fontSize = 18.sp,
                                fontWeight = FontWeight.Bold,
                                color = colors["type.emphasis"]
                            )
                            Text(
                                text = t("settings.account.register.text"),
                                fontSize = 14.sp,
                                color = colors["type.secondary"]
                            )
                        }
                        Spacer(Modifier.width(16.dp))
                        TvButton(
                            label = t("settings.account.register.cta"),
                            icon = R.drawable.desktop_cloud_arrow_up,
                            accent = true
                        ) {
                            state.openLogin()
                        }
                    }
                }
            }
        } else {
            // AccountEditPart matching Desktop AccountEditPart.tsx
            item {
                SettingsCardContainer {
                    if (!accountMessage.isNullOrBlank()) {
                        Text(
                            text = accountMessage!!,
                            color = colors["type.logo"],
                            fontSize = 13.sp
                        )
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(24.dp),
                        verticalAlignment = Alignment.Top
                    ) {
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            UserAvatar(
                                colorA = state.userProfileColorA,
                                colorB = state.userProfileColorB,
                                icon = state.userProfileIcon,
                                size = 76.dp,
                                fontSize = 34.sp
                            )
                            TvButton(
                                label = t("settings.account.accountDetails.editProfile"),
                                icon = R.drawable.desktop_edit,
                                navigation = true
                            ) {
                                showProfileEditModal = true
                            }
                        }

                        Column(
                            modifier = Modifier.weight(1f),
                            verticalArrangement = Arrangement.spacedBy(14.dp)
                        ) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(14.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                OutlinedTextField(
                                    value = nicknameInput,
                                    onValueChange = { nicknameInput = it.replace(Regex("\\s"), "") },
                                    label = { Text(t("settings.account.accountDetails.nicknameLabel")) },
                                    placeholder = { Text(t("settings.account.accountDetails.nicknamePlaceholder")) },
                                    singleLine = true,
                                    colors = tvFieldColors(),
                                    shape = RoundedCornerShape(12.dp),
                                    modifier = Modifier.weight(1f)
                                )
                                if (nicknameInput.trim() != state.userNickname.orEmpty().trim() && nicknameInput.isNotBlank()) {
                                    TvButton(
                                        label = t("settings.save"),
                                        accent = true,
                                        loading = savingProfile
                                    ) {
                                        scope.launch {
                                            savingProfile = true
                                            accountMessage = null
                                            try {
                                                state.backend.editUser(nickname = nicknameInput.trim())
                                                state.syncUserProfile()
                                                accountMessage = "Đã lưu tên hiển thị!"
                                            } catch (e: Exception) {
                                                accountMessage = e.message ?: "Không thể lưu tên hiển thị"
                                            } finally {
                                                savingProfile = false
                                            }
                                        }
                                    }
                                }
                            }

                            // Email Row matching AccountEditPart.tsx lines 95-115
                            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                Text(
                                    text = t("settings.account.accountDetails.emailLabel"),
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = colors["type.emphasis"]
                                )
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clip(RoundedCornerShape(10.dp))
                                        .background(colors["search.background"])
                                        .padding(horizontal = 14.dp, vertical = 10.dp),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text(
                                        text = state.userEmail?.takeIf { it.isNotBlank() }
                                            ?: t("settings.account.accountDetails.noEmail"),
                                        color = colors["type.emphasis"],
                                        fontSize = 14.sp
                                    )
                                    TvButton(
                                        label = t("settings.account.accountDetails.editEmail"),
                                        icon = R.drawable.desktop_edit,
                                        navigation = true
                                    ) {
                                        showEmailChangeModal = true
                                    }
                                }
                            }

                            // Security & Logout Buttons Row matching AccountEditPart.tsx lines 117-125
                            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                TvButton(
                                    label = t("settings.account.security.passwordTitle"),
                                    navigation = true
                                ) {
                                    showPasswordChangeModal = true
                                }
                                TvButton(
                                    label = t("settings.account.accountDetails.logoutButton"),
                                    icon = R.drawable.desktop_logout,
                                    accent = true
                                ) {
                                    state.logout()
                                }
                            }
                        }
                    }
                }
            }

            // DeviceListPart matching Desktop DeviceListPart.tsx
            item {
                Text(
                    text = t("settings.account.devices.title"),
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Bold,
                    color = colors["type.emphasis"]
                )
            }
            if (sessionsLoading) {
                item {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(16.dp),
                            color = colors["type.secondary"],
                            strokeWidth = 2.dp
                        )
                        Text(
                            text = t("addons.native.loading"),
                            color = colors["type.secondary"],
                            fontSize = 14.sp
                        )
                    }
                }
            } else if (sessionsError && sessions.isEmpty()) {
                item {
                    Text(
                        text = t("settings.account.devices.failed"),
                        color = colors["type.danger"],
                        fontSize = 14.sp
                    )
                }
            } else {
                items(sessions, key = { it.id }) { session ->
                    SettingsCardContainer {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column(
                                modifier = Modifier.weight(1f),
                                verticalArrangement = Arrangement.spacedBy(4.dp)
                            ) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                                ) {
                                    Text(
                                        text = session.displayName,
                                        color = colors["type.emphasis"],
                                        fontSize = 16.sp,
                                        fontWeight = FontWeight.Bold
                                    )
                                    if (session.isCurrent) {
                                        Box(
                                            modifier = Modifier
                                                .clip(CircleShape)
                                                .background(Color(0xFF10B981).copy(alpha = 0.2f))
                                                .border(1.dp, Color(0xFF10B981).copy(alpha = 0.4f), CircleShape)
                                                .padding(horizontal = 10.dp, vertical = 2.dp)
                                        ) {
                                            Text(
                                                text = t("settings.account.devices.thisDevice"),
                                                color = Color(0xFF34D399),
                                                fontSize = 11.sp,
                                                fontWeight = FontWeight.Medium
                                            )
                                        }
                                    }
                                }
                                Text(
                                    text = session.subtitle,
                                    color = colors["type.secondary"],
                                    fontSize = 13.sp
                                )
                                Text(
                                    text = if (session.isCurrent) {
                                        t("settings.account.devices.activeNow")
                                    } else {
                                        session.accessedAt.take(10)
                                    },
                                    color = if (session.isCurrent) Color(0xFF34D399) else colors["type.secondary"],
                                    fontSize = 12.sp
                                )
                            }
                            if (!session.isCurrent) {
                                TvButton(
                                    label = t("settings.account.devices.removeDevice"),
                                    accent = true
                                ) {
                                    scope.launch {
                                        runCatching { state.backend.removeSession(session.id) }
                                        loadSessions()
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // AccountActionsPart matching Desktop AccountActionsPart.tsx
            item {
                Text(
                    text = t("settings.account.actions.title"),
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Bold,
                    color = colors["type.emphasis"]
                )
            }
            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    SettingsCardContainer(modifier = Modifier.weight(1f)) {
                        Text(
                            text = t("settings.account.actions.logoutAllDevices.title"),
                            fontSize = 17.sp,
                            fontWeight = FontWeight.Bold,
                            color = colors["type.emphasis"]
                        )
                        Text(
                            text = t("settings.account.actions.logoutAllDevices.text"),
                            fontSize = 13.sp,
                            color = colors["type.secondary"]
                        )
                        TvButton(
                            label = t("settings.account.actions.logoutAllDevices.button"),
                            accent = true
                        ) {
                            scope.launch {
                                sessions.filter { !it.isCurrent }.forEach { s ->
                                    runCatching { state.backend.removeSession(s.id) }
                                }
                                loadSessions()
                            }
                        }
                    }

                    SettingsCardContainer(modifier = Modifier.weight(1f)) {
                        Text(
                            text = t("settings.account.actions.delete.title"),
                            fontSize = 17.sp,
                            fontWeight = FontWeight.Bold,
                            color = colors["type.emphasis"]
                        )
                        Text(
                            text = t("settings.account.actions.delete.text"),
                            fontSize = 13.sp,
                            color = colors["type.secondary"]
                        )
                        TvButton(
                            label = t("settings.account.actions.delete.button"),
                            accent = true
                        ) {
                            showDeleteConfirmModal = true
                        }
                    }
                }
            }
        }
    }

    if (showProfileEditModal) {
        ProfileEditDialog(
            initialColorA = state.userProfileColorA ?: UserIcon.INITIAL_COLOR,
            initialColorB = state.userProfileColorB ?: UserIcon.INITIAL_COLOR,
            initialIcon = UserIcon.fromKey(state.userProfileIcon),
            onDismiss = { showProfileEditModal = false },
            onSave = { newColorA, newColorB, newIcon ->
                scope.launch {
                    savingProfile = true
                    try {
                        state.backend.editUser(
                            colorA = newColorA,
                            colorB = newColorB,
                            icon = newIcon.key
                        )
                        state.syncUserProfile()
                        showProfileEditModal = false
                    } finally {
                        savingProfile = false
                    }
                }
            }
        )
    }

    if (showPasswordChangeModal) {
        PasswordChangeDialog(
            state = state,
            onDismiss = { showPasswordChangeModal = false }
        )
    }

    if (showEmailChangeModal) {
        EmailChangeDialog(
            state = state,
            onDismiss = { showEmailChangeModal = false }
        )
    }

    if (showDeleteConfirmModal) {
        DeleteAccountConfirmDialog(
            onDismiss = { showDeleteConfirmModal = false },
            onConfirm = {
                scope.launch {
                    runCatching { state.backend.deleteAccount() }
                    showDeleteConfirmModal = false
                    state.logout()
                }
            }
        )
    }
}

@Composable
private fun SettingsCardContainer(
    modifier: Modifier = Modifier.fillMaxWidth(),
    content: @Composable ColumnScope.() -> Unit
) {
    val colors = LocalFrameZooColors.current
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(16.dp))
            .background(colors["background.main"].copy(alpha = 0.65f))
            .border(BorderStroke(1.dp, colors["authentication.border"]), RoundedCornerShape(16.dp))
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        content = content
    )
}

@Composable
private fun ProfileEditDialog(
    initialColorA: String,
    initialColorB: String,
    initialIcon: UserIcon,
    onDismiss: () -> Unit,
    onSave: (String, String, UserIcon) -> Unit
) {
    val colors = LocalFrameZooColors.current
    var colorA by remember { mutableStateOf(initialColorA) }
    var colorB by remember { mutableStateOf(initialColorB) }
    var userIcon by remember { mutableStateOf(initialIcon) }
    var tab by remember { mutableStateOf(IconPickerTab.CLASSIC) }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Box(
            modifier = Modifier
                .width(520.dp)
                .clip(RoundedCornerShape(20.dp))
                .background(colors["background.main"])
                .border(BorderStroke(1.dp, colors["authentication.border"]), RoundedCornerShape(20.dp))
                .padding(28.dp)
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = t("settings.account.profile.title"),
                        fontSize = 20.sp,
                        fontWeight = FontWeight.Bold,
                        color = colors["type.emphasis"]
                    )
                    UserAvatar(
                        profile = AccountProfile(colorA = colorA, colorB = colorB, icon = userIcon),
                        size = 48.dp,
                        fontSize = 22.sp
                    )
                }

                TvColorPicker(
                    label = t("settings.account.profile.firstColor"),
                    selectedColor = colorA,
                    onColorSelected = { colorA = it }
                )

                TvColorPicker(
                    label = t("settings.account.profile.secondColor"),
                    selectedColor = colorB,
                    onColorSelected = { colorB = it }
                )

                TvIconPicker(
                    label = t("settings.account.profile.userIcon"),
                    selectedIcon = userIcon,
                    activeTab = tab,
                    onTabChanged = { tab = it },
                    onIconSelected = { userIcon = it }
                )

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    TvButton(
                        label = t("onboarding.defaultConfirm.cancel"),
                        navigation = true,
                        modifier = Modifier.weight(1f)
                    ) {
                        onDismiss()
                    }
                    TvButton(
                        label = t("settings.account.profile.finish"),
                        accent = true,
                        modifier = Modifier.weight(1f)
                    ) {
                        onSave(colorA, colorB, userIcon)
                    }
                }
            }
        }
    }
}

@Composable
private fun PasswordChangeDialog(
    state: FrameZooState,
    onDismiss: () -> Unit
) {
    val colors = LocalFrameZooColors.current
    val scope = rememberCoroutineScope()
    var password by remember { mutableStateOf("") }
    var confirmPassword by remember { mutableStateOf("") }
    var showPassword by remember { mutableStateOf(false) }
    var showConfirm by remember { mutableStateOf(false) }
    var challenge by remember { mutableStateOf<OtpChallenge?>(null) }
    var otpCode by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Box(
            modifier = Modifier
                .width(480.dp)
                .clip(RoundedCornerShape(20.dp))
                .background(colors["background.main"])
                .border(BorderStroke(1.dp, colors["authentication.border"]), RoundedCornerShape(20.dp))
                .padding(28.dp)
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                if (!error.isNullOrBlank()) {
                    Text(text = error!!, color = colors["type.danger"], fontSize = 13.sp)
                }
                val currentChallenge = challenge
                if (currentChallenge != null) {
                    TvOtpVerificationCard(
                        title = t("auth.otp.passwordChangeTitle"),
                        description = t("auth.otp.passwordChangeDescription"),
                        challenge = currentChallenge,
                        code = otpCode,
                        isLoading = loading,
                        submitLabel = t("auth.otp.finish"),
                        email = state.userEmail,
                        onCodeChanged = { otpCode = it.filter(Char::isDigit).take(6) },
                        onVerify = {
                            scope.launch {
                                loading = true
                                error = null
                                try {
                                    state.backend.completePasswordChange(currentChallenge.challengeId, otpCode, password)
                                    state.syncUserProfile()
                                    onDismiss()
                                } catch (e: Exception) {
                                    error = e.message ?: "Mã xác thực không hợp lệ"
                                } finally {
                                    loading = false
                                }
                            }
                        },
                        onResend = {
                            scope.launch {
                                runCatching { challenge = state.backend.resendOtp(currentChallenge.challengeId) }
                            }
                        },
                        onBack = { challenge = null }
                    )
                } else {
                    Text(
                        text = t("settings.account.security.passwordTitle"),
                        fontSize = 20.sp,
                        fontWeight = FontWeight.Bold,
                        color = colors["type.emphasis"]
                    )
                    Text(
                        text = t("settings.account.security.passwordDescription"),
                        fontSize = 13.sp,
                        color = colors["type.secondary"]
                    )
                    TvPasswordField(
                        value = password,
                        onValueChange = { password = it; error = null },
                        label = t("auth.login.passwordLabel"),
                        placeholder = t("auth.register.passwordPlaceholder"),
                        showPassword = showPassword,
                        onToggleVisibility = { showPassword = !showPassword },
                        imeAction = ImeAction.Next,
                        onImeAction = {},
                        modifier = Modifier.fillMaxWidth()
                    )
                    TvPasswordField(
                        value = confirmPassword,
                        onValueChange = { confirmPassword = it; error = null },
                        label = t("auth.register.confirmPasswordLabel"),
                        placeholder = t("auth.register.confirmPasswordPlaceholder"),
                        showPassword = showConfirm,
                        onToggleVisibility = { showConfirm = !showConfirm },
                        imeAction = ImeAction.Done,
                        onImeAction = {},
                        modifier = Modifier.fillMaxWidth()
                    )
                    val passwordWeakError = t("auth.register.passwordWeak")
                    val passwordMismatchError = t("auth.register.passwordMismatch")
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        TvButton(
                            label = t("onboarding.defaultConfirm.cancel"),
                            navigation = true,
                            modifier = Modifier.weight(1f)
                        ) {
                            onDismiss()
                        }
                        TvButton(
                            label = t("auth.otp.send"),
                            accent = true,
                            loading = loading,
                            modifier = Modifier.weight(1f)
                        ) {
                            if (!Auth.verifyValidPassword(password) || !Auth.verifyValidMnemonic(password)) {
                                error = passwordWeakError
                                return@TvButton
                            }
                            if (password != confirmPassword) {
                                error = passwordMismatchError
                                return@TvButton
                            }
                            scope.launch {
                                loading = true
                                error = null
                                try {
                                    challenge = state.backend.requestPasswordChange()
                                } catch (e: Exception) {
                                    error = e.message ?: "Không thể gửi mã xác thực"
                                } finally {
                                    loading = false
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun EmailChangeDialog(
    state: FrameZooState,
    onDismiss: () -> Unit
) {
    val colors = LocalFrameZooColors.current
    val scope = rememberCoroutineScope()
    var newEmail by remember { mutableStateOf("") }
    var step by remember { mutableStateOf("form") } // "form", "old", "new"
    var challenge by remember { mutableStateOf<OtpChallenge?>(null) }
    var otpCode by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Box(
            modifier = Modifier
                .width(480.dp)
                .clip(RoundedCornerShape(20.dp))
                .background(colors["background.main"])
                .border(BorderStroke(1.dp, colors["authentication.border"]), RoundedCornerShape(20.dp))
                .padding(28.dp)
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                if (!error.isNullOrBlank()) {
                    Text(text = error!!, color = colors["type.danger"], fontSize = 13.sp)
                }
                val currentChallenge = challenge
                if (step == "old" && currentChallenge != null) {
                    TvOtpVerificationCard(
                        title = t("auth.otp.emailOldTitle"),
                        description = t("auth.otp.emailOldDescription"),
                        challenge = currentChallenge,
                        code = otpCode,
                        isLoading = loading,
                        submitLabel = t("auth.otp.continue"),
                        email = state.userEmail,
                        onCodeChanged = { otpCode = it.filter(Char::isDigit).take(6) },
                        onVerify = {
                            scope.launch {
                                loading = true
                                error = null
                                try {
                                    challenge = state.backend.verifyEmailChangeOld(currentChallenge.challengeId, otpCode)
                                    otpCode = ""
                                    step = "new"
                                } catch (e: Exception) {
                                    error = e.message ?: "Mã xác thực không hợp lệ"
                                } finally {
                                    loading = false
                                }
                            }
                        },
                        onResend = {
                            scope.launch {
                                runCatching { challenge = state.backend.resendOtp(currentChallenge.challengeId) }
                            }
                        },
                        onBack = { step = "form" }
                    )
                } else if (step == "new" && currentChallenge != null) {
                    TvOtpVerificationCard(
                        title = t("auth.otp.emailNewTitle"),
                        description = t("auth.otp.emailNewDescription"),
                        challenge = currentChallenge,
                        code = otpCode,
                        isLoading = loading,
                        submitLabel = t("auth.otp.finish"),
                        email = newEmail,
                        onCodeChanged = { otpCode = it.filter(Char::isDigit).take(6) },
                        onVerify = {
                            scope.launch {
                                loading = true
                                error = null
                                try {
                                    state.backend.completeEmailChange(currentChallenge.challengeId, otpCode)
                                    state.syncUserProfile()
                                    onDismiss()
                                } catch (e: Exception) {
                                    error = e.message ?: "Mã xác thực không hợp lệ"
                                } finally {
                                    loading = false
                                }
                            }
                        },
                        onResend = {
                            scope.launch {
                                runCatching { challenge = state.backend.resendOtp(currentChallenge.challengeId) }
                            }
                        },
                        onBack = { step = "form" }
                    )
                } else {
                    Text(
                        text = t("settings.account.security.emailTitle"),
                        fontSize = 20.sp,
                        fontWeight = FontWeight.Bold,
                        color = colors["type.emphasis"]
                    )
                    Text(
                        text = t("settings.account.security.emailDescription"),
                        fontSize = 13.sp,
                        color = colors["type.secondary"]
                    )
                    OutlinedTextField(
                        value = newEmail,
                        onValueChange = { newEmail = it; error = null },
                        label = { Text(t("settings.account.security.newEmailLabel")) },
                        placeholder = { Text(t("auth.register.emailPlaceholder")) },
                        singleLine = true,
                        colors = tvFieldColors(),
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier.fillMaxWidth()
                    )
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        TvButton(
                            label = t("onboarding.defaultConfirm.cancel"),
                            navigation = true,
                            modifier = Modifier.weight(1f)
                        ) {
                            onDismiss()
                        }
                        TvButton(
                            label = t("auth.otp.send"),
                            accent = true,
                            loading = loading,
                            modifier = Modifier.weight(1f)
                        ) {
                            if (newEmail.isBlank()) return@TvButton
                            scope.launch {
                                loading = true
                                error = null
                                try {
                                    challenge = state.backend.requestEmailChange(newEmail.trim())
                                    otpCode = ""
                                    step = if (state.userEmail.isNullOrBlank()) "new" else "old"
                                } catch (e: Exception) {
                                    error = e.message ?: "Không thể gửi mã xác thực"
                                } finally {
                                    loading = false
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun DeleteAccountConfirmDialog(
    onDismiss: () -> Unit,
    onConfirm: () -> Unit
) {
    val colors = LocalFrameZooColors.current
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Box(
            modifier = Modifier
                .width(460.dp)
                .clip(RoundedCornerShape(20.dp))
                .background(colors["background.main"])
                .border(BorderStroke(1.dp, colors["authentication.border"]), RoundedCornerShape(20.dp))
                .padding(28.dp)
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Text(
                    text = t("settings.account.actions.delete.confirmTitle"),
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Bold,
                    color = colors["type.emphasis"]
                )
                Text(
                    text = t("settings.account.actions.delete.confirmDescription"),
                    fontSize = 14.sp,
                    color = colors["type.secondary"]
                )
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    TvButton(
                        label = t("onboarding.defaultConfirm.cancel"),
                        navigation = true,
                        modifier = Modifier.weight(1f)
                    ) {
                        onDismiss()
                    }
                    TvButton(
                        label = t("settings.account.actions.delete.confirmButton"),
                        accent = true,
                        modifier = Modifier.weight(1f)
                    ) {
                        onConfirm()
                    }
                }
            }
        }
    }
}
