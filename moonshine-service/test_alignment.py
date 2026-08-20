import unittest
from unittest.mock import patch

from alignment import (
    MIN_ALIGNMENT_CONFIDENCE,
    align_speech_batch,
    align_speech_windows,
    align_vtt_windows,
    alignment_result_from_speech,
    compute_track_search_centers,
    evaluate_offset,
    find_best_offset,
    is_malformed_encoding_cue,
    parse_alignment_cues,
    parse_vtt,
    select_alignment_consensus,
)


class AlignmentAlgorithmTests(unittest.TestCase):
    @staticmethod
    def make_aligned_result(offset_ms: int, confidence: int = 90):
        return {
            "aligned": True,
            "offsetMs": offset_ms,
            "confidence": confidence,
            "speechIntervals": [{"startMs": 0, "endMs": 4_000}],
            "reason": None,
        }

    def test_selects_consensus_on_server(self):
        result = select_alignment_consensus(
            [
                {
                    "startAt": 0,
                    "result": self.make_aligned_result(-2_000, 80),
                },
                {
                    "startAt": 60,
                    "result": self.make_aligned_result(-2_300, 70),
                },
                {
                    "startAt": 120,
                    "result": self.make_aligned_result(30_000, 100),
                },
            ]
        )

        self.assertTrue(result["aligned"])
        self.assertEqual(result["offsetMs"], -2_150)
        self.assertEqual(result["confidence"], 75)

    def test_builds_piecewise_result_on_server(self):
        result = select_alignment_consensus(
            [
                {
                    "startAt": 0,
                    "result": self.make_aligned_result(-104_000, 96),
                },
                {
                    "startAt": 473,
                    "result": self.make_aligned_result(2_500, 94),
                },
                {
                    "startAt": 1_104,
                    "result": self.make_aligned_result(2_500, 90),
                },
            ]
        )

        self.assertTrue(result["aligned"])
        self.assertEqual(result["offsetMs"], 2_500)
        self.assertEqual(result["segments"][0]["offsetMs"], -104_000)
        self.assertEqual(result["segments"][1]["offsetMs"], 2_500)

    def test_aligns_all_uploaded_windows_before_server_consensus(self):
        window_results = [
            {"results": {"primary": self.make_aligned_result(-2_000, 80)}},
            {"results": {"primary": self.make_aligned_result(-2_300, 70)}},
        ]
        with patch(
            "alignment.align_speech_batch",
            side_effect=window_results,
        ) as align_batch:
            result = align_speech_windows(
                [
                    ([(0, 4_000)], 0, 60_000),
                    ([(600_000, 604_000)], 600_000, 660_000),
                ],
                [{"track": "primary", "vttData": "WEBVTT"}],
            )

        self.assertEqual(align_batch.call_count, 2)
        self.assertTrue(result["results"]["primary"]["aligned"])
        self.assertEqual(result["results"]["primary"]["offsetMs"], -2_150)

    def test_audio_windows_transcribe_then_use_the_same_speech_core(self):
        with (
            patch(
                "alignment.decode_wav",
                side_effect=[
                    ([0.0] * 1_000, 1_000),
                    ([0.0] * 1_000, 1_000),
                ],
            ),
            patch(
                "alignment.transcribe_speech_intervals",
                side_effect=[
                    [(0, 4_000)],
                    [(600_000, 604_000)],
                ],
            ),
            patch(
                "alignment.align_speech_batch",
                side_effect=[
                    {"results": {"primary": self.make_aligned_result(-2_000, 80)}},
                    {"results": {"primary": self.make_aligned_result(-2_300, 70)}},
                ],
            ) as align_batch,
        ):
            result = align_vtt_windows(
                [(b"first", 0), (b"second", 600_000)],
                [{"track": "primary", "vttData": "WEBVTT"}],
                "en",
            )

        self.assertEqual(align_batch.call_count, 2)
        self.assertEqual(
            align_batch.call_args_list[0].args[:3],
            ([(0, 4_000)], [{"track": "primary", "vttData": "WEBVTT"}], 0),
        )
        self.assertTrue(result["results"]["primary"]["aligned"])

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

    def test_prefers_subtitle_start_alignment_over_end_only_match(self):
        speech = [(11_000, 15_000)]

        for early_ms in (500, 1_500):
            with self.subTest(early_ms=early_ms):
                cue_start_ms = 11_000 - early_ms
                cue_start_seconds, cue_start_millis = divmod(
                    cue_start_ms,
                    1_000,
                )
                cues = parse_vtt(
                    f"""WEBVTT

00:00:{cue_start_seconds:02d}.{cue_start_millis:03d} --> 00:00:15.000
Dialogue
"""
                )
                expected_offset = early_ms

                early_evidence = evaluate_offset(
                    cues,
                    speech,
                    0,
                    0,
                    20_000,
                )
                corrected_evidence = evaluate_offset(
                    cues,
                    speech,
                    expected_offset,
                    0,
                    20_000,
                )
                offset, _ = find_best_offset(
                    cues,
                    speech,
                    0,
                    20_000,
                )

                self.assertGreater(
                    corrected_evidence.score,
                    early_evidence.score,
                )
                self.assertAlmostEqual(
                    offset,
                    expected_offset,
                    delta=750,
                )

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

    def test_rejects_window_with_insufficient_speech_duration(self):
        vtt = """WEBVTT

00:00:05.000 --> 00:00:09.000
Hello
"""
        result = alignment_result_from_speech(
            parse_vtt(vtt),
            [(1_000, 1_500)],  # Only 500ms speech duration (< 1000ms)
            0,
            10_000,
        )

        self.assertFalse(result["aligned"])
        self.assertEqual(result["confidence"], 0)
        self.assertEqual(result["reason"], "insufficient_speech_in_window")

    def test_finds_large_offset_with_relative_search_center(self):
        # Secondary sub has dialogue at 02:00 (120s), while audio has dialogue at 00:17 (17s)
        # Delta offset is 17s - 120s = -103s (-103_000ms)
        vtt = """WEBVTT

00:02:00.000 --> 00:02:04.000
Hello

00:02:10.000 --> 00:02:14.000
World
"""
        cues = parse_vtt(vtt)
        speech = [(17_000, 21_000), (27_000, 31_000)]

        offset, score = find_best_offset(
            cues,
            speech,
            17_000,
            47_000,
            search_centers=[0, -103_000],
        )

        self.assertAlmostEqual(offset, -103_000, delta=750)
        self.assertGreater(score, 0.7)

        result = alignment_result_from_speech(
            cues,
            speech,
            17_000,
            47_000,
            search_centers=[0, -103_000],
        )

        self.assertTrue(result["aligned"])
        self.assertAlmostEqual(result["offsetMs"], -103_000, delta=750)

    def test_estimate_subtitle_relative_offset_with_credit_cues(self):
        primary_vtt = """WEBVTT

00:00:01.000 --> 00:00:04.000
Subtitle by Subscene

00:00:17.000 --> 00:00:21.000
Hello

00:00:27.000 --> 00:00:31.000
World

00:00:37.000 --> 00:00:41.000
Again
"""
        secondary_vtt = """WEBVTT

00:00:02.000 --> 00:00:05.000
Dịch bởi PhimMoi

00:02:00.000 --> 00:02:04.000
Hello

00:02:10.000 --> 00:02:14.000
World

00:02:20.000 --> 00:02:24.000
Again
"""
        from alignment import estimate_subtitle_relative_offset

        offset = estimate_subtitle_relative_offset(
            parse_vtt(primary_vtt),
            parse_vtt(secondary_vtt),
        )
        self.assertIsNotNone(offset)
        self.assertAlmostEqual(offset, -103_000, delta=750)

    def test_estimate_subtitle_relative_offset_dexter_screenshot(self):
        primary_vtt = """WEBVTT

00:00:11.000 --> 00:00:15.000
Máu. Đôi khi nó làm tôi ghê cả răng.

00:00:15.000 --> 00:00:19.000
Các lần khác nó giúp tôi kiểm soát sự hỗn loạn.

00:00:20.000 --> 00:00:22.000
Trong mùa trước...

00:00:22.000 --> 00:00:25.000
Chính là đêm nay. Chuyện đó sẽ tiếp tục xảy ra.

00:00:26.000 --> 00:00:29.000
Mở mắt ra mà xem mày đã làm gì.

00:00:29.000 --> 00:00:32.000
Làm ơn hãy hiểu cho tôi.
"""
        secondary_vtt = """WEBVTT

00:00:06.000 --> 00:00:10.000
Watch Online Movies and Series for FREE www.osdb.link/lm

00:01:57.000 --> 00:02:01.000
Blood. Sometimes, it sets my teeth on edge.

00:02:01.000 --> 00:02:05.000
Other times, it helps me control the chaos.

00:02:06.000 --> 00:02:08.000
Last season on Dexter...

00:02:08.000 --> 00:02:11.000
Tonight's the night and it's going to happen again,

00:02:11.000 --> 00:02:14.000
and again.
"""
        from alignment import estimate_subtitle_relative_offset

        offset = estimate_subtitle_relative_offset(
            parse_vtt(primary_vtt),
            parse_vtt(secondary_vtt),
        )
        self.assertIsNotNone(offset)
        # 11s - 117s = -106s = -106_000ms
        self.assertAlmostEqual(offset, -106_000, delta=750)

    def test_estimate_subtitle_relative_offset_vip_member_ad(self):
        primary_vtt = """WEBVTT

00:00:11.000 --> 00:00:15.000
Máu. Đôi khi nó làm tôi ghê cả răng.

00:00:15.000 --> 00:00:19.000
Các lần khác nó giúp tôi kiểm soát sự hỗn loạn.
"""
        secondary_vtt = """WEBVTT

00:00:08.000 --> 00:00:12.000
Support us and become VIP member to remove all ads from www.OpenSubtitles.org

00:01:57.000 --> 00:02:01.000
Blood. Sometimes, it sets my teeth on edge.

00:02:01.000 --> 00:02:05.000
Other times, it helps me control the chaos.
"""
        from alignment import estimate_subtitle_relative_offset

        offset = estimate_subtitle_relative_offset(
            parse_vtt(primary_vtt),
            parse_vtt(secondary_vtt),
        )
        self.assertIsNotNone(offset)
        self.assertAlmostEqual(offset, -106_000, delta=750)

    def test_align_speech_windows_dual_subtitles(self):
        primary_vtt = """WEBVTT

00:00:10.000 --> 00:00:14.000
Hello world

00:01:10.000 --> 00:01:14.000
Second dialogue
"""
        secondary_vtt = """WEBVTT

00:00:12.000 --> 00:00:16.000
Xin chao the gioi

00:01:12.000 --> 00:01:16.000
Doan thoai thu hai
"""
        # Speech at 10s and 70s
        windows = [
            ([(10_000, 14_000)], 0, 60_000),
            ([(70_000, 74_000)], 60_000, 120_000),
        ]
        subtitles = [
            {"track": "primary", "vttData": primary_vtt},
            {"track": "secondary", "vttData": secondary_vtt},
        ]
        result = align_speech_windows(windows, subtitles)
        self.assertTrue(result["results"]["primary"]["aligned"])
        self.assertEqual(result["results"]["primary"]["offsetMs"], 0)
        self.assertTrue(result["results"]["secondary"]["aligned"])
        self.assertEqual(result["results"]["secondary"]["offsetMs"], -2_000)

    def test_aligns_dual_subtitles_with_independent_offsets(self):
        primary_vtt = """WEBVTT

00:00:12.000 --> 00:00:16.000
Primary one

00:01:12.000 --> 00:01:16.000
Primary two
"""
        secondary_vtt = """WEBVTT

00:00:07.000 --> 00:00:11.000
Secondary one

00:01:07.000 --> 00:01:11.000
Secondary two
"""
        subtitles = [
            {"track": "primary", "vttData": primary_vtt},
            {"track": "secondary", "vttData": secondary_vtt},
        ]
        windows = [
            ([(10_000, 14_000)], 0, 60_000),
            ([(70_000, 74_000)], 60_000, 120_000),
        ]

        batch_result = align_speech_batch(
            [(10_000, 14_000), (70_000, 74_000)],
            subtitles,
            0,
            120_000,
        )
        self.assertTrue(batch_result["results"]["primary"]["aligned"])
        self.assertEqual(batch_result["results"]["primary"]["offsetMs"], -2_000)
        self.assertTrue(batch_result["results"]["secondary"]["aligned"])
        self.assertEqual(
            batch_result["results"]["secondary"]["offsetMs"],
            3_000,
        )

        result = align_speech_windows(windows, subtitles)

        self.assertTrue(result["results"]["primary"]["aligned"])
        self.assertEqual(result["results"]["primary"]["offsetMs"], -2_000)
        self.assertTrue(result["results"]["secondary"]["aligned"])
        self.assertEqual(result["results"]["secondary"]["offsetMs"], 3_000)

    def test_corrects_early_primary_without_shifting_secondary(self):
        primary_vtt = """WEBVTT

00:00:02.000 --> 00:00:05.000
Vietnamese dialogue

00:01:02.000 --> 00:01:05.000
Vietnamese dialogue two
"""
        secondary_vtt = """WEBVTT

00:00:03.000 --> 00:00:05.000
English dialogue

00:01:03.000 --> 00:01:05.000
English dialogue two
"""
        result = align_speech_batch(
            [(3_000, 5_000), (63_000, 65_000)],
            [
                {"track": "primary", "vttData": primary_vtt},
                {"track": "secondary", "vttData": secondary_vtt},
            ],
            0,
            120_000,
        )

        self.assertTrue(result["results"]["primary"]["aligned"])
        self.assertAlmostEqual(
            result["results"]["primary"]["offsetMs"],
            1_000,
            delta=250,
        )
        self.assertTrue(result["results"]["secondary"]["aligned"])
        self.assertEqual(result["results"]["secondary"]["offsetMs"], 0)

    def test_uses_independent_guided_centers_for_large_dual_offsets(self):
        primary_vtt = """WEBVTT

00:02:00.000 --> 00:02:04.000
Primary dialogue

00:02:10.000 --> 00:02:14.000
Primary next dialogue
"""
        secondary_vtt = """WEBVTT

00:02:30.000 --> 00:02:34.000
Secondary dialogue

00:02:40.000 --> 00:02:44.000
Secondary next dialogue
"""
        speech = [(10_000, 14_000), (20_000, 24_000)]

        result = align_speech_batch(
            speech,
            [
                {"track": "primary", "vttData": primary_vtt},
                {"track": "secondary", "vttData": secondary_vtt},
            ],
            0,
            60_000,
        )
        primary_only = align_speech_batch(
            speech,
            [{"track": "primary", "vttData": primary_vtt}],
            0,
            60_000,
        )
        secondary_only = align_speech_batch(
            speech,
            [{"track": "secondary", "vttData": secondary_vtt}],
            0,
            60_000,
        )

        self.assertTrue(result["results"]["primary"]["aligned"])
        self.assertAlmostEqual(
            result["results"]["primary"]["offsetMs"],
            -110_000,
            delta=750,
        )
        self.assertEqual(
            result["results"]["primary"]["offsetMs"],
            primary_only["results"]["primary"]["offsetMs"],
        )
        self.assertTrue(result["results"]["secondary"]["aligned"])
        self.assertAlmostEqual(
            result["results"]["secondary"]["offsetMs"],
            -140_000,
            delta=750,
        )
        self.assertEqual(
            result["results"]["secondary"]["offsetMs"],
            secondary_only["results"]["secondary"]["offsetMs"],
        )

    def test_filters_tryray_app_ad_before_aligning_primary(self):
        primary_vtt = """WEBVTT

00:00:07.000 --> 00:00:10.000
Nhấn phát. Phụ đề xuất hiện. Hơn 200 ngôn ngữ. Một ứng dụng: tryray.app

00:01:59.000 --> 00:02:03.000
Máu. Thỉnh thoảng nó làm tôi ghê hết cả răng.

00:02:03.000 --> 00:02:07.000
Những đôi khi, nó giúp tôi kiểm soát được bản loạn.
"""
        secondary_vtt = """WEBVTT

00:00:21.000 --> 00:00:23.000
Last season on Dexter...

00:00:23.000 --> 00:00:27.000
Tonight's the night and it's going to happen again,
"""
        primary_cues = parse_alignment_cues(primary_vtt)
        self.assertEqual(primary_cues[0].start_ms, 119_000)

        result = align_speech_batch(
            [(11_000, 15_000), (15_000, 19_000), (19_000, 23_000)],
            [
                {"track": "primary", "vttData": primary_vtt},
                {"track": "secondary", "vttData": secondary_vtt},
            ],
            0,
            60_000,
        )

        self.assertTrue(result["results"]["primary"]["aligned"])
        self.assertAlmostEqual(
            result["results"]["primary"]["offsetMs"],
            -108_000,
            delta=750,
        )

    def test_filters_malformed_leading_secondary_cue_before_aligning(self):
        secondary_vtt = """WEBVTT

00:00:10.000 --> 00:00:14.000
-==\u00b7\u00e7\u00ca\u00ceFRM\u00d7\u00d6\u00c4\u00bb\u00d7\u00e9==- \u00b7\u00d6\u00eb: \u00cb\u00cf\u00a3\u00bc\u00ac\u00ee

00:01:50.000 --> 00:01:54.000
If you were the Bay Harbor Butcher,

00:01:54.000 --> 00:01:58.000
would you use a place like this?
"""
        cues = parse_alignment_cues(secondary_vtt)

        self.assertTrue(is_malformed_encoding_cue(parse_vtt(secondary_vtt)[0]))
        self.assertEqual(cues[0].start_ms, 110_000)
        self.assertEqual(
            compute_track_search_centers(
                cues,
                [(14_000, 18_000), (18_000, 22_000)],
                0,
            ),
            [-96_000, 0],
        )

        result = align_speech_batch(
            [(14_000, 18_000), (18_000, 22_000)],
            [{"track": "secondary", "vttData": secondary_vtt}],
            0,
            60_000,
        )

        self.assertTrue(result["results"]["secondary"]["aligned"])
        self.assertAlmostEqual(
            result["results"]["secondary"]["offsetMs"],
            -96_000,
            delta=750,
        )


if __name__ == "__main__":
    unittest.main()
