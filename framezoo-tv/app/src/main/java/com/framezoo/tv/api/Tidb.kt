package com.framezoo.tv.api

import com.framezoo.tv.model.Episode
import com.framezoo.tv.model.Media
import org.json.JSONObject

internal val TIDB_SEGMENT_TYPES = listOf("intro", "recap", "credits", "preview")
internal const val MAX_TIDB_TIME_SECONDS = 21_600_000.0

internal class TidbSubmissionException(
    message: String,
    val statusCode: Int? = null,
    val details: String? = null
) : IllegalStateException(if (!details.isNullOrBlank()) "$message: $details" else message)

internal fun shouldFallbackToClientTidbKey(statusCode: Int?, apiKey: String?): Boolean =
    statusCode in setOf(404, 405, 501, 503) && !apiKey.isNullOrBlank()

/**
 * Validates and builds a TheIntroDB skip-segment submission JSON matching Desktop TIDBSubmissionForm.
 */
internal fun buildTidbSubmissionPayload(
    item: Media,
    episode: Episode?,
    segmentType: String,
    startSec: Double?,
    endSec: Double?
): JSONObject {
    val cleanType = segmentType.trim().lowercase()
    require(cleanType in TIDB_SEGMENT_TYPES) { "Invalid segment type: $segmentType" }
    val tmdbId = item.id.toIntOrNull()?.takeIf { it > 0 }
        ?: throw IllegalArgumentException("Valid numeric TMDB ID is required")
    val isShow = item.type == "show"
    if (isShow) {
        require(episode != null && episode.season >= 0 && episode.number >= 0) {
            "Episode metadata is required for TV shows"
        }
    }

    fun validateTime(value: Double?, name: String) {
        if (value != null) {
            require(value.isFinite() && value >= 0.0 && value <= MAX_TIDB_TIME_SECONDS) {
                "Invalid $name time"
            }
        }
    }
    validateTime(startSec, "start")
    validateTime(endSec, "end")

    // Desktop rules: intro/recap require end_sec (start_sec optional); credits/preview require start_sec (end_sec optional).
    if (cleanType == "intro" || cleanType == "recap") {
        require(endSec != null) { "End time is required for $cleanType" }
        if (startSec != null) {
            require(endSec > startSec) { "End time must be after start time" }
        }
    } else {
        require(startSec != null) { "Start time is required for $cleanType" }
        if (endSec != null) {
            require(endSec > startSec) { "End time must be after start time" }
        }
    }

    return JSONObject().apply {
        put("tmdb_id", tmdbId)
        put("type", if (isShow) "tv" else "movie")
        put("segment", cleanType)
        if (isShow && episode != null) {
            put("season", episode.season)
            put("episode", episode.number)
        }
        put("start_sec", startSec ?: JSONObject.NULL)
        put("end_sec", endSec ?: JSONObject.NULL)
    }
}
