import struct
import unittest
from unittest.mock import patch

from app import (
    MIN_ALIGNMENT_CONFIDENCE,
    align_vtt_batch,
    alignment_result_from_speech,
    decode_wav,
    evaluate_offset,
    find_best_offset,
    normalize_language,
    parse_batch_subtitles,
    parse_vtt,
)
def make_extensible_pcm_wav(
    samples: list[tuple[int, ...]],
    sample_rate: int = 16_000,
) -> bytes:
    channels = len(samples[0])
    frames = b"".join(
        b"".join(int(sample).to_bytes(2, "little", signed=True) for sample in frame)
        for frame in samples
    )
    pcm_subformat = bytes.fromhex("0100000000001000800000aa00389b71")
    fmt = struct.pack(
        "<HHIIHHH",
        0xFFFE,
        channels,
        sample_rate,
        sample_rate * channels * 2,
        channels * 2,
        16,
        22,
    )
    fmt += struct.pack("<H", 16)
    fmt += struct.pack("<I", channels)
    fmt += pcm_subformat
    riff_payload = (
        b"WAVE"
        + b"fmt "
        + struct.pack("<I", len(fmt))
        + fmt
        + b"data"
        + struct.pack("<I", len(frames))
        + frames
    )
    return b"RIFF" + struct.pack("<I", len(riff_payload)) + riff_payload


