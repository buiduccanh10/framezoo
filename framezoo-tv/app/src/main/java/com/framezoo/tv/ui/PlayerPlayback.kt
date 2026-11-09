package com.framezoo.tv.ui

import kotlin.math.roundToInt
import java.util.Locale
import com.framezoo.tv.model.Episode
import com.framezoo.tv.player.VideoTrack

internal fun playbackSpeed(value: Double): Double = (value * 20).roundToInt().coerceIn(5, 60) / 20.0

internal fun playbackFinished(position: Double, duration: Double, eof: Boolean, skipCredits: Boolean): Boolean =
    duration > 0 && (eof || position >= duration * if (skipCredits) 0.99 else 1.0)

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
