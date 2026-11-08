package com.framezoo.tv.model

enum class WatchPartyError { EMPTY_ROOM, NO_HOST, INVALID_ROOM }

class WatchPartyException(val kind: WatchPartyError) : Exception(kind.name)

data class WatchPartyHost(val tmdbId: String, val title: String, val isShow: Boolean, val season: Int?, val episode: Int?)

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
