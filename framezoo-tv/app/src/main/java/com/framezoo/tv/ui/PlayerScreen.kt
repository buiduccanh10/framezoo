package com.framezoo.tv.ui

import android.view.KeyEvent
import android.view.SurfaceView
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.Image
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.toggleableState
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.lifecycle.lifecycleScope
import coil.compose.AsyncImage
import coil.compose.SubcomposeAsyncImage
import androidx.tv.material3.Border as TvBorder
import androidx.tv.material3.Button as MaterialTvButton
import androidx.tv.material3.ButtonDefaults as TvButtonDefaults
import androidx.tv.material3.Card as TvCard
import androidx.tv.material3.CardDefaults as TvCardDefaults
import com.framezoo.tv.R
import com.framezoo.tv.api.Backend
import com.framezoo.tv.model.Episode
import com.framezoo.tv.model.Media
import com.framezoo.tv.model.Stream
import com.framezoo.tv.model.Subtitle
import com.framezoo.tv.player.PlayerController
import com.framezoo.tv.player.AudioTrack
import com.framezoo.tv.player.VideoTrack
import com.framezoo.tv.player.SubtitleTrack
import com.framezoo.tv.player.TranscriptCue
import com.framezoo.tv.player.TorrentLiveStats
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private fun formatDurationTime(seconds: Double): String {
    val total = seconds.toInt().coerceAtLeast(0)
    val hrs = total / 3600
    val mins = (total % 3600) / 60
    val secs = total % 60
    return if (hrs > 0) "%d:%02d:%02d".format(hrs, mins, secs) else "%d:%02d".format(mins, secs)
}

private fun formatSpeed(bytesPerSec: Long): String {
    if (bytesPerSec <= 0L) return "0 KB/s"
    val kb = bytesPerSec / 1024.0
    if (kb < 1024.0) return "%.0f KB/s".format(kb)
    val mb = kb / 1024.0
    return "%.1f MB/s".format(mb)
}

private fun formatEndTime(remainingSeconds: Double): String {
    if (remainingSeconds < 0.0 || remainingSeconds.isNaN() || remainingSeconds.isInfinite()) return ""
    val endMillis = System.currentTimeMillis() + (remainingSeconds * 1000).toLong()
    return runCatching {
        SimpleDateFormat("h:mm a", Locale.getDefault()).format(Date(endMillis))
    }.getOrDefault("")
}

private fun audioTrackLabel(track: AudioTrack): String {
    val language = track.language.takeIf { it.isNotBlank() && it != "und" }
        ?.let { Locale.forLanguageTag(it).getDisplayLanguage(Locale.getDefault()).replaceFirstChar { c -> c.uppercase() } }
    return listOfNotNull(language, track.title.takeIf { it.isNotBlank() }).distinct().joinToString(" · ")
}

private data class CaptionChoice(val language: String, val label: String, val url: String?, val nativeId: String?, val selected: Boolean)

@Composable
internal fun PlayerIconButton(
    icon: Int,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    size: Dp = 44.dp,
    iconSize: Dp = 22.dp,
    active: Boolean = false,
    pillBackground: Boolean = false
) {
    val colors = LocalFrameZooColors.current
    var focused by remember { mutableStateOf(false) }
    val shape = CircleShape
    val bg = when {
        focused -> Color.White.copy(alpha = 0.22f)
        active -> colors["video.buttonBackground"].copy(alpha = 0.85f)
        pillBackground -> Color.White.copy(alpha = 0.10f)
        else -> Color.Transparent
    }
    MaterialTvButton(
        onClick = onClick,
        modifier = modifier
            .size(size)
            .onFocusChanged { focused = it.isFocused },
        shape = TvButtonDefaults.shape(shape),
        colors = TvButtonDefaults.colors(
            containerColor = bg,
            contentColor = Color.White,
            focusedContainerColor = Color.White.copy(alpha = 0.22f),
            focusedContentColor = Color.White
        ),
        scale = TvButtonDefaults.scale(focusedScale = 1.1f),
        border = TvButtonDefaults.border(
            border = if (pillBackground) TvBorder(BorderStroke(1.dp, Color.White.copy(alpha = 0.12f)), shape = shape) else TvBorder.None,
            focusedBorder = TvBorder(BorderStroke(2.dp, colors["type.logo"]), shape = shape)
        ),
        contentPadding = PaddingValues(0.dp)
    ) {
        Icon(
            painter = painterResource(icon),
            contentDescription = null,
            tint = if (active) colors["type.logo"] else Color.White,
            modifier = Modifier.size(iconSize)
        )
    }
}

@Composable
internal fun PlayerBrandPill() {
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(50))
            .background(Color.White.copy(alpha = 0.10f))
            .border(BorderStroke(1.dp, Color.White.copy(alpha = 0.10f)), RoundedCornerShape(50))
            .padding(horizontal = 12.dp, vertical = 6.dp),
        contentAlignment = Alignment.Center
    ) {
        Image(painterResource(R.drawable.framezoo_brand), contentDescription = "Framezoo", modifier = Modifier.width(92.dp).height(27.dp), contentScale = ContentScale.Fit)
    }
}

