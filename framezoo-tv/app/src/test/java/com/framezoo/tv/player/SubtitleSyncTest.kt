package com.framezoo.tv.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SubtitleSyncTest {

    @Test
    fun normalizesSrtAndAssToVttAndFiltersAdsOnAlignment() {
        val srt = """1
00:00:05,000 --> 00:00:07,000
OpenSubtitles.org - free subtitles

2
00:00:10,000 --> 00:00:12,500
Hello world
"""
        val vtt = normalizeSubtitleToVtt(srt)
        assertTrue(vtt.startsWith("WEBVTT"))
        assertTrue(vtt.contains("00:00:10.000 --> 00:00:12.500"))

        val shifted = applyVttAlignment(
            vtt,
            SubtitleAlignmentResult(aligned = true, offsetMs = 1500.0, rateRatio = 1.0)
        )
        assertTrue(!shifted.contains("OpenSubtitles.org"))
        assertTrue(shifted.contains("00:00:11.500 --> 00:00:14.000"))

        val ass = """[Events]
Format: Layer, Start, End, Style, Text
Dialogue: 0,0:00:02.50,0:00:04.00,Default,{\b1}Xin chào\NThế giới
"""
        val vttFromAss = normalizeSubtitleToVtt(ass)
        assertTrue(vttFromAss.contains("00:00:02.500 --> 00:00:04.000"))
        assertTrue(vttFromAss.contains("Xin chào\nThế giới"))
    }

    @Test
    fun appliesPiecewiseInterpolationAndRateRatio() {
        val vtt = """WEBVTT

00:00:10.000 --> 00:00:12.000
Early

00:00:25.000 --> 00:00:27.000
Gap middle

00:01:00.000 --> 00:01:02.000
Late
"""
        val aligned = applyVttAlignment(
            vtt,
            SubtitleAlignmentResult(
                aligned = true,
                offsetMs = 0.0,
                rateRatio = 1.0,
                segments = listOf(
                    SubtitleTimingSegment(10_000.0, 20_000.0, 1_000.0),
                    SubtitleTimingSegment(30_000.0, 40_000.0, 3_000.0)
                )
            )
        )
        assertTrue(aligned.contains("00:00:11.000 --> 00:00:13.000"))
        assertTrue(aligned.contains("00:00:27.000 --> 00:00:29.000"))
        assertTrue(aligned.contains("00:01:03.000 --> 00:01:05.000"))
    }

    @Test
    fun plansDialogueDenseNonOverlappingWindowsAndParsesResponse() {
        val cues = (0 until 12).map { idx ->
            val start = 40.0 + idx * 3.0
            start to (start + 2.0)
        } + listOf(260.0 to 263.0, 264.0 to 267.0, 268.0 to 271.0)
        val plan = buildAlignmentWindowPlan(currentPositionSec = 10.0, videoDurationSec = 600.0, dialogueSpans = cues)
        assertEquals(2, plan.size)
        assertTrue(plan[0].startAt >= 15.0)
        assertTrue(plan[0].startAt + plan[0].duration <= plan[1].startAt || plan[1].startAt + plan[1].duration <= plan[0].startAt)

        val json = """{"results":{"primary":{"aligned":true,"offsetMs":-1250,"rateRatio":1.002,"confidence":0.94,"segments":[{"startMs":0,"endMs":60000,"offsetMs":-1250}]}}}"""
        val parsed = parseSubtitleAlignResponse(json)
        assertNotNull(parsed)
        assertEquals(true, parsed?.aligned)
        assertEquals(-1250.0, parsed?.offsetMs ?: 0.0, 0.01)
        assertEquals(1, parsed?.segments?.size)
    }
}
