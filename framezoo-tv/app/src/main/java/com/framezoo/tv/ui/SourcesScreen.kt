package com.framezoo.tv.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.SubcomposeAsyncImage
import androidx.tv.material3.Border as TvBorder
import androidx.tv.material3.Card as TvCard
import androidx.tv.material3.CardDefaults as TvCardDefaults
import com.framezoo.tv.R
import com.framezoo.tv.model.Episode
import com.framezoo.tv.model.Media
import com.framezoo.tv.model.Stream

private fun formatSize(bytes: Long?): String? {
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

private fun streamLines(value: String): List<String> =
    value.lines().map { it.trim() }.filter { it.isNotBlank() }

@Composable
internal fun SourcesScreen(
    media: Media?,
    episode: Episode?,
    sources: List<Stream>,
    isLoading: Boolean = false,
    onChooseSource: (Stream) -> Unit,
    onBack: () -> Unit
) {
    val colors = LocalFrameZooColors.current
    val backRequester = remember { FocusRequester() }
    var selectedQuality by remember { mutableStateOf("all") }
    var startingStreamKey by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        runCatching { backRequester.requestFocus() }
    }

    val filteredSources = remember(sources, selectedQuality) {
        if (selectedQuality == "all") sources
        else sources.filter { stream ->
            val text = "${stream.name} ${stream.title} ${stream.description} ${stream.filename.orEmpty()}".lowercase()
            when (selectedQuality) {
                "4k" -> text.contains("4k") || text.contains("2160")
                "1080p" -> text.contains("1080")
                "720p" -> text.contains("720")
                "480p" -> text.contains("480") || text.contains("sd")
                else -> true
            }
        }
    }

    val qualities = listOf(
        "all" to t("addons.player.qualities.all"),
        "4k" to t("addons.player.qualities.4k"),
        "1080p" to t("addons.player.qualities.1080p"),
        "720p" to t("addons.player.qualities.720p"),
        "480p" to t("addons.player.qualities.480p")
    )

    LazyColumn(
        verticalArrangement = Arrangement.spacedBy(16.dp),
        contentPadding = PaddingValues(bottom = 48.dp),
        modifier = Modifier.fillMaxSize()
    ) {
        item {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    text = "${media?.title.orEmpty()}${episode?.let { " · S${it.season}E${it.number}" } ?: ""} · ${t("addons.player.sources")}",
                    style = MaterialTheme.typography.headlineLarge,
                    color = colors["type.emphasis"]
                )
                Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
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
        }

        // Quality Filter Row matching Desktop SourceSelectPart
        item {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                items(qualities) { (q, label) ->
                    TvButton(
                        label = label,
                        selected = selectedQuality == q,
                        navigation = true
                    ) {
                        selectedQuality = q
                    }
                }
            }
        }

        if (isLoading) {
            item {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(16.dp))
                        .border(BorderStroke(1.dp, colors["authentication.border"]), RoundedCornerShape(16.dp))
                        .background(colors["background.secondary"].copy(alpha = 0.35f))
                        .padding(40.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(14.dp)
                    ) {
                        androidx.compose.material3.CircularProgressIndicator(
                            color = colors["type.logo"],
                            modifier = Modifier.size(36.dp),
                            strokeWidth = 3.dp
                        )
                        Text(
                            text = t("addons.player.loadingStreams"),
                            color = colors["type.emphasis"],
                            fontSize = 16.sp,
                            fontWeight = FontWeight.Medium
                        )
                    }
                }
            }
        } else if (filteredSources.isEmpty()) {
            item {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(16.dp))
                        .border(BorderStroke(1.dp, colors["authentication.border"]), RoundedCornerShape(16.dp))
                        .background(colors["background.secondary"].copy(alpha = 0.35f))
                        .padding(32.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = if (sources.isEmpty()) t("addons.player.emptyExplanation") else t("addons.player.noStreams"),
                        color = colors["type.secondary"],
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Medium
                    )
                }
            }
        } else {
            items(filteredSources) { source ->
                val isTorrent = source.infoHash != null || source.url.startsWith("magnet:")
                val isDebrid = source.name.contains("RD", ignoreCase = true) || source.name.contains("RealDebrid", ignoreCase = true) || source.name.contains("[RD+]", ignoreCase = true)

                val nameLines = streamLines(source.name.ifBlank { source.addonName })
                val addonNameHeader = nameLines.firstOrNull() ?: source.addonName.ifBlank { "Addon" }
                val qualityTag = if (nameLines.size > 1) nameLines.drop(1).joinToString(" ") else null

                val titleLines = streamLines(source.title)
                val descLines = streamLines(source.description)
                val sizeStr = formatSize(source.videoSize)
                val fallbackDetails = listOfNotNull(
                    sizeStr?.let { "💾 $it" },
                    source.filename?.let { "⚙ $it" }
                )
                val detailsLines = (titleLines + descLines).ifEmpty { fallbackDetails }
                val primaryTitle = detailsLines.firstOrNull() ?: source.filename ?: source.name
                val secondaryDetails = if (detailsLines.size > 1) detailsLines.drop(1).joinToString("  •  ") else sizeStr?.let { "💾 $it" }.orEmpty()

                val shape = RoundedCornerShape(12.dp)
                val isStartingThis = startingStreamKey == (source.url + source.name)
                TvCard(
                    onClick = {
                        startingStreamKey = source.url + source.name
                        onChooseSource(source)
                    },
                    shape = TvCardDefaults.shape(shape),
                    colors = TvCardDefaults.colors(
                        containerColor = colors["background.secondary"].copy(alpha = 0.5f),
                        focusedContainerColor = colors["pill.activeBackground"]
                    ),
                    scale = TvCardDefaults.scale(focusedScale = 1.03f),
                    border = TvCardDefaults.border(
                        focusedBorder = TvBorder(BorderStroke(2.dp, colors["type.logo"]), shape = shape)
                    ),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(16.dp)
                    ) {
                        Box(
                            modifier = Modifier
                                .size(44.dp)
                                .clip(RoundedCornerShape(8.dp))
                                .background(Color.White.copy(alpha = 0.08f)),
                            contentAlignment = Alignment.Center
                        ) {
                            if (!source.addonLogo.isNullOrBlank()) {
                                SubcomposeAsyncImage(
                                    model = source.addonLogo,
                                    contentDescription = "${source.addonName} logo",
                                    modifier = Modifier
                                        .fillMaxSize()
                                        .padding(4.dp),
                                    contentScale = ContentScale.Fit,
                                    error = {
                                        Icon(
                                            painter = painterResource(R.drawable.desktop_extension),
                                            contentDescription = null,
                                            tint = colors["type.logo"],
                                            modifier = Modifier.size(22.dp)
                                        )
                                    }
                                )
                            } else {
                                Icon(
                                    painter = painterResource(R.drawable.desktop_extension),
                                    contentDescription = null,
                                    tint = colors["type.logo"],
                                    modifier = Modifier.size(22.dp)
                                )
                            }
                        }

                        // Left section: Addon Name, Quality tag badge, Type badge
                        Column(
                            modifier = Modifier.widthIn(min = 160.dp, max = 280.dp),
                            verticalArrangement = Arrangement.spacedBy(4.dp)
                        ) {
                            Text(
                                text = addonNameHeader,
                                color = colors["type.emphasis"],
                                fontSize = 15.sp,
                                fontWeight = FontWeight.Bold,
                                maxLines = 1
                            )
                            Row(
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                if (qualityTag != null) {
                                    Box(
                                        modifier = Modifier
                                            .clip(RoundedCornerShape(4.dp))
                                            .background(colors["dropdown.altBackground"])
                                            .padding(horizontal = 6.dp, vertical = 2.dp)
                                    ) {
                                        Text(
                                            text = qualityTag,
                                            color = colors["type.emphasis"],
                                            fontSize = 11.sp,
                                            fontWeight = FontWeight.SemiBold,
                                            maxLines = 1
                                        )
                                    }
                                }
                                Box(
                                    modifier = Modifier
                                        .clip(RoundedCornerShape(4.dp))
                                        .background(if (isTorrent) Color(0xFFC53BB0).copy(alpha = 0.15f) else Color(0xFF48D3FF).copy(alpha = 0.15f))
                                        .padding(horizontal = 6.dp, vertical = 2.dp)
                                ) {
                                    Text(
                                        text = if (isDebrid) "RD+" else if (isTorrent) "Torrent" else "HTTP",
                                        color = if (isDebrid) Color(0xFFFBBF24) else if (isTorrent) Color(0xFFC53BB0) else Color(0xFF48D3FF),
                                        fontSize = 11.sp,
                                        fontWeight = FontWeight.Bold,
                                        maxLines = 1
                                    )
                                }
                            }
                        }

                        // Middle section: Release Title and details (seeds, size, audio/video specs)
                        Column(
                            modifier = Modifier.weight(1f),
                            verticalArrangement = Arrangement.spacedBy(4.dp)
                        ) {
                            Text(
                                text = primaryTitle,
                                color = Color.White,
                                fontSize = 14.5.sp,
                                fontWeight = FontWeight.SemiBold,
                                maxLines = 1
                            )
                            if (secondaryDetails.isNotBlank()) {
                                Text(
                                    text = secondaryDetails,
                                    color = colors["type.secondary"],
                                    fontSize = 12.5.sp,
                                    lineHeight = 18.sp,
                                    maxLines = 2
                                )
                            }
                        }

                        if (isStartingThis) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(18.dp),
                                color = colors["type.logo"],
                                strokeWidth = 2.dp
                            )
                        } else {
                            Icon(
                                painter = painterResource(R.drawable.desktop_play),
                                contentDescription = null,
                                tint = colors["type.logo"],
                                modifier = Modifier.size(18.dp)
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
internal fun SourcesScreen(state: FrameZooState) {
    SourcesScreen(
        media = state.selected,
        episode = state.episode,
        sources = state.sources,
        isLoading = state.sourcesLoading,
        onChooseSource = { state.chooseSource(it) },
        onBack = { state.back() }
    )
}
