package com.framezoo.tv.player

import com.framezoo.tv.model.Stream
import java.io.DataOutputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale
import kotlin.coroutines.cancellation.CancellationException
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToLong
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

private val TIMING_LINE_REGEX = Regex(
    "^\\s*(\\d{1,3}:\\d{2}(?::\\d{2})?[.,]\\d{1,3})\\s*-->\\s*(\\d{1,3}:\\d{2}(?::\\d{2})?[.,]\\d{1,3})(.*)$"
)

private val SUBTITLE_AD_PATTERNS = listOf(
    Regex("https?://\\S+", RegexOption.IGNORE_CASE),
    Regex("www\\.\\S+", RegexOption.IGNORE_CASE),
    Regex("\\.(?:org|com|net|link|tv|me)\\b", RegexOption.IGNORE_CASE),
    Regex("\\b(?:opensubtitles|subscene|osdb|addic7ed|podnapisi|yify|rarbg|psa)\\b", RegexOption.IGNORE_CASE),
    Regex("\\b(?:vip\\s+member|remove\\s+all\\s+ads|advertise\\s+your\\s+product|support\\s+us|watch\\s+online|downloaded\\s+from)\\b", RegexOption.IGNORE_CASE),
    Regex("\\b(?:subtitles?|sync(?:ed)?|resync(?:ed)?|corrected|translated|encoded|ripped|released)\\s+by\\b", RegexOption.IGNORE_CASE),
    Regex("\\b(?:subtitles?\\s+(?:downloaded|created|sync)|dịch\\s+bởi|biên\\s+dịch|phụ\\s+đề\\s+bởi|thuyết\\s+minh\\s+bởi|thực\\s+hiện\\s+bởi|vietsub\\s+bởi|chúc\\s+các\\s+bạn\\s+xem\\s+phim\\s+vui\\s+vẻ|phimmoi|xemphim|motphim|bilutv|tvhay)\\b", RegexOption.IGNORE_CASE),
    Regex("\\bosdb\\.link\\b", RegexOption.IGNORE_CASE)
)

internal fun isSubtitleAdOrCredit(text: String?): Boolean {
    val clean = text.orEmpty().replace(Regex("<[^>]*>"), "").trim()
    if (clean.isEmpty()) return false
    return SUBTITLE_AD_PATTERNS.any { it.containsMatchIn(clean) }
}

private fun cleanAssTextForVtt(text: String): String = text
    .replace(Regex("\\{[^}]*\\}"), "")
    .replace("\\N", "\n")
    .replace("\\n", "\n")
    .replace("\\h", " ")
    .trim()

/** Convert SRT, WebVTT, or ASS/SSA subtitle text into canonical WEBVTT for sync/translation. */
internal fun normalizeSubtitleToVtt(rawText: String): String {
    val cleaned = rawText.removePrefix("\uFEFF").replace("\r\n", "\n").replace('\r', '\n').trim()
    if (cleaned.isEmpty()) return "WEBVTT\n\n"

    val lines = cleaned.lines()
    val cues = mutableListOf<String>()
    var i = 0
    while (i < lines.size) {
        val m = TIMING_LINE_REGEX.matchEntire(lines[i])
        if (m == null) {
            i++
            continue
        }
        val startMs = parseSubtitleTimestampMs(m.groupValues[1])
        val endMs = parseSubtitleTimestampMs(m.groupValues[2])
        val settings = m.groupValues[3]
        val body = mutableListOf<String>()
        i++
        while (i < lines.size && lines[i].isNotBlank()) body += lines[i++]
        if (startMs != null && endMs != null && endMs > startMs && body.isNotEmpty()) {
            cues += "${formatVttTimestampMs(startMs)} --> ${formatVttTimestampMs(endMs)}$settings\n${body.joinToString("\n")}"
        }
    }
    if (cues.isNotEmpty()) return "WEBVTT\n\n" + cues.joinToString("\n\n") + "\n"

    var columns = emptyList<String>()
    var inEvents = false
    for (line in lines) {
        val trimmed = line.trim()
        if (trimmed.startsWith("[")) {
            inEvents = trimmed.equals("[Events]", ignoreCase = true)
            continue
        }
        if (!inEvents) continue
        if (trimmed.startsWith("Format:", ignoreCase = true)) {
            columns = trimmed.substringAfter(':').split(',').map { it.trim().lowercase(Locale.ROOT) }
        } else if (trimmed.startsWith("Dialogue:", ignoreCase = true) && columns.isNotEmpty()) {
            val fields = trimmed.substringAfter(':').trim().split(',', limit = columns.size)
            fun field(name: String) = columns.indexOf(name).takeIf { it >= 0 }?.let { fields.getOrNull(it) }
            val startMs = field("start")?.let(::parseSubtitleTimestampMs)
            val endMs = field("end")?.let(::parseSubtitleTimestampMs)
            val text = cleanAssTextForVtt(field("text").orEmpty())
            if (startMs != null && endMs != null && endMs > startMs && text.isNotEmpty()) {
                cues += "${formatVttTimestampMs(startMs)} --> ${formatVttTimestampMs(endMs)}\n$text"
            }
        }
    }
    return if (cues.isEmpty()) "WEBVTT\n\n" else "WEBVTT\n\n" + cues.joinToString("\n\n") + "\n"
}

