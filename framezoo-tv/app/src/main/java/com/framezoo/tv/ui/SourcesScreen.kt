package com.framezoo.tv.ui

import android.view.KeyEvent
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.SubcomposeAsyncImage
import androidx.tv.material3.Border as TvBorder
import androidx.tv.material3.Button as MaterialTvButton
import androidx.tv.material3.ButtonDefaults as TvButtonDefaults
import androidx.tv.material3.Card as TvCard
import androidx.tv.material3.CardDefaults as TvCardDefaults
import com.framezoo.tv.R
import com.framezoo.tv.model.Addon
import com.framezoo.tv.model.Episode
import com.framezoo.tv.model.Media
import com.framezoo.tv.model.Stream

internal fun formatStreamBytes(bytes: Long?): String? {
    if (bytes == null || bytes <= 0L) return null
    val units = listOf("B", "KB", "MB", "GB", "TB")
    var value = bytes.toDouble()
    var index = 0
    while (value >= 1024.0 && index < units.size - 1) {
        value /= 1024.0
        index++
    }
    return if (index == 0) "${value.toInt()} ${units[index]}" else "%.1f %s".format(value, units[index])
}

internal fun splitStreamLines(value: String): List<String> =
    value.lines().map { it.trim() }.filter { it.isNotBlank() }

internal fun detectStreamQualityCategory(stream: Stream): String {
    val text = "${stream.name} ${stream.title} ${stream.description} ${stream.filename.orEmpty()}".lowercase()
    return when {
        Regex("\\b(2160p|4k|uhd)\\b").containsMatchIn(text) -> "4k"
        Regex("\\b1080p\\b").containsMatchIn(text) -> "1080p"
        Regex("\\b720p\\b").containsMatchIn(text) -> "720p"
        Regex("\\b(480p|576p|360p|sd)\\b").containsMatchIn(text) -> "480p"
        else -> "other"
    }
}

@Composable
internal fun AddonLogoBox(
    name: String,
    logo: String?,
    modifier: Modifier = Modifier.size(40.dp)
) {
    val colors = LocalFrameZooColors.current
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(8.dp))
            .background(Color.White.copy(alpha = 0.08f)),
        contentAlignment = Alignment.Center
    ) {
        if (!logo.isNullOrBlank()) {
            SubcomposeAsyncImage(
                model = logo,
                contentDescription = "$name logo",
                modifier = Modifier
                    .fillMaxSize()
                    .padding(4.dp),
                contentScale = ContentScale.Fit,
                error = {
                    Icon(
                        painter = painterResource(R.drawable.desktop_extension),
                        contentDescription = null,
                        tint = colors["type.logo"],
                        modifier = Modifier.size(20.dp)
                    )
                }
            )
        } else {
            Icon(
                painter = painterResource(R.drawable.desktop_extension),
                contentDescription = null,
                tint = colors["type.logo"],
                modifier = Modifier.size(20.dp)
            )
        }
    }
}

/**
 * 100% clone of Desktop `SourceSelectPart.tsx` inside `Menu.CardWithScrollable`.
 * Supports:
 * - Step 1 (`showAddonList = true`): Addon list with per-addon stream counts & loading states, plus Quality filter dropdown
 * - Step 2 (`showAddonList = false`): Selected addon's streams list with Back arrow, Addon logo & name, Quality filter dropdown, and 2-column stream rows (`nameLines` on left, `detailsLines` on right)
 */
