package com.framezoo.tv.ui

import kotlin.math.roundToInt
import kotlin.math.max
import kotlin.math.min
import java.util.Locale
import com.framezoo.tv.model.Episode
import com.framezoo.tv.model.SkipSegment
import com.framezoo.tv.player.VideoTrack
import com.framezoo.tv.player.TorrentLiveStats

internal const val STREAM_READY_THRESHOLD_BYTES = 4L * 1024L * 1024L

internal fun playbackSpeed(value: Double): Double = (value * 20).roundToInt().coerceIn(5, 60) / 20.0

internal fun playbackFinished(position: Double, duration: Double, eof: Boolean, skipCredits: Boolean): Boolean =
    duration > 0 && (eof || position >= duration * if (skipCredits) 0.99 else 1.0)

/** Same loading progress contract as desktop PlayerLoadingOverlay. */
internal fun playerLoadingProgress(
    hasRenderedFrame: Boolean,
    duration: Double,
    bufferedSeconds: Double,
    torrentStats: TorrentLiveStats?
): Float {
    if (hasRenderedFrame) return 100f
    val bufferedProgress = if (duration > 0.0 && duration.isFinite()) {
        (bufferedSeconds.coerceAtLeast(0.0) / duration * 100.0).coerceIn(0.0, 100.0)
    } else 0.0
    val torrentProgress = torrentStats?.let { stats ->
        val target = if (stats.totalBytes > 0L) min(STREAM_READY_THRESHOLD_BYTES, stats.totalBytes) else STREAM_READY_THRESHOLD_BYTES
        if (target <= 0L) 0.0 else (stats.downloadedBytes.coerceAtLeast(0L).toDouble() / target * 100.0).coerceIn(0.0, 100.0)
    } ?: 0.0
    return min(95.0, max(bufferedProgress, torrentProgress)).toFloat()
}

internal fun shouldAcceptRenderedFrame(
    surfaceFramePending: Boolean,
    isOpening: Boolean,
    nativeFrameReady: Boolean
): Boolean = surfaceFramePending && !isOpening && nativeFrameReady

/**
 * Emulator libmpv can expose a valid TextureView frame while
 * `video-frame-info` is still unavailable. Duration plus a moving clock is
 * enough fallback evidence once the surface has updated.
 */
internal fun shouldAcceptSurfaceFrame(
    surfaceFramePending: Boolean,
    isOpening: Boolean,
    nativeFrameReady: Boolean,
    duration: Double,
    position: Double,
    surfaceFrameCount: Int = 0
): Boolean = surfaceFramePending && !isOpening && (
    nativeFrameReady ||
        (duration.isFinite() && duration > 0.0 && position.isFinite() && position > 0.0) ||
        // Some emulator mpv builds never expose picture metadata. Two
        // consecutive TextureView updates still prove that the native surface
        // is receiving decoded output.
        surfaceFrameCount >= 2
    )

internal fun skipSegmentVisible(
    segment: SkipSegment,
    position: Double,
    duration: Double,
    controlsShown: Boolean
): Boolean {
    val bounds = playbackSegmentBounds(segment, duration) ?: return false
    if (position < bounds.start || (bounds.end != null && position > bounds.end)) return false
    return controlsShown || position - bounds.start <= 10.0
}

internal fun segmentEndsAtVideoEnd(segment: SkipSegment, duration: Double): Boolean =
    duration > 0.0 && playbackSegmentBounds(segment, duration)?.let { bounds ->
        (bounds.end ?: duration) >= duration - 0.5
    } == true

internal fun nextEpisodeVisible(position: Double, duration: Double, controlsShown: Boolean): Boolean {
    if (duration <= 0.0 || position < 0.0) return false
    val remaining = duration - position
    return remaining <= 30.0 || (position / duration >= 0.93 && controlsShown)
}

// ponytail: percentages approximate desktop margins; use measured video bounds for letterboxed video.
internal fun subtitlePosition(controlsShown: Boolean, verticalPosition: Int): Int =
    if (controlsShown) 80 else if (verticalPosition == 3) 92 else 96

// ponytail: fixed spacing fits one line; use measured cue bounds for multiline subtitles.
internal fun secondarySubtitlePosition(controlsShown: Boolean, verticalPosition: Int): Int =
    subtitlePosition(controlsShown, verticalPosition) - 12

private val subtitleLanguages = Locale.getISOLanguages().mapNotNull { code ->
    runCatching { Locale.forLanguageTag(code).isO3Language to code }.getOrNull()
}.toMap()
internal fun subtitleLanguage(code: String): String {
    val language = code.trim().replace('_', '-').lowercase(Locale.ROOT).substringBefore('-')
    return subtitleLanguages[language] ?: language.ifBlank { "und" }
}

internal suspend fun resolveNextEpisode(current: Episode, seasons: List<Int>, episodes: suspend (Int) -> List<Episode>): Episode? {
    episodes(current.season).firstOrNull { it.number == current.number + 1 }?.let { return it }
    val nextSeason = current.season + 1
    if (nextSeason !in seasons) return null
    return episodes(nextSeason).filter { detailEpisodeAired(it.airDate) }.minByOrNull { it.number }
}

internal val videoQualities = listOf("4k", "1440p", "1080p", "720p", "480p", "360p")

internal fun videoTrackQuality(track: VideoTrack): String? = when {
    track.width >= 3500 || track.height >= 2000 -> "4k"
    track.width >= 2500 || track.height >= 1300 -> "1440p"
    track.width >= 1900 || track.height >= 1000 -> "1080p"
    track.width >= 1250 || track.height >= 700 -> "720p"
    track.width >= 850 || track.height >= 470 -> "480p"
    track.width > 0 && track.height > 0 -> "360p"
    else -> null
}

internal fun preferredVideoTrack(tracks: List<VideoTrack>, quality: String): VideoTrack? {
    val index = videoQualities.indexOf(quality)
    if (index < 0) return null
    val available = tracks.groupBy(::videoTrackQuality)
    val nearest = (videoQualities.drop(index) + videoQualities.take(index).reversed()).firstOrNull { available[it]?.isNotEmpty() == true }
    return available[nearest]?.maxByOrNull { it.bitrate }
}

internal data class PlaybackSegmentBounds(val start: Double, val end: Double?)

internal fun playbackSegmentBounds(segment: SkipSegment, duration: Double): PlaybackSegmentBounds? {
    val max = duration.takeIf { it.isFinite() && it > 0.0 }
    val start = (segment.startMs ?: 0L).coerceAtLeast(0L) / 1000.0
    val end = segment.endMs?.coerceAtLeast(0L)?.div(1000.0)
    val boundedStart = if (max != null) start.coerceAtMost(max) else start
    val boundedEnd = if (end != null && max != null) end.coerceAtMost(max) else end
    if (max != null && boundedStart >= max) return null
    if (boundedEnd != null && boundedEnd <= boundedStart) return null
    return PlaybackSegmentBounds(boundedStart, boundedEnd)
}

internal fun activePlaybackSegment(
    segments: List<SkipSegment>,
    position: Double,
    duration: Double
): SkipSegment? = segments.firstOrNull { segment ->
    val bounds = playbackSegmentBounds(segment, duration) ?: return@firstOrNull false
    position >= bounds.start && (bounds.end == null || position < bounds.end)
}
