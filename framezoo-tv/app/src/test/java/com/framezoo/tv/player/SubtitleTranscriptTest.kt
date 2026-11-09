package com.framezoo.tv.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SubtitleTranscriptTest {
    @Test fun parsesSrtVttAndAssAndIgnoresInvalidCues() {
        val srt = """1
00:00:02,500 --> 00:00:04,000
<i>Xin chào</i>
thế giới &amp; bạn

2
00:00:05,000 --> 00:00:04,000
invalid
"""
        assertEquals(listOf(TranscriptCue(2.5, 4.0, "Xin chào thế giới & bạn")), parseSubtitleTranscript(srt))
        val vtt = """WEBVTT

cue-id
00:01.000 --> 00:02.250 align:start
<v Speaker>Hello</v>
"""
        assertEquals(listOf(TranscriptCue(1.0, 2.25, "Hello")), parseSubtitleTranscript(vtt))
        val ass = """[Events]
Format: Layer, Start, End, Style, Text
Dialogue: 0,0:00:03.10,0:00:04.20,Default,{\an8}Line one\NLine two, again
"""
        assertEquals(listOf(TranscriptCue(3.1, 4.2, "Line one Line two, again")), parseSubtitleTranscript(ass))
        assertTrue(parseSubtitleTranscript("not a subtitle").isEmpty())
    }
}
