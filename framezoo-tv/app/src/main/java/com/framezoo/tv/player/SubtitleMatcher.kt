package com.framezoo.tv.player

import com.framezoo.tv.model.Subtitle
import java.util.Locale

private val ISO_3_TO_2 = mapOf(
    "eng" to "en",
    "vie" to "vi",
    "jpn" to "ja",
    "kor" to "ko",
    "zho" to "zh", "chi" to "zh",
    "fra" to "fr", "fre" to "fr",
    "spa" to "es",
    "deu" to "de", "ger" to "de",
    "ita" to "it",
    "por" to "pt", "pob" to "pt-br",
    "rus" to "ru",
    "tha" to "th",
    "ind" to "id",
    "hin" to "hi",
    "ara" to "ar",
    "tur" to "tr",
    "pol" to "pl",
    "nld" to "nl", "dut" to "nl",
    "swe" to "sv",
    "nor" to "no", "nob" to "no", "nno" to "no",
    "dan" to "da",
    "fin" to "fi",
    "ces" to "cs", "cze" to "cs",
    "ron" to "ro", "rum" to "ro",
    "hun" to "hu",
    "ell" to "el", "gre" to "el",
    "heb" to "he",
    "ukr" to "uk",
    "msa" to "ms", "may" to "ms",
    "tgl" to "tl", "fil" to "tl",
    "und" to "und"
) + Locale.getISOLanguages().mapNotNull { iso1 ->
    runCatching { Locale.forLanguageTag(iso1).isO3Language.lowercase(Locale.ROOT) to iso1 }.getOrNull()
}

private val LANGUAGE_NAME_TO_CODE = mapOf(
    "english" to "en",
    "vietnamese" to "vi", "tieng viet" to "vi",
    "japanese" to "ja",
    "korean" to "ko",
    "chinese" to "zh", "mandarin" to "zh", "cantonese" to "zh",
    "french" to "fr", "francais" to "fr",
    "spanish" to "es", "espanol" to "es",
    "german" to "de", "deutsch" to "de",
    "italian" to "it",
    "portuguese" to "pt", "portuguese brazil" to "pt-br", "brazilian" to "pt-br",
    "russian" to "ru",
    "thai" to "th",
    "indonesian" to "id",
    "hindi" to "hi",
    "arabic" to "ar",
    "turkish" to "tr",
    "polish" to "pl",
    "dutch" to "nl",
    "swedish" to "sv",
    "norwegian" to "no",
    "danish" to "da",
    "finnish" to "fi",
    "czech" to "cs",
    "romanian" to "ro",
    "hungarian" to "hu",
    "greek" to "el",
    "hebrew" to "he",
    "ukrainian" to "uk",
    "malay" to "ms",
    "filipino" to "tl", "tagalog" to "tl"
)

/** Normalize BCP-47 / ISO-639-2 / display names into compact canonical codes for reliable matching. */
internal fun canonicalizeLanguageCode(raw: String?): String {
    val clean = raw.orEmpty().trim().lowercase(Locale.ROOT).replace('_', '-')
    if (clean.isBlank()) return "und"
    LANGUAGE_NAME_TO_CODE[clean]?.let { return it }
    if (clean == "pt-br" || clean == "pob") return "pt-br"
    if (clean.startsWith("zh-tw") || clean.startsWith("zh-hk") || clean.startsWith("zh-hant")) return "zh-tw"
    if (clean.startsWith("zh-cn") || clean.startsWith("zh-sg") || clean.startsWith("zh-hans")) return "zh-cn"
    if (clean == "iw") return "he"
    val primary = clean.substringBefore('-').substringBefore(' ')
    ISO_3_TO_2[primary]?.let { return it }
    if (primary.length == 2 && primary.all(Char::isLetter)) return primary
    return primary.ifBlank { "und" }
}

internal fun baseLanguageCode(code: String?): String =
    canonicalizeLanguageCode(code).substringBefore('-')

internal fun languagesMatch(candidate: String?, preferred: String?): Boolean {
    val c = canonicalizeLanguageCode(candidate)
    val p = canonicalizeLanguageCode(preferred)
    if (c == "und" || p == "und") return false
    if (c == p) return true
    if (c.startsWith("zh-") && p.startsWith("zh-")) return false
    return baseLanguageCode(c) == baseLanguageCode(p)
}

private val NOISE_RELEASE_TOKENS = setOf(
    "mkv", "mp4", "avi", "mov", "webm", "srt", "vtt", "ass", "ssa", "sub",
    "english", "vietnamese", "vietsub", "subtitles", "subtitle", "cc", "sdh", "hi",
    "the", "and", "of", "for", "with"
)