class AlignmentTests(unittest.TestCase):
    def test_decodes_extensible_pcm_wav(self):
        wav = make_extensible_pcm_wav([(32767, -32768), (0, 16384)])

        samples, sample_rate = decode_wav(wav)

        self.assertEqual(sample_rate, 16_000)
        self.assertEqual(len(samples), 2)
        self.assertAlmostEqual(samples[0], -0.0000152588, places=5)
        self.assertAlmostEqual(samples[1], 0.25, places=5)

    def test_normalizes_iso_639_3_language_codes(self):
        self.assertEqual(normalize_language("eng"), "en")
        self.assertEqual(normalize_language("vie-VN"), "vi")

    def test_finds_offset_when_subtitle_has_leading_ad(self):
        vtt = """WEBVTT

00:00:00.000 --> 00:00:05.000
Subscribe now

00:00:30.000 --> 00:00:34.000
Hello

00:00:35.000 --> 00:00:39.000
How are you?
"""
        cues = parse_vtt(vtt)
        speech = [(0, 4_000), (5_000, 9_000)]

        offset_ms, score = find_best_offset(cues, speech, 0, 20_000)

        self.assertAlmostEqual(offset_ms, -30_000, delta=750)
        self.assertGreater(score, 0.4)

    def test_scores_multiple_speech_anchors_in_order(self):
        vtt = """WEBVTT

00:00:10.000 --> 00:00:13.000
Hello

00:00:20.000 --> 00:00:23.000
Again
"""
        cues = parse_vtt(vtt)
        speech = [(0, 3_000), (10_000, 13_000)]

        evidence = evaluate_offset(cues, speech, -10_000, 0, 30_000)

        self.assertEqual(evidence.matched_anchors, 2)
        self.assertEqual(evidence.speech_anchor_count, 2)
        self.assertGreaterEqual(evidence.anchor_coverage, 1.0)
        self.assertGreater(evidence.score, 0.7)

    def test_reduces_score_when_only_one_of_multiple_speech_anchors_matches(self):
        vtt = """WEBVTT

00:00:10.000 --> 00:00:13.000
Hello

00:00:50.000 --> 00:00:53.000
Again
"""
        cues = parse_vtt(vtt)
        speech = [(0, 3_000), (10_000, 13_000)]

        evidence = evaluate_offset(cues, speech, -10_000, 0, 30_000)

        self.assertEqual(evidence.matched_anchors, 1)
        full_match = evaluate_offset(
            cues,
            speech[:1],
            -10_000,
            0,
            30_000,
        )
        self.assertLess(evidence.score, full_match.score)

    def test_matches_speech_anchors_in_subtitle_order(self):
        speech = [(0, 3_000), (10_000, 13_000)]
        subtitle_intervals = [(0, 3_000), (10_000, 13_000)]

        from alignment import match_speech_anchors

        matched, errors = match_speech_anchors(speech, subtitle_intervals)

        self.assertEqual(matched, 2)
        self.assertEqual(errors, [0, 0])

    def test_batch_alignment_transcribes_audio_once_for_both_tracks(self):
        primary_vtt = """WEBVTT

00:00:00.000 --> 00:00:04.000
Hello
"""
        secondary_vtt = """WEBVTT

00:00:10.000 --> 00:00:14.000
Xin chao
"""

        with (
            patch("app.decode_wav", return_value=([0.0] * 20_000, 1_000)),
            patch(
                "app.transcribe_speech_intervals",
                return_value=[(0, 4_000)],
            ) as transcribe,
        ):
            result = align_vtt_batch(
                b"wav",
                [
                    {"track": "primary", "vttData": primary_vtt},
                    {"track": "secondary", "vttData": secondary_vtt},
                ],
                "en",
                0,
            )

        self.assertEqual(transcribe.call_count, 1)
        self.assertTrue(result["results"]["primary"]["aligned"])
        self.assertTrue(result["results"]["secondary"]["aligned"])
        self.assertAlmostEqual(
            result["results"]["secondary"]["offsetMs"],
            -10_000,
            delta=750,
        )

    def test_batch_alignment_keeps_other_track_when_one_vtt_is_invalid(self):
        primary_vtt = """WEBVTT

00:00:00.000 --> 00:00:04.000
Hello
"""
        invalid_vtt = """WEBVTT

not-a-timestamp --> 00:00:04.000
Broken
"""

        with (
            patch("app.decode_wav", return_value=([0.0] * 20_000, 1_000)),
            patch(
                "app.transcribe_speech_intervals",
                return_value=[(0, 4_000)],
            ),
        ):
            result = align_vtt_batch(
                b"wav",
                [
                    {"track": "primary", "vttData": primary_vtt},
                    {"track": "secondary", "vttData": invalid_vtt},
                ],
                "en",
                0,
            )

        self.assertTrue(result["results"]["primary"]["aligned"])
        self.assertFalse(result["results"]["secondary"]["aligned"])
        self.assertEqual(result["results"]["secondary"]["reason"], "invalid_subtitle")

    def test_rejects_alignment_below_confidence_threshold(self):
        with patch(
            "app.find_best_offset",
            return_value=(1_000, (MIN_ALIGNMENT_CONFIDENCE - 1) / 100),
        ):
            result = alignment_result_from_speech(
                parse_vtt(
                    """WEBVTT

00:00:00.000 --> 00:00:04.000
Hello
"""
                ),
                [(0, 4_000)],
                0,
                4_000,
            )

        self.assertEqual(result["confidence"], MIN_ALIGNMENT_CONFIDENCE - 1)
        self.assertFalse(result["aligned"])
        self.assertEqual(result["reason"], "low_alignment_confidence")

    def test_alignment_response_keeps_original_vtt_for_renderer_consensus(self):
        vtt = """WEBVTT

00:00:05.000 --> 00:00:09.000
Hello
"""
        with patch(
            "app.find_best_offset",
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

    def test_rejects_alignment_at_search_boundary(self):
        with patch(
            "app.find_best_offset",
            return_value=(45_000, 0.95),
        ):
            result = alignment_result_from_speech(
                parse_vtt(
                    """WEBVTT

00:00:00.000 --> 00:00:04.000
Hello
"""
                ),
                [(0, 4_000)],
                0,
                4_000,
            )

        self.assertFalse(result["aligned"])
        self.assertEqual(result["offsetMs"], 0)
        self.assertEqual(result["confidence"], 95)
        self.assertEqual(result["reason"], "offset_out_of_range")

    def test_rejects_alignment_without_enough_speech_anchors(self):
        with patch(
            "app.find_best_offset",
            return_value=(-10_000, 0.95),
        ):
            result = alignment_result_from_speech(
                parse_vtt(
                    """WEBVTT

00:00:10.000 --> 00:00:13.000
Hello
"""
                ),
                [(0, 3_000), (20_000, 23_000)],
                0,
                30_000,
            )

        self.assertFalse(result["aligned"])
        self.assertEqual(result["reason"], "insufficient_speech_anchors")

    def test_requires_two_thirds_coverage_for_many_speech_anchors(self):
        vtt = """WEBVTT

00:00:10.000 --> 00:00:13.000
Hello

00:00:20.000 --> 00:00:23.000
Again
"""
        with patch(
            "app.find_best_offset",
            return_value=(-10_000, 0.95),
        ):
            result = alignment_result_from_speech(
                parse_vtt(vtt),
                [
                    (0, 3_000),
                    (10_000, 13_000),
                    (20_000, 23_000),
                    (30_000, 33_000),
                ],
                0,
                40_000,
            )

        self.assertFalse(result["aligned"])
        self.assertEqual(result["reason"], "insufficient_speech_anchors")

    def test_parses_batch_subtitles(self):
        subtitles = parse_batch_subtitles(
            '[{"track":"primary","vttData":"WEBVTT"},'
            '{"track":"secondary","vttData":"WEBVTT"}]'
        )

        self.assertEqual([item["track"] for item in subtitles], ["primary", "secondary"])


if __name__ == "__main__":
    unittest.main()
