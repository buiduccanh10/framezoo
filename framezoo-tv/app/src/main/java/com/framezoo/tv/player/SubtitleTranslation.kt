package com.framezoo.tv.player

import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import org.json.JSONArray

internal data class TranslationTargetLanguage(val code: String, val name: String)

internal val TRANSLATION_TARGET_LANGUAGES: List<TranslationTargetLanguage> = listOf(
    TranslationTargetLanguage("vi", "Tiếng Việt"),
    TranslationTargetLanguage("en", "English"),
    TranslationTargetLanguage("ja", "日本語"),
    TranslationTargetLanguage("ko", "한국어"),
    TranslationTargetLanguage("zh-CN", "中文 (简体)"),
    TranslationTargetLanguage("zh-TW", "中文 (繁體)"),
    TranslationTargetLanguage("fr", "Français"),
    TranslationTargetLanguage("es", "Español"),
    TranslationTargetLanguage("de", "Deutsch"),
    TranslationTargetLanguage("th", "ไทย"),
    TranslationTargetLanguage("id", "Bahasa Indonesia"),
    TranslationTargetLanguage("ms", "Bahasa Melayu"),
    TranslationTargetLanguage("ru", "Русский"),
    TranslationTargetLanguage("pt", "Português"),
    TranslationTargetLanguage("it", "Italiano"),
    TranslationTargetLanguage("ar", "العربية"),
    TranslationTargetLanguage("hi", "हिन्दी"),
    TranslationTargetLanguage("tr", "Türkçe"),
    TranslationTargetLanguage("pl", "Polski"),
    TranslationTargetLanguage("nl", "Nederlands"),
    TranslationTargetLanguage("sv", "Svenska"),
    TranslationTargetLanguage("no", "Norsk"),
    TranslationTargetLanguage("da", "Dansk"),
    TranslationTargetLanguage("fi", "Suomi"),
    TranslationTargetLanguage("cs", "Čeština"),
    TranslationTargetLanguage("ro", "Română"),
    TranslationTargetLanguage("hu", "Magyar"),
    TranslationTargetLanguage("el", "Ελληνικά"),
    TranslationTargetLanguage("he", "עברית"),
    TranslationTargetLanguage("uk", "Українська"),
    TranslationTargetLanguage("fil", "Filipino"),
    TranslationTargetLanguage("bg", "Български"),
    TranslationTargetLanguage("hr", "Hrvatski"),
    TranslationTargetLanguage("sr", "Српски"),
    TranslationTargetLanguage("sk", "Slovenčina"),
    TranslationTargetLanguage("sl", "Slovenščina"),
    TranslationTargetLanguage("bn", "বাংলা"),
    TranslationTargetLanguage("ta", "தமிழ்"),
    TranslationTargetLanguage("te", "తెలుగు"),
    TranslationTargetLanguage("ur", "اردو"),
    TranslationTargetLanguage("fa", "فارسی"),
    TranslationTargetLanguage("af", "Afrikaans"),
    TranslationTargetLanguage("sq", "Shqip"),
    TranslationTargetLanguage("hy", "Հայերեն"),
    TranslationTargetLanguage("az", "Azərbaycanca"),
    TranslationTargetLanguage("eu", "Euskara"),
    TranslationTargetLanguage("be", "Беларуская"),
    TranslationTargetLanguage("bs", "Bosanski"),
    TranslationTargetLanguage("ca", "Català"),
    TranslationTargetLanguage("et", "Eesti"),
    TranslationTargetLanguage("gl", "Galego"),
    TranslationTargetLanguage("ka", "ქართული"),
    TranslationTargetLanguage("gu", "ગુજરાતી"),
    TranslationTargetLanguage("ht", "Kreyòl ayisyen"),
    TranslationTargetLanguage("is", "Íslenska"),
    TranslationTargetLanguage("ga", "Gaeilge"),
    TranslationTargetLanguage("kn", "ಕನ್ನಡ"),
    TranslationTargetLanguage("lv", "Latviešu"),
    TranslationTargetLanguage("lt", "Lietuvių"),
    TranslationTargetLanguage("mk", "Македонски"),
    TranslationTargetLanguage("mt", "Malti"),
    TranslationTargetLanguage("sw", "Kiswahili"),
    TranslationTargetLanguage("cy", "Cymraeg"),
    TranslationTargetLanguage("yi", "ייִדיש")
)

internal data class VttEditableCue(
    val startMs: Long,
    val endMs: Long,
    val settings: String,
    val text: String
)

private val VTT_TIMING_CAPTURE = Regex(
    "^\\s*(\\d{1,3}:\\d{2}(?::\\d{2})?[.,]\\d{1,3})\\s*-->\\s*(\\d{1,3}:\\d{2}(?::\\d{2})?[.,]\\d{1,3})(.*)$"
)

