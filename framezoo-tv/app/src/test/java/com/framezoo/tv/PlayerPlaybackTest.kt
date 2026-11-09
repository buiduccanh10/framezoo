package com.framezoo.tv

import com.framezoo.tv.ui.playbackSpeed
import com.framezoo.tv.ui.playbackFinished
import com.framezoo.tv.ui.subtitleLanguage
import com.framezoo.tv.ui.resolveNextEpisode
import com.framezoo.tv.ui.subtitlePosition
import com.framezoo.tv.ui.secondarySubtitlePosition
import com.framezoo.tv.model.Episode
import com.framezoo.tv.player.VideoTrack
import com.framezoo.tv.ui.videoTrackQuality
import com.framezoo.tv.ui.preferredVideoTrack
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayerPlaybackTest {
    @Test fun speedUsesDesktopRangeAndSteps() {
        assertEquals(0.25, playbackSpeed(0.0), 0.0)
        assertEquals(1.05, playbackSpeed(1.0 + 0.05), 0.0)
        assertEquals(1.25, playbackSpeed(1.23), 0.0)
        assertEquals(3.0, playbackSpeed(4.0), 0.0)
    }

    @Test fun autoplayWaitsForEndOrCreditsThreshold() {
        assertFalse(playbackFinished(99.0, 100.0, false, false))
        assertTrue(playbackFinished(99.0, 100.0, false, true))
        assertTrue(playbackFinished(99.5, 100.0, true, false))
        assertFalse(playbackFinished(0.0, 0.0, true, true))
    }

    @Test fun videoQualityUsesDimensionsAndNearestLowerVariant() {
        val low = VideoTrack("1", 640, 360, 300000, false)
        val high = VideoTrack("2", 1280, 720, 1000000, true)
        assertEquals("360p", videoTrackQuality(low))
        assertEquals("720p", videoTrackQuality(high))
        assertEquals("1080p", videoTrackQuality(VideoTrack("3", 1920, 800, 0, false)))
        assertEquals(high, preferredVideoTrack(listOf(low, high), "1080p"))
        assertEquals(high, preferredVideoTrack(listOf(high), "360p"))
    }

    @Test fun subtitleLanguageGroupsTwoAndThreeLetterCodes() {
        assertEquals("vi", subtitleLanguage("vie"))
        assertEquals("en", subtitleLanguage("EN-us"))
        assertEquals("en", subtitleLanguage("eng"))
        assertEquals("und", subtitleLanguage(""))
    }

    @Test fun subtitleMovesAboveControlsAndUsesSavedPositionWhenHidden() {
        assertEquals(80, subtitlePosition(true, 1))
        assertEquals(80, subtitlePosition(true, 3))
        assertEquals(96, subtitlePosition(false, 1))
        assertEquals(92, subtitlePosition(false, 3))
        assertEquals(68, secondarySubtitlePosition(true, 1))
        assertEquals(80, secondarySubtitlePosition(false, 3))
    }

    @Test fun nextEpisodeUsesNextSeasonOnlyWhenAired() = runBlocking {
        val current = Episode(1, 2, "Current")
        val sameSeason = Episode(1, 3, "Next")
        val aired = Episode(2, 1, "Aired", airDate = "2020-01-01")
        val future = Episode(2, 2, "Future", airDate = "2099-01-01")
        assertEquals(sameSeason, resolveNextEpisode(current, listOf(1, 2)) { if (it == 1) listOf(sameSeason) else listOf(aired) })
        assertEquals(aired, resolveNextEpisode(current, listOf(1, 2)) { if (it == 2) listOf(future, aired) else emptyList() })
        assertNull(resolveNextEpisode(current, listOf(1, 2)) { if (it == 2) listOf(future) else emptyList() })
    }
}
