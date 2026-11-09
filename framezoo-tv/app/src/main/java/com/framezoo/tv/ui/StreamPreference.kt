package com.framezoo.tv.ui

import com.framezoo.tv.model.Stream
import kotlin.math.roundToInt

internal data class StreamPreference(
    val addonId: String,
    val kind: String,
    val quality: String,
    val name: String,
    val title: String,
    val bingeGroup: String?
)

internal fun streamKind(stream: Stream): String = when {
    stream.infoHash != null || stream.url.startsWith("magnet:", true) ||
        stream.filename.orEmpty().endsWith(".torrent", true) || stream.url.substringBefore('?').substringBefore('#').endsWith(".torrent", true) -> "torrent"
    stream.url.substringBefore('?').substringBefore('#').endsWith(".m3u8", true) -> "hls"
    stream.url.substringBefore('?').substringBefore('#').endsWith(".mpd", true) -> "dash"
    else -> "file"
}

internal fun streamPreference(stream: Stream) = StreamPreference(
    stream.addonId, streamKind(stream), detectStreamQualityCategory(stream), stream.name, stream.title, stream.bingeGroup
)

private fun releaseLine(title: String) = title.lineSequence().map { it.trim() }.firstOrNull { it.isNotEmpty() }.orEmpty()
private fun normalizedRelease(title: String) = title.lowercase()
    .replace(Regex("\\bs\\d+e\\d+\\b"), "")
    .replace(Regex("\\b(?:season|s)\\s*\\d+"), "")
    .replace(Regex("\\b(?:episode|ep|e)\\s*\\d+"), "")
    .replace(Regex("\\b\\d+x\\d+\\b"), "")
    .replace(Regex("[^a-z0-9]+"), " ").trim()
private fun releaseGroup(title: String): String? =
    (Regex("\\[([a-z0-9_-]+)\\]", RegexOption.IGNORE_CASE).find(title)
        ?: Regex("[-.]([a-z0-9]+)(?:\\.mkv|\\.mp4)?$", RegexOption.IGNORE_CASE).find(title))
        ?.groupValues?.get(1)?.lowercase()
private fun releaseWords(title: String) = Regex("[a-z0-9]{3,}").findAll(title.lowercase()).map { it.value }.toList()

internal fun findPreferredStream(streams: List<Stream>, preference: StreamPreference): Stream? {
    val candidates = streams.filter { it.addonId == preference.addonId && streamKind(it) == preference.kind }
    val preferredLine = releaseLine(preference.title)
    val preferredNormalized = normalizedRelease(preferredLine)
    candidates.firstOrNull { stream ->
        if (detectStreamQualityCategory(stream) != preference.quality) false
        else if (!preference.bingeGroup.isNullOrBlank() && !stream.bingeGroup.isNullOrBlank()) stream.bingeGroup == preference.bingeGroup
        else if (stream.name != preference.name) false
        else {
            val line = releaseLine(stream.title)
            if (line.isEmpty() || preferredLine.isEmpty()) stream.title == preference.title
            else line == preferredLine || (normalizedRelease(line).isNotEmpty() && normalizedRelease(line) == preferredNormalized)
        }
    }?.let { return it }
    val preferredWords = releaseWords(preferredLine)
    val preferredGroup = releaseGroup(preferredLine)
    return candidates.map { stream ->
        val line = releaseLine(stream.title)
        val normalized = normalizedRelease(line)
        var score = if (detectStreamQualityCategory(stream) == preference.quality) 100 else 0
        if (line.isNotEmpty() && line == preferredLine) score += 1000
        else if (normalized.isNotEmpty() && normalized == preferredNormalized) score += 800
        if (preferredGroup != null && preferredGroup == releaseGroup(line)) score += 500
        val words = releaseWords(line)
        val total = (words + preferredWords).toSet().size
        if (total > 0) score += (words.count { it in preferredWords }.toDouble() / total * 300).roundToInt()
        stream to score
    }.maxByOrNull { it.second }?.takeIf { it.second > 0 }?.first
}