internal data class SubtitleTimingSegment(val startMs: Double, val endMs: Double, val offsetMs: Double)

internal data class SubtitleAlignmentResult(
    val aligned: Boolean,
    val offsetMs: Double,
    val rateRatio: Double = 1.0,
    val confidence: Double = 0.0,
    val segments: List<SubtitleTimingSegment> = emptyList(),
    val reason: String? = null
)

internal fun normalizeRateRatio(rateRatio: Double?): Double =
    if (rateRatio != null && rateRatio.isFinite() && rateRatio > 0.5 && rateRatio < 2.0) rateRatio else 1.0

private fun splitVttBlocks(vttText: String): List<String> =
    normalizeSubtitleToVtt(vttText).split(Regex("\\r?\\n\\s*\\r?\\n"))

/** Apply desktop-parity uniform or piecewise linear subtitle offset + rate scaling onto VTT cues. */
internal fun applyVttAlignment(vttText: String, alignment: SubtitleAlignmentResult): String {
    if (!alignment.aligned || !alignment.offsetMs.isFinite()) return vttText
    val blocks = splitVttBlocks(vttText)
    val rate = normalizeRateRatio(alignment.rateRatio)
    val sortedSegments = alignment.segments.sortedBy { it.startMs }
    val headerBlocks = mutableListOf<String>()
    val timedBlocks = mutableListOf<Pair<Double, String>>()

    for (block in blocks) {
        val lines = block.lines().toMutableList()
        val timingIndex = lines.indexOfFirst { TIMING_LINE_REGEX.matches(it) }
        if (timingIndex == -1) {
            if (block.isNotBlank()) headerBlocks += block
            continue
        }
        val body = lines.drop(timingIndex + 1).joinToString(" ")
        if (isSubtitleAdOrCredit(body)) continue
        val m = TIMING_LINE_REGEX.matchEntire(lines[timingIndex]) ?: continue
        val start = parseSubtitleTimestampMs(m.groupValues[1])?.toDouble() ?: continue
        val end = parseSubtitleTimestampMs(m.groupValues[2])?.toDouble() ?: continue
        val settings = m.groupValues[3]

        val appliedOffsetMs = when {
            sortedSegments.isEmpty() -> alignment.offsetMs
            else -> resolvePiecewiseOffset(start, sortedSegments, alignment.offsetMs)
        }

        val shiftedStart = max(0.0, start * rate + appliedOffsetMs)
        val shiftedEnd = max(0.0, end * rate + appliedOffsetMs)
        if (shiftedEnd <= shiftedStart) continue

        lines[timingIndex] = "${formatVttTimestampMs(shiftedStart.roundToLong())} --> ${formatVttTimestampMs(shiftedEnd.roundToLong())}$settings"
        timedBlocks += shiftedStart to lines.joinToString("\n")
    }

    val sortedTimed = if (sortedSegments.isNotEmpty()) {
        timedBlocks.sortedBy { it.first }.map { it.second }
    } else {
        timedBlocks.map { it.second }
    }
    return (headerBlocks + sortedTimed).joinToString("\n\n").trimEnd() + "\n"
}

