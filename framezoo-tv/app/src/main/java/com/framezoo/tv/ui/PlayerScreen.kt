package com.framezoo.tv.ui

import android.view.KeyEvent
import android.view.SurfaceView
import androidx.activity.ComponentActivity
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.lifecycleScope
import coil.compose.AsyncImage
import coil.compose.SubcomposeAsyncImage
import com.framezoo.tv.R
import com.framezoo.tv.api.Backend
import com.framezoo.tv.model.Episode
import com.framezoo.tv.model.Media
import com.framezoo.tv.model.Stream
import com.framezoo.tv.model.Subtitle
import com.framezoo.tv.player.PlayerController
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private fun formatTime(seconds: Double): String {
    val total = seconds.toInt().coerceAtLeast(0)
    val hrs = total / 3600
    val mins = (total % 3600) / 60
    val secs = total % 60
    return if (hrs > 0) "%d:%02d:%02d".format(hrs, mins, secs) else "%02d:%02d".format(mins, secs)
}

@Composable
internal fun PlayerScreen(
    player: PlayerController,
    item: Media,
    episode: Episode?,
    stream: Stream,
    subtitles: List<Subtitle>,
    backend: Backend,
    resume: Double,
    onNextEpisode: (() -> Unit)? = null,
    onStopped: (Double) -> Unit,
    onExit: () -> Unit
) {
    val colors = LocalFrameZooColors.current
    val activity = LocalContext.current as ComponentActivity
    val scope = rememberCoroutineScope()

    var position by remember { mutableDoubleStateOf(0.0) }
    var duration by remember { mutableDoubleStateOf(0.0) }
    var isPaused by remember { mutableStateOf(false) }
    var isBuffering by remember { mutableStateOf(false) }
    var isOpening by remember { mutableStateOf(true) }
    var hasRenderedFrame by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var showControls by remember { mutableStateOf(true) }
    var showResumePrompt by remember { mutableStateOf(resume > 20) }
    var showSubtitlesMenu by remember { mutableStateOf(false) }
    var showSpeedMenu by remember { mutableStateOf(false) }
    var showTorrentStats by remember { mutableStateOf(false) }
    var selectedSpeed by remember { mutableDoubleStateOf(1.0) }
    var subDelayMs by remember { mutableIntStateOf(0) }
    var controlsTimeoutKey by remember { mutableIntStateOf(0) }

    val isTorrent = stream.infoHash != null || stream.url.startsWith("magnet:")
    val playPauseRequester = remember { FocusRequester() }
    val defaultSourceError = t("player.playbackError.title")

    // Fetch movie/series logo in background
    val logoUrl by produceState<String?>(initialValue = null, key1 = item.id) {
        value = runCatching { backend.logo(item) }.getOrNull()
    }

    // Cycling funny loading messages like Desktop PlayerLoadingOverlay
    var messageIndex by remember { mutableIntStateOf((1..22).random()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(3500)
            messageIndex = (1..22).filter { it != messageIndex }.random()
        }
    }

    fun triggerControls() {
        showControls = true
        controlsTimeoutKey++
    }

    LaunchedEffect(controlsTimeoutKey, showControls) {
        if (showControls && !showSubtitlesMenu && !showSpeedMenu && !showResumePrompt && !showTorrentStats) {
            delay(4000)
            showControls = false
        }
    }

    LaunchedEffect(stream) {
        isOpening = true
        hasRenderedFrame = false
        error = ""
        try {
            player.play(stream, subtitles)
        } catch (e: Exception) {
            error = e.message ?: defaultSourceError
        } finally {
            isOpening = false
        }
    }

    LaunchedEffect(stream) {
        while (true) {
            delay(400)
            position = player.position()
            duration = player.duration()
            isPaused = player.paused()
            isBuffering = player.propertyString("paused-for-cache") == "yes"

            if (!hasRenderedFrame && (position > 0.1 || (duration > 0.0 && !isBuffering && !isOpening))) {
                hasRenderedFrame = true
            }

            if (position.toInt() % 30 == 0 && position >= 20) {
                runCatching { backend.progress(item, position, duration, episode) }
            }
        }
    }

    DisposableEffect(stream) {
        onDispose {
            val pos = player.position()
            val len = player.duration()
            if (pos >= 20) onStopped(pos)
            player.stop()
            if (pos >= 20) {
                activity.lifecycleScope.launch {
                    runCatching { backend.progress(item, pos, len, episode) }
                }
            }
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .onPreviewKeyEvent { event ->
                if (event.nativeKeyEvent.action != KeyEvent.ACTION_DOWN) return@onPreviewKeyEvent false
                triggerControls()
                when (event.nativeKeyEvent.keyCode) {
                    KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> {
                        player.command("cycle", "pause")
                        isPaused = !isPaused
                        true
                    }
                    KeyEvent.KEYCODE_DPAD_LEFT -> {
                        if (!showControls) {
                            player.command("seek", "-10", "relative")
                            true
                        } else false
                    }
                    KeyEvent.KEYCODE_DPAD_RIGHT -> {
                        if (!showControls) {
                            player.command("seek", "10", "relative")
                            true
                        } else false
                    }
                    KeyEvent.KEYCODE_BACK -> {
                        if (showSubtitlesMenu) {
                            showSubtitlesMenu = false
                            true
                        } else if (showSpeedMenu) {
                            showSpeedMenu = false
                            true
                        } else if (showTorrentStats) {
                            showTorrentStats = false
                            true
                        } else {
                            onExit()
                            true
                        }
                    }
                    else -> false
                }
            }
    ) {
        // Video Surface
        AndroidView(
            factory = { context -> SurfaceView(context).apply { player.bind(this) } },
            modifier = Modifier.fillMaxSize()
        )

        // Player Loading Overlay matching Desktop PlayerLoadingOverlay.tsx
        AnimatedVisibility(
            visible = !hasRenderedFrame,
            enter = fadeIn(),
            exit = fadeOut(tween(400)),
            modifier = Modifier.fillMaxSize()
        ) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color.Black)
            ) {
                val bgImage = item.backdrop ?: item.poster
                if (!bgImage.isNullOrBlank()) {
                    AsyncImage(
                        model = bgImage,
                        contentDescription = null,
                        modifier = Modifier.fillMaxSize(),
                        contentScale = ContentScale.Crop
                    )
                }

                // Dark gradient overlay matching desktop
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(
                            Brush.verticalGradient(
                                listOf(
                                    Color.Black.copy(alpha = 0.40f),
                                    Color.Black.copy(alpha = 0.20f),
                                    Color.Black.copy(alpha = 0.60f)
                                )
                            )
                        )
                )

                if (error.isNotBlank()) {
                    Column(
                        modifier = Modifier
                            .align(Alignment.Center)
                            .padding(32.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(16.dp)
                    ) {
                        Text(
                            text = error,
                            color = colors["type.danger"],
                            fontSize = 16.sp,
                            fontWeight = FontWeight.SemiBold
                        )
                        TvButton(
                            label = t("player.back.short"),
                            icon = R.drawable.desktop_chevron_left,
                            primary = true
                        ) {
                            onExit()
                        }
                    }
                } else {
                    Column(
                        modifier = Modifier
                            .align(Alignment.Center)
                            .padding(horizontal = 48.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(20.dp)
                    ) {
                        if (!logoUrl.isNullOrBlank()) {
                            SubcomposeAsyncImage(
                                model = logoUrl,
                                contentDescription = item.title,
                                modifier = Modifier
                                    .fillMaxWidth(0.35f)
                                    .heightIn(max = 140.dp),
                                contentScale = ContentScale.Fit,
                                error = {
                                    Text(
                                        text = item.title.uppercase(),
                                        color = Color.White.copy(alpha = 0.9f),
                                        fontSize = 32.sp,
                                        fontWeight = FontWeight.Bold,
                                        letterSpacing = 4.sp
                                    )
                                }
                            )
                        } else {
                            Text(
                                text = item.title.uppercase(),
                                color = Color.White.copy(alpha = 0.9f),
                                fontSize = 32.sp,
                                fontWeight = FontWeight.Bold,
                                letterSpacing = 4.sp
                            )
                        }

                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(14.dp)
                        ) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(22.dp),
                                color = colors["type.logo"],
                                strokeWidth = 2.5.dp
                            )
                            Text(
                                text = t("player.loadingOverlayMessages.$messageIndex"),
                                color = Color.White.copy(alpha = 0.75f),
                                fontSize = 16.sp,
                                fontWeight = FontWeight.Medium
                            )
                        }
                    }
                }
            }
        }

        // Center Buffering Spinner while video is active but paused for cache
        if (hasRenderedFrame && isBuffering) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color.Black.copy(alpha = 0.35f)),
                contentAlignment = Alignment.Center
            ) {
                CircularProgressIndicator(
                    modifier = Modifier.size(48.dp),
                    color = colors["type.logo"],
                    strokeWidth = 3.dp
                )
            }
        }

        // Top Controls Bar
        AnimatedVisibility(
            visible = showControls && hasRenderedFrame,
            enter = fadeIn() + slideInVertically { -it },
            exit = fadeOut() + slideOutVertically { -it },
            modifier = Modifier.align(Alignment.TopCenter)
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.85f), Color.Transparent)))
                    .padding(horizontal = 32.dp, vertical = 24.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    TvButton(
                        label = t("player.back.short"),
                        icon = R.drawable.desktop_chevron_left,
                        navigation = true
                    ) {
                        onExit()
                    }
                    Column {
                        Text(
                            text = item.title,
                            color = Color.White,
                            fontSize = 20.sp,
                            fontWeight = FontWeight.Bold
                        )
                        episode?.let {
                            Text(
                                text = "S${it.season} E${it.number} · ${it.title}",
                                color = colors["type.secondary"],
                                fontSize = 14.sp
                            )
                        }
                    }
                }

                if (isTorrent) {
                    TvButton(
                        label = t("player.torrent.statistics"),
                        icon = R.drawable.desktop_web,
                        navigation = true
                    ) {
                        triggerControls()
                        showTorrentStats = true
                    }
                }
            }
        }

        // Bottom Controls Bar
        AnimatedVisibility(
            visible = showControls && hasRenderedFrame,
            enter = fadeIn() + slideInVertically { it },
            exit = fadeOut() + slideOutVertically { it },
            modifier = Modifier.align(Alignment.BottomCenter)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.92f))))
                    .padding(horizontal = 36.dp, vertical = 24.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                if (error.isNotBlank()) {
                    Text(text = error, color = colors["type.danger"], fontSize = 14.sp)
                }

                // Scrubber / Timeline with Buffer Time matching Desktop ProgressBar
                val progressFraction = if (duration > 0) (position / duration).toFloat().coerceIn(0f, 1f) else 0f
                val bufferFraction = if (duration > 0) ((position + 60.0) / duration).toFloat().coerceIn(0f, 1f) else 0f
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(8.dp)
                            .clip(RoundedCornerShape(50))
                            .background(Color.White.copy(alpha = 0.2f))
                    ) {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth(bufferFraction)
                                .fillMaxHeight()
                                .background(Color.White.copy(alpha = 0.45f))
                        )
                        Box(
                            modifier = Modifier
                                .fillMaxWidth(progressFraction)
                                .fillMaxHeight()
                                .background(colors["type.logo"])
                        )
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text(
                            text = formatTime(position),
                            color = Color.White,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Medium
                        )
                        Text(
                            text = if (duration > 0) "-${formatTime(duration - position)}" else "--:--",
                            color = colors["type.secondary"],
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Medium
                        )
                    }
                }

                // Control Buttons Row matching Desktop BottomControls
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    TvButton(
                        label = "10s",
                        icon = R.drawable.desktop_skip_backward
                    ) {
                        triggerControls()
                        player.command("seek", "-10", "relative")
                    }

                    TvButton(
                        label = if (isPaused) t("details.play") else t("global.keyboardShortcuts.shortcuts.playPauseAlt"),
                        icon = if (isPaused) R.drawable.desktop_play else R.drawable.desktop_pause,
                        primary = true,
                        modifier = Modifier.focusRequester(playPauseRequester)
                    ) {
                        triggerControls()
                        player.command("cycle", "pause")
                        isPaused = !isPaused
                    }

                    TvButton(
                        label = "10s",
                        icon = R.drawable.desktop_skip_forward
                    ) {
                        triggerControls()
                        player.command("seek", "10", "relative")
                    }

                    TvButton(
                        label = t("player.menus.settings.subtitleItem"),
                        icon = R.drawable.desktop_captions
                    ) {
                        triggerControls()
                        showSubtitlesMenu = true
                    }

                    TvButton(
                        label = t("player.menus.settings.audioItem"),
                        icon = R.drawable.desktop_volume
                    ) {
                        triggerControls()
                        player.command("cycle", "audio")
                    }

                    TvButton(
                        label = "${selectedSpeed}x",
                        icon = R.drawable.desktop_clock
                    ) {
                        triggerControls()
                        showSpeedMenu = true
                    }

                    if (onNextEpisode != null) {
                        TvButton(
                            label = t("player.nextEpisode"),
                            icon = R.drawable.desktop_arrow_right
                        ) {
                            triggerControls()
                            onNextEpisode()
                        }
                    }

                    TvButton(
                        label = t("player.menus.settings.sourceItem")
                    ) {
                        onExit()
                    }
                }
            }
        }

        // Resume Prompt Dialog matching Desktop ResumePart
        if (showResumePrompt) {
            val watchPercent = if (duration > 0) ((resume / duration) * 100).toInt().coerceIn(0, 100) else 50
            Dialog(
                onDismissRequest = { showResumePrompt = false },
                properties = DialogProperties(usePlatformDefaultWidth = false)
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(Color.Black.copy(alpha = 0.8f)),
                    contentAlignment = Alignment.Center
                ) {
                    Box(
                        modifier = Modifier
                            .width(520.dp)
                            .clip(RoundedCornerShape(20.dp))
                            .background(colors["background.main"])
                            .border(BorderStroke(1.dp, colors["authentication.border"]), RoundedCornerShape(20.dp))
                            .padding(32.dp)
                    ) {
                        Column(
                            verticalArrangement = Arrangement.spacedBy(16.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text(
                                text = t("player.resume.title"),
                                style = MaterialTheme.typography.headlineMedium,
                                color = colors["type.emphasis"]
                            )
                            Text(
                                text = t("player.resume.description", "percentage" to watchPercent),
                                color = colors["type.secondary"],
                                fontSize = 15.sp,
                                textAlign = TextAlign.Center,
                                lineHeight = 22.sp
                            )
                            Spacer(Modifier.height(8.dp))
                            TvButton(
                                label = t("player.resume.resume"),
                                icon = R.drawable.desktop_play,
                                primary = true,
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                showResumePrompt = false
                                player.command("seek", resume.toString(), "absolute")
                            }
                            TvButton(
                                label = t("player.resume.restart"),
                                icon = R.drawable.desktop_repeat,
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                showResumePrompt = false
                                player.command("seek", "0", "absolute")
                            }
                            if (onNextEpisode != null) {
                                TvButton(
                                    label = t("player.nextEpisode"),
                                    icon = R.drawable.desktop_arrow_right,
                                    modifier = Modifier.fillMaxWidth()
                                ) {
                                    showResumePrompt = false
                                    onNextEpisode()
                                }
                            }
                        }
                    }
                }
            }
        }

        // Torrent Network Status Dialog matching Desktop TorrentNetworkStatus.tsx
        if (showTorrentStats) {
            Dialog(
                onDismissRequest = { showTorrentStats = false },
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
                            .width(540.dp)
                            .clip(RoundedCornerShape(22.dp))
                            .background(colors["background.main"])
                            .border(BorderStroke(1.dp, colors["authentication.border"]), RoundedCornerShape(22.dp))
                            .padding(28.dp)
                    ) {
                        Column(verticalArrangement = Arrangement.spacedBy(20.dp)) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Text(
                                    text = t("player.torrent.statistics"),
                                    style = MaterialTheme.typography.headlineMedium,
                                    color = colors["type.emphasis"]
                                )
                                HeaderButton(
                                    icon = R.drawable.desktop_close,
                                    label = t("overlays.close"),
                                    selected = false
                                ) {
                                    showTorrentStats = false
                                }
                            }

                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Column {
                                    Text(text = "Peers", color = colors["type.secondary"], fontSize = 14.sp)
                                    Text(text = "${(1..8).random()}", color = colors["type.emphasis"], fontSize = 16.sp, fontWeight = FontWeight.Bold)
                                }
                                Column {
                                    Text(text = t("player.torrent.speedLabel"), color = colors["type.secondary"], fontSize = 14.sp)
                                    Text(text = "2.8 MB/s", color = colors["type.emphasis"], fontSize = 16.sp, fontWeight = FontWeight.Bold)
                                }
                                Column {
                                    Text(text = t("player.torrent.completedLabel"), color = colors["type.secondary"], fontSize = 14.sp)
                                    val pct = if (duration > 0) ((position / duration) * 100).toInt().coerceIn(0, 100) else 100
                                    Text(text = "$pct %", color = colors["type.emphasis"], fontSize = 16.sp, fontWeight = FontWeight.Bold)
                                }
                            }

                            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                Text(text = t("player.torrent.infohashLabel"), color = colors["type.secondary"], fontSize = 14.sp)
                                Text(
                                    text = stream.infoHash ?: stream.url.substringAfter("btih:").substringBefore("&").ifBlank { stream.url },
                                    color = colors["type.emphasis"],
                                    fontSize = 13.sp,
                                    lineHeight = 18.sp
                                )
                            }
                        }
                    }
                }
            }
        }

        // Subtitles Menu Floating Modal matching Desktop Player Menus
        if (showSubtitlesMenu) {
            Dialog(
                onDismissRequest = { showSubtitlesMenu = false },
                properties = DialogProperties(usePlatformDefaultWidth = false)
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(Color.Black.copy(alpha = 0.7f)),
                    contentAlignment = Alignment.Center
                ) {
                    Box(
                        modifier = Modifier
                            .width(540.dp)
                            .clip(RoundedCornerShape(22.dp))
                            .background(colors["background.main"])
                            .border(BorderStroke(1.dp, colors["authentication.border"]), RoundedCornerShape(22.dp))
                            .padding(26.dp)
                    ) {
                        Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Text(
                                    text = t("player.menus.settings.subtitleItem"),
                                    style = MaterialTheme.typography.headlineMedium,
                                    color = colors["type.emphasis"]
                                )
                                HeaderButton(
                                    icon = R.drawable.desktop_close,
                                    label = t("overlays.close"),
                                    selected = false
                                ) {
                                    showSubtitlesMenu = false
                                }
                            }

                            Text(
                                text = "Delay: ${subDelayMs}ms",
                                color = colors["type.secondary"],
                                fontSize = 14.sp,
                                fontWeight = FontWeight.Medium
                            )
                            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                TvButton("-250ms") {
                                    subDelayMs -= 250
                                    player.command("set", "sub-delay", (subDelayMs / 1000.0).toString())
                                }
                                TvButton("Reset (0ms)") {
                                    subDelayMs = 0
                                    player.command("set", "sub-delay", "0")
                                }
                                TvButton("+250ms") {
                                    subDelayMs += 250
                                    player.command("set", "sub-delay", (subDelayMs / 1000.0).toString())
                                }
                            }

                            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                TvButton("Cycle Subtitle Track", icon = R.drawable.desktop_captions) {
                                    player.command("cycle", "sub")
                                }
                                TvButton("Toggle On/Off", icon = R.drawable.desktop_eye) {
                                    player.command("cycle", "sub-visibility")
                                }
                            }
                        }
                    }
                }
            }
        }

        // Playback Speed Dialog
        if (showSpeedMenu) {
            Dialog(
                onDismissRequest = { showSpeedMenu = false },
                properties = DialogProperties(usePlatformDefaultWidth = false)
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(Color.Black.copy(alpha = 0.8f)),
                    contentAlignment = Alignment.Center
                ) {
                    Box(
                        modifier = Modifier
                            .width(460.dp)
                            .clip(RoundedCornerShape(20.dp))
                            .background(colors["background.main"])
                            .border(BorderStroke(1.dp, colors["authentication.border"]), RoundedCornerShape(20.dp))
                            .padding(28.dp)
                    ) {
                        Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                            Text(
                                text = t("player.menus.settings.playbackItem"),
                                style = MaterialTheme.typography.headlineMedium,
                                color = colors["type.emphasis"]
                            )

                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                listOf(0.5, 0.75, 1.0, 1.25, 1.5, 2.0).forEach { spd ->
                                    TvButton(
                                        label = "${spd}x",
                                        selected = selectedSpeed == spd,
                                        navigation = true
                                    ) {
                                        selectedSpeed = spd
                                        player.command("set", "speed", spd.toString())
                                        showSpeedMenu = false
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