private val EPISODE_MARKER_REGEX = Regex("\\bs(\\d{1,2})e(\\d{1,3})\\b", RegexOption.IGNORE_CASE)
private val QUALITY_SOURCE_TOKENS = setOf(
    "2160p", "4k", "1080p", "720p", "480p", "bluray", "bdrip", "brrip", "remux",
    "web", "webdl", "web-dl", "webrip", "hdtv", "dvdrip", "cam", "ts",
    "x265", "h265", "hevc", "x264", "h264", "av1", "10bit", "hdr", "hdr10", "dv", "dovi",
    "atmos", "truehd", "ddp", "dd", "dts", "aac", "ac3", "eac3"
)

internal fun tokenizeReleaseName(value: String): List<String> {
    if (value.isBlank()) return emptyList()
    return value.lowercase(Locale.ROOT)
        .replace("web-dl", "webdl")
        .replace("web.dl", "webdl")
        .replace("blu-ray", "bluray")
        .split(Regex("[^a-z0-9]+"))
        .filter { it.length >= 2 && it !in NOISE_RELEASE_TOKENS }
}

internal fun extractReleaseGroup(value: String): String? {
    val clean = value.substringBeforeLast('.').trim()
    val match = Regex("-([A-Za-z0-9]{2,14})$").find(clean) ?: return null
    val group = match.groupValues[1].lowercase(Locale.ROOT)
    return group.takeUnless { it in QUALITY_SOURCE_TOKENS || it.all(Char::isDigit) }
}

/** Score how strongly a subtitle candidate release name/label matches the active video stream filename/title. */
internal fun scoreSubtitleReleaseMatch(streamRelease: String?, candidateRelease: String?): Int {
    val streamText = streamRelease.orEmpty().trim()
    val candidateText = candidateRelease.orEmpty().trim()
    if (streamText.isBlank() || candidateText.isBlank()) return 0

    val streamTokens = tokenizeReleaseName(streamText).toSet()
    val candidateTokens = tokenizeReleaseName(candidateText).toSet()
    if (streamTokens.isEmpty() || candidateTokens.isEmpty()) return 0

    var score = 0
    val shared = streamTokens.intersect(candidateTokens)
    for (token in shared) {
        score += when {
            token in QUALITY_SOURCE_TOKENS -> 18
            token.matches(Regex("(19|20)\\d{2}")) -> 12
            else -> 10
        }
    }

    val streamEp = EPISODE_MARKER_REGEX.find(streamText)?.value?.lowercase(Locale.ROOT)
    val candEp = EPISODE_MARKER_REGEX.find(candidateText)?.value?.lowercase(Locale.ROOT)
    if (streamEp != null && candEp != null) {
        score += if (streamEp == candEp) 30 else -40
    }

    val streamGroup = extractReleaseGroup(streamText)
    val candGroup = extractReleaseGroup(candidateText)
    if (streamGroup != null && (candGroup == streamGroup || streamGroup in candidateTokens)) {
        score += 45
    }

    return score.coerceAtLeast(0)
}

internal fun isHearingImpairedSubtitle(label: String, releaseName: String = ""): Boolean {
    val combined = "$label $releaseName".lowercase(Locale.ROOT)
    return Regex("\\b(sdh|hi|hearing\\s*impaired|cc)\\b").containsMatchIn(combined)
}

internal fun isExactReleaseMatchScore(score: Int): Boolean = score >= 55

internal fun rankSubtitlesForStream(
    candidates: List<Subtitle>,
    streamReleaseName: String?
): List<Subtitle> = candidates.sortedWith(
    compareByDescending<Subtitle> { sub ->
        scoreSubtitleReleaseMatch(streamReleaseName, sub.releaseName.ifBlank { sub.label })
    }.thenBy { sub ->
        if (sub.isHearingImpaired || isHearingImpairedSubtitle(sub.label, sub.releaseName)) 1 else 0
    }
)

internal fun pickBestSubtitle(
    candidates: List<Subtitle>,
    preferredLanguages: List<String?>,
    streamReleaseName: String?
): Subtitle? {
    if (candidates.isEmpty()) return null
    val ranked = rankSubtitlesForStream(candidates, streamReleaseName)
    for (lang in preferredLanguages.filterNotNull().filter { it.isNotBlank() }) {
        val exactLang = ranked.filter { canonicalizeLanguageCode(it.language) == canonicalizeLanguageCode(lang) }
        if (exactLang.isNotEmpty()) return exactLang.first()
        val baseLang = ranked.filter { languagesMatch(it.language, lang) }
        if (baseLang.isNotEmpty()) return baseLang.first()
    }
    return null
}
