package com.framezoo.tv.player

import java.util.Locale

private val COMMENTARY_OR_DESCRIPTIVE_REGEX =
    Regex("\\b(commentary|director|audio\\s*description|descriptive|narration|ad)\\b", RegexOption.IGNORE_CASE)

internal fun isCommentaryOrDescriptiveAudioTrack(track: AudioTrack): Boolean {
    val title = track.title.trim()
    if (title.isEmpty()) return false
    return COMMENTARY_OR_DESCRIPTIVE_REGEX.containsMatchIn(title)
}

/**
 * Pick the most suitable default audio track matching desktop `audioTrack.ts`:
 * 1) Non-commentary track matching `preferredLanguage` (media original language),
 * 2) Else non-commentary English track when the stream isn't single-track,
 * 3) Else first non-commentary track (keeping currently selected track if it's already valid).
 */
internal fun resolveDefaultAudioTrack(
    tracks: List<AudioTrack>,
    preferredLanguage: String?
): AudioTrack? {
    if (tracks.isEmpty()) return null
    if (tracks.size == 1) return tracks.first()

    val nonCommentary = tracks.filterNot(::isCommentaryOrDescriptiveAudioTrack)
    val pool = nonCommentary.ifEmpty { tracks }

    val preferred = preferredLanguage?.trim()?.takeIf { it.isNotBlank() }
    if (preferred != null) {
        val exact = pool.filter { languagesMatch(it.language, preferred) }
        if (exact.isNotEmpty()) {
            return exact.firstOrNull { it.selected } ?: exact.first()
        }
    }

    val currentSelected = tracks.firstOrNull { it.selected }
    if (currentSelected != null && !isCommentaryOrDescriptiveAudioTrack(currentSelected) && preferred == null) {
        return currentSelected
    }

    val english = pool.filter { languagesMatch(it.language, "en") }
    if (english.isNotEmpty()) {
        return english.firstOrNull { it.selected } ?: english.first()
    }

    return pool.firstOrNull { it.selected } ?: pool.first()
}

internal fun audioTrackDisplayTitle(track: AudioTrack): String {
    val parts = mutableListOf<String>()
    val canon = canonicalizeLanguageCode(track.language)
    if (canon != "und") {
        val display = Locale.forLanguageTag(canon).getDisplayLanguage(Locale.getDefault())
        parts += display.replaceFirstChar { it.uppercase() }.ifBlank { track.language.uppercase() }
    }
    if (track.title.isNotBlank() && !track.title.equals(parts.firstOrNull(), ignoreCase = true)) {
        parts += track.title.trim()
    }
    return parts.joinToString(" • ").ifBlank { "Track ${track.id}" }
}
