import unittest
from unittest.mock import patch

from alignment import (
    MIN_ALIGNMENT_CONFIDENCE,
    alignment_result_from_speech,
    evaluate_offset,
    find_best_offset,
    parse_vtt,
)


class AlignmentAlgorithmTests(unittest.TestCase):
    def test_finds_offset_from_multiple_speech_anchors(self):
        vtt = """WEBVTT

00:00:10.000 --> 00:00:13.000
Hello

00:00:20.000 --> 00:00:23.000
Again
"""
        cues = parse_vtt(vtt)
        speech = [(0, 3_000), (10_000, 13_000)]

        evidence = evaluate_offset(cues, speech, -10_000, 0, 30_000)
        offset, score = find_best_offset(cues, speech, 0, 30_000)

        self.assertEqual(evidence.matched_anchors, 2)
        self.assertGreaterEqual(evidence.anchor_coverage, 1.0)
        self.assertAlmostEqual(offset, -10_000, delta=750)
        self.assertGreater(score, 0.7)

    def test_rejects_single_anchor_when_multiple_speech_intervals_exist(self):
        vtt = """WEBVTT

00:00:10.000 --> 00:00:13.000
Hello
"""
        with patch(
            "alignment.find_best_offset",
            return_value=(-10_000, 0.95),
        ):
            result = alignment_result_from_speech(
                parse_vtt(vtt),
                [(0, 3_000), (20_000, 23_000)],
                0,
                30_000,
            )

        self.assertFalse(result["aligned"])
        self.assertEqual(result["confidence"], 95)
        self.assertEqual(result["reason"], "insufficient_speech_anchors")

    def test_rejects_low_confidence_before_apply(self):
        vtt = """WEBVTT

00:00:00.000 --> 00:00:04.000
Hello
"""
        with patch(
            "alignment.find_best_offset",
            return_value=(1_000, (MIN_ALIGNMENT_CONFIDENCE - 1) / 100),
        ):
            result = alignment_result_from_speech(
                parse_vtt(vtt),
                [(0, 4_000)],
                0,
                4_000,
            )

        self.assertFalse(result["aligned"])
        self.assertEqual(result["reason"], "low_alignment_confidence")

    def test_keeps_source_vtt_in_success_response(self):
        vtt = """WEBVTT

00:00:05.000 --> 00:00:09.000
Hello
"""
        with patch(
            "alignment.find_best_offset",
            return_value=(-2_000, 0.95),
        ):
            result = alignment_result_from_speech(
                parse_vtt(vtt),
                [(3_000, 7_000)],
                0,
                10_000,
            )

        self.assertTrue(result["aligned"])
        self.assertEqual(result["offsetMs"], -2_000)
        self.assertNotIn("cleanedVtt", result)


if __name__ == "__main__":
    unittest.main()
