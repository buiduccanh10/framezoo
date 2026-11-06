package com.framezoo.tv.ui

import android.view.KeyEvent
import android.view.SurfaceView
import androidx.activity.ComponentActivity
import androidx.compose.animation.AnimatedVisibility
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.lifecycleScope
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
    onStopped: (Double) -> Unit,
    onExit: () -> Unit
) {
    val colors = LocalFrameZooColors.current
    val activity = LocalContext.current as ComponentActivity
    val scope = rememberCoroutineScope()

    var position by remember { mutableDoubleStateOf(0.0) }
    var duration by remember { mutableDoubleStateOf(0.0) }
    var isPaused by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var showControls by remember { mutableStateOf(true) }
    var showResumePrompt by remember { mutableStateOf(resume > 20) }
    var showSubtitlesMenu by remember { mutableStateOf(false) }
    var showSpeedMenu by remember { mutableStateOf(false) }
    var selectedSpeed by remember { mutableDoubleStateOf(1.0) }
    var subDelayMs by remember { mutableIntStateOf(0) }
    var controlsTimeoutKey by remember { mutableIntStateOf(0) }

    val playPauseRequester = remember { FocusRequester() }
    val defaultSourceError = t("player.playbackError.title")

    fun triggerControls() {
        showControls = true
        controlsTimeoutKey++
    }

    LaunchedEffect(controlsTimeoutKey, showControls) {
        if (showControls && !showSubtitlesMenu && !showSpeedMenu && !showResumePrompt) {
            delay(4000)
            showControls = false
        }
    }

    LaunchedEffect(stream) {
        try {
            player.play(stream, subtitles)
        } catch (e: Exception) {
            error = e.message ?: defaultSourceError
        }
    }

    LaunchedEffect(stream) {
        while (true) {
            delay(500)
            position = player.position()
            duration = player.duration()
            isPaused = player.paused()
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

        // Top Controls Bar
        AnimatedVisibility(
            visible = showControls,
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
            }
        }

        // Bottom Controls Bar
        AnimatedVisibility(
            visible = showControls,
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

                // Scrubber / Timeline
                val progressFraction = if (duration > 0) (position / duration).toFloat().coerceIn(0f, 1f) else 0f
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(6.dp)
                            .clip(RoundedCornerShape(50))
                            .background(Color.White.copy(alpha = 0.25f))
                    ) {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth(progressFraction)
                                .height(6.dp)
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
            val watchPercent = if (duration > 0) ((resume / duration) * 100).toInt() else 50
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
                                text = "${formatTime(resume)} (${watchPercent}%)",
                                color = colors["type.secondary"],
                                fontSize = 16.sp
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
                        }
                    }
                }
            }
        }

        // Subtitles Menu Dialog
        if (showSubtitlesMenu) {
            Dialog(
                onDismissRequest = { showSubtitlesMenu = false },
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
                            .width(540.dp)
                            .clip(RoundedCornerShape(20.dp))
                            .background(colors["background.main"])
                            .border(BorderStroke(1.dp, colors["authentication.border"]), RoundedCornerShape(20.dp))
                            .padding(28.dp)
                    ) {
                        Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                            Text(
                                text = t("player.menus.settings.subtitleItem"),
                                style = MaterialTheme.typography.headlineMedium,
                                color = colors["type.emphasis"]
                            )

                            Text(
                                text = "Delay: ${subDelayMs}ms",
                                color = colors["type.secondary"],
                                fontSize = 14.sp
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
                                TvButton("Cycle Subtitle Track") {
                                    player.command("cycle", "sub")
                                }
                                TvButton("Toggle Subtitles On/Off") {
                                    player.command("cycle", "sub-visibility")
                                }
                            }

                            TvButton(
                                label = t("overlays.close"),
                                primary = true,
                                modifier = Modifier.align(Alignment.End)
                            ) {
                                showSubtitlesMenu = false
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