private fun resolvePiecewiseOffset(
    startMs: Double,
    sortedSegments: List<SubtitleTimingSegment>,
    fallbackOffsetMs: Double
): Double {
    for (seg in sortedSegments) {
        if (startMs >= seg.startMs && startMs < seg.endMs) return seg.offsetMs
    }
    if (sortedSegments.size == 1 || startMs < sortedSegments.first().startMs) {
        return sortedSegments.first().offsetMs
    }
    if (startMs >= sortedSegments.last().endMs) {
        return sortedSegments.last().offsetMs
    }
    for (i in 0 until sortedSegments.lastIndex) {
        val s1 = sortedSegments[i]
        val s2 = (i + 1 until sortedSegments.size)
            .map { sortedSegments[it] }
            .firstOrNull { it.startMs >= s1.endMs } ?: sortedSegments[i + 1]
        if (startMs >= s1.endMs && startMs < s2.startMs) {
            val gap = s2.startMs - s1.endMs
            val slope = if (gap > 0.0) (s2.offsetMs - s1.offsetMs) / gap else 0.0
            return s1.offsetMs + slope * (startMs - s1.endMs)
        }
    }
    return fallbackOffsetMs
}

internal data class AlignmentWindowPlan(val startAt: Double, val duration: Double)

private fun computeWindowDuration(videoDuration: Double): Double {
    if (!videoDuration.isFinite() || videoDuration <= 0.0) return 30.0
    if (videoDuration < 30.0) return videoDuration
    return max(15.0, min(30.0, videoDuration / 2.0))
}

private fun clampWindowStart(startAt: Double, videoDuration: Double, windowDuration: Double): Double {
    val s = max(0.0, startAt)
    if (!videoDuration.isFinite() || videoDuration <= 0.0) return s
    return min(s, max(0.0, videoDuration - windowDuration))
}

private fun nudgeToDialogueDenseStart(
    anchor: Double,
    existing: List<AlignmentWindowPlan>,
    dialogueSpans: List<Pair<Double, Double>>,
    videoDuration: Double,
    windowDuration: Double
): Double {
    val clamped = clampWindowStart(anchor, videoDuration, windowDuration)
    if (dialogueSpans.size < 3) return clamped

    val offsets = buildList {
        add(0.0)
        var d = 5.0
        while (d <= 60.0) {
            add(d); add(-d); d += 5.0
        }
    }

    var bestStart: Double? = null
    var bestCount = 0
    var bestSpeech = 0.0
    var bestDist = Double.POSITIVE_INFINITY
    val seen = mutableSetOf<Double>()

    for (offset in offsets) {
        val candidate = clampWindowStart(clamped + offset, videoDuration, windowDuration)
        if (!seen.add(candidate)) continue
        if (existing.any { candidate < it.startAt + it.duration && it.startAt < candidate + windowDuration }) continue

        val winEnd = candidate + windowDuration
        var count = 0
        var speech = 0.0
        for ((s, e) in dialogueSpans) {
            if (e <= candidate || s >= winEnd) continue
            count++
            speech += min(e, winEnd) - max(s, candidate)
        }
        if (count == 0) continue

        val dist = abs(candidate - clamped)
        if (count > bestCount ||
            (count == bestCount && (speech > bestSpeech + 0.5 || (abs(speech - bestSpeech) <= 0.5 && dist < bestDist)))
        ) {
            bestStart = candidate
            bestCount = count
            bestSpeech = speech
            bestDist = dist
        }
    }
    return bestStart ?: clamped
}