internal fun parseVttCuesForTranslation(rawSubtitleText: String): List<VttEditableCue> {
    val vtt = normalizeSubtitleToVtt(rawSubtitleText)
    val cues = mutableListOf<VttEditableCue>()
    for (block in vtt.split(Regex("\\r?\\n\\s*\\r?\\n"))) {
        val lines = block.lines()
        val timingIdx = lines.indexOfFirst { VTT_TIMING_CAPTURE.matches(it) }
        if (timingIdx == -1) continue
        val m = VTT_TIMING_CAPTURE.matchEntire(lines[timingIdx]) ?: continue
        val start = parseSubtitleTimestampMs(m.groupValues[1]) ?: continue
        val end = parseSubtitleTimestampMs(m.groupValues[2]) ?: continue
        if (end <= start) continue
        val body = lines.drop(timingIdx + 1).joinToString("\n").trim()
        if (body.isNotEmpty()) cues += VttEditableCue(start, end, m.groupValues[3], body)
    }
    return cues
}

internal fun buildVttFromCues(cues: List<VttEditableCue>): String = buildString {
    append("WEBVTT\n\n")
    for (cue in cues) {
        append(formatVttTimestampMs(cue.startMs))
        append(" --> ")
        append(formatVttTimestampMs(cue.endMs))
        append(cue.settings)
        append('\n')
        append(cue.text)
        append("\n\n")
    }
}

internal fun parseGoogleTranslateSingleResponse(jsonPayload: String): String {
    val root = JSONArray(jsonPayload)
    val sentences = root.optJSONArray(0) ?: return ""
    return buildString {
        for (i in 0 until sentences.length()) {
            val part = sentences.optJSONArray(i)?.optString(0).orEmpty()
            append(part)
        }
    }
}

private const val BATCH_SEPARATOR = "\n[[FZT_9918]]\n"

internal class GoogleSubtitleTranslator(
    private val endpointBaseUrl: String = "https://translate.googleapis.com/translate_a/single"
) {
    private val cache = ConcurrentHashMap<String, String>()

    suspend fun translateSubtitleText(
        rawSubtitleText: String,
        targetLang: String,
        onProgress: (Int, Int) -> Unit = { _, _ -> }
    ): String = withContext(Dispatchers.IO) {
        val cues = parseVttCuesForTranslation(rawSubtitleText)
        if (cues.isEmpty()) throw IllegalStateException("Phụ đề không có nội dung để dịch")

        val translatedCues = cues.toMutableList()
        val pendingIndices = mutableListOf<Int>()
        for (idx in cues.indices) {
            val key = "$targetLang::${cues[idx].text}"
            val cached = cache[key]
            if (cached != null) {
                translatedCues[idx] = cues[idx].copy(text = cached)
            } else {
                pendingIndices += idx
            }
        }
        onProgress(cues.size - pendingIndices.size, cues.size)

        var pos = 0
        val batchSize = 20
        while (pos < pendingIndices.size) {
            currentCoroutineContext().ensureActive()
            val end = minOf(pos + batchSize, pendingIndices.size)
            val slice = pendingIndices.subList(pos, end)
            val batchTexts = slice.map { cues[it].text }
            val translatedBatch = translateBatchOrFallback(batchTexts, targetLang)
            for (j in slice.indices) {
                val cueIdx = slice[j]
                val translated = translatedBatch[j].ifBlank { cues[cueIdx].text }
                cache["$targetLang::${cues[cueIdx].text}"] = translated
                translatedCues[cueIdx] = cues[cueIdx].copy(text = translated)
            }
            pos = end
            onProgress(cues.size - (pendingIndices.size - pos), cues.size)
            if (pos < pendingIndices.size) delay(150)
        }
        buildVttFromCues(translatedCues)
    }

    private suspend fun translateBatchOrFallback(texts: List<String>, targetLang: String): List<String> {
        if (texts.size > 1) {
            val joined = texts.joinToString(BATCH_SEPARATOR)
            val attempt = runCatching { requestTranslate(joined, targetLang) }.getOrNull()
            if (attempt != null) {
                val parts = attempt.split(Regex("\\s*\\[\\[FZT_9918]]\\s*"))
                if (parts.size == texts.size) return parts.map { it.trim() }
            }
        }
        return texts.map { text ->
            currentCoroutineContext().ensureActive()
            translateWithRetry(text, targetLang)
        }
    }

    private suspend fun translateWithRetry(text: String, targetLang: String): String {
        var lastErr: Throwable? = null
        repeat(3) { attempt ->
            currentCoroutineContext().ensureActive()
            try {
                return requestTranslate(text, targetLang).trim()
            } catch (e: CancellationException) {
                throw e
            } catch (t: Throwable) {
                lastErr = t
                if (attempt < 2) delay(350)
            }
        }
        throw IllegalStateException("Dịch phụ đề thất bại: ${lastErr?.message ?: "Lỗi mạng"}", lastErr)
    }

    private fun requestTranslate(text: String, targetLang: String): String {
        val url = "$endpointBaseUrl?client=gtx&sl=auto&tl=${URLEncoder.encode(targetLang, "UTF-8")}&dt=t"
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            doOutput = true
            connectTimeout = 12_000
            readTimeout = 20_000
            setRequestProperty("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8")
            setRequestProperty("Accept", "application/json")
        }
        return try {
            val body = "q=${URLEncoder.encode(text, "UTF-8")}"
            conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            val code = conn.responseCode
            val payload = (if (code in 200..299) conn.inputStream else conn.errorStream)
                ?.bufferedReader()?.use { it.readText() }.orEmpty()
            if (code !in 200..299) throw IllegalStateException("HTTP $code")
            parseGoogleTranslateSingleResponse(payload)
        } finally {
            conn.disconnect()
        }
    }
}
