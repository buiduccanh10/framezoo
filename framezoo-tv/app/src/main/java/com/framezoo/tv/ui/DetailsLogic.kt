package com.framezoo.tv.ui

import java.time.LocalDate

internal fun detailEpisodeAired(date: String, today: LocalDate = LocalDate.now()): Boolean =
    try { !LocalDate.parse(date).isAfter(today) } catch (_: Exception) { false }

internal fun initialDetailSeason(seasons: List<Int>, selected: Int?, saved: Int?): Int? =
    listOfNotNull(selected, saved).firstOrNull { it in seasons } ?: seasons.firstOrNull()

internal fun detailProviderAsset(name: String): String = mapOf(
    "Max" to "max", "Prime Video" to "prime", "Netflix" to "netflix", "Disney+" to "disney",
    "Hulu" to "hulu", "Apple TV+" to "appletv", "Paramount+" to "paramount",
)[name] ?: name.lowercase(java.util.Locale.ROOT).replace(Regex("\\s+"), "")