@Composable
internal fun PlayerScreen(
    state: FrameZooState,
    player: PlayerController,
    item: Media,
    episode: Episode?,
    stream: Stream?,
    subtitles: List<Subtitle>,
    backend: Backend,
    resume: Double,
    resumeDuration: Double,
    onNextEpisode: (() -> Unit)? = null,
    onSelectEpisode: ((Episode) -> Unit)? = null,
    onStopped: (Double, Double) -> Unit,
    onExit: () -> Unit
) {
    val colors = LocalFrameZooColors.current
    val activity = LocalContext.current as ComponentActivity
    val subtitleFailureText = t("player.menus.subtitles.fetchFailed")
    val subtitleSecondaryHint = t("player.menus.subtitles.dualSubHint")

    // Calculate initial watched percentage for ResumePart (> 80% triggers ResumePart before SourceSelectPart, matching PlayerView.tsx lines 416-431)
    val initialPercentage = remember(item.id, episode?.id) {
        if (resumeDuration > 0.0) ((resume / resumeDuration) * 100.0).toInt().coerceIn(0, 100) else 0
    }
    var resumeHandled by remember(item.id, episode?.id) { mutableStateOf(initialPercentage <= 80) }
    var shouldStartFromBeginning by remember(item.id, episode?.id) { mutableStateOf(false) }

    var position by remember { mutableDoubleStateOf(0.0) }
    var duration by remember { mutableDoubleStateOf(0.0) }
    var isPaused by remember { mutableStateOf(false) }
    var isBuffering by remember { mutableStateOf(false) }
    var isOpening by remember { mutableStateOf(false) }
    var hasRenderedFrame by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var showControls by remember { mutableStateOf(true) }
    var showRemainingTime by remember { mutableStateOf(false) }
    var isMuted by remember { mutableStateOf(false) }
    var selectedSpeed by remember { mutableDoubleStateOf(1.0) }
    var subtitlesEnabled by remember { mutableStateOf(true) }
    var secondarySubtitlesEnabled by remember { mutableStateOf(true) }
    var selectedSubtitleLang by remember { mutableStateOf<String?>(null) }
    var torrentStats by remember { mutableStateOf<TorrentLiveStats?>(null) }
    var audioTracks by remember { mutableStateOf<List<AudioTrack>>(emptyList()) }
    var videoTracks by remember { mutableStateOf<List<VideoTrack>>(emptyList()) }
    var subtitleTracks by remember { mutableStateOf<List<SubtitleTrack>>(emptyList()) }
    var primarySubtitleId by remember { mutableStateOf<String?>(null) }
    var secondarySubtitleId by remember { mutableStateOf<String?>(null) }
    var subtitleError by remember(stream) { mutableStateOf("") }
    var captionMode by remember { mutableStateOf<String?>(null) }
    val subtitleScope = rememberCoroutineScope()
    var subtitleChosen by remember(stream) { mutableStateOf(false) }
    var bufferedSeconds by remember { mutableDoubleStateOf(0.0) }
    var switchPosition by remember(item.id, episode?.season, episode?.number) { mutableStateOf<Double?>(null) }

    // Active Overlay Router (`null`, `"settings"`, `"source"`, `"captions"`, `"captions_lang"`, `"captions_settings"`, `"playback"`, `"audio"`, `"quality"`, `"episodes"`, `"torrent"`)
    var activeOverlay by remember { mutableStateOf<String?>(null) }
    var captionsReturn by remember { mutableStateOf<String?>(null) }
    var sourceReturn by remember { mutableStateOf("settings") }
    var controlsTimeoutKey by remember { mutableIntStateOf(0) }
    val playPauseRequester = remember { FocusRequester() }
    val progressBarRequester = remember { FocusRequester() }
    val resumeButtonRequester = remember { FocusRequester() }
    val topBackRequester = remember { FocusRequester() }
    val rootPlayerRequester = remember { FocusRequester() }

    val isSourceSelecting = resumeHandled && stream == null
    LaunchedEffect(isSourceSelecting, state.sourcesLoading, state.addonLoading, state.addonStreams) {
        if (isSourceSelecting) state.selectPreferredSourceWhenReady()
    }
    val isPlayingStream = resumeHandled && stream != null
    val isTorrent = stream != null && (stream.infoHash != null || stream.url.startsWith("magnet:"))
    val isBookmarked = state.bookmarks.any { it.id == item.id }

    LaunchedEffect(state.activeWatchParty) {
        if (state.activeWatchParty != null) {
            selectedSpeed = 1.0
            player.command("set", "speed", "1")
        }
    }
    WatchPartyPlayback(state, player, backend, item, episode, stream, hasRenderedFrame, onSelectEpisode)

    // Fetch movie/series logo in background for PlayerLoadingOverlay
    val logoUrl by produceState<String?>(initialValue = null, key1 = item.id) {
        value = runCatching { backend.logo(item) }.getOrNull()
    }

    var logoFailed by remember(logoUrl) { mutableStateOf(false) }

    // Cycling funny loading messages matching Desktop PlayerLoadingOverlay
    var messageIndex by remember { mutableIntStateOf((1..22).random()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(3500)
            messageIndex = (1..22).filter { it != messageIndex }.random()
        }
    }

    // Progressive loading percentage for horizontal logo reveal (matching Desktop `loadingProgress` in `PlayerLoadingOverlay.tsx`)
    var simulatedProgress by remember(stream) { mutableFloatStateOf(8f) }
    LaunchedEffect(stream, isOpening, hasRenderedFrame) {
        if (stream != null && !hasRenderedFrame) {
            simulatedProgress = 8f
            while (!hasRenderedFrame && simulatedProgress < 92f) {
                delay(400)
                val step = if (simulatedProgress < 45f) 4.5f else if (simulatedProgress < 75f) 2.2f else 0.8f
                simulatedProgress = (simulatedProgress + step).coerceAtMost(92f)
            }
        } else if (hasRenderedFrame) {
            simulatedProgress = 100f
        }
    }
    val realProgress = remember(simulatedProgress, torrentStats, hasRenderedFrame) {
        if (hasRenderedFrame) 100f
        else {
            val tProg = ((torrentStats?.progress ?: 0.0) * 100.0).toFloat()
            maxOf(simulatedProgress, tProg).coerceIn(5f, 98f)
        }
    }
    val animatedFillFraction by animateFloatAsState(
        targetValue = (realProgress / 100f).coerceIn(0f, 1f),
        animationSpec = tween(350),
        label = "logo_fill_fraction"
    )

    fun triggerControls() {
        showControls = true
        controlsTimeoutKey++
    }

    LaunchedEffect(controlsTimeoutKey, showControls, activeOverlay, hasRenderedFrame, isPaused) {
        if (showControls && activeOverlay == null && hasRenderedFrame && !isPaused && isPlayingStream) {
            delay(4500)
            showControls = false
            runCatching { rootPlayerRequester.requestFocus() }
        }
    }

    LaunchedEffect(showControls, hasRenderedFrame, activeOverlay) {
        if (hasRenderedFrame && showControls && activeOverlay == null) {
            delay(100)
            runCatching { playPauseRequester.requestFocus() }
        } else if (hasRenderedFrame && !showControls && activeOverlay == null) {
            runCatching { rootPlayerRequester.requestFocus() }
        }
    }

    LaunchedEffect(stream, hasRenderedFrame) {
        if (stream != null && !hasRenderedFrame) runCatching { topBackRequester.requestFocus() }
    }

    // Start playback when `stream` is chosen
    val defaultSourceError = t("player.playbackError.title")
    LaunchedEffect(stream, resumeHandled) {
        if (!resumeHandled) return@LaunchedEffect
        val currentStream = stream ?: return@LaunchedEffect
        isOpening = true
        hasRenderedFrame = false
        error = ""
        val startAt = switchPosition ?: if (shouldStartFromBeginning) 0.0 else resume
        switchPosition = null
        audioTracks = emptyList()
        videoTracks = emptyList()
        subtitleTracks = emptyList()
        primarySubtitleId = null
        secondarySubtitleId = null
        bufferedSeconds = 0.0
        try {
            // ponytail: bitrate approximates the previous HLS quality; parse the new manifest to match its resolution.
            val initialBitrate = if (streamKind(currentStream) == "hls" && !state.automaticVideoQuality) state.store.preferredVideoBitrate else 0L
            player.play(currentStream, startAt, initialBitrate)
            player.command("set", "speed", selectedSpeed.toString())
            player.command("set", "mute", if (isMuted) "yes" else "no")
            player.command("set", "sub-visibility", if (subtitlesEnabled) "yes" else "no")
            player.command("set", "secondary-sub-visibility", if (secondarySubtitlesEnabled) "yes" else "no")
            state.applySubtitleStyling()
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            error = e.message ?: defaultSourceError
        } finally {
            isOpening = false
        }
    }

    LaunchedEffect(stream, subtitles, isOpening, resumeHandled) {
        if (!resumeHandled) return@LaunchedEffect
        val currentStream = stream ?: return@LaunchedEffect
        if (isOpening || subtitleChosen) return@LaunchedEffect
        val candidates = (currentStream.subtitles + subtitles).distinctBy { it.url }
        val sub = candidates.firstOrNull { it.language.startsWith("vi", true) }
            ?: candidates.firstOrNull { it.language.startsWith("en", true) }
            ?: return@LaunchedEffect
        val token = player.subtitleToken() ?: return@LaunchedEffect
        subtitleChosen = true
        withContext(Dispatchers.IO) {
            player.selectSubtitle(token, null, sub.url, sub.label.ifBlank { sub.language }, sub.language, false, currentStream.headers, currentStream.url)
        }
    }

    LaunchedEffect(stream, isOpening, resumeHandled, showControls, state.subtitleVerticalPosition) {
        if (stream != null && resumeHandled && !isOpening) {
            player.command("set", "sub-pos", subtitlePosition(showControls, state.subtitleVerticalPosition).toString())
            player.command("set", "secondary-sub-pos", secondarySubtitlePosition(showControls, state.subtitleVerticalPosition).toString())
        }
    }

    val currentNextEpisode by rememberUpdatedState(onNextEpisode)
    // Poll player state & torrent live stats
    LaunchedEffect(stream, resumeHandled) {
        if (stream == null || !resumeHandled) return@LaunchedEffect
        var autoplayed = false
        while (true) {
            delay(400)
            position = player.position()
            duration = player.duration()
            isPaused = player.paused()
            isBuffering = player.propertyString("paused-for-cache") == "yes"
            torrentStats = player.torrentStats()
            bufferedSeconds = player.propertyDouble("demuxer-cache-duration").coerceAtLeast(0.0)
            audioTracks = player.audioTracks()
            videoTracks = player.videoTracks()
            subtitleTracks = player.subtitleTracks()
            primarySubtitleId = player.propertyString("sid")
            secondarySubtitleId = player.propertyString("secondary-sid")

            if (!hasRenderedFrame && error.isBlank() && player.hasVideoFrame()) {
                hasRenderedFrame = true
            }

            val next = currentNextEpisode
            if (!autoplayed && hasRenderedFrame && state.activeWatchParty == null && state.enableAutoplay && next != null &&
                playbackFinished(position, duration, player.propertyString("eof-reached") == "yes", state.enableSkipCredits)) {
                autoplayed = true
                next()
            }

            if (hasRenderedFrame && position.toInt() % 30 == 0 && position >= 20) {
                runCatching { backend.progress(item, position, duration, episode) }
            }
        }
    }

    DisposableEffect(stream) {
        onDispose {
            if (stream != null) {
                val pos = player.position()
                val len = player.duration()
                if (hasRenderedFrame && pos >= 20) onStopped(pos, len)
                player.stop()
                if (hasRenderedFrame && pos >= 20) {
                    activity.lifecycleScope.launch {
                        runCatching { backend.progress(item, pos, len, episode) }
                    }
                }
            }
        }
    }

    BackHandler(enabled = true) {
        when {
            activeOverlay in listOf("captions_lang", "captions_settings", "captions_transcript") -> {
                activeOverlay = "captions"
            }
            activeOverlay == "captions" -> {
                activeOverlay = if (captionMode != null) "captions_dual" else captionsReturn
                captionMode = null
            }
            activeOverlay == "captions_dual" -> { captionMode = null; activeOverlay = "captions" }
            activeOverlay == "source" -> {
                activeOverlay = sourceReturn
            }
            activeOverlay in listOf("playback", "audio", "quality", "watchparty") -> {
                activeOverlay = "settings"
            }
            activeOverlay != null -> {
                activeOverlay = null
            }
            isPlayingStream && !hasRenderedFrame -> {
                // Cancel loading stream and return to SourceSelectPart inside PlayerView
                player.stop()
                state.playing = null
            }
            else -> {
                onExit()
            }
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black)
            .focusRequester(rootPlayerRequester)
            .focusable()
            .onPreviewKeyEvent { event ->
                if (event.nativeKeyEvent.action != KeyEvent.ACTION_DOWN) return@onPreviewKeyEvent false
                when (event.nativeKeyEvent.keyCode) {
                    KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> {
                        if (isPlayingStream && hasRenderedFrame) {
                            player.command("cycle", "pause")
                            isPaused = !isPaused
                            triggerControls()
                            true
                        } else false
                    }
                    KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER -> {
                        if (isPlayingStream && hasRenderedFrame && !showControls && activeOverlay == null) {
                            triggerControls()
                            runCatching { playPauseRequester.requestFocus() }
                            true
                        } else false
                    }
                    KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_DPAD_DOWN -> {
                        if (isPlayingStream && hasRenderedFrame && !showControls && activeOverlay == null) {
                            triggerControls()
                            runCatching { playPauseRequester.requestFocus() }
                            true
                        } else {
                            triggerControls()
                            false
                        }
                    }
                    KeyEvent.KEYCODE_DPAD_LEFT -> {
                        if (isPlayingStream && hasRenderedFrame && !showControls && activeOverlay == null) {
                            player.command("seek", "-10", "relative")
                            triggerControls()
                            true
                        } else {
                            triggerControls()
                            false
                        }
                    }
                    KeyEvent.KEYCODE_DPAD_RIGHT -> {
                        if (isPlayingStream && hasRenderedFrame && !showControls && activeOverlay == null) {
                            player.command("seek", "10", "relative")
                            triggerControls()
                            true
                        } else {
                            triggerControls()
                            false
                        }
                    }
                    else -> false
                }
            }
    ) {
        // 1. Always keep Video Surface mounted so `PlayerController` has a valid Surface immediately when a stream is selected
        AndroidView(
            factory = { context -> SurfaceView(context).apply { player.bind(this) } },
            modifier = Modifier.fillMaxSize()
        )
        if (state.watchPartyNotice != null || (state.activeWatchParty != null && state.watchPartyStatusOverlay)) {
            val notice = state.watchPartyNotice ?: if (!state.watchPartyConnected) t("watchParty.validating")
                else if (state.watchPartyIsHost) t("watchParty.hosting") else t("watchParty.watching")
            Text(notice, color = Color.White, fontSize = 13.sp,
                modifier = Modifier.align(Alignment.TopEnd).padding(top = 70.dp, end = 36.dp)
                    .background(Color.Black.copy(alpha = 0.75f), RoundedCornerShape(8.dp)).padding(10.dp))
        }

        // 2. Phase 1: `ResumePart` (when watched > 80%, before source selection — matching `ResumePart.tsx`)
        if (!resumeHandled) {
            LaunchedEffect(Unit) {
                runCatching { resumeButtonRequester.requestFocus() }
            }
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(colors["background.main"])
            ) {
                val bgImage = item.backdrop ?: item.poster
                if (!bgImage.isNullOrBlank()) {
                    AsyncImage(
                        model = bgImage,
                        contentDescription = null,
                        modifier = Modifier
                            .fillMaxSize()
                            .alpha(0.35f),
                        contentScale = ContentScale.Crop
                    )
                }
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(
                            Brush.verticalGradient(
                                listOf(
                                    Color.Black.copy(alpha = 0.55f),
                                    Color.Black.copy(alpha = 0.70f),
                                    Color.Black.copy(alpha = 0.88f)
                                )
                            )
                        )
                )

                Column(
                    modifier = Modifier
                        .align(Alignment.Center)
                        .widthIn(max = 460.dp)
                        .padding(horizontal = 24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text(
                        text = t("player.resume.title"),
                        color = Color.White,
                        fontSize = 28.sp,
                        fontWeight = FontWeight.Bold,
                        textAlign = TextAlign.Center
                    )
                    Spacer(Modifier.height(12.dp))
                    Text(
                        text = t("player.resume.description", "percentage" to initialPercentage),
                        color = colors["type.secondary"],
                        fontSize = 16.sp,
                        textAlign = TextAlign.Center,
                        lineHeight = 22.sp
                    )
                    Spacer(Modifier.height(28.dp))
                    Column(
                        modifier = Modifier.width(260.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        TvButton(
                            label = t("player.resume.resume"),
                            icon = R.drawable.desktop_play,
                            accent = true,
                            modifier = Modifier
                                .fillMaxWidth()
                                .focusRequester(resumeButtonRequester)
                        ) {
                            shouldStartFromBeginning = false
                            resumeHandled = true
                        }
                        TvButton(
                            label = t("player.resume.restart"),
                            icon = R.drawable.desktop_repeat,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            shouldStartFromBeginning = true
                            resumeHandled = true
                        }
                        if (onNextEpisode != null) {
                            TvButton(
                                label = t("player.nextEpisode.next"),
                                icon = R.drawable.desktop_skip_forward,
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                onNextEpisode()
                            }
                        }
                    }
                }
            }
        }

        // 3. Phase 2: `SourceSelectPart` inside `PlayerPart` (matching Desktop `PlayerView.tsx` + `SourceSelectPart.tsx`)
        if (isSourceSelecting) {
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
                        modifier = Modifier
                            .fillMaxSize()
                            .alpha(0.55f),
                        contentScale = ContentScale.Crop
                    )
                }
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(Color.Black.copy(alpha = 0.45f))
                        .background(
                            Brush.verticalGradient(
                                listOf(
                                    Color.Black.copy(alpha = 0.35f),
                                    Color.Black.copy(alpha = 0.55f),
                                    Color.Black.copy(alpha = 0.80f)
                                )
                            )
                        )
                )

                SourceSelectModalCard(
                    streamAddons = state.streamAddons,
                    addonStreams = state.addonStreams,
                    addonLoading = state.addonLoading,
                    allSources = state.sources,
                    isLoadingAll = state.sourcesLoading,
                    activeStream = stream,
                    isModalOverlay = false,
                    onSelectStream = { chosen ->
                        state.chooseSource(chosen)
                    },
                    onManageAddons = {
                        state.openAddons()
                    },
                    modifier = Modifier.align(Alignment.Center)
                )
            }
        }

        // 4. Loading overlay with horizontal progressive logo clip.
        AnimatedVisibility(
            visible = isPlayingStream && !hasRenderedFrame,
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

                // Gradient `from-black/30 via-black/5 to-black/45` matching `PlayerLoadingOverlay.tsx` line 183
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(
                            Brush.verticalGradient(
                                listOf(
                                    Color.Black.copy(alpha = 0.35f),
                                    Color.Black.copy(alpha = 0.15f),
                                    Color.Black.copy(alpha = 0.55f)
                                )
                            )
                        )
                )

                if (error.isNotBlank()) {
                    Column(
                        modifier = Modifier
                            .align(Alignment.Center)
                            .widthIn(max = 520.dp)
                            .clip(RoundedCornerShape(16.dp))
                            .background(colors["video.context.background"].copy(alpha = 0.92f))
                            .border(BorderStroke(1.dp, colors["video.context.border"]), RoundedCornerShape(16.dp))
                            .padding(32.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(16.dp)
                    ) {
                        Text(
                            text = error,
                            color = colors["type.danger"],
                            fontSize = 16.sp,
                            fontWeight = FontWeight.SemiBold,
                            textAlign = TextAlign.Center
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            TvButton(
                                label = t("player.menus.settings.sourceItem"),
                                icon = R.drawable.desktop_chevron_left,
                                accent = true
                            ) {
                                player.stop()
                                state.playing = null
                            }
                            TvButton(
                                label = t("player.back.short")
                            ) {
                                onExit()
                            }
                        }
                    }
                } else {
                    // Progressive horizontal clip-fill `<LoadingTitle>` + funny message
                    Column(
                        modifier = Modifier
                            .align(Alignment.Center)
                            .padding(horizontal = 48.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(16.dp)
                    ) {
                        val grayscaleMatrix = remember { ColorMatrix().apply { setToSaturation(0f) } }
                        if (!logoUrl.isNullOrBlank() && !logoFailed) {
                            Box(
                                modifier = Modifier
                                    .width(320.dp)
                                    .height(150.dp),
                                contentAlignment = Alignment.Center
                            ) {
                                // Base grayscale 30% opacity layer
                                AsyncImage(
                                    model = logoUrl,
                                    contentDescription = item.title,
                                    modifier = Modifier
                                        .fillMaxSize()
                                        .alpha(0.30f),
                                    contentScale = ContentScale.Fit,
                                    colorFilter = ColorFilter.colorMatrix(grayscaleMatrix),
                                    onError = { logoFailed = true }
                                )
                                // Foreground full-color layer clipped horizontally from left to right by `animatedFillFraction`
                                AsyncImage(
                                    model = logoUrl,
                                    contentDescription = null,
                                    modifier = Modifier
                                        .fillMaxSize()
                                        .drawWithContent {
                                            clipRect(right = size.width * animatedFillFraction) {
                                                this@drawWithContent.drawContent()
                                            }
                                        },
                                    contentScale = ContentScale.Fit
                                )
                            }
                        } else {
                            Box(contentAlignment = Alignment.Center) {
                                Text(
                                    text = item.title.uppercase(),
                                    color = Color.White.copy(alpha = 0.25f),
                                    fontSize = 36.sp,
                                    fontWeight = FontWeight.Bold,
                                    letterSpacing = 6.sp,
                                    textAlign = TextAlign.Center
                                )
                                Text(
                                    text = item.title.uppercase(),
                                    color = Color.White,
                                    fontSize = 36.sp,
                                    fontWeight = FontWeight.Bold,
                                    letterSpacing = 6.sp,
                                    textAlign = TextAlign.Center,
                                    modifier = Modifier.drawWithContent {
                                        clipRect(right = size.width * animatedFillFraction) {
                                            this@drawWithContent.drawContent()
                                        }
                                    }
                                )
                            }
                        }

                        Text(
                            text = t("player.loadingOverlayMessages.$messageIndex"),
                            color = Color.White.copy(alpha = 0.65f),
                            fontSize = 16.sp,
                            fontWeight = FontWeight.Medium,
                            textAlign = TextAlign.Center
                        )
                    }
                }
            }
        }

        // 5. Center Buffering Spinner when video is playing but paused for cache
        if (isPlayingStream && hasRenderedFrame && isBuffering) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color.Black.copy(alpha = 0.30f)),
                contentAlignment = Alignment.Center
            ) {
                CircularProgressIndicator(
                    modifier = Modifier.size(48.dp),
                    color = colors["type.logo"],
                    strokeWidth = 3.dp
                )
            }
        }

        // 6. `Player.TopControls` (shown during ResumePart, SourceSelectPart, LoadingOverlay, and when controls are active during playback — matching `PlayerPart.tsx` line 183)
        val showTopBar = !isPlayingStream || !hasRenderedFrame || showControls || activeOverlay != null
        AnimatedVisibility(
            visible = showTopBar,
            enter = fadeIn() + slideInVertically { -it },
            exit = fadeOut() + slideOutVertically { -it },
            modifier = Modifier.align(Alignment.TopCenter)
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(
                        Brush.verticalGradient(
                            listOf(Color.Black.copy(alpha = 0.78f), Color.Transparent)
                        )
                    )
                    .padding(horizontal = 32.dp, vertical = 22.dp)
            ) {
                // Left: Circular Back button (`w-9 h-9 rounded-full bg-white/10 ring-1 ring-white/10`) + Movie Title (`Player.Title`)
                Row(
                    modifier = Modifier.align(Alignment.CenterStart),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(14.dp)
                ) {
                    PlayerIconButton(
                        icon = R.drawable.desktop_chevron_left,
                        modifier = Modifier.focusRequester(topBackRequester),
                        size = 38.dp,
                        iconSize = 18.dp,
                        pillBackground = true,
                        onClick = {
                            if (isPlayingStream && !hasRenderedFrame) {
                                player.stop()
                                state.playing = null
                            } else {
                                onExit()
                            }
                        }
                    )
                    Text(
                        text = item.title,
                        color = Color.White,
                        fontSize = 18.sp,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.widthIn(max = 360.dp)
                    )
                }

                // Center: `Player.EpisodeTitle` (`S1 E1` in white + episode title in secondary color)
                if (item.type == "show" && episode != null) {
                    Row(
                        modifier = Modifier.align(Alignment.Center),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        Text(
                            text = t(
                                "media.episodeDisplay",
                                "season" to episode.season,
                                "episode" to episode.number
                            ),
                            color = Color.White,
                            fontSize = 16.sp,
                            fontWeight = FontWeight.SemiBold
                        )
                        if (episode.title.isNotBlank()) {
                            Text(
                                text = episode.title,
                                color = colors["type.secondary"],
                                fontSize = 15.sp,
                                fontWeight = FontWeight.Medium,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.widthIn(max = 320.dp)
                            )
                        }
                    }
                }

                // Right: `InfoButton` (circle question), `BookmarkButton` (bookmark), `BrandPill` (`framezoo`)
                Row(
                    modifier = Modifier.align(Alignment.CenterEnd),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    PlayerIconButton(
                        icon = R.drawable.desktop_question,
                        size = 40.dp,
                        iconSize = 20.dp,
                        onClick = {
                            player.stop()
                            state.playing = null
                            state.openDetails(item)
                        }
                    )
                    PlayerIconButton(
                        icon = if (isBookmarked) R.drawable.desktop_bookmark_filled else R.drawable.desktop_bookmark,
                        size = 40.dp,
                        iconSize = 20.dp,
                        active = isBookmarked,
                        onClick = {
                            state.bookmark(item)
                        }
                    )
                    PlayerBrandPill()
                }
            }
        }

        // 7. Floating `NextEpisodeButton` near end of episode (matching `PlayerPart.tsx` lines 253-273)
        val showFloatingNextEpisode = isPlayingStream && hasRenderedFrame && onNextEpisode != null &&
            duration > 60.0 && (duration - position) <= 90.0 && activeOverlay == null
        AnimatedVisibility(
            visible = showFloatingNextEpisode,
            enter = fadeIn(),
            exit = fadeOut(),
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(end = 36.dp, bottom = if (showControls) 120.dp else 36.dp)
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                TvButton(
                    label = t("player.nextEpisode.replay"),
                    icon = R.drawable.desktop_repeat
                ) {
                    player.command("seek", "0", "absolute")
                }
                TvButton(
                    label = t("player.nextEpisode.next"),
                    icon = R.drawable.desktop_skip_episode,
                    primary = true
                ) {
                    onNextEpisode?.invoke()
                }
            }
        }

        // 8. `Player.BottomControls` (matching `PlayerPart.tsx` lines 276-332)
        AnimatedVisibility(
            visible = isPlayingStream && error.isBlank() && (!hasRenderedFrame || showControls || activeOverlay != null),
            enter = fadeIn() + slideInVertically { it },
            exit = fadeOut() + slideOutVertically { it },
            modifier = Modifier.align(Alignment.BottomCenter)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(
                        Brush.verticalGradient(
                            listOf(Color.Transparent, Color.Black.copy(alpha = 0.90f))
                        )
                    )
                    .padding(horizontal = 32.dp, vertical = 18.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                // Interactive D-Pad Seekable ProgressBar (matching `ProgressBar.tsx`)
                val progressFraction = if (duration > 0) (position / duration).toFloat().coerceIn(0f, 1f) else 0f
                val bufferFraction = if (duration > 0) ((position + bufferedSeconds) / duration).toFloat().coerceIn(0f, 1f) else 0f
                var barFocused by remember { mutableStateOf(false) }

                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 6.dp)
                        .focusRequester(progressBarRequester)
                        .onFocusChanged { barFocused = it.isFocused }
                        .onPreviewKeyEvent { event ->
                            if (event.nativeKeyEvent.action == KeyEvent.ACTION_DOWN && barFocused) {
                                when (event.nativeKeyEvent.keyCode) {
                                    KeyEvent.KEYCODE_DPAD_LEFT -> {
                                        player.command("seek", "-15", "relative")
                                        triggerControls()
                                        true
                                    }
                                    KeyEvent.KEYCODE_DPAD_RIGHT -> {
                                        player.command("seek", "15", "relative")
                                        triggerControls()
                                        true
                                    }
                                    else -> false
                                }
                            } else false
                        }
                ) {
                    MaterialTvButton(
                        onClick = {
                            player.command("cycle", "pause")
                            isPaused = !isPaused
                            triggerControls()
                        },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(if (barFocused) 18.dp else 14.dp),
                        shape = TvButtonDefaults.shape(RoundedCornerShape(50)),
                        colors = TvButtonDefaults.colors(
                            containerColor = Color.Transparent,
                            focusedContainerColor = Color.Transparent
                        ),
                        scale = TvButtonDefaults.scale(focusedScale = 1f),
                        border = TvButtonDefaults.border(focusedBorder = TvBorder.None),
                        contentPadding = PaddingValues(0.dp)
                    ) {
                        Box(
                            modifier = Modifier.fillMaxSize(),
                            contentAlignment = Alignment.CenterStart
                        ) {
                            // Track background (`bg-progress-background bg-opacity-25`)
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(if (barFocused) 8.dp else 5.dp)
                                    .clip(RoundedCornerShape(50))
                                    .background(colors["progress.background"].copy(alpha = 0.28f))
                            ) {
                                // Preloaded buffer bar
                                Box(
                                    modifier = Modifier
                                        .fillMaxWidth(bufferFraction)
                                        .fillMaxHeight()
                                        .background(colors["progress.preloaded"].copy(alpha = 0.55f))
                                )
                                // Filled progress bar (`bg-progress-filled`)
                                Box(
                                    modifier = Modifier
                                        .fillMaxWidth(progressFraction)
                                        .fillMaxHeight()
                                        .background(colors["progress.filled"])
                                )
                            }
                        }
                    }
                }

                // Bottom Controls Row (`justify-between`: LeftSideControls & RightSideControls)
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    // LeftSideControls: Pause/Play, SkipBackward, SkipForward, Volume, Time
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        PlayerIconButton(
                            icon = if (isPaused) R.drawable.desktop_play else R.drawable.desktop_pause,
                            size = 52.dp,
                            iconSize = 28.dp,
                            modifier = Modifier.focusRequester(playPauseRequester),
                            onClick = {
                                triggerControls()
                                player.command("cycle", "pause")
                                isPaused = !isPaused
                            }
                        )
                        PlayerIconButton(
                            icon = R.drawable.desktop_skip_backward,
                            size = 44.dp,
                            iconSize = 22.dp,
                            onClick = {
                                triggerControls()
                                player.command("seek", "-10", "relative")
                            }
                        )
                        PlayerIconButton(
                            icon = R.drawable.desktop_skip_forward,
                            size = 44.dp,
                            iconSize = 22.dp,
                            onClick = {
                                triggerControls()
                                player.command("seek", "10", "relative")
                            }
                        )
                        PlayerIconButton(
                            icon = if (isMuted) R.drawable.desktop_volume_x else R.drawable.desktop_volume,
                            size = 44.dp,
                            iconSize = 22.dp,
                            onClick = {
                                triggerControls()
                                isMuted = !isMuted
                                player.command("set", "mute", if (isMuted) "yes" else "no")
                            }
                        )

                        // `Player.Time` button (`player.time.regular` / `player.time.remaining` with finish time)
                        val watchedStr = formatDurationTime(position)
                        val totalStr = formatDurationTime(duration)
                        val remainingSecs = (duration - position).coerceAtLeast(0.0)
                        val remainingStr = formatDurationTime(remainingSecs)
                        val finishClock = formatEndTime(remainingSecs / selectedSpeed)
                        val timeLabel = if (showRemainingTime) {
                            t(
                                "player.time.remaining",
                                "timeLeft" to remainingStr,
                                "timeWatched" to watchedStr,
                                "timeFinished, datetime" to finishClock.ifBlank { "--:--" }
                            )
                        } else {
                            t(
                                "player.time.regular",
                                "timeWatched" to watchedStr,
                                "duration" to totalStr
                            )
                        }

                        var timeFocused by remember { mutableStateOf(false) }
                        MaterialTvButton(
                            onClick = {
                                triggerControls()
                                showRemainingTime = !showRemainingTime
                            },
                            modifier = Modifier.onFocusChanged { timeFocused = it.isFocused },
                            shape = TvButtonDefaults.shape(RoundedCornerShape(8.dp)),
                            colors = TvButtonDefaults.colors(
                                containerColor = if (timeFocused) colors["video.buttonBackground"].copy(alpha = 0.5f) else Color.Transparent,
                                contentColor = Color.White,
                                focusedContainerColor = colors["video.buttonBackground"].copy(alpha = 0.65f),
                                focusedContentColor = Color.White
                            ),
                            scale = TvButtonDefaults.scale(focusedScale = 1.03f),
                            border = TvButtonDefaults.border(
                                focusedBorder = TvBorder(BorderStroke(1.5.dp, colors["type.logo"]), shape = RoundedCornerShape(8.dp))
                            ),
                            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp)
                        ) {
                            Text(
                                text = timeLabel,
                                color = Color.White,
                                fontSize = 14.sp,
                                fontWeight = FontWeight.Medium
                            )
                        }
                    }

                    // RightSideControls: Episodes (if show), SkipEpisodeButton (if show), TorrentNetworkStatus (if torrent), Captions, Settings
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        if (item.type == "show") {
                            var epFocused by remember { mutableStateOf(false) }
                            val isEpOpen = activeOverlay == "episodes"
                            MaterialTvButton(
                                onClick = {
                                    triggerControls()
                                    activeOverlay = if (isEpOpen) null else "episodes"
                                },
                                modifier = Modifier.onFocusChanged { epFocused = it.isFocused },
                                shape = TvButtonDefaults.shape(RoundedCornerShape(8.dp)),
                                colors = TvButtonDefaults.colors(
                                    containerColor = if (isEpOpen || epFocused) colors["video.buttonBackground"].copy(alpha = 0.7f) else Color.Transparent,
                                    contentColor = Color.White,
                                    focusedContainerColor = colors["video.buttonBackground"].copy(alpha = 0.85f),
                                    focusedContentColor = Color.White
                                ),
                                scale = TvButtonDefaults.scale(focusedScale = 1.05f),
                                border = TvButtonDefaults.border(
                                    focusedBorder = TvBorder(BorderStroke(2.dp, colors["type.logo"]), shape = RoundedCornerShape(8.dp))
                                ),
                                contentPadding = PaddingValues(horizontal = 14.dp, vertical = 10.dp)
                            ) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                                ) {
                                    Icon(
                                        painter = painterResource(R.drawable.desktop_episodes),
                                        contentDescription = null,
                                        tint = Color.White,
                                        modifier = Modifier.size(20.dp)
                                    )
                                    Text(
                                        text = t("player.menus.episodes.button"),
                                        color = Color.White,
                                        fontSize = 15.sp,
                                        fontWeight = FontWeight.SemiBold
                                    )
                                }
                            }

                            if (onNextEpisode != null) {
                                PlayerIconButton(
                                    icon = R.drawable.desktop_skip_episode,
                                    size = 44.dp,
                                    iconSize = 22.dp,
                                    onClick = {
                                        triggerControls()
                                        onNextEpisode()
                                    }
                                )
                            }
                        }

                        if (isTorrent) {
                            PlayerIconButton(
                                icon = R.drawable.desktop_web,
                                size = 44.dp,
                                iconSize = 22.dp,
                                active = activeOverlay == "torrent",
                                onClick = {
                                    triggerControls()
                                    activeOverlay = if (activeOverlay == "torrent") null else "torrent"
                                }
                            )
                        }

                        PlayerIconButton(
                            icon = R.drawable.desktop_captions,
                            size = 44.dp,
                            iconSize = 22.dp,
                            active = activeOverlay?.startsWith("captions") == true,
                            onClick = {
                                triggerControls()
                                captionsReturn = null
                                captionMode = null
                                activeOverlay = if (activeOverlay?.startsWith("captions") == true) null else "captions"
                            }
                        )

                        PlayerIconButton(
                            icon = R.drawable.desktop_settings,
                            size = 44.dp,
                            iconSize = 22.dp,
                            active = activeOverlay in listOf("settings", "playback", "audio", "quality", "source"),
                            onClick = {
                                triggerControls()
                                activeOverlay = if (activeOverlay == "settings") null else "settings"
                            }
                        )
                    }
                }
            }
        }

        // 9. Popout Overlays (matching Desktop `OverlayRouter.tsx`, `SettingsMenu.tsx`, `CaptionsView.tsx`, `TorrentNetworkStatus.tsx`, `Episodes.tsx`)
        if (activeOverlay == "source") {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color.Black.copy(alpha = 0.65f)),
                contentAlignment = Alignment.Center
            ) {
                SourceSelectModalCard(
                    streamAddons = state.streamAddons,
                    addonStreams = state.addonStreams,
                    addonLoading = state.addonLoading,
                    allSources = state.sources,
                    isLoadingAll = state.sourcesLoading,
                    activeStream = stream,
                    isModalOverlay = true,
                    onSelectStream = { chosen ->
                        activeOverlay = null
                        if (chosen != stream) {
                            switchPosition = player.position()
                        }
                        state.chooseSource(chosen)
                    },
                    onManageAddons = {
                        activeOverlay = null
                        state.openAddons()
                    },
                    onCloseModal = {
                        activeOverlay = sourceReturn
                    }
                )
            }
        } else if (activeOverlay == "torrent" && stream != null) {
            // `TorrentNetworkStatus.tsx` popover anchored above bottom-right controls
            val cardBg = colors["video.context.background"]
            val cardBorder = colors["video.context.border"]
            val mainText = colors["video.context.type.main"]
            val secondaryText = colors["video.context.type.secondary"]
            val infoHashText = stream.infoHash ?: stream.url.substringAfter("btih:", "").substringBefore("&").ifBlank { stream.url }
            val completedPct = ((torrentStats?.progress ?: 0.0) * 100.0).toInt().coerceIn(0, 100)

            Box(
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .padding(end = 36.dp, bottom = 104.dp)
                    .width(420.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(cardBg.copy(alpha = 0.96f))
                    .border(BorderStroke(1.dp, cardBorder), RoundedCornerShape(12.dp))
                    .padding(20.dp)
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = t("player.torrent.statistics"),
                            color = mainText,
                            fontSize = 18.sp,
                            fontWeight = FontWeight.Bold
                        )
                        PlayerContextIconButton(
                            icon = R.drawable.desktop_close,
                            onClick = { activeOverlay = null }
                        )
                    }
                    Box(modifier = Modifier.fillMaxWidth().height(1.dp).background(cardBorder))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(text = "Peers", color = secondaryText, fontSize = 13.sp)
                            Text(
                                text = "${torrentStats?.peers ?: 0}",
                                color = Color.White,
                                fontSize = 14.sp,
                                fontWeight = FontWeight.SemiBold
                            )
                        }
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(text = t("player.torrent.speedLabel"), color = secondaryText, fontSize = 13.sp)
                            Text(
                                text = formatSpeed(torrentStats?.downloadRate ?: 0L),
                                color = Color.White,
                                fontSize = 14.sp,
                                fontWeight = FontWeight.SemiBold
                            )
                        }
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(text = t("player.torrent.completedLabel"), color = secondaryText, fontSize = 13.sp)
                            Text(
                                text = "$completedPct %",
                                color = Color.White,
                                fontSize = 14.sp,
                                fontWeight = FontWeight.SemiBold
                            )
                        }
                    }
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(text = t("player.torrent.infohashLabel"), color = secondaryText, fontSize = 13.sp)
                        Text(
                            text = infoHashText,
                            color = Color.White.copy(alpha = 0.85f),
                            fontSize = 12.sp,
                            lineHeight = 16.sp
                        )
                    }
                }
            }
        } else if (activeOverlay != null) {
            // Right-aligned popout Menu Card matching Desktop `Menu.Card` (`SettingsMenu`, `CaptionsView`, `PlaybackSettingsView`, `AudioView`, `QualityView`, `EpisodesView`)
            PlayerMenuOverlayCard(
                activeOverlay = activeOverlay!!,
                onNavigateOverlay = {
                    if (it == "captions" && activeOverlay == "settings") { captionsReturn = "settings"; captionMode = null }
                    if (it == "source") sourceReturn = if (activeOverlay == "quality") "quality" else "settings"
                    activeOverlay = it
                },
                captionsReturn = captionsReturn,
                state = state,
                player = player,
                item = item,
                episode = episode,
                stream = stream,
                subtitles = subtitles,
                audioTracks = audioTracks,
                videoTracks = videoTracks,
                subtitleTracks = subtitleTracks,
                position = position,
                primarySubtitleId = primarySubtitleId,
                secondarySubtitleId = secondarySubtitleId,
                captionMode = captionMode,
                onCaptionMode = { captionMode = it; subtitleError = "" },
                subtitleError = subtitleError,
                subtitlesEnabled = subtitlesEnabled,
                secondarySubtitlesEnabled = secondarySubtitlesEnabled,
                onToggleSubtitles = {
                    subtitleChosen = true
                    player.markSubtitleChanged()
                    val enabled = !(subtitlesEnabled || (secondarySubtitlesEnabled && secondarySubtitleId != null && secondarySubtitleId != "no"))
                    subtitlesEnabled = enabled
                    secondarySubtitlesEnabled = enabled
                    player.command("set", "sub-visibility", if (enabled) "yes" else "no")
                    player.command("set", "secondary-sub-visibility", if (enabled) "yes" else "no")
                },
                selectedSubtitleLang = selectedSubtitleLang,
                onSelectSubtitleLang = { selectedSubtitleLang = it; subtitleError = "" },
                onSelectSubtitle = selectSubtitle@ { sub ->
                    if (captionMode != "secondary" && sub?.nativeId != null && sub.nativeId == secondarySubtitleId) {
                        subtitleError = subtitleSecondaryHint
                        return@selectSubtitle
                    }
                    subtitleChosen = true
                    player.markSubtitleChanged()
                    subtitleError = ""
                    val secondary = captionMode == "secondary"
                    if (sub == null) {
                        if (secondary) player.command("set", "secondary-sid", "no")
                        else {
                            subtitlesEnabled = false
                            player.command("set", "sub-visibility", "no")
                        }
                    } else {
                        val token = player.subtitleToken()
                        if (token != null) subtitleScope.launch {
                            val result = withContext(Dispatchers.IO) {
                                player.selectSubtitle(token, sub.nativeId, sub.url, sub.label.ifBlank { sub.language }, sub.language,
                                    secondary, stream?.headers.orEmpty(), stream?.url.orEmpty())
                            }
                            if (token == player.subtitleToken()) {
                                if (result < 0) subtitleError = if (result == -2) subtitleSecondaryHint else subtitleFailureText
                                else if (secondary) {
                                    secondarySubtitlesEnabled = true
                                    player.command("set", "secondary-sub-visibility", "yes")
                                } else {
                                    subtitlesEnabled = true
                                    player.command("set", "sub-visibility", "yes")
                                }
                            }
                        }
                    }
                },
                selectedSpeed = selectedSpeed,
                onSelectSpeed = { spd ->
                    if (state.activeWatchParty == null) {
                        selectedSpeed = playbackSpeed(spd)
                        player.command("set", "speed", selectedSpeed.toString())
                    }
                },
                onSelectEpisode = { ep ->
                    activeOverlay = null
                    onSelectEpisode?.invoke(ep)
                },
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .padding(end = 32.dp, bottom = 100.dp)
            )
        }
    }
}

