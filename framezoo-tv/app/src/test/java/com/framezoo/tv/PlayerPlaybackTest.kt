package com.framezoo.tv

import com.framezoo.tv.ui.playbackSpeed
import com.framezoo.tv.ui.playbackFinished
import com.framezoo.tv.ui.subtitleLanguage
import com.framezoo.tv.ui.resolveNextEpisode
import com.framezoo.tv.ui.subtitlePosition
import com.framezoo.tv.ui.secondarySubtitlePosition
import com.framezoo.tv.model.Episode
import com.framezoo.tv.model.SkipSegment
import com.framezoo.tv.player.TorrentLiveStats
import com.framezoo.tv.player.VideoTrack
import com.framezoo.tv.ui.videoTrackQuality
import com.framezoo.tv.ui.preferredVideoTrack
import com.framezoo.tv.ui.activePlaybackSegment
import com.framezoo.tv.ui.playbackSegmentBounds
import com.framezoo.tv.ui.playerLoadingProgress
import com.framezoo.tv.ui.shouldAcceptRenderedFrame
import com.framezoo.tv.ui.shouldAcceptSurfaceFrame
import com.framezoo.tv.ui.skipSegmentVisible
import com.framezoo.tv.ui.segmentEndsAtVideoEnd
import com.framezoo.tv.ui.nextEpisodeVisible
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

    @Test fun loadingProgressUsesDesktopTorrentThresholdAndBuffer() {
        assertEquals(0f, playerLoadingProgress(false, 0.0, 0.0, null), 0.0f)
        assertEquals(50f, playerLoadingProgress(false, 100.0, 50.0, null), 0.0f)
        assertEquals(50f, playerLoadingProgress(false, 0.0, 0.0, TorrentLiveStats(downloadedBytes = 2L * 1024L * 1024L, totalBytes = 20L * 1024L * 1024L)), 0.0f)
        assertEquals(95f, playerLoadingProgress(false, 0.0, 0.0, TorrentLiveStats(downloadedBytes = 8L * 1024L * 1024L, totalBytes = 20L * 1024L * 1024L)), 0.0f)
        assertEquals(100f, playerLoadingProgress(true, 0.0, 0.0, null), 0.0f)
    }

    @Test fun renderedFrameRequiresSurfaceUpdateAndNativeFrame() {
        assertFalse(shouldAcceptRenderedFrame(false, false, true))
        assertFalse(shouldAcceptRenderedFrame(true, true, true))
        assertFalse(shouldAcceptRenderedFrame(true, false, false))
        assertTrue(shouldAcceptRenderedFrame(true, false, true))
    }

    @Test fun surfaceFrameFallbackUsesMovingClockWhenNativeMetadataIsMissing() {
        assertFalse(shouldAcceptSurfaceFrame(true, false, false, 100.0, 0.0))
        assertTrue(shouldAcceptSurfaceFrame(true, false, false, 100.0, 1.0))
        assertFalse(shouldAcceptSurfaceFrame(true, true, true, 100.0, 1.0))
        assertTrue(shouldAcceptSurfaceFrame(true, false, false, 0.0, 0.0, 2))
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

    @Test fun skipSegmentBoundsClampToDurationAndExposeOnlyActiveSegment() {
        val intro = SkipSegment("intro", -1000, 30_000)
        val credits = SkipSegment("credits", 90_000, null)
        assertEquals(0.0, playbackSegmentBounds(intro, 100.0)!!.start, 0.0)
        assertEquals(30.0, playbackSegmentBounds(intro, 100.0)!!.end!!, 0.0)
        assertEquals(credits, activePlaybackSegment(listOf(intro, credits), 95.0, 100.0))
        assertNull(activePlaybackSegment(listOf(intro, credits), 40.0, 100.0))
        assertTrue(skipSegmentVisible(intro, 5.0, 100.0, false))
        assertFalse(skipSegmentVisible(intro, 20.0, 100.0, false))
        assertTrue(skipSegmentVisible(intro, 20.0, 100.0, true))
        assertTrue(segmentEndsAtVideoEnd(credits, 100.0))
        assertTrue(nextEpisodeVisible(94.0, 100.0, false))
        assertFalse(nextEpisodeVisible(60.0, 100.0, false))
    }
}
