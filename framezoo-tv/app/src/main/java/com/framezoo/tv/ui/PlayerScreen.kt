package com.framezoo.tv.ui

import android.view.KeyEvent
import android.view.SurfaceView
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.background
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.lifecycleScope
import com.framezoo.tv.api.Backend
import com.framezoo.tv.model.Episode
import com.framezoo.tv.model.Media
import com.framezoo.tv.model.Stream
import com.framezoo.tv.model.Subtitle
import com.framezoo.tv.player.PlayerController
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
internal fun PlayerScreen(player: PlayerController, item: Media, episode: Episode?, stream: Stream, subtitles: List<Subtitle>, backend: Backend, resume: Double, onStopped: (Double) -> Unit, onExit: () -> Unit) {
    val colors = LocalFrameZooColors.current
    val activity = LocalContext.current as ComponentActivity
    var position by remember { mutableStateOf(0.0) }
    var duration by remember { mutableStateOf(0.0) }
    var error by remember { mutableStateOf("") }
    LaunchedEffect(stream) {
        try { player.play(stream, subtitles) } catch (e: Exception) { error = e.message ?: "Không phát được nguồn" }
    }
    LaunchedEffect(stream, resume) {
        if (resume > 20) {
            repeat(30) {
                delay(1000)
                if (player.duration() > resume) { player.command("seek", resume.toString(), "absolute"); return@LaunchedEffect }
            }
        }
    }
    LaunchedEffect(stream) {
        while (true) {
            delay(1000)
            position = player.position(); duration = player.duration()
            if (position.toInt() % 30 == 0 && position >= 20) runCatching { backend.progress(item, position, duration, episode) }
        }
    }
    DisposableEffect(stream) {
        onDispose {
            val pos = player.position(); val len = player.duration()
            if (pos >= 20) onStopped(pos)
            player.stop()
            if (pos >= 20) activity.lifecycleScope.launch { runCatching { backend.progress(item, pos, len, episode) } }
        }
    }
    Box(Modifier.fillMaxSize().onPreviewKeyEvent {
        if (it.nativeKeyEvent.action != KeyEvent.ACTION_DOWN) return@onPreviewKeyEvent false
        when (it.nativeKeyEvent.keyCode) {
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> { player.command("cycle", "pause"); true }
            else -> false
        }
    }) {
        AndroidView(factory = { context -> SurfaceView(context).apply { player.bind(this) } }, modifier = Modifier.fillMaxSize())
        Column(Modifier.align(Alignment.BottomStart).fillMaxWidth()
            .background(Brush.verticalGradient(listOf(Color.Transparent, colors["video.context.background"].copy(alpha = 0.94f))))
            .padding(24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(item.title + (episode?.let { " · S${it.season}E${it.number}" } ?: ""),
                color = colors["type.emphasis"], fontSize = 23.sp, fontWeight = FontWeight.Bold)
            Text("${position.toInt()}s / ${duration.toInt()}s", color = colors["video.context.type.main"])
            if (error.isNotBlank()) Text(error, color = colors["type.danger"])
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                TvButton("⏪ 10s") { player.command("seek", "-10", "relative") }
                TvButton("Phát / Tạm dừng") { player.command("cycle", "pause") }
                TvButton("10s ⏩") { player.command("seek", "10", "relative") }
                TvButton("Audio") { player.command("cycle", "audio") }
                TvButton("Phụ đề") { player.command("cycle", "sub") }
                TvButton("Thoát") { onExit() }
            }
        }
    }
}