@Composable
private fun PlayerMenuOverlayCard(
    activeOverlay: String,
    onNavigateOverlay: (String?) -> Unit,
    captionsReturn: String?,
    state: FrameZooState,
    player: PlayerController,
    item: Media,
    episode: Episode?,
    stream: Stream?,
    subtitles: List<Subtitle>,
    audioTracks: List<AudioTrack>,
    videoTracks: List<VideoTrack>,
    subtitleTracks: List<SubtitleTrack>,
    position: Double,
    primarySubtitleId: String?,
    secondarySubtitleId: String?,
    captionMode: String?,
    onCaptionMode: (String?) -> Unit,
    subtitleError: String,
    subtitlesEnabled: Boolean,
    secondarySubtitlesEnabled: Boolean,
    onToggleSubtitles: () -> Unit,
    selectedSubtitleLang: String?,
    onSelectSubtitleLang: (String) -> Unit,
    onSelectSubtitle: (CaptionChoice?) -> Unit,
    selectedSpeed: Double,
    onSelectSpeed: (Double) -> Unit,
    onSelectEpisode: (Episode) -> Unit,
    modifier: Modifier = Modifier
) {
    val colors = LocalFrameZooColors.current
    val context = LocalContext.current
    val cardBg = colors["video.context.background"]
    val cardBorder = colors["video.context.border"]
    val mainText = colors["video.context.type.main"]
    val secondaryText = colors["video.context.type.secondary"]
    val accentColor = colors["video.context.type.accent"]
    val firstRequester = remember(activeOverlay) { FocusRequester() }
    var expandedEpisode by remember { mutableStateOf<Episode?>(null) }

    LaunchedEffect(activeOverlay, episode?.season) {
        if (activeOverlay == "episodes" && episode != null && state.selectedSeason != episode.season) {
            state.chooseSeason(item, episode.season)
        }
    }

    LaunchedEffect(activeOverlay) {
        runCatching { firstRequester.requestFocus() }
    }

    val selectedCaptionId = if (captionMode == "secondary") secondarySubtitleId else primarySubtitleId
    val allSubs = remember(stream, subtitles, subtitleTracks, selectedCaptionId) {
        val external = ((stream?.subtitles ?: emptyList()) + subtitles).distinctBy { it.url }.map { sub ->
            val track = subtitleTracks.firstOrNull { it.externalFilename == sub.url }
            CaptionChoice(sub.language, sub.label, sub.url, track?.id, track?.id != null && track.id == selectedCaptionId)
        }
        val embedded = subtitleTracks.filter { it.externalFilename.isNullOrBlank() }.map { track ->
            CaptionChoice(track.language, track.title, null, track.id, track.id == selectedCaptionId)
        }
        embedded + external
    }
    val subGroups = remember(allSubs) {
        allSubs.groupBy { subtitleLanguage(it.language) }
    }
    val selectionVisible = if (captionMode == "secondary") secondarySubtitlesEnabled else subtitlesEnabled
    val activeCaptionUrl = allSubs.firstOrNull { it.selected }?.url
    val transcript by produceState<List<TranscriptCue>?>(initialValue = null, activeOverlay, activeCaptionUrl) {
        value = if (activeOverlay in listOf("captions", "captions_transcript") && activeCaptionUrl != null)
            withContext(Dispatchers.IO) { player.transcript(activeCaptionUrl) } else emptyList()
    }

    Box(
        modifier = modifier
            .then(if (activeOverlay == "episodes") Modifier.fillMaxWidth(0.9f) else Modifier.width(380.dp))
            .heightIn(min = 260.dp, max = 480.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(cardBg.copy(alpha = 0.96f))
            .border(BorderStroke(1.dp, cardBorder), RoundedCornerShape(14.dp))
            .padding(20.dp)
    ) {
        when (activeOverlay) {
            "settings" -> {
                // Settings menu.
                val autoQualityLabel = t("player.menus.quality.auto")
                val currentQuality = videoTracks.firstOrNull { it.selected }?.let(::videoTrackQuality)
                    ?: stream?.let(::detectStreamQualityCategory)
                val currentQualityLabel = when (currentQuality) {
                    "4k" -> "4K"
                    in videoQualities -> currentQuality!!
                    else -> autoQualityLabel
                }
                val sourceTitle = stream?.addonName?.ifBlank { stream.name.lines().firstOrNull().orEmpty() } ?: "Addon streams"
                val actualSubtitleLanguage = allSubs.firstOrNull { it.selected }?.language
                val prettyCaptionLang = remember(actualSubtitleLanguage) {
                    val code = actualSubtitleLanguage
                    if (code.isNullOrBlank()) null
                    else Locale.forLanguageTag(subtitleLanguage(code)).getDisplayLanguage(Locale.getDefault()).replaceFirstChar { it.uppercase() }.ifBlank { code.uppercase() }
                }
                val captionSub = if (!subtitlesEnabled || allSubs.none { it.selected }) t("player.menus.subtitles.offChoice") else (prettyCaptionLang ?: t("player.menus.subtitles.unknownLanguage"))

                LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    item {
                        // Row 1 of 2x2 Grid: Quality + Source
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            SettingsGridButton(
                                title = t("player.menus.settings.qualityItem"),
                                subtitle = currentQualityLabel,
                                modifier = Modifier
                                    .weight(1f)
                                    .focusRequester(firstRequester),
                                onClick = { onNavigateOverlay("quality") }
                            )
                            SettingsGridButton(
                                title = t("player.menus.settings.sourceItem"),
                                subtitle = sourceTitle,
                                modifier = Modifier.weight(1f),
                                onClick = { onNavigateOverlay("source") }
                            )
                        }
                    }
                    item {
                        // Row 2 of 2x2 Grid: Captions + Audio
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            SettingsGridButton(
                                title = t("player.menus.settings.subtitleItem"),
                                subtitle = captionSub,
                                modifier = Modifier.weight(1f),
                                onClick = { onNavigateOverlay("captions") }
                            )
                            SettingsGridButton(
                                title = t("player.menus.settings.audioItem"),
                                subtitle = audioTracks.firstOrNull { it.selected }?.let(::audioTrackLabel)
                                    ?.ifBlank { null } ?: t("player.menus.audio.default"),
                                modifier = Modifier.weight(1f),
                                onClick = { onNavigateOverlay("audio") }
                            )
                        }
                    }
                    item {
                        Spacer(Modifier.height(4.dp))
                        PlayerMenuRowLink(
                            title = t("player.menus.watchparty.watchpartyItem"),
                            rightIcon = R.drawable.desktop_watch_party,
                            onClick = { onNavigateOverlay("watchparty") }
                        )
                    }
                    item {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 4.dp)
                                .height(1.dp)
                                .background(cardBorder)
                        )
                    }
                    item {
                        PlayerMenuRowLink(
                            title = t("player.menus.settings.enableSubtitles"),
                            showToggle = true,
                            toggleEnabled = subtitlesEnabled || (secondarySubtitlesEnabled && secondarySubtitleId != null && secondarySubtitleId != "no"),
                            onClick = onToggleSubtitles
                        )
                    }
                    item {
                        PlayerMenuRowLink(
                            title = t("player.menus.settings.playbackItem"),
                            rightText = "${selectedSpeed}x",
                            chevron = true,
                            onClick = { onNavigateOverlay("playback") }
                        )
                    }
                }
            }

            "captions" -> {
                // `CaptionsView.tsx`: Header + Customize button, Off, Auto-select, Language groups
                Column(modifier = Modifier.fillMaxSize()) {
                    PlayerMenuHeader(
                        title = when (captionMode) {
                            "primary" -> t("player.menus.subtitles.primary")
                            "secondary" -> t("player.menus.subtitles.secondary")
                            else -> t("player.menus.subtitles.title")
                        },
                        onBack = {
                            if (captionMode != null) { onCaptionMode(null); onNavigateOverlay("captions_dual") }
                            else onNavigateOverlay(captionsReturn)
                        },
                        rightActionLabel = t("player.menus.subtitles.customizeLabel"),
                        onRightAction = { onNavigateOverlay("captions_settings") }
                    )
                    if (subtitleError.isNotBlank()) Text(subtitleError, modifier = Modifier.padding(top = 8.dp), color = colors["type.danger"], fontSize = 13.sp)
                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(top = 8.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        item {
                            PlayerMenuRowLink(
                                title = t("player.menus.subtitles.offChoice"),
                                selected = !selectionVisible || allSubs.none { it.selected },
                                modifier = Modifier.focusRequester(firstRequester),
                                onClick = { onSelectSubtitle(null) }
                            )
                        }
                        item {
                            val candidates = allSubs.filter { it.nativeId == null || it.nativeId != (if (captionMode == "secondary") primarySubtitleId else secondarySubtitleId) }
                            val bestSub = candidates.firstOrNull { it.language.startsWith("vi", true) }
                                ?: candidates.firstOrNull { it.language.startsWith("en", true) }
                                ?: candidates.firstOrNull()
                            if (bestSub != null) {
                                PlayerMenuRowLink(
                                    title = t("player.menus.subtitles.autoSelectChoice"),
                                    rightText = bestSub.language.uppercase(),
                                    selected = selectionVisible && bestSub.selected,
                                    onClick = { onSelectSubtitle(bestSub) }
                                )
                            }
                        }
                        if (captionMode == null) item {
                            PlayerMenuRowLink(
                                title = t("player.menus.subtitles.dualSub"),
                                chevron = true,
                                onClick = { onNavigateOverlay("captions_dual") }
                            )
                        }
                        if (allSubs.any { it.selected }) item {
                            PlayerMenuRowLink(
                                title = t("player.menus.subtitles.transcriptChoice"),
                                chevron = true,
                                enabled = activeCaptionUrl != null && !transcript.isNullOrEmpty(),
                                onClick = { onNavigateOverlay("captions_transcript") }
                            )
                        }
                        val entries = subGroups.entries.toList()
                        items(entries.size) { idx ->
                            val (lang, list) = entries[idx]
                            val langName = Locale.forLanguageTag(lang).getDisplayLanguage(Locale.getDefault()).replaceFirstChar { it.uppercase() }.ifBlank { lang.uppercase() }
                            PlayerMenuRowLink(
                                title = "$langName (${list.size})",
                                selected = selectionVisible && list.any { it.selected },
                                chevron = true,
                                onClick = {
                                    onSelectSubtitleLang(lang)
                                    onNavigateOverlay("captions_lang")
                                }
                            )
                        }
                    }
                }
            }

            "captions_transcript" -> {
                val focusManager = LocalFocusManager.current
                val keyboardVisible = WindowInsets.ime.getBottom(LocalDensity.current) > 0
                val delayProperty = if (captionMode == "secondary") "secondary-sub-delay" else "sub-delay"
                var offset by remember(delayProperty, activeCaptionUrl) { mutableDoubleStateOf(player.propertyDouble(delayProperty)) }
                var offsetText by remember(delayProperty, activeCaptionUrl) { mutableStateOf("%.2f".format(Locale.US, offset)) }
                var editingOffset by remember { mutableStateOf(false) }
                var query by remember { mutableStateOf("") }
                var browsing by remember { mutableStateOf(false) }
                val listState = rememberLazyListState()
                val cues = transcript.orEmpty().filter { query.isBlank() || it.text.contains(query.trim(), ignoreCase = true) }
                val targetIndex = cues.indexOfFirst { it.start + offset > position }.takeIf { it >= 0 }
                    ?: cues.indexOfFirst { position >= it.start + offset && position < it.end + offset }.takeIf { it >= 0 }
                LaunchedEffect(targetIndex, browsing) {
                    if (!browsing && targetIndex != null) listState.scrollToItem(targetIndex)
                }
                fun updateOffset(value: Double) {
                    if (!value.isFinite()) return
                    val rounded = kotlin.math.round(value * 100.0) / 100.0
                    if (player.command("set", delayProperty, rounded.toString()) >= 0) {
                        offset = rounded
                        if (!editingOffset) offsetText = "%.2f".format(Locale.US, rounded)
                    }
                }
                Column(modifier = Modifier.fillMaxSize()) {
                    PlayerMenuHeader(title = t("player.menus.subtitles.transcriptChoice"),
                        onBack = { onNavigateOverlay("captions") }, backModifier = Modifier.focusRequester(firstRequester))
                    if (secondarySubtitleId != null && secondarySubtitleId != "no") {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 6.dp)) {
                            listOf("primary", "secondary").forEach { mode ->
                                TvButton(label = t("player.menus.subtitles.$mode"), selected = (captionMode ?: "primary") == mode, navigation = true,
                                    onClick = { onCaptionMode(mode); browsing = false })
                            }
                        }
                    }
                    BasicTextField(value = query, onValueChange = { query = it; browsing = false }, singleLine = true,
                        textStyle = TextStyle(color = Color.White, fontSize = 14.sp),
                        modifier = Modifier.fillMaxWidth().padding(top = 8.dp).background(cardBorder, RoundedCornerShape(6.dp))
                            .onPreviewKeyEvent { event ->
                                if (!keyboardVisible && event.nativeKeyEvent.action == KeyEvent.ACTION_DOWN && event.nativeKeyEvent.keyCode == KeyEvent.KEYCODE_DPAD_DOWN)
                                    focusManager.moveFocus(FocusDirection.Down) else false
                            }.padding(10.dp),
                        decorationBox = { inner -> Box { if (query.isEmpty()) Text(t("player.menus.subtitles.searchPlaceholder"), color = secondaryText, fontSize = 14.sp); inner() } })
                    Row(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                        Text(t("player.menus.subtitles.delayLabel"), color = mainText, fontSize = 13.sp, modifier = Modifier.weight(1f))
                        TvButton(label = "−", navigation = true, onClick = { updateOffset(offset - 0.1) })
                        BasicTextField(value = offsetText, onValueChange = { value ->
                            offsetText = value
                            value.replace(',', '.').toDoubleOrNull()?.let(::updateOffset)
                        }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Text),
                            textStyle = TextStyle(color = Color.White, fontSize = 13.sp, textAlign = TextAlign.Center),
                            modifier = Modifier.width(54.dp).background(cardBorder, RoundedCornerShape(6.dp))
                                .onPreviewKeyEvent { event ->
                                    if (!keyboardVisible && event.nativeKeyEvent.action == KeyEvent.ACTION_DOWN && event.nativeKeyEvent.keyCode == KeyEvent.KEYCODE_DPAD_DOWN)
                                        focusManager.moveFocus(FocusDirection.Down) else false
                                }
                                .onFocusChanged { editingOffset = it.isFocused; if (!it.isFocused) offsetText = "%.2f".format(Locale.US, offset) }
                                .padding(vertical = 8.dp))
                        TvButton(label = "+", navigation = true, onClick = { updateOffset(offset + 0.1) })
                        TvButton(label = t("player.menus.subtitles.resetDelay"), navigation = true, onClick = { updateOffset(0.0) })
                    }
                    LazyColumn(state = listState, modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        items(cues.size) { index ->
                            val cue = cues[index]
                            val active = position >= cue.start + offset && position < cue.end + offset
                            TvCard(onClick = { updateOffset(position - cue.start) },
                                modifier = Modifier.fillMaxWidth().onFocusChanged { if (it.isFocused) browsing = true },
                                colors = TvCardDefaults.colors(containerColor = if (active) cardBorder else Color.Transparent,
                                    focusedContainerColor = colors["video.context.hoverColor"]),
                                scale = TvCardDefaults.scale(focusedScale = 1f)) {
                                Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 7.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    Text(if (cue.start + offset < 0) "N/A" else formatDurationTime(cue.start + offset), color = secondaryText, fontSize = 12.sp)
                                    Text(cue.text, color = mainText, fontSize = 13.sp)
                                }
                            }
                        }
                    }
                }
            }

            "captions_dual" -> {
                Column(modifier = Modifier.fillMaxSize()) {
                    PlayerMenuHeader(title = t("player.menus.subtitles.dualSub"), onBack = { onCaptionMode(null); onNavigateOverlay("captions") })
                    LazyColumn(modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(top = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        item { Text(t("player.menus.subtitles.dualSubSelectHint"), color = secondaryText, fontSize = 13.sp) }
                        items(listOf("primary" to primarySubtitleId, "secondary" to secondarySubtitleId)) { (mode, id) ->
                            val selected = allSubs.firstOrNull { it.nativeId == id && (if (mode == "primary") subtitlesEnabled else secondarySubtitlesEnabled) }
                            val detail = selected?.language?.let { Locale.forLanguageTag(subtitleLanguage(it)).getDisplayLanguage(Locale.getDefault()) }
                                ?.replaceFirstChar { it.uppercase() }?.ifBlank { null } ?: t("player.menus.subtitles.offChoice")
                            PlayerMenuRowLink(
                                title = if (mode == "primary") t("player.menus.subtitles.primary") else t("player.menus.subtitles.secondary"),
                                rightText = detail,
                                chevron = true,
                                modifier = if (mode == "primary") Modifier.focusRequester(firstRequester) else Modifier,
                                onClick = { onCaptionMode(mode); onNavigateOverlay("captions") }
                            )
                        }
                    }
                }
            }

            "captions_lang" -> {
                val lang = selectedSubtitleLang ?: "en"
                val list = subGroups[lang].orEmpty()
                val langName = Locale.forLanguageTag(lang).getDisplayLanguage(Locale.getDefault()).replaceFirstChar { it.uppercase() }.ifBlank { lang.uppercase() }
                Column(modifier = Modifier.fillMaxSize()) {
                    PlayerMenuHeader(
                        title = langName,
                        onBack = { onNavigateOverlay("captions") }
                    )
                    if (subtitleError.isNotBlank()) Text(subtitleError, modifier = Modifier.padding(top = 8.dp), color = colors["type.danger"], fontSize = 13.sp)
                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(top = 8.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        items(list.size) { idx ->
                            val sub = list[idx]
                            PlayerMenuRowLink(
                                title = sub.label.ifBlank { if (sub.url == null) t("player.menus.subtitles.embedded") else "${lang.uppercase()} #${idx + 1}" },
                                selected = selectionVisible && sub.selected,
                                modifier = if (idx == 0) Modifier.focusRequester(firstRequester) else Modifier,
                                onClick = { onSelectSubtitle(sub) }
                            )
                        }
                    }
                }
            }

            "captions_settings" -> {
                // `CaptionSettingsView.tsx`: Subtitle delay, size, background opacity
                var delayMs by remember { mutableIntStateOf((player.propertyDouble("sub-delay") * 1000).toInt()) }
                Column(modifier = Modifier.fillMaxSize()) {
                    PlayerMenuHeader(
                        title = t("player.menus.subtitles.settings.backlink"),
                        onBack = { onNavigateOverlay("captions") }
                    )
                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(top = 10.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        item {
                            Text(
                                text = "${t("player.menus.subtitles.settings.delay")}: ${delayMs}ms",
                                color = secondaryText,
                                fontSize = 13.sp
                            )
                            Row(
                                modifier = Modifier.padding(top = 6.dp),
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                TvButton(
                                    label = "-250ms",
                                    navigation = true,
                                    modifier = Modifier.focusRequester(firstRequester)
                                ) {
                                    delayMs -= 250
                                    player.command("set", "sub-delay", (delayMs / 1000.0).toString())
                                }
                                TvButton(label = "0ms", navigation = true) {
                                    delayMs = 0
                                    player.command("set", "sub-delay", "0")
                                }
                                TvButton(label = "+250ms", navigation = true) {
                                    delayMs += 250
                                    player.command("set", "sub-delay", (delayMs / 1000.0).toString())
                                }
                            }
                        }
                        item {
                            Text(
                                text = "${t("settings.subtitles.backgroundLabel")}: ${state.subtitleBackgroundOpacity}%",
                                color = secondaryText,
                                fontSize = 13.sp
                            )
                            Row(modifier = Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                TvButton(label = "−", navigation = true) { state.updateSubtitleBackgroundOpacity(state.subtitleBackgroundOpacity - 10) }
                                TvButton(label = "+", navigation = true) { state.updateSubtitleBackgroundOpacity(state.subtitleBackgroundOpacity + 10) }
                            }
                        }
                        item {
                            Text(
                                text = "${t("settings.subtitles.textSizeLabel")}: ${state.subtitleFontSize}%",
                                color = secondaryText,
                                fontSize = 13.sp
                            )
                            Row(modifier = Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                TvButton(label = "−", navigation = true) { state.updateSubtitleFontSize(state.subtitleFontSize - 5) }
                                TvButton(label = "100%", selected = state.subtitleFontSize == 100, navigation = true) { state.updateSubtitleFontSize(100) }
                                TvButton(label = "+", navigation = true) { state.updateSubtitleFontSize(state.subtitleFontSize + 5) }
                            }
                        }
                        item {
                            PlayerMenuRowLink(
                                title = t("settings.subtitles.textBoldLabel"),
                                showToggle = true,
                                toggleEnabled = state.subtitleBold,
                                onClick = { state.toggleSubtitleBold() }
                            )
                        }
                        item {
                            val label = t("settings.subtitles.colorLabel")
                            Text(label, color = secondaryText, fontSize = 13.sp)
                            Row(modifier = Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                listOf("#FFFFFF", "#80B1FA", "#E2E535", "#10B239").forEach { hex ->
                                    val selected = state.subtitleColor.equals(hex, ignoreCase = true)
                                    MaterialTvButton(
                                        onClick = { state.updateSubtitleColor(hex) },
                                        modifier = Modifier.size(44.dp).semantics { contentDescription = "$label $hex" },
                                        shape = TvButtonDefaults.shape(CircleShape),
                                        colors = TvButtonDefaults.colors(containerColor = Color(android.graphics.Color.parseColor(hex)), focusedContainerColor = Color(android.graphics.Color.parseColor(hex))),
                                        border = TvButtonDefaults.border(focusedBorder = TvBorder(BorderStroke(3.dp, colors["type.logo"]), shape = CircleShape)),
                                        contentPadding = PaddingValues(0.dp)
                                    ) {
                                        if (selected) Icon(painterResource(R.drawable.desktop_checkmark), null, Modifier.size(20.dp), tint = Color.Black)
                                    }
                                }
                            }
                        }
                        item {
                            Text(t("settings.subtitles.verticalPositionLabel"), color = secondaryText, fontSize = 13.sp)
                            Row(modifier = Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                TvButton(t("settings.subtitles.low"), selected = state.subtitleVerticalPosition == 1, navigation = true) { state.updateSubtitleVerticalPosition(1) }
                                TvButton(t("settings.subtitles.high"), selected = state.subtitleVerticalPosition == 3, navigation = true) { state.updateSubtitleVerticalPosition(3) }
                            }
                        }
                        item { TvButton(t("settings.reset"), navigation = true) { state.resetSubtitleStyling() } }
                    }
                }
            }

            "watchparty" -> {
                Column {
                    PlayerMenuHeader(t("player.menus.watchparty.watchpartyItem"), onBack = { onNavigateOverlay("settings") })
                    LazyColumn(contentPadding = PaddingValues(top = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        state.watchPartyNotice?.let { notice -> item { Text(notice, color = colors["type.danger"], fontSize = 13.sp) } }
                        if (!state.isLoggedIn) {
                            item { PlayerMenuRowLink(t("auth.login.submit"), modifier = Modifier.focusRequester(firstRequester)) { state.openLogin() } }
                        } else if (state.activeWatchParty == null) {
                            item { PlayerMenuRowLink(t("watchParty.hostParty"), enabled = stream != null,
                                modifier = if (stream != null) Modifier.focusRequester(firstRequester) else Modifier) { state.hostWatchParty() } }
                            item { PlayerMenuRowLink(t("watchParty.joinParty"),
                                modifier = if (stream == null) Modifier.focusRequester(firstRequester) else Modifier) { state.openWatchParty() } }
                        } else {
                            item { Text(if (!state.watchPartyConnected) t("watchParty.validating") else if (state.watchPartyIsHost) t("watchParty.hosting") else t("watchParty.connectedAsGuest"),
                                color = secondaryText, fontSize = 13.sp, modifier = Modifier.padding(8.dp)) }
                            item { PlayerMenuRowLink(state.activeWatchParty.orEmpty(), rightText = t("watchParty.copyCode"),
                                modifier = Modifier.focusRequester(firstRequester)) {
                                val clipboard = context.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
                                clipboard.setPrimaryClip(android.content.ClipData.newPlainText("Watch Party", state.activeWatchParty.orEmpty()))
                            } }
                            item { Text(t("watchParty.viewers", "count" to state.watchPartyUsers.size), color = mainText,
                                fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(8.dp)) }
                            items(state.watchPartyUsers, key = { it.participantId }) { user ->
                                val name = if (user.participantId == state.userId) t("watchParty.you") else user.nickname.ifBlank { t("watchParty.guestFallback") }
                                val progress = if (user.duration > 0) "${(100 * user.time / user.duration).toInt().coerceIn(0, 100)}%" else "${user.time.toInt()}s"
                                Text("$name  ·  $progress", color = if (user.isHost) accentColor else secondaryText,
                                    fontSize = 13.sp, modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp))
                            }
                            item { PlayerMenuRowLink(t("watchParty.showStatusOverlay"), showToggle = true,
                                toggleEnabled = state.watchPartyStatusOverlay) { state.watchPartyStatusOverlay = !state.watchPartyStatusOverlay } }
                            item { PlayerMenuRowLink(t("watchParty.leaveWatchParty")) { state.leaveWatchParty() } }
                        }
                    }
                }
            }
            "playback" -> {
                Column(modifier = Modifier.fillMaxSize()) {
                    PlayerMenuHeader(
                        title = t("player.menus.playback.title"),
                        onBack = { onNavigateOverlay("settings") }
                    )
                    Column(
                        modifier = Modifier.fillMaxSize(),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Spacer(Modifier.height(2.dp))
                        Text(t("player.menus.playback.speedLabel"), color = secondaryText, fontSize = 14.sp)
                        Text(
                            text = String.format(Locale.ROOT, "%.2fx", selectedSpeed),
                            modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center,
                            color = Color.White, fontSize = 28.sp, fontWeight = FontWeight.SemiBold
                        )
                        if (state.activeWatchParty != null) {
                            Text(t("player.menus.playback.disabled"), color = secondaryText, fontSize = 13.sp,
                                modifier = Modifier.focusRequester(firstRequester).focusable())
                        } else {
                        Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            TvButton(label = "−", modifier = Modifier.focusRequester(firstRequester), navigation = true) {
                                onSelectSpeed(selectedSpeed - 0.05)
                            }
                            Box(modifier = Modifier.weight(1f).padding(horizontal = 12.dp).height(5.dp)
                                .clip(RoundedCornerShape(50)).background(colors["video.context.slider"].copy(alpha = 0.25f))) {
                                Box(Modifier.fillMaxHeight().fillMaxWidth(((selectedSpeed - 0.25) / 2.75).toFloat().coerceIn(0f, 1f))
                                    .background(colors["video.context.sliderFilled"]))
                            }
                            TvButton(label = "+", navigation = true) { onSelectSpeed(selectedSpeed + 0.05) }
                        }
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            listOf(1.0, 1.25, 1.5, 2.0, 3.0).forEach { speed ->
                                TvButton(label = "${speed}x", selected = selectedSpeed == speed, navigation = true,
                                    modifier = Modifier.weight(1f)) { onSelectSpeed(speed) }
                            }
                        }
                        PlayerMenuRowLink(
                            title = t("settings.preferences.autoplayLabel"),
                            showToggle = true, toggleEnabled = state.enableAutoplay,
                            onClick = { state.toggleAutoplay() }
                        )
                        }
                    }
                }
            }

            "audio" -> {
                Column(modifier = Modifier.fillMaxSize()) {
                    PlayerMenuHeader(
                        title = t("player.menus.settings.audioItem"),
                        onBack = { onNavigateOverlay("settings") }
                    )
                    LazyColumn(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(top = 12.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        items(audioTracks.size) { index ->
                            val track = audioTracks[index]
                            PlayerMenuRowLink(
                                title = audioTrackLabel(track).ifBlank { t("player.menus.subtitles.unknownLanguage") },
                                selected = track.selected,
                                modifier = if (index == 0) Modifier.focusRequester(firstRequester) else Modifier,
                                onClick = {
                                    if (player.command("set", "aid", track.id) >= 0) onNavigateOverlay(null)
                                }
                            )
                        }
                    }
                }
            }

            "quality" -> {
                val adaptive = stream != null && streamKind(stream) in listOf("hls", "dash")
                val selectedVideo = videoTracks.firstOrNull { it.selected }
                val selectedQuality = selectedVideo?.let(::videoTrackQuality)
                    ?: stream?.let(::detectStreamQualityCategory)?.takeUnless { it == "other" }
                val qualityTracks = videoTracks.filter { adaptive }.groupBy(::videoTrackQuality)
                Column(modifier = Modifier.fillMaxSize()) {
                    PlayerMenuHeader(
                        title = t("player.menus.quality.title"),
                        onBack = { onNavigateOverlay("settings") },
                        backModifier = Modifier.focusRequester(firstRequester)
                    )
                    LazyColumn(
                        modifier = Modifier.fillMaxSize().padding(top = 12.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        items(videoQualities) { quality ->
                            val track = qualityTracks[quality]?.maxByOrNull { it.bitrate }
                            val available = if (adaptive) track != null else selectedQuality == quality
                            PlayerMenuRowLink(
                                title = if (quality == "4k") "4K" else quality,
                                selected = selectedQuality == quality,
                                enabled = available,
                                onClick = {
                                    if (track != null && player.command("set", "vid", track.id) >= 0) {
                                        state.setVideoQualityPreference(quality, track.bitrate)
                                        onNavigateOverlay(null)
                                    }
                                }
                            )
                        }
                        if (adaptive) item {
                            PlayerMenuRowLink(
                                title = t("player.menus.quality.automaticLabel"),
                                showToggle = true,
                                toggleEnabled = state.automaticVideoQuality,
                                onClick = {
                                    val enable = !state.automaticVideoQuality
                                    val track = selectedVideo ?: state.preferredVideoQuality?.let { preferredVideoTrack(videoTracks, it) }
                                    val result = if (enable) player.command("set", "vid", "auto")
                                        else if (track != null) player.command("set", "vid", track.id) else -1
                                    if (result >= 0) {
                                        if (!enable && track != null) selectedQuality?.let { state.setVideoQualityPreference(it, track.bitrate) }
                                        state.updateAutomaticVideoQuality(enable)
                                    }
                                }
                            )
                            Text(t("player.menus.quality.mpvAutoHint"), color = secondaryText, fontSize = 13.sp, lineHeight = 18.sp)
                        }
                        item {
                            PlayerMenuRowLink(
                                title = t("player.menus.settings.sourceItem"),
                                chevron = true,
                                onClick = { onNavigateOverlay("source") }
                            )
                            Text(
                                text = t("player.menus.quality.hint").replace("<0>", "").replace("</0>", ""),
                                color = secondaryText,
                                fontSize = 13.sp,
                                lineHeight = 18.sp
                            )
                        }
                    }
                }
            }

            "episodes" -> {
                Column(modifier = Modifier.fillMaxSize()) {
                    PlayerMenuHeader(
                        title = t("player.menus.episodes.button"),
                        onBack = { onNavigateOverlay(null) },
                        backModifier = Modifier.focusRequester(firstRequester)
                    )
                    if (state.seasons.size > 1) {
                        LazyRow(
                            modifier = Modifier.padding(vertical = 8.dp),
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            items(state.seasons) { seasonNum ->
                                TvButton(
                                    label = "${t("details.season")} $seasonNum",
                                    selected = state.selectedSeason == seasonNum,
                                    navigation = true
                                ) {
                                    state.chooseSeason(item, seasonNum)
                                }
                            }
                        }
                    }
                    if (state.episodesLoading) {
                        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(28.dp),
                                color = colors["type.logo"],
                                strokeWidth = 2.5.dp
                            )
                        }
                    } else if (state.episodes.isEmpty()) {
                        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            Text(
                                text = t("player.menus.episodes.emptyState"),
                                color = secondaryText,
                                fontSize = 14.sp
                            )
                        }
                    } else {
                        LazyRow(horizontalArrangement = Arrangement.spacedBy(14.dp), contentPadding = PaddingValues(vertical = 5.dp)) {
                            items(state.episodes, key = { "${it.season}:${it.number}" }) { ep ->
                                val progress = state.progress.firstOrNull { it.media.id == item.id && it.season == ep.season && it.episode == ep.number }
                                val watched = (state.history + listOfNotNull(progress)).any { it.media.id == item.id && it.season == ep.season && it.episode == ep.number && it.duration > 0 && it.position / it.duration > .9 }
                                val favorite = state.bookmarkDetails.firstOrNull { it.media.id == item.id }?.favoriteEpisodes?.contains(ep.id) == true
                                DetailsEpisodeCard(ep, progress, firstRequester, favorite, watched, false,
                                    onFavorite = { state.toggleFavoriteEpisode(item, ep) },
                                    onWatched = { state.markEpisodeWatched(item, ep, !watched) },
                                    onOverview = { expandedEpisode = ep },
                                    playing = episode?.season == ep.season && episode.number == ep.number
                                ) {
                                    if (ep.id.isBlank() || detailEpisodeAired(ep.airDate)) onSelectEpisode(ep)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    expandedEpisode?.let { ep ->
        Dialog(onDismissRequest = { expandedEpisode = null }) {
            Column(Modifier.widthIn(max = 550.dp).clip(RoundedCornerShape(14.dp)).background(colors["background.main"]).padding(22.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Text("${t("details.episode")} ${ep.number}: ${ep.title}", color = colors["type.emphasis"], fontSize = 20.sp, fontWeight = FontWeight.Bold)
                LazyColumn(Modifier.heightIn(max = 300.dp)) { item { Text(ep.overview, color = colors["type.text"], fontSize = 15.sp, lineHeight = 22.sp) } }
                TvButton(t("player.menus.episodes.showLess")) { expandedEpisode = null }
            }
        }
    }
}

@Composable
private fun SettingsGridButton(
    title: String,
    subtitle: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val colors = LocalFrameZooColors.current
    var focused by remember { mutableStateOf(false) }
    val shape = RoundedCornerShape(8.dp)
    TvCard(
        onClick = onClick,
        modifier = modifier
            .height(68.dp)
            .onFocusChanged { focused = it.isFocused },
        shape = TvCardDefaults.shape(shape),
        colors = TvCardDefaults.colors(
            containerColor = colors["video.context.buttons.list"].copy(alpha = 0.55f),
            focusedContainerColor = colors["video.context.hoverColor"]
        ),
        scale = TvCardDefaults.scale(focusedScale = 1.03f),
        border = TvCardDefaults.border(
            border = TvBorder(BorderStroke(1.dp, colors["video.context.border"]), shape = shape),
            focusedBorder = TvBorder(BorderStroke(2.dp, colors["type.logo"]), shape = shape)
        )
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 10.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(
                text = title,
                color = Color.White,
                fontSize = 14.5.sp,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth()
            )
            if (subtitle.isNotBlank()) {
                Spacer(Modifier.height(2.dp))
                Text(
                    text = subtitle,
                    color = colors["video.context.type.secondary"],
                    fontSize = 12.5.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth()
                )
            }
        }
    }
}

@Composable
private fun PlayerMenuHeader(
    title: String,
    onBack: () -> Unit,
    backModifier: Modifier = Modifier,
    rightActionLabel: String? = null,
    onRightAction: (() -> Unit)? = null
) {
    val colors = LocalFrameZooColors.current
    Column {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(bottom = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                modifier = Modifier.weight(1f)
            ) {
                PlayerContextIconButton(
                    icon = R.drawable.desktop_chevron_left,
                    onClick = onBack,
                    modifier = backModifier
                )
                Text(
                    text = title,
                    color = Color.White,
                    fontSize = 17.sp,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            if (rightActionLabel != null && onRightAction != null) {
                TvButton(
                    label = rightActionLabel,
                    navigation = true,
                    onClick = onRightAction
                )
            }
        }
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(1.dp)
                .background(colors["video.context.border"])
        )
    }
}

@Composable
private fun PlayerMenuRowLink(
    title: String,
    rightText: String = "",
    selected: Boolean = false,
    chevron: Boolean = false,
    rightIcon: Int? = null,
    showToggle: Boolean = false,
    toggleEnabled: Boolean = false,
    enabled: Boolean = true,
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    val colors = LocalFrameZooColors.current
    var focused by remember { mutableStateOf(false) }
    val shape = RoundedCornerShape(8.dp)
    if (!enabled) {
        Text(title, color = colors["video.context.type.main"].copy(alpha = 0.4f), fontSize = 14.5.sp,
            modifier = modifier.fillMaxWidth().semantics { disabled() }.padding(horizontal = 12.dp, vertical = 11.dp))
        return
    }
    TvCard(
        onClick = onClick,
        modifier = modifier
            .fillMaxWidth()
            .alpha(if (enabled) 1f else 0.4f)
            .semantics {
                if (showToggle) {
                    role = Role.Switch
                    toggleableState = ToggleableState(toggleEnabled)
                }
            }
            .onFocusChanged { focused = it.isFocused },
        shape = TvCardDefaults.shape(shape),
        colors = TvCardDefaults.colors(
            containerColor = if (focused) colors["video.context.hoverColor"] else Color.Transparent,
            focusedContainerColor = colors["video.context.hoverColor"]
        ),
        scale = TvCardDefaults.scale(focusedScale = 1.02f),
        border = TvCardDefaults.border(
            focusedBorder = TvBorder(BorderStroke(1.5.dp, colors["type.logo"]), shape = shape)
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 11.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(
                text = title,
                color = if (selected) Color.White else colors["video.context.type.main"],
                fontSize = 14.5.sp,
                fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f)
            )
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                if (rightText.isNotBlank()) {
                    Text(
                        text = rightText,
                        color = colors["video.context.type.secondary"],
                        fontSize = 13.sp
                    )
                }
                if (showToggle) {
                    Box(
                        modifier = Modifier
                            .width(38.dp)
                            .height(22.dp)
                            .clip(RoundedCornerShape(50))
                            .background(if (toggleEnabled) colors["type.logo"] else colors["video.context.buttons.list"]),
                        contentAlignment = if (toggleEnabled) Alignment.CenterEnd else Alignment.CenterStart
                    ) {
                        Box(
                            modifier = Modifier
                                .padding(horizontal = 3.dp)
                                .size(16.dp)
                                .clip(CircleShape)
                                .background(Color.White)
                        )
                    }
                } else if (rightIcon != null) {
                    Icon(
                        painter = painterResource(rightIcon),
                        contentDescription = null,
                        tint = colors["video.context.type.main"],
                        modifier = Modifier.size(18.dp)
                    )
                } else if (selected) {
                    Icon(
                        painter = painterResource(R.drawable.desktop_checkmark),
                        contentDescription = null,
                        tint = colors["video.context.type.accent"],
                        modifier = Modifier.size(16.dp)
                    )
                } else if (chevron) {
                    Icon(
                        painter = painterResource(R.drawable.desktop_chevron_right),
                        contentDescription = null,
                        tint = colors["video.context.type.secondary"],
                        modifier = Modifier.size(16.dp)
                    )
                }
            }
        }
    }
}
