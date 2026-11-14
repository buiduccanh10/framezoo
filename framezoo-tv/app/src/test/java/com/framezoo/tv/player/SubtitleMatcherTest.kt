package com.framezoo.tv.player

import com.framezoo.tv.model.Subtitle
import com.framezoo.tv.ui.buildMpvSubtitleStyleProperties
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SubtitleMatcherTest {

    @Test
    fun canonicalizesAndMatchesIsoCodesAndVariants() {
        assertEquals("vi", canonicalizeLanguageCode("vie"))
        assertEquals("en", canonicalizeLanguageCode("eng-US"))
        assertEquals("pt-br", canonicalizeLanguageCode("pob"))
        assertEquals("zh-tw", canonicalizeLanguageCode("zh_Hant"))
        assertTrue(languagesMatch("vie", "vi-VN"))
        assertTrue(languagesMatch("fre", "fr"))
        assertFalse(languagesMatch("zh-CN", "zh-TW"))
    }

    @Test
    fun scoresReleaseGroupsAndPicksBestNonHiSubtitle() {
        val stream = "Movie.2024.2160p.WEB-DL.x265.HDR-FLUX.mkv"
        val exactMatch = Subtitle("en", "https://ex/1.srt", "Movie 2024 2160p WEB-DL x265 FLUX", false, "Movie.2024.2160p.WEB-DL.x265-FLUX.srt")
        val hiSameRelease = Subtitle("en", "https://ex/2.srt", "Movie 2024 2160p WEB-DL SDH FLUX", true, "Movie.2024.2160p.WEB-DL.x265-FLUX.srt")
        val otherRelease = Subtitle("en", "https://ex/3.srt", "Movie 2024 720p BluRay-YTS", false, "Movie.2024.720p.BluRay-YTS.srt")

        assertTrue(scoreSubtitleReleaseMatch(stream, exactMatch.releaseName) > scoreSubtitleReleaseMatch(stream, otherRelease.releaseName))
        assertTrue(isExactReleaseMatchScore(scoreSubtitleReleaseMatch(stream, exactMatch.releaseName)))
        assertTrue(isHearingImpairedSubtitle(hiSameRelease.label))

        val picked = pickBestSubtitle(
            candidates = listOf(otherRelease, hiSameRelease, exactMatch),
            preferredLanguages = listOf("vi", "en"),
            streamReleaseName = stream
        )
        assertEquals("https://ex/1.srt", picked?.url)
    }

    @Test
    fun buildsDistinctMpvStylePropertiesForFontStylesAndBlur() {
        val borderProps = buildMpvSubtitleStyleProperties(
            fontSize = 120,
            color = "#80b1fa",
            backgroundOpacity = 0,
            backgroundBlurEnabled = true,
            backgroundBlur = 75,
            fontStyle = "Border",
            borderThickness = 4.0f,
            bold = true,
            verticalPosition = 3,
            secondaryVerticalPosition = 1,
            controlsShown = false
        )
        assertEquals("outline-and-shadow", borderProps["sub-border-style"])
        assertEquals("6.50", borderProps["sub-border-size"])
        assertEquals("3.00", borderProps["sub-blur"])
        assertEquals("yes", borderProps["sub-bold"])
        assertEquals("0", borderProps["sub-shadow-offset"])
        assertEquals("92", borderProps["sub-pos"])
        assertEquals("84", borderProps["secondary-sub-pos"])

        val defaultProps = buildMpvSubtitleStyleProperties(
            fontSize = 100,
            color = "#FFFFFF",
            backgroundOpacity = 50,
            backgroundBlurEnabled = false,
            backgroundBlur = 50,
            fontStyle = "default",
            borderThickness = 1.0f,
            bold = false,
            verticalPosition = 1
        )
        assertEquals("background-box", defaultProps["sub-border-style"])
        assertEquals("0", defaultProps["sub-blur"])
    }
}
