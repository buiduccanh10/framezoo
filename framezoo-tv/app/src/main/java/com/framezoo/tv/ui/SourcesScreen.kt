package com.framezoo.tv.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
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
import androidx.tv.material3.Card as TvCard
import androidx.tv.material3.CardDefaults as TvCardDefaults
import com.framezoo.tv.R
import com.framezoo.tv.model.Episode
import com.framezoo.tv.model.Media
import com.framezoo.tv.model.Stream

@Composable
internal fun SourcesScreen(
    media: Media?,
    episode: Episode?,
    sources: List<Stream>,
    onChooseSource: (Stream) -> Unit,
    onBack: () -> Unit
) {
    val colors = LocalFrameZooColors.current
    val backRequester = remember { FocusRequester() }
    var selectedQuality by remember { mutableStateOf("all") }

    val filteredSources = remember(sources, selectedQuality) {
        if (selectedQuality == "all") sources
        else sources.filter { stream ->
            val lower = stream.name.lowercase()
            when (selectedQuality) {
                "4k" -> lower.contains("4k") || lower.contains("2160")
                "1080p" -> lower.contains("1080")
                "720p" -> lower.contains("720")
                "480p" -> lower.contains("480") || lower.contains("sd")
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

        if (filteredSources.isEmpty()) {
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
                val lines = source.name.split("\n").filter { it.isNotBlank() }
                val mainTitle = lines.firstOrNull() ?: source.name
                val subDetails = if (lines.size > 1) lines.drop(1).joinToString(" · ") else source.filename.orEmpty()
                val shape = RoundedCornerShape(12.dp)
                TvCard(
                    onClick = { onChooseSource(source) },
                    shape = TvCardDefaults.shape(shape),
                    colors = TvCardDefaults.colors(
                        containerColor = colors["background.secondary"].copy(alpha = 0.5f),
                        focusedContainerColor = colors["pill.activeBackground"]
                    ),
                    scale = TvCardDefaults.scale(focusedScale = 1.01f),
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
                                .background(if (isDebrid) Color(0xFFF59E0B).copy(alpha = 0.2f) else if (isTorrent) Color(0xFFC53BB0).copy(alpha = 0.2f) else Color(0xFF48D3FF).copy(alpha = 0.2f)),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(
                                painter = painterResource(if (isTorrent) R.drawable.desktop_video else R.drawable.desktop_play),
                                contentDescription = null,
                                tint = if (isDebrid) Color(0xFFF59E0B) else if (isTorrent) Color(0xFFC53BB0) else Color(0xFF48D3FF),
                                modifier = Modifier.size(22.dp)
                            )
                        }

                        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text(
                                    text = mainTitle,
                                    color = colors["type.emphasis"],
                                    fontSize = 16.sp,
                                    fontWeight = FontWeight.Bold,
                                    maxLines = 1
                                )
                                if (isDebrid) {
                                    Box(
                                        modifier = Modifier
                                            .clip(RoundedCornerShape(4.dp))
                                            .background(Color(0xFFF59E0B).copy(alpha = 0.25f))
                                            .padding(horizontal = 6.dp, vertical = 2.dp)
                                    ) {
                                        Text(
                                            text = "RD+",
                                            color = Color(0xFFFBBF24),
                                            fontSize = 11.sp,
                                            fontWeight = FontWeight.Bold
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
                                        text = if (isTorrent) "Torrent" else "HTTP / HLS",
                                        color = if (isTorrent) Color(0xFFC53BB0) else Color(0xFF48D3FF),
                                        fontSize = 11.sp,
                                        fontWeight = FontWeight.Bold
                                    )
                                }
                            }
                            if (subDetails.isNotBlank()) {
                                Text(
                                    text = subDetails,
                                    color = colors["type.secondary"],
                                    fontSize = 13.sp,
                                    maxLines = 2
                                )
                            }
                        }

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

@Composable
internal fun SourcesScreen(state: FrameZooState) {
    SourcesScreen(
        media = state.selected,
        episode = state.episode,
        sources = state.sources,
        onChooseSource = { state.chooseSource(it) },
        onBack = { state.back() }
    )
}
