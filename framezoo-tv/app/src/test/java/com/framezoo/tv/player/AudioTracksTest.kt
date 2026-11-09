package com.framezoo.tv.player

import org.junit.Assert.assertEquals
import org.junit.Test

class AudioTracksTest {
    @Test fun readsOnlyValidAudioTracksAndSelection() {
        val properties = mapOf(
            "track-list/count" to "4",
            "track-list/0/type" to "video",
            "track-list/1/type" to "audio", "track-list/1/id" to "2",
            "track-list/1/lang" to "eng", "track-list/1/title" to "Stereo", "track-list/1/selected" to "yes",
            "track-list/2/type" to "audio", "track-list/2/id" to "3",
            "track-list/3/type" to "audio"
        )
        assertEquals(
            listOf(AudioTrack("2", "eng", "Stereo", true), AudioTrack("3", "", "", false)),
            readAudioTracks(properties::get)
        )
        assertEquals(emptyList<AudioTrack>(), readAudioTracks { null })
    }

    @Test fun readsVideoVariantsWithoutCoverArt() {
        val props = mapOf("track-list/count" to "3", "track-list/0/type" to "video", "track-list/0/id" to "1",
            "track-list/0/demux-w" to "640", "track-list/0/demux-h" to "360", "track-list/0/hls-bitrate" to "300000",
            "track-list/1/type" to "video", "track-list/1/id" to "2", "track-list/1/demux-w" to "1280",
            "track-list/1/demux-h" to "720", "track-list/1/selected" to "yes",
            "track-list/2/type" to "video", "track-list/2/id" to "3", "track-list/2/albumart" to "yes")
        assertEquals(listOf(VideoTrack("1", 640, 360, 300000, false), VideoTrack("2", 1280, 720, 0, true)), readVideoTracks(props::get))
    }

    @Test fun readsEmbeddedAndExternalSubtitles() {
        val properties = mapOf(
            "track-list/count" to "3",
            "track-list/0/type" to "audio",
            "track-list/1/type" to "sub", "track-list/1/id" to "1", "track-list/1/lang" to "eng",
            "track-list/1/title" to "English SDH", "track-list/1/selected" to "yes",
            "track-list/2/type" to "sub", "track-list/2/id" to "2", "track-list/2/lang" to "vi",
            "track-list/2/external-filename" to "https://example.test/sub.srt"
        )
        assertEquals(listOf(
            SubtitleTrack("1", "eng", "English SDH", null, true),
            SubtitleTrack("2", "vi", "", "https://example.test/sub.srt", false)
        ), readSubtitleTracks(properties::get))
    }
}