@Composable
internal fun SourceSelectModalCard(
    streamAddons: List<Addon>,
    addonStreams: Map<String, List<Stream>>,
    addonLoading: Set<String>,
    allSources: List<Stream>,
    isLoadingAll: Boolean,
    activeStream: Stream? = null,
    isModalOverlay: Boolean = false,
    onSelectStream: (Stream) -> Unit,
    onManageAddons: () -> Unit,
    onCloseModal: (() -> Unit)? = null,
    modifier: Modifier = Modifier
) {
    val colors = LocalFrameZooColors.current
    var selectedAddonId by remember { mutableStateOf<String?>(null) }
    var selectedQuality by remember { mutableStateOf("all") }
    var qualityDropdownOpen by remember { mutableStateOf(false) }
    var startingStreamKey by remember { mutableStateOf<String?>(null) }
    val firstItemRequester = remember { FocusRequester() }
    val activeQualityRequester = remember { FocusRequester() }

    val qualityOptions = listOf(
        "all" to t("addons.player.qualities.all"),
        "4k" to t("addons.player.qualities.4k"),
        "1080p" to t("addons.player.qualities.1080p"),
        "720p" to t("addons.player.qualities.720p"),
        "480p" to t("addons.player.qualities.480p"),
        "other" to t("addons.player.qualities.other")
    )

    fun filterByQuality(streams: List<Stream>): List<Stream> {
        if (selectedQuality == "all") return streams
        return streams.filter { detectStreamQualityCategory(it) == selectedQuality }
    }

    val selectedAddon = remember(streamAddons, selectedAddonId) {
        streamAddons.firstOrNull { it.id == selectedAddonId }
    }
    val showAddonList = selectedAddon == null

    LaunchedEffect(showAddonList, isLoadingAll, streamAddons.size, selectedQuality) {
        if (!qualityDropdownOpen) {
            runCatching { firstItemRequester.requestFocus() }
        }
    }

    LaunchedEffect(qualityDropdownOpen) {
        if (qualityDropdownOpen) {
            runCatching { activeQualityRequester.requestFocus() }
        }
    }

    val cardBg = colors["video.context.background"]
    val cardBorder = colors["video.context.border"]
    val mainText = colors["video.context.type.main"]
    val secondaryText = colors["video.context.type.secondary"]

    BackHandler(enabled = qualityDropdownOpen || !showAddonList || (isModalOverlay && onCloseModal != null)) {
        if (qualityDropdownOpen) {
            qualityDropdownOpen = false
        } else if (!showAddonList) {
            selectedAddonId = null
        } else if (isModalOverlay && onCloseModal != null) {
            onCloseModal()
        }
    }

    Box(
        modifier = modifier
            .widthIn(max = 672.dp)
            .fillMaxWidth(0.76f)
            .heightIn(min = 380.dp, max = 540.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(cardBg)
            .border(BorderStroke(1.dp, cardBorder), RoundedCornerShape(16.dp))
            .onPreviewKeyEvent { event ->
                if (event.nativeKeyEvent.action == KeyEvent.ACTION_DOWN && event.nativeKeyEvent.keyCode == KeyEvent.KEYCODE_BACK) {
                    if (qualityDropdownOpen) {
                        qualityDropdownOpen = false
                        true
                    } else if (!showAddonList) {
                        selectedAddonId = null
                        true
                    } else if (isModalOverlay && onCloseModal != null) {
                        onCloseModal()
                        true
                    } else false
                } else false
            }
    ) {
        Column(modifier = Modifier.fillMaxSize()) {
            // Header (`SelectedAddonHeader` or `chooseAddon` header)
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 24.dp, vertical = 18.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                if (showAddonList) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        modifier = Modifier.weight(1f)
                    ) {
                        if (isModalOverlay && onCloseModal != null) {
                            PlayerContextIconButton(
                                icon = R.drawable.desktop_chevron_left,
                                onClick = onCloseModal
                            )
                        }
                        Text(
                            text = t("addons.player.chooseAddon"),
                            color = Color.White,
                            fontSize = 20.sp,
                            fontWeight = FontWeight.Bold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                } else if (selectedAddon != null) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        modifier = Modifier.weight(1f)
                    ) {
                        PlayerContextIconButton(
                            icon = R.drawable.desktop_chevron_left,
                            onClick = { selectedAddonId = null }
                        )
                        AddonLogoBox(
                            name = selectedAddon.name,
                            logo = selectedAddon.logo,
                            modifier = Modifier.size(36.dp)
                        )
                        Text(
                            text = selectedAddon.name,
                            color = Color.White,
                            fontSize = 20.sp,
                            fontWeight = FontWeight.Bold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                }

                // Quality Filter Button (matching Desktop QualityFilterSelect)
                val currentQualityLabel = qualityOptions.firstOrNull { it.first == selectedQuality }?.second ?: t("addons.player.qualities.all")
                var filterFocused by remember { mutableStateOf(false) }
                val filterShape = RoundedCornerShape(8.dp)
                MaterialTvButton(
                    onClick = { qualityDropdownOpen = !qualityDropdownOpen },
                    modifier = Modifier.onFocusChanged { filterFocused = it.isFocused },
                    shape = TvButtonDefaults.shape(filterShape),
                    colors = TvButtonDefaults.colors(
                        containerColor = colors["video.context.inputBg"],
                        contentColor = Color.White,
                        focusedContainerColor = colors["video.context.hoverColor"],
                        focusedContentColor = Color.White
                    ),
                    scale = TvButtonDefaults.scale(focusedScale = 1.03f),
                    border = TvButtonDefaults.border(
                        border = TvBorder(BorderStroke(1.dp, cardBorder), shape = filterShape),
                        focusedBorder = TvBorder(BorderStroke(2.dp, colors["type.logo"]), shape = filterShape)
                    ),
                    contentPadding = PaddingValues(horizontal = 14.dp, vertical = 8.dp)
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Text(
                            text = currentQualityLabel,
                            color = Color.White,
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Medium
                        )
                        Icon(
                            painter = painterResource(if (qualityDropdownOpen) R.drawable.desktop_chevron_up else R.drawable.desktop_chevron_down),
                            contentDescription = null,
                            tint = Color.White.copy(alpha = 0.7f),
                            modifier = Modifier.size(14.dp)
                        )
                    }
                }
            }

            // Divider line matching `border-b border-video-context-border`
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(1.dp)
                    .background(cardBorder)
            )

            // Quality Filter Dropdown expansion
            if (qualityDropdownOpen) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(colors["video.context.inputBg"])
                        .padding(horizontal = 24.dp, vertical = 10.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    qualityOptions.forEach { (key, label) ->
                        val isSelected = selectedQuality == key
                        TvButton(
                            label = label,
                            selected = isSelected,
                            navigation = true,
                            modifier = if (isSelected) Modifier.focusRequester(activeQualityRequester) else Modifier
                        ) {
                            selectedQuality = key
                            qualityDropdownOpen = false
                            runCatching { firstItemRequester.requestFocus() }
                        }
                    }
                }
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(1.dp)
                        .background(cardBorder)
                )
            }

            // Body Content
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(horizontal = 24.dp)
            ) {
                if (streamAddons.isEmpty() && !isLoadingAll) {
                    // Empty Addons State matching Desktop SourceSelectPart lines 952-966
                    Column(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(vertical = 32.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center
                    ) {
                        Icon(
                            painter = painterResource(R.drawable.desktop_video),
                            contentDescription = null,
                            tint = secondaryText,
                            modifier = Modifier.size(36.dp)
                        )
                        Spacer(Modifier.height(12.dp))
                        Text(
                            text = t("addons.player.emptyTitle"),
                            color = Color.White,
                            fontSize = 18.sp,
                            fontWeight = FontWeight.SemiBold,
                            textAlign = TextAlign.Center
                        )
                        Spacer(Modifier.height(8.dp))
                        Text(
                            text = t("addons.player.emptyExplanation"),
                            color = mainText,
                            fontSize = 14.sp,
                            textAlign = TextAlign.Center
                        )
                        Spacer(Modifier.height(20.dp))
                        TvButton(
                            label = t("addons.player.manageAddonsButton"),
                            accent = true,
                            modifier = Modifier.focusRequester(firstItemRequester)
                        ) {
                            onManageAddons()
                        }
                    }
                } else if (showAddonList) {
                    // Step 1: Addon List (`showAddonList == true`) matching Desktop lines 993-1052
                    val anyLoading = isLoadingAll || addonLoading.isNotEmpty()
                    val totalStreamsCount = allSources.size
                    if (!anyLoading && totalStreamsCount == 0 && addonStreams.isNotEmpty()) {
                        Column(
                            modifier = Modifier
                                .fillMaxSize()
                                .padding(vertical = 32.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.Center
                        ) {
                            Icon(
                                painter = painterResource(R.drawable.desktop_video),
                                contentDescription = null,
                                tint = secondaryText,
                                modifier = Modifier.size(36.dp)
                            )
                            Spacer(Modifier.height(12.dp))
                            Text(
                                text = t("addons.player.title"),
                                color = Color.White,
                                fontSize = 18.sp,
                                fontWeight = FontWeight.SemiBold,
                                textAlign = TextAlign.Center
                            )
                            Spacer(Modifier.height(8.dp))
                            Text(
                                text = t("addons.player.noTorrentStreams"),
                                color = mainText,
                                fontSize = 14.sp,
                                textAlign = TextAlign.Center
                            )
                            Spacer(Modifier.height(20.dp))
                            TvButton(
                                label = t("addons.player.manageAddonsButton"),
                                accent = true,
                                modifier = Modifier.focusRequester(firstItemRequester)
                            ) {
                                onManageAddons()
                            }
                        }
                    } else {
                        LazyColumn(
                            modifier = Modifier.fillMaxSize(),
                            contentPadding = PaddingValues(vertical = 12.dp),
                            verticalArrangement = Arrangement.spacedBy(4.dp)
                        ) {
                            items(streamAddons.size) { index ->
                                val addon = streamAddons[index]
                                val rawList = addonStreams[addon.id] ?: allSources.filter { it.addonId == addon.id || it.addonName == addon.name }
                                val filteredCount = filterByQuality(rawList).size
                                val isAddonLoading = addon.id in addonLoading || (isLoadingAll && addon.id !in addonStreams)
                                val isActiveAddon = activeStream?.let { it.addonId == addon.id || it.addonName == addon.name } == true

                                val rowShape = RoundedCornerShape(10.dp)
                                var rowFocused by remember { mutableStateOf(false) }
                                TvCard(
                                    onClick = {
                                        if (!isAddonLoading) {
                                            selectedAddonId = addon.id
                                        }
                                    },
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .then(if (index == 0) Modifier.focusRequester(firstItemRequester) else Modifier)
                                        .onFocusChanged { rowFocused = it.isFocused },
                                    shape = TvCardDefaults.shape(rowShape),
                                    colors = TvCardDefaults.colors(
                                        containerColor = if (rowFocused) colors["video.context.hoverColor"] else Color.Transparent,
                                        focusedContainerColor = colors["video.context.hoverColor"]
                                    ),
                                    scale = TvCardDefaults.scale(focusedScale = 1.01f),
                                    border = TvCardDefaults.border(
                                        focusedBorder = TvBorder(BorderStroke(2.dp, colors["type.logo"]), shape = rowShape)
                                    )
                                ) {
                                    Row(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .padding(horizontal = 12.dp, vertical = 12.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.SpaceBetween
                                    ) {
                                        Row(
                                            verticalAlignment = Alignment.CenterVertically,
                                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                                            modifier = Modifier.weight(1f)
                                        ) {
                                            AddonLogoBox(name = addon.name, logo = addon.logo)
                                            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                                Text(
                                                    text = addon.name,
                                                    color = Color.White,
                                                    fontSize = 16.sp,
                                                    fontWeight = FontWeight.Medium,
                                                    maxLines = 1,
                                                    overflow = TextOverflow.Ellipsis
                                                )
                                                Text(
                                                    text = if (isAddonLoading) t("addons.player.loadingStreams")
                                                    else t("addons.player.streamCount", "count" to filteredCount),
                                                    color = mainText,
                                                    fontSize = 13.sp,
                                                    maxLines = 1
                                                )
                                            }
                                        }

                                        Row(
                                            verticalAlignment = Alignment.CenterVertically,
                                            horizontalArrangement = Arrangement.spacedBy(10.dp)
                                        ) {
                                            if (isAddonLoading) {
                                                CircularProgressIndicator(
                                                    modifier = Modifier.size(18.dp),
                                                    color = colors["type.logo"],
                                                    strokeWidth = 2.dp
                                                )
                                            } else {
                                                if (isActiveAddon) {
                                                    Icon(
                                                        painter = painterResource(R.drawable.desktop_checkmark),
                                                        contentDescription = null,
                                                        tint = colors["video.context.type.accent"],
                                                        modifier = Modifier.size(18.dp)
                                                    )
                                                }
                                                Icon(
                                                    painter = painterResource(R.drawable.desktop_chevron_right),
                                                    contentDescription = null,
                                                    tint = Color.White.copy(alpha = 0.7f),
                                                    modifier = Modifier.size(18.dp)
                                                )
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                } else if (selectedAddon != null) {
                    // Step 2: Stream List for Selected Addon (`showAddonList == false`) matching Desktop lines 1053-1102
                    val rawStreams = addonStreams[selectedAddon.id] ?: allSources.filter { it.addonId == selectedAddon.id || it.addonName == selectedAddon.name }
                    val streams = remember(rawStreams, selectedQuality) { filterByQuality(rawStreams) }
                    val isAddonLoading = selectedAddon.id in addonLoading || (isLoadingAll && selectedAddon.id !in addonStreams)

                    if (isAddonLoading) {
                        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            Column(
                                horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.spacedBy(12.dp)
                            ) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(32.dp),
                                    color = colors["type.logo"],
                                    strokeWidth = 3.dp
                                )
                                Text(
                                    text = t("addons.player.loadingStreams"),
                                    color = mainText,
                                    fontSize = 15.sp
                                )
                            }
                        }
                    } else if (streams.isEmpty()) {
                        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            Text(
                                text = t("addons.player.noStreams"),
                                color = mainText,
                                fontSize = 15.sp,
                                textAlign = TextAlign.Center
                            )
                        }
                    } else {
                        LazyColumn(
                            modifier = Modifier.fillMaxSize(),
                            contentPadding = PaddingValues(vertical = 10.dp),
                            verticalArrangement = Arrangement.spacedBy(4.dp)
                        ) {
                            items(streams.size) { index ->
                                val stream = streams[index]
                                val streamKey = "${stream.addonId}:${stream.infoHash ?: stream.url}:${stream.fileIdx ?: -1}:${index}"
                                val isStartingThis = startingStreamKey == streamKey
                                val isSelected = activeStream != null && (
                                    (activeStream.infoHash != null && activeStream.infoHash == stream.infoHash && activeStream.fileIdx == stream.fileIdx) ||
                                    activeStream.url == stream.url
                                )

                                val nameLines = splitStreamLines(stream.name.ifBlank { selectedAddon.name })
                                val titleLines = splitStreamLines(stream.title)
                                val descLines = splitStreamLines(stream.description)
                                val sizeStr = formatStreamBytes(stream.videoSize)
                                val fallbackDetails = listOfNotNull(
                                    sizeStr?.let { "💾 $it" },
                                    stream.filename?.let { "⚙ $it" }
                                )
                                val detailsLines = (titleLines + descLines).ifEmpty { fallbackDetails }

                                val rowShape = RoundedCornerShape(10.dp)
                                var rowFocused by remember { mutableStateOf(false) }

                                TvCard(
                                    onClick = {
                                        startingStreamKey = streamKey
                                        onSelectStream(stream)
                                    },
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .then(if (index == 0) Modifier.focusRequester(firstItemRequester) else Modifier)
                                        .onFocusChanged { rowFocused = it.isFocused },
                                    shape = TvCardDefaults.shape(rowShape),
                                    colors = TvCardDefaults.colors(
                                        containerColor = if (rowFocused) colors["video.context.hoverColor"] else Color.Transparent,
                                        focusedContainerColor = colors["video.context.hoverColor"]
                                    ),
                                    scale = TvCardDefaults.scale(focusedScale = 1.01f),
                                    border = TvCardDefaults.border(
                                        focusedBorder = TvBorder(BorderStroke(2.dp, colors["type.logo"]), shape = rowShape)
                                    )
                                ) {
                                    Column {
                                        Row(
                                            modifier = Modifier
                                                .fillMaxWidth()
                                                .padding(horizontal = 12.dp, vertical = 12.dp),
                                            verticalAlignment = Alignment.Top,
                                            horizontalArrangement = Arrangement.spacedBy(20.dp)
                                        ) {
                                            // Left column: `minmax(8rem, 12rem)` -> Spinner + `nameLines`
                                            Row(
                                                modifier = Modifier.width(156.dp),
                                                verticalAlignment = Alignment.Top,
                                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                                            ) {
                                                if (isStartingThis) {
                                                    CircularProgressIndicator(
                                                        modifier = Modifier
                                                            .padding(top = 2.dp)
                                                            .size(16.dp),
                                                        color = colors["type.logo"],
                                                        strokeWidth = 2.dp
                                                    )
                                                }
                                                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                                    if (nameLines.isNotEmpty()) {
                                                        nameLines.forEachIndexed { lineIdx, line ->
                                                            Text(
                                                                text = line,
                                                                color = if (lineIdx == 0) Color.White else Color.White.copy(alpha = 0.85f),
                                                                fontSize = 15.sp,
                                                                fontWeight = if (lineIdx == 0) FontWeight.SemiBold else FontWeight.Medium,
                                                                lineHeight = 20.sp
                                                            )
                                                        }
                                                    } else {
                                                        Text(
                                                            text = selectedAddon.name,
                                                            color = Color.White,
                                                            fontSize = 15.sp,
                                                            fontWeight = FontWeight.SemiBold
                                                        )
                                                    }
                                                }
                                            }

                                            // Right column: `detailsLines` (first line white/90 medium 15sp, remaining lines white/70 14sp)
                                            Column(
                                                modifier = Modifier.weight(1f),
                                                verticalArrangement = Arrangement.spacedBy(3.dp)
                                            ) {
                                                if (detailsLines.isNotEmpty()) {
                                                    detailsLines.forEachIndexed { lineIdx, line ->
                                                        Text(
                                                            text = line,
                                                            color = if (lineIdx == 0) Color.White.copy(alpha = 0.92f) else Color.White.copy(alpha = 0.70f),
                                                            fontSize = if (lineIdx == 0) 15.sp else 13.5.sp,
                                                            fontWeight = if (lineIdx == 0) FontWeight.Medium else FontWeight.Normal,
                                                            lineHeight = 19.sp
                                                        )
                                                    }
                                                } else {
                                                    Text(
                                                        text = stream.url.take(64),
                                                        color = Color.White.copy(alpha = 0.70f),
                                                        fontSize = 13.5.sp,
                                                        maxLines = 1,
                                                        overflow = TextOverflow.Ellipsis
                                                    )
                                                }
                                            }

                                            if (isSelected) {
                                                Icon(
                                                    painter = painterResource(R.drawable.desktop_checkmark),
                                                    contentDescription = null,
                                                    tint = colors["video.context.type.accent"],
                                                    modifier = Modifier
                                                        .padding(top = 4.dp)
                                                        .size(18.dp)
                                                )
                                            }
                                        }

                                        if (index < streams.size - 1) {
                                            Box(
                                                modifier = Modifier
                                                    .fillMaxWidth()
                                                    .padding(horizontal = 8.dp)
                                                    .height(1.dp)
                                                    .background(cardBorder.copy(alpha = 0.6f))
                                            )
                                        }
                                    }
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
internal fun PlayerContextIconButton(
    icon: Int,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val colors = LocalFrameZooColors.current
    var focused by remember { mutableStateOf(false) }
    MaterialTvButton(
        onClick = onClick,
        modifier = modifier
            .size(34.dp)
            .onFocusChanged { focused = it.isFocused },
        shape = TvButtonDefaults.shape(CircleShape),
        colors = TvButtonDefaults.colors(
            containerColor = if (focused) colors["video.context.hoverColor"] else Color.Transparent,
            contentColor = Color.White,
            focusedContainerColor = colors["video.context.hoverColor"],
            focusedContentColor = Color.White
        ),
        scale = TvButtonDefaults.scale(focusedScale = 1.08f),
        border = TvButtonDefaults.border(
            focusedBorder = TvBorder(BorderStroke(2.dp, colors["type.logo"]), shape = CircleShape)
        ),
        contentPadding = PaddingValues(0.dp)
    ) {
        Icon(
            painter = painterResource(icon),
            contentDescription = null,
            tint = Color.White,
            modifier = Modifier.size(18.dp)
        )
    }
}

@Composable
internal fun SourcesScreen(state: FrameZooState) {
    val item = state.selected ?: return
    val currentEp = state.episode
    val nextEp = if (item.type == "show" && currentEp != null) {
        state.episodes.firstOrNull { it.season == currentEp.season && it.number == currentEp.number + 1 }
    } else null
    PlayerScreen(
        state = state,
        player = state.player,
        item = item,
        episode = currentEp,
        stream = state.playing,
        subtitles = state.subtitles,
        backend = state.backend,
        resume = state.resume(item, currentEp),
        resumeDuration = state.resumeDuration(item, currentEp),
        onNextEpisode = nextEp?.let { ep -> { state.loadSources(item, ep) } },
        onSelectEpisode = { ep -> state.loadSources(item, ep) },
        onStopped = { pos -> state.stopped(item, currentEp, pos) },
        onExit = { state.exitPlayer() }
    )
}
