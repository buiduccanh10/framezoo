package com.framezoo.tv.api

import java.time.Instant

internal data class ReleaseDate(val country: String, val type: Int, val date: Instant)

internal fun showCinemaBadge(type: String, quality: String?) = type == "movie" && quality == "CAM"

internal fun releaseQuality(dates: List<ReleaseDate>, now: Instant = Instant.now()): String? {
    fun earliest(types: Set<Int>): Instant? {
        val candidates = dates.filter { it.type in types }
        val preferred = candidates.filter { it.country in setOf("US", "GB") }
        return (preferred.ifEmpty { candidates }).minOfOrNull { it.date }
    }
    return when {
        earliest(setOf(4, 5))?.let { it <= now } == true -> "HD"
        earliest(setOf(2, 3))?.let { it <= now } == true -> "CAM"
        else -> null
    }
}

internal fun releaseQualityLabel(label: String): String? = when {
    Regex("(?:^|[^a-z])(cam|hdcam|hdts|telesync|telecine|ts|tc|screener)(?:$|[^a-z])", RegexOption.IGNORE_CASE).containsMatchIn(label) -> "CAM"
    Regex("2160|1080|720|4k|uhd|bluray|brrip|bdrip|web[ .-]?dl|webrip|hdrip|hdtv|dvdrip|remux", RegexOption.IGNORE_CASE).containsMatchIn(label) -> "HD"
    else -> null
}
