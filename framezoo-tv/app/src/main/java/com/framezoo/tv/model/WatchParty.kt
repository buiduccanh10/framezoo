package com.framezoo.tv.model

import org.json.JSONObject
import kotlin.math.abs

enum class WatchPartyError { EMPTY_ROOM, NO_HOST, INVALID_ROOM }

class WatchPartyException(val kind: WatchPartyError) : Exception(kind.name)

data class WatchPartyHost(val tmdbId: String, val title: String, val isShow: Boolean, val season: Int?, val episode: Int?)

data class WatchPartyUser(
    val participantId: String, val nickname: String, val isHost: Boolean, val timestamp: Long,
    val tmdbId: String, val title: String, val isShow: Boolean, val season: Int?, val episode: Int?,
    val playing: Boolean, val paused: Boolean, val time: Double, val duration: Double
)

internal fun parseWatchPartyUsers(reply: JSONObject): List<WatchPartyUser> {
    val users = reply.optJSONObject("users") ?: return emptyList()
    return users.keys().asSequence().mapNotNull { key ->
        val statuses = users.optJSONArray(key) ?: return@mapNotNull null
        val latest = (0 until statuses.length()).mapNotNull { statuses.optJSONObject(it) }
            .maxByOrNull { it.optLong("timestamp") } ?: return@mapNotNull null
        val content = latest.optJSONObject("content") ?: return@mapNotNull null
        val player = latest.optJSONObject("player") ?: JSONObject()
        fun number(name: String) = if (content.has(name) && !content.isNull(name)) content.optInt(name, -1).takeIf { it >= 0 } else null
        WatchPartyUser(
            latest.optString("participantId").ifBlank { key }, latest.optString("nickname"), latest.optBoolean("isHost"),
            latest.optLong("timestamp"), content.opt("tmdbId")?.takeIf { it != JSONObject.NULL }?.toString()?.removeSuffix(".0").orEmpty(),
            content.optString("title"),
            content.optString("type").equals("TV Show", true), number("seasonNumber"), number("episodeNumber"),
            player.optBoolean("isPlaying"), player.optBoolean("isPaused"),
            player.optDouble("time", 0.0).takeIf { it.isFinite() && it >= 0 } ?: 0.0,
            player.optDouble("duration", 0.0).takeIf { it.isFinite() && it >= 0 } ?: 0.0
        )
    }.sortedWith(compareByDescending<WatchPartyUser> { it.isHost }.thenByDescending { it.timestamp }).toList()
}

internal fun watchPartySyncTime(host: WatchPartyUser, localTime: Double, localPaused: Boolean, now: Long): Double? {
    val hostPlaying = host.playing && !host.paused
    val predicted = (host.time + if (hostPlaying) ((now - host.timestamp).coerceAtLeast(0L) / 1000.0) else 0.0)
        .coerceAtMost(host.duration.takeIf { it > 0 } ?: Double.MAX_VALUE)
    val threshold = if (localPaused) 5.0 else 2.0
    return predicted.takeIf { abs(localTime - predicted) > threshold || localPaused == hostPlaying }
}

/** Port of desktop parseWatchPartyCode (LinksDropdown.tsx). */
fun parseWatchPartyCode(input: String): String? {
    val value = input.trim()
    if (value.isEmpty()) return null
    val normalized = value.uppercase()
    if (!normalized.contains("HTTP://") && !normalized.contains("HTTPS://")) return normalized
    return try {
        val query = java.net.URI(value).rawQuery ?: return null
        query.split("&").map { it.split("=", limit = 2) }
            .firstOrNull { it[0] == "watchparty" }?.getOrNull(1)
            ?.let { java.net.URLDecoder.decode(it, "UTF-8") }?.trim()?.uppercase()?.takeIf { it.isNotEmpty() }
    } catch (_: Exception) { null }
}
