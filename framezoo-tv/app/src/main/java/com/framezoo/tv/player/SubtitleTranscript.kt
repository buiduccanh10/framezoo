package com.framezoo.tv.player

internal data class TranscriptCue(val start: Double, val end: Double, val text: String)

private fun subtitleTime(value: String): Double? {
    val parts = value.trim().replace(',', '.').split(':')
    if (parts.size !in 2..3) return null
    val hours = if (parts.size == 3) parts[0].toIntOrNull() ?: return null else 0
    val minutes = parts[parts.size - 2].toIntOrNull() ?: return null
    val seconds = parts.last().toDoubleOrNull() ?: return null
    if (hours < 0 || minutes !in 0..59 || seconds < 0 || seconds >= 60 || !seconds.isFinite()) return null
    return hours * 3600.0 + minutes * 60.0 + seconds
}

private fun plainSubtitleText(text: String): String = text
    .replace(Regex("\\{[^}]*\\}"), "")
    .replace(Regex("<[^>]*>"), "")
    .replace("\\N", " ").replace("\\n", " ").replace("\\h", " ")
    .replace("&nbsp;", " ", true).replace("&lt;", "<", true).replace("&gt;", ">", true)
    .replace("&quot;", "\"", true).replace("&amp;", "&", true)
    .replace(Regex("\\s+"), " ").trim()

// ponytail: text SRT, WebVTT and ASS/SSA only; use a shared subtitle parser for other formats.
internal fun parseSubtitleTranscript(text: String): List<TranscriptCue> {
    val lines = text.removePrefix("\uFEFF").replace("\r\n", "\n").replace('\r', '\n').lines()
    val cues = mutableListOf<TranscriptCue>()
    val timing = Regex("^\\s*(\\d{1,3}:\\d{2}(?::\\d{2})?[.,]\\d{1,3})\\s*-->\\s*(\\d{1,3}:\\d{2}(?::\\d{2})?[.,]\\d{1,3})(?:\\s.*)?$")
    var index = 0
    while (index < lines.size) {
        val match = timing.matchEntire(lines[index])
        if (match == null) { index++; continue }
        val start = subtitleTime(match.groupValues[1])
        val end = subtitleTime(match.groupValues[2])
        val body = mutableListOf<String>()
        index++
        while (index < lines.size && lines[index].isNotBlank()) body += lines[index++]
        val content = plainSubtitleText(body.joinToString(" "))
        if (start != null && end != null && end >= start && content.isNotEmpty()) cues += TranscriptCue(start, end, content)
    }
    if (cues.isNotEmpty()) return cues.sortedBy { it.start }

    var columns: List<String> = emptyList()
    var inEvents = false
    for (line in lines) {
        val trimmed = line.trim()
        if (trimmed.startsWith("[")) { inEvents = trimmed.equals("[Events]", true); continue }
        if (!inEvents) continue
        if (trimmed.startsWith("Format:", true)) columns = trimmed.substringAfter(':').split(',').map { it.trim().lowercase() }
        if (!trimmed.startsWith("Dialogue:", true) || columns.isEmpty()) continue
        val fields = trimmed.substringAfter(':').trim().split(',', limit = columns.size)
        fun field(name: String) = columns.indexOf(name).takeIf { it >= 0 }?.let { fields.getOrNull(it) }
        val start = field("start")?.let(::subtitleTime)
        val end = field("end")?.let(::subtitleTime)
        val content = plainSubtitleText(field("text").orEmpty())
        if (start != null && end != null && end >= start && content.isNotEmpty()) cues += TranscriptCue(start, end, content)
    }
    return cues.sortedBy { it.start }
}