internal fun buildAlignmentWindowPlan(
    currentPositionSec: Double,
    videoDurationSec: Double,
    dialogueSpans: List<Pair<Double, Double>>
): List<AlignmentWindowPlan> {
    val winDur = computeWindowDuration(videoDurationSec)
    val anchor1Raw = max(0.0, currentPositionSec - winDur / 3.0)
    val plans = mutableListOf<AlignmentWindowPlan>()
    val start1 = nudgeToDialogueDenseStart(anchor1Raw, plans, dialogueSpans, videoDurationSec, winDur)
    plans += AlignmentWindowPlan(start1, winDur)

    val canAddSecond = !videoDurationSec.isFinite() || videoDurationSec <= 0.0 || videoDurationSec >= winDur * 2.5
    if (canAddSecond) {
        val dur = if (videoDurationSec > 0.0) videoDurationSec else max(currentPositionSec + winDur * 4.0, 600.0)
        val anchor2Raw = if (start1 >= dur * 0.4) {
            min(dur * 0.15, 90.0)
        } else {
            min(dur * 0.7, start1 + max(180.0, winDur * 3.0))
        }
        val start2 = nudgeToDialogueDenseStart(anchor2Raw, plans, dialogueSpans, videoDurationSec, winDur)
        if (plans.none { start2 < it.startAt + it.duration && it.startAt < start2 + winDur }) {
            plans += AlignmentWindowPlan(start2, winDur)
        }
    }
    return plans
}

internal enum class SubtitleSyncStage { EXTRACTING, ANALYZING, APPLYING }

internal data class SubtitleAlignResponse(val alignedVtt: String, val result: SubtitleAlignmentResult)

internal fun parseSubtitleAlignResponse(rawJson: String): SubtitleAlignmentResult? {
    val root = runCatching { JSONObject(rawJson) }.getOrNull() ?: return null
    val results = root.optJSONObject("results") ?: return null
    val primary = results.optJSONObject("primary") ?: return null
    val aligned = primary.optBoolean("aligned", false)
    val offsetMs = primary.optDouble("offsetMs", 0.0)
    val rateRatio = if (primary.has("rateRatio") && !primary.isNull("rateRatio")) primary.optDouble("rateRatio", 1.0) else 1.0
    val confidence = primary.optDouble("confidence", 0.0)
    val reason = primary.optString("reason").ifBlank { null }
    val segArr = primary.optJSONArray("segments")
    val segments = buildList {
        if (segArr != null) {
            for (i in 0 until segArr.length()) {
                val seg = segArr.optJSONObject(i) ?: continue
                add(SubtitleTimingSegment(seg.optDouble("startMs"), seg.optDouble("endMs"), seg.optDouble("offsetMs")))
            }
        }
    }
    return SubtitleAlignmentResult(aligned, offsetMs, rateRatio, confidence, segments, reason)
}

