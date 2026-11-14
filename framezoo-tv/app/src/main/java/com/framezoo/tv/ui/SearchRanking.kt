package com.framezoo.tv.ui

import com.framezoo.tv.model.Media
import java.text.Normalizer

private val DIACRITICS_REGEX = Regex("\\p{InCombiningDiacriticalMarks}+")
private val NON_ALNUM_REGEX = Regex("[^\\p{L}\\p{N}]+")

/**
 * Normalizes Vietnamese/Unicode titles identically to Desktop searchRanking.ts.
 */
internal fun normalizeSearchText(value: String): String {
    if (value.isBlank()) return ""
    val decomposed = Normalizer.normalize(value, Normalizer.Form.NFKD)
    return DIACRITICS_REGEX.replace(decomposed, "")
        .replace('đ', 'd')
        .replace('Đ', 'd')
        .lowercase()
        .let { NON_ALNUM_REGEX.replace(it, " ") }
        .trim()
}

internal fun scoreSearchMatch(normalizedQuery: String, normalizedCandidate: String): Int {
    if (normalizedQuery.isEmpty() || normalizedCandidate.isEmpty()) return 0
    if (normalizedCandidate == normalizedQuery) return 100
    if (normalizedCandidate.startsWith(normalizedQuery)) return 85

    val candidateWords = normalizedCandidate.split(" ")
    if (normalizedQuery in candidateWords) return 75
    if (candidateWords.any { it.startsWith(normalizedQuery) }) return 70
    if (normalizedCandidate.contains(normalizedQuery)) return 55

    val queryWords = normalizedQuery.split(" ")
    val hasAllQueryWords = queryWords.all { qWord ->
        candidateWords.any { cWord -> cWord == qWord || cWord.startsWith(qWord) }
    }
    return if (hasAllQueryWords) 40 else 0
}

private data class RankedSearchEntry(
    val index: Int,
    val item: Media,
    val score: Int,
    val popularity: Double,
)

/**
 * Ranks search results by relevance across localized & original titles, then popularity, then original order.
 */
internal fun rankSearchResults(query: String, results: List<Media>): List<Media> {
    val normalizedQuery = normalizeSearchText(query)
    if (normalizedQuery.isEmpty() || results.size <= 1) return results

    return results.mapIndexed { index, item ->
        val bestScore = maxOf(
            scoreSearchMatch(normalizedQuery, normalizeSearchText(item.title)),
            scoreSearchMatch(normalizedQuery, normalizeSearchText(item.originalTitle))
        )
        RankedSearchEntry(index, item, bestScore, item.popularity)
    }.sortedWith(
        compareByDescending<RankedSearchEntry> { it.score }
            .thenByDescending { it.popularity }
            .thenBy { it.index }
    ).map { it.item }
}
