import unittest
import numpy as np
from fft_align import find_best_offset_fft, intervals_to_signal
from split_align import compute_piecewise_segments
from vad import merge_speech_intervals


class VadFftTests(unittest.TestCase):
    def test_merge_speech_intervals(self):
        # Merges close intervals
        raw = [(100, 200), (250, 400), (900, 1100)]
        merged = merge_speech_intervals(raw, min_duration_ms=50, merge_gap_ms=100)
        self.assertEqual(merged, [(100, 400), (900, 1100)])

    def test_fft_cross_correlate_positive_offset(self):
        # Speech occurs at 10s to 15s and 25s to 30s
        speech = [(10_000, 15_000), (25_000, 30_000)]
        # Subtitles occur 2.5s earlier (at 7.5s and 22.5s)
        # Expected offset is +2500ms
        subs = [(7_500, 12_500), (22_500, 27_500)]

        offset_ms, conf, ratio = find_best_offset_fft(
            speech_intervals=speech,
            subtitle_intervals=subs,
            audio_start_ms=0,
            audio_end_ms=60_000,
            max_offset_ms=45_000,
        )
        self.assertAlmostEqual(offset_ms, 2500, delta=25)
        self.assertGreaterEqual(conf, 90.0)
        self.assertEqual(ratio, 1.0)

    def test_fft_cross_correlate_negative_offset(self):
        # Speech occurs at 10s to 15s
        speech = [(10_000, 15_000)]
        # Subtitles occur 5s later (at 15s) -> offset should be -5000ms
        subs = [(15_000, 20_000)]

        offset_ms, conf, ratio = find_best_offset_fft(
            speech_intervals=speech,
            subtitle_intervals=subs,
            audio_start_ms=0,
            audio_end_ms=60_000,
            max_offset_ms=45_000,
        )
        self.assertAlmostEqual(offset_ms, -5000, delta=25)
        self.assertGreaterEqual(conf, 90.0)

    def test_fft_framerate_ratio_detection(self):
        # Subtitle was created at 25fps, but video is 23.976fps
        # Time expands by ratio ~ 25.0 / 23.976
        ratio = 25.0 / 23.976
        speech = [(10_000, 15_000), (30_000, 35_000), (50_000, 55_000)]
        subs = [(int(s / ratio), int(e / ratio)) for s, e in speech]

        offset_ms, conf, detected_ratio = find_best_offset_fft(
            speech_intervals=speech,
            subtitle_intervals=subs,
            audio_start_ms=0,
            audio_end_ms=60_000,
            max_offset_ms=45_000,
            try_framerate_ratios=True,
        )
        self.assertAlmostEqual(detected_ratio, ratio, places=2)
        self.assertAlmostEqual(offset_ms, 0, delta=50)

    def test_split_piecewise_detection(self):
        # Window 1 (0 to 60s): offset +2000ms
        # Window 2 (60 to 120s): offset +2100ms
        # Window 3 (300 to 360s): commercial break happened, offset is now +17000ms
        # Window 4 (360 to 420s): offset +17100ms
        windows = [
            {"startAt": 0, "result": {"aligned": True, "offsetMs": 2000, "confidence": 95}},
            {"startAt": 60, "result": {"aligned": True, "offsetMs": 2100, "confidence": 90}},
            {"startAt": 300, "result": {"aligned": True, "offsetMs": 17000, "confidence": 92}},
            {"startAt": 360, "result": {"aligned": True, "offsetMs": 17100, "confidence": 94}},
        ]
        segments = compute_piecewise_segments(windows, global_offset_ms=2050)
        self.assertEqual(len(segments), 2)
        self.assertAlmostEqual(segments[0]["offsetMs"], 2050, delta=100)
        self.assertAlmostEqual(segments[1]["offsetMs"], 17050, delta=100)
        self.assertEqual(segments[0]["startMs"], 0)
        self.assertEqual(segments[1]["endMs"], 9_007_199_254_740_991)


if __name__ == "__main__":
    unittest.main()