internal suspend fun alignSubtitleWithBackend(
    player: PlayerController,
    stream: Stream,
    rawSubtitleText: String,
    language: String,
    currentPositionSec: Double,
    videoDurationSec: Double,
    audioTrackId: String?,
    backendUrl: String,
    accessToken: String?,
    cacheDir: File,
    onStage: (SubtitleSyncStage, Int, Int) -> Unit
): SubtitleAlignResponse = withContext(Dispatchers.IO) {
    val normalizedVtt = normalizeSubtitleToVtt(rawSubtitleText)
    val cues = parseSubtitleTranscript(normalizedVtt)
    val cueSpans = cues.map { it.start to it.end }
    val plan = buildAlignmentWindowPlan(currentPositionSec, videoDurationSec, cueSpans)
    val wavFiles = mutableListOf<Pair<AlignmentWindowPlan, File>>()
    try {
        plan.forEachIndexed { idx, window ->
            ensureActive()
            onStage(SubtitleSyncStage.EXTRACTING, idx + 1, plan.size)
            val wavFile = File.createTempFile("align-${System.currentTimeMillis()}-$idx-", ".wav", cacheDir)
            val err = player.extractAudio(stream, window.startAt, window.duration, wavFile, audioTrackId)
            if (err == null && wavFile.exists() && wavFile.length() > 44L) {
                wavFiles += window to wavFile
            } else {
                wavFile.delete()
                if (wavFiles.isEmpty() && idx == plan.lastIndex) {
                    throw IllegalStateException(err ?: "Không trích xuất được âm thanh để đồng bộ")
                }
            }
        }
        ensureActive()
        if (wavFiles.isEmpty()) throw IllegalStateException("Không trích xuất được mẫu âm thanh hợp lệ")
        onStage(SubtitleSyncStage.ANALYZING, wavFiles.size, plan.size)

        val responseJson = uploadAlignmentMultipart(
            endpoint = "${backendUrl.trimEnd('/')}/api/subtitle-align",
            vttData = normalizedVtt,
            language = language.ifBlank { "und" },
            windows = wavFiles,
            accessToken = accessToken
        )
        val result = parseSubtitleAlignResponse(responseJson)
            ?: throw IllegalStateException("Phản hồi đồng bộ phụ đề không hợp lệ")
        if (!result.aligned) {
            throw IllegalStateException(result.reason ?: "Không khớp được thoại để căn chỉnh phụ đề")
        }
        onStage(SubtitleSyncStage.APPLYING, wavFiles.size, plan.size)
        val alignedVtt = applyVttAlignment(normalizedVtt, result)
        SubtitleAlignResponse(alignedVtt, result)
    } catch (e: CancellationException) {
        player.cancelExtractAudio()
        throw e
    } finally {
        wavFiles.forEach { (_, file) -> file.delete() }
    }
}

private fun uploadAlignmentMultipart(
    endpoint: String,
    vttData: String,
    language: String,
    windows: List<Pair<AlignmentWindowPlan, File>>,
    accessToken: String?
): String {
    val boundary = "----FrameZooAlign${System.currentTimeMillis()}"
    val conn = (URL(endpoint).openConnection() as HttpURLConnection).apply {
        requestMethod = "POST"
        doOutput = true
        connectTimeout = 20_000
        readTimeout = 90_000
        setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")
        setRequestProperty("Accept", "application/json")
        if (!accessToken.isNullOrBlank()) setRequestProperty("Authorization", "Bearer $accessToken")
    }
    try {
        DataOutputStream(conn.outputStream).use { out ->
            fun writeField(name: String, value: String) {
                out.writeBytes("--$boundary\r\n")
                out.writeBytes("Content-Disposition: form-data; name=\"$name\"\r\n\r\n")
                out.write(value.toByteArray(Charsets.UTF_8))
                out.writeBytes("\r\n")
            }

            val subtitlesJson = JSONArray().put(
                JSONObject().put("track", "primary").put("vttData", vttData)
            ).toString()
            val startsJson = JSONArray().apply {
                windows.forEach { (w, _) -> put((w.startAt * 1000.0).roundToLong()) }
            }.toString()
            val durationsJson = JSONArray().apply {
                windows.forEach { (w, _) -> put((w.duration * 1000.0).roundToLong()) }
            }.toString()

            writeField("subtitles", subtitlesJson)
            writeField("language", language)
            writeField("windowStartsMs", startsJson)
            writeField("windowDurationsMs", durationsJson)

            windows.forEachIndexed { idx, (_, wav) ->
                out.writeBytes("--$boundary\r\n")
                out.writeBytes("Content-Disposition: form-data; name=\"audio\"; filename=\"capture-$idx.wav\"\r\n")
                out.writeBytes("Content-Type: audio/wav\r\n\r\n")
                wav.inputStream().use { input -> input.copyTo(out) }
                out.writeBytes("\r\n")
            }
            out.writeBytes("--$boundary--\r\n")
            out.flush()
        }
        val status = conn.responseCode
        val body = (if (status in 200..299) conn.inputStream else conn.errorStream)
            ?.bufferedReader()?.use { it.readText() }.orEmpty()
        if (status !in 200..299) {
            throw IllegalStateException("HTTP $status: ${body.take(180)}")
        }
        return body
    } finally {
        conn.disconnect()
    }
}
