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

    def test_accepts_one_window_with_multiple_speech_anchors(self):
        result = select_alignment_consensus(
            [
                {
                    "startAt": 0,
                    "result": {
                        **self.make_aligned_result(-2_000, 66),
                        "speechAnchorCount": 3,
                        "speechAnchorCoverage": 0.23,
                    },
                },
            ]
        )

        self.assertTrue(result["aligned"])
        self.assertEqual(result["offsetMs"], -2_000)

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
        self.assertEqual(result["additionalWindows"], 0)

    def test_requests_more_samples_for_speechless_alignment_result(self):
        with patch(
            "alignment.align_speech_batch",
            return_value={
                "results": {
                    "primary": {
                        "aligned": False,
                        "offsetMs": 0,
                        "confidence": 0,
                        "speechIntervals": [],
                        "reason": "no_speech_detected",
                    }
                }
            },
        ):
            result = align_speech_windows(
                [([(0, 500)], 0, 60_000)],
                [{"track": "primary", "vttData": "WEBVTT"}],
            )

        self.assertTrue(result["needsMoreSamples"])
        self.assertEqual(result["additionalWindows"], 1)

    def test_counts_each_window_that_needs_replacement_samples(self):
        unaligned = {
            "results": {
                "primary": {
                    "aligned": False,
                    "offsetMs": 0,
                    "confidence": 0,
                    "speechIntervals": [],
                    "reason": "no_speech_detected",
                }
            }
        }
        with patch("alignment.align_speech_batch", side_effect=[unaligned, unaligned]):
            result = align_speech_windows(
                [
                    ([(0, 500)], 0, 60_000),
                    ([(60_000, 60_500)], 60_000, 120_000),
                ],
                [{"track": "primary", "vttData": "WEBVTT"}],
            )

        self.assertTrue(result["needsMoreSamples"])
        self.assertEqual(result["additionalWindows"], 2)

    def test_does_not_request_more_samples_after_alignment(self):
        with patch(
            "alignment.align_speech_batch",
            return_value={
                "results": {"primary": self.make_aligned_result(-2_000)}
            },
        ):
            result = align_speech_windows(
                [
                    ([(0, 4_000)], 0, 60_000),
                    ([(60_000, 64_000)], 60_000, 120_000),
                ],
                [{"track": "primary", "vttData": "WEBVTT"}],
            )

        self.assertFalse(result["needsMoreSamples"])
        self.assertEqual(result["additionalWindows"], 0)

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

    def test_reuses_preprocessed_cues_when_finding_search_centers(self):
        cues = parse_alignment_cues(
            """WEBVTT

00:01:50.000 --> 00:01:54.000
If you were the Bay Harbor Butcher,
"""
        )

        with patch(
            "alignment.filter_alignment_cues",
            side_effect=AssertionError("preprocessed cues were filtered again"),
        ):
            centers = compute_track_search_centers(
                cues,
                [(14_000, 18_000)],
                0,
                cues_filtered=True,
            )

        self.assertEqual(centers, [-96_000, 0])

    def test_filters_non_speech_sdh_and_music_cues(self):
        vtt = """WEBVTT

00:00:02.000 --> 00:00:06.000
[Dramatic music playing]

00:00:07.000 --> 00:00:11.000
♪ Ooh la la ♪

00:00:12.000 --> 00:00:15.000
(Thunder rumbles)

00:00:25.000 --> 00:00:29.000
We need to leave right now.

00:00:35.000 --> 00:00:39.000
There is no time left.
"""
        cues = parse_alignment_cues(vtt)
        self.assertEqual(len(cues), 2)
        self.assertEqual(cues[0].start_ms, 25_000)
        self.assertEqual(cues[1].start_ms, 35_000)

    def test_matches_continuous_speech_spanning_split_subtitle_cues(self):
        # Actor speaks continuously from 10s to 16s, split into two cues in VTT
        vtt = """WEBVTT

00:00:12.000 --> 00:00:14.700
First half of a continuous sentence,

00:00:15.100 --> 00:00:18.000
and the second half right after.

00:00:25.000 --> 00:00:28.000
Another line of dialogue.
"""
        cues = parse_alignment_cues(vtt)
        speech = [(10_000, 16_000), (23_000, 26_000)]
        res = alignment_result_from_speech(cues, speech, 0, 40_000)
        self.assertTrue(res["aligned"])
        self.assertAlmostEqual(res["offsetMs"], -2_000, delta=250)
        self.assertGreaterEqual(res["confidence"], 80)

    def test_pooled_multi_window_fallback_rescues_sparse_dialogue_movie(self):
        # Each 60s window only has 1 short utterance (which alone has 1 anchor < 80 conf),
        # but across 3 windows they all agree on offset = -3000ms.
        vtt = """WEBVTT

00:00:13.000 --> 00:00:15.000
Hello there.

00:02:13.000 --> 00:02:15.000
Are you ready?

00:04:13.000 --> 00:04:15.000
Let's move out.
"""
        windows = [
            ([(10_000, 12_000)], 0, 60_000),
            ([(130_000, 132_000)], 120_000, 180_000),
            ([(250_000, 252_000)], 240_000, 300_000),
        ]
        result = align_speech_windows(
            windows,
            [{"track": "primary", "vttData": vtt}],
        )
        self.assertTrue(result["results"]["primary"]["aligned"])
        self.assertAlmostEqual(result["results"]["primary"]["offsetMs"], -3_000, delta=250)

    def test_fits_global_framerate_drift_23976_to_24(self):
        from alignment import select_alignment_consensus

        ratio = 23.976 / 24.0
        entries = []
        for start_s in (0, 600, 1200, 1800):
            t_v = start_s * 1_000
            t_s = round(t_v / ratio)
            entries.append(
                {
                    "startAt": start_s,
                    "result": {
                        "aligned": True,
                        "offsetMs": int(t_v - t_s),
                        "confidence": 90,
                        "speechAnchorCount": 3,
                        "speechAnchorCoverage": 0.6,
                        "speechIntervals": [{"startMs": t_v + 1_000, "endMs": t_v + 3_000}],
                    },
                }
            )
        consensus = select_alignment_consensus(entries)
        self.assertTrue(consensus["aligned"])
        self.assertAlmostEqual(consensus.get("rateRatio", 1.0), ratio, delta=0.0001)
        self.assertAlmostEqual(consensus["offsetMs"], 0, delta=100)

    def test_fits_global_framerate_drift_24_to_25_with_offset(self):
        from alignment import select_alignment_consensus

        ratio = 25.0 / 24.0
        offset0 = 2_000
        entries = []
        for start_s in (0, 300, 600, 900):
            t_v = start_s * 1_000
            t_s = round((t_v - offset0) / ratio)
            entries.append(
                {
                    "startAt": start_s,
                    "result": {
                        "aligned": True,
                        "offsetMs": int(t_v - t_s),
                        "confidence": 92,
                        "speechAnchorCount": 4,
                        "speechAnchorCoverage": 0.7,
                        "speechIntervals": [{"startMs": t_v + 1_000, "endMs": t_v + 3_000}],
                    },
                }
            )
        consensus = select_alignment_consensus(entries)
        self.assertTrue(consensus["aligned"])
        self.assertAlmostEqual(consensus.get("rateRatio", 1.0), ratio, delta=0.0002)
        self.assertAlmostEqual(consensus["offsetMs"], offset0, delta=150)

    def test_parses_vtt_enforces_max_cues_and_redos_safe(self):
        import time as pytime
        from alignment import MAX_VTT_CUES, Cue, is_non_speech_sdh_cue, parse_vtt

        malicious = "♪" + ("x " * 15_000)
        cue = Cue(0, 1000, 2000, f"00:00:01.000 --> 00:00:02.000\n{malicious}")
        t0 = pytime.perf_counter()
        self.assertFalse(is_non_speech_sdh_cue(cue))
        self.assertLess(pytime.perf_counter() - t0, 0.1)

        too_many_lines = ["WEBVTT\n"]
        for i in range(MAX_VTT_CUES + 5):
            s0 = i * 2
            s1 = s0 + 1
            t_start = f"{s0 // 3600:02d}:{(s0 // 60) % 60:02d}:{s0 % 60:02d}.000"
            t_end = f"{s1 // 3600:02d}:{(s1 // 60) % 60:02d}:{s1 % 60:02d}.000"
            too_many_lines.append(f"{t_start} --> {t_end}\nLine {i}\n")
        with self.assertRaises(ValueError):
            parse_vtt("\n".join(too_many_lines))

    def test_dense_unalignable_movie_skips_pooled_fallback(self):
        calls = 0

        def always_low(*args, **kwargs):
            nonlocal calls
            calls += 1
            return {
                "aligned": False,
                "offsetMs": 0,
                "confidence": 20,
                "speechIntervals": [{"startMs": 1_000, "endMs": 4_000}, {"startMs": 6_000, "endMs": 10_000}],
                "reason": "low_alignment_confidence",
            }

        windows = [
            ([(1_000, 4_000), (6_000, 10_000)], 0, 60_000),
            ([(121_000, 124_000), (126_000, 130_000)], 120_000, 180_000),
        ]
        res = align_speech_windows(
            windows,
            [{"track": "primary", "vttData": "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nHi\n"}],
            alignment_result_fn=always_low,
        )
        self.assertFalse(res["results"]["primary"]["aligned"])
        self.assertEqual(calls, 2)

    @staticmethod
    def _format_vtt_ms(ms: int) -> str:
        total_ms = max(0, int(round(ms)))
        hours, rem = divmod(total_ms, 3_600_000)
        minutes, rem = divmod(rem, 60_000)
        seconds, millis = divmod(rem, 1_000)
        return f"{hours:02d}:{minutes:02d}:{seconds:02d}.{millis:03d}"

    def _build_drifted_vtt_and_windows(
        self,
        window_specs: list[tuple[int, int, bool]],
        *,
        rate_ratio: float,
        offset0_ms: int,
        end_s_ms: int = 2_600_000,
    ) -> tuple[str, list[tuple[list[tuple[int, int]], int, int]]]:
        cues: list[tuple[int, int]] = []
        cursor = 5_000
        idx = 0
        while cursor < end_s_ms:
            dur = 1_300 + ((idx * 733 + idx * idx * 197) % 2_900)
            gap = 800 + ((idx * 1_103 + idx * idx * 311) % 3_600)
            cues.append((cursor, cursor + dur))
            cursor += dur + gap
            idx += 1

        lines = ["WEBVTT", ""]
        for cue_idx, (s_ms, e_ms) in enumerate(cues, start=1):
            lines.append(f"{self._format_vtt_ms(s_ms)} --> {self._format_vtt_ms(e_ms)}")
            lines.append(f"Line {cue_idx}")
            lines.append("")
        vtt_data = "\n".join(lines)

        windows: list[tuple[list[tuple[int, int]], int, int]] = []
        for center_ms, jitter_ms, has_speech in window_specs:
            win_start = center_ms - 30_000
            win_end = center_ms + 30_000
            if not has_speech:
                windows.append(([], win_start, win_end))
                continue
            speech: list[tuple[int, int]] = []
            for s_ms, e_ms in cues:
                v_start = int(round(s_ms * rate_ratio + offset0_ms + jitter_ms))
                v_end = int(round(e_ms * rate_ratio + offset0_ms + jitter_ms))
                clipped_start = max(v_start, win_start)
                clipped_end = min(v_end, win_end)
                if clipped_end - clipped_start >= 600:
                    speech.append((clipped_start, clipped_end))
            windows.append((speech, win_start, win_end))

        return vtt_data, windows

    def test_single_sync_locks_25_over_23976_drift_despite_early_playhead_cluster(self):
        ratio = 25.0 / 23.976
        offset0 = 1_500
        vtt_data, windows = self._build_drifted_vtt_and_windows(
            [
                (90_000, 0, True),
                (150_000, 0, True),
                (723_000, 0, True),
                (1_471_000, 0, True),
                (1_993_000, 0, True),
            ],
            rate_ratio=ratio,
            offset0_ms=offset0,
        )

        res = align_speech_windows(windows, [{"track": "primary", "vttData": vtt_data}])
        primary = res["results"]["primary"]
        self.assertTrue(primary["aligned"])
        self.assertIsNotNone(primary.get("rateRatio"))
        self.assertAlmostEqual(primary["rateRatio"], ratio, delta=0.0003)
        self.assertLessEqual(abs(primary["offsetMs"] - offset0), 300)
        self.assertNotIn("segments", primary)

    def test_detects_subtle_23976_to_24_drift_with_window_jitter(self):
        from alignment import select_alignment_consensus

        ratio = 23.976 / 24.0
        offset0 = 2_000
        specs = [
            (90_000, 120, True),
            (480_000, -160, True),
            (960_000, 180, True),
            (1_440_000, -140, True),
            (1_920_000, 150, True),
            (2_370_000, -170, True),
        ]
        entries = []
        for center_ms, jitter_ms, _ in specs:
            window_offset = int(round(offset0 + (1.0 - 1.0 / ratio) * center_ms + jitter_ms))
            result = self.make_aligned_result(window_offset, 88.0)
            result["matchedAnchors"] = 4
            entries.append({"startAt": center_ms / 1000.0, "midMs": center_ms, "result": result})

        consensus = select_alignment_consensus(entries)
        self.assertTrue(consensus["aligned"])
        self.assertIsNotNone(consensus.get("rateRatio"))
        self.assertAlmostEqual(consensus["rateRatio"], ratio, delta=0.0003)

        vtt_data, windows = self._build_drifted_vtt_and_windows(
            specs,
            rate_ratio=ratio,
            offset0_ms=offset0,
        )
        res = align_speech_windows(windows, [{"track": "primary", "vttData": vtt_data}])
        primary = res["results"]["primary"]
        self.assertTrue(primary["aligned"])
        self.assertIsNotNone(primary.get("rateRatio"))
        self.assertAlmostEqual(primary["rateRatio"], ratio, delta=0.0003)

    def test_detects_small_linear_drift_below_framerate_threshold(self):
        ratio = 0.99975
        offset0 = 1_800
        centers = (90_000, 480_000, 960_000, 1_440_000, 1_920_000, 2_370_000)
        jitters = (120, -150, 80, -100, 140, -130)
        entries = []
        for center_ms, jitter_ms in zip(centers, jitters):
            offset = int(round(offset0 + (1.0 - 1.0 / ratio) * center_ms + jitter_ms))
            result = self.make_aligned_result(offset, 88)
            result["speechAnchorCount"] = 4
            result["speechAnchorCoverage"] = 0.6
            entries.append(
                {
                    "startAt": center_ms / 1_000.0,
                    "midMs": center_ms,
                    "result": result,
                }
            )

        consensus = select_alignment_consensus(entries)

        self.assertTrue(consensus["aligned"])
        self.assertAlmostEqual(consensus["rateRatio"], ratio, delta=0.00008)
        self.assertLessEqual(abs(consensus["offsetMs"] - offset0), 150)

        vtt_data, windows = self._build_drifted_vtt_and_windows(
            [(center_ms, jitter_ms, True) for center_ms, jitter_ms in zip(centers, jitters)],
            rate_ratio=ratio,
            offset0_ms=offset0,
        )
        primary = align_speech_windows(
            windows,
            [{"track": "primary", "vttData": vtt_data}],
        )["results"]["primary"]
        self.assertTrue(primary["aligned"])
        self.assertAlmostEqual(primary["rateRatio"], ratio, delta=0.00008)

    def test_does_not_promote_one_local_offset_to_global_drift(self):
        centers = (90_000, 480_000, 960_000, 1_440_000, 1_920_000, 2_370_000)
        offsets = (1_800, 1_800, 1_800, 2_800, 1_800, 1_800)
        entries = []
        for center_ms, offset in zip(centers, offsets):
            result = self.make_aligned_result(offset, 88)
            result["speechAnchorCount"] = 4
            result["speechAnchorCoverage"] = 0.6
            entries.append(
                {
                    "startAt": center_ms / 1_000.0,
                    "midMs": center_ms,
                    "result": result,
                }
            )

        consensus = select_alignment_consensus(entries)

        self.assertTrue(consensus["aligned"])
        self.assertIsNone(consensus.get("rateRatio"))

    def test_two_wide_windows_fit_broadcast_fps_drift(self):
        ratio = 25.0 / 24.0
        offset0 = -1_000
        vtt_data, windows = self._build_drifted_vtt_and_windows(
            [
                (120_000, 0, True),
                (450_000, 0, False),
                (900_000, 0, False),
                (1_500_000, 0, True),
                (2_100_000, 0, False),
            ],
            rate_ratio=ratio,
            offset0_ms=offset0,
        )

        res = align_speech_windows(windows, [{"track": "primary", "vttData": vtt_data}])
        primary = res["results"]["primary"]
        self.assertTrue(primary["aligned"])
        self.assertIsNotNone(primary.get("rateRatio"))
        self.assertAlmostEqual(primary["rateRatio"], ratio, delta=0.0003)

    def test_constant_offset_with_outlier_keeps_rate_ratio_none(self):
        offset0 = -3_000
        vtt_data, windows = self._build_drifted_vtt_and_windows(
            [
                (90_000, 0, True),
                (150_000, 0, True),
                (500_000, 0, True),
                (1_000_000, 42_000, True),
                (1_500_000, 0, True),
                (2_000_000, 0, True),
            ],
            rate_ratio=1.0,
            offset0_ms=offset0,
        )

        res = align_speech_windows(windows, [{"track": "primary", "vttData": vtt_data}])
        primary = res["results"]["primary"]
        self.assertTrue(primary["aligned"])
        self.assertLessEqual(abs(primary["offsetMs"] - offset0), 250)
        self.assertIsNone(primary.get("rateRatio"))

    def test_rescues_moderate_confidence_constant_offset_across_spread_windows(self):
        # Simulate noisy/music-heavy audio where each window gets 50-56% score
        # (below 60% single-window threshold) but 4 spread windows agree tightly at -2_500ms.
        vtt_data, windows = self._build_drifted_vtt_and_windows(
            [
                (120_000, 0, True),
                (600_000, 0, True),
                (1_200_000, 0, True),
                (1_800_000, 0, True),
            ],
            rate_ratio=1.0,
            offset0_ms=-2_500,
        )

        # Inject unaligned background noise intervals so single-window score lands around ~52-55%
        noisy_windows = [
            (
                [(s_ms + 3_000, s_ms + 6_500), *speech, (e_ms - 6_500, e_ms - 3_000)],
                s_ms,
                e_ms,
            )
            for speech, s_ms, e_ms in windows
        ]
        res = align_speech_windows(noisy_windows, [{"track": "primary", "vttData": vtt_data}])
        primary = res["results"]["primary"]
        self.assertTrue(primary["aligned"])
        self.assertAlmostEqual(primary["offsetMs"], -2_500, delta=300)
        self.assertNotIn("_candidate", primary)

    def test_sliding_cluster_and_core_mean_resist_noisy_cluster_edge(self):
        entries = [
            {"startAt": 100, "result": self.make_aligned_result(-2_020, 92)},
            {"startAt": 500, "result": self.make_aligned_result(-1_990, 90)},
            {"startAt": 900, "result": self.make_aligned_result(-2_010, 91)},
            {"startAt": 1_300, "result": self.make_aligned_result(-2_000, 93)},
            {"startAt": 1_700, "result": self.make_aligned_result(-950, 62)},
        ]
        consensus = select_alignment_consensus(entries)
        self.assertTrue(consensus["aligned"])
        # Core 4 windows near -2005ms must not be pulled toward -950ms
        self.assertLessEqual(abs(consensus["offsetMs"] - (-2_005)), 40)

    def test_aligns_large_constant_offset_and_reports_failed_window_indices(self):
        vtt_data, windows = self._build_drifted_vtt_and_windows(
            [
                (120_000, 0, True),
                (600_000, 0, False),
                (1_200_000, 0, True),
                (1_800_000, 0, False),
            ],
            rate_ratio=1.0,
            offset0_ms=75_000,
        )
        res = align_speech_windows(windows, [{"track": "primary", "vttData": vtt_data}])
        primary = res["results"]["primary"]
        self.assertTrue(primary["aligned"])
        self.assertAlmostEqual(primary["offsetMs"], 75_000, delta=350)
        self.assertEqual(res["failedWindowIndices"], [1, 3])

    def test_three_aligned_windows_fit_framerate_drift_and_22min_episode(self):
        # 3 windows across a 22-minute episode at 23.976 / 24.0
        ratio = 23.976 / 24.0
        offset0 = 1_200
        vtt_data, windows = self._build_drifted_vtt_and_windows(
            [
                (120_000, 0, True),
                (660_000, 0, True),
                (1_200_000, 0, True),
            ],
            rate_ratio=ratio,
            offset0_ms=offset0,
            end_s_ms=1_400_000,
        )
        res = align_speech_windows(windows, [{"track": "primary", "vttData": vtt_data}])
        primary = res["results"]["primary"]
        self.assertTrue(primary["aligned"])
        self.assertAlmostEqual(primary.get("rateRatio", 1.0), ratio, delta=0.0002)
        self.assertLessEqual(abs(primary["offsetMs"] - offset0), 250)

    def test_detects_drift_with_clustered_first_two_windows_and_jitter(self):
        # Mirrors buildAlignmentWindowPlan layout: windows 0 & 1 only 60s apart + ±120ms jitter
        for ratio in (23.976 / 24.0, 0.9996):
            with self.subTest(ratio=ratio):
                offset0 = 1_500
                vtt_data, windows = self._build_drifted_vtt_and_windows(
                    [
                        (600_000, 120, True),
                        (660_000, -110, True),
                        (1_200_000, 90, True),
                        (1_800_000, -100, True),
                        (2_400_000, 110, True),
                    ],
                    rate_ratio=ratio,
                    offset0_ms=offset0,
                )
                res = align_speech_windows(
                    windows, [{"track": "primary", "vttData": vtt_data}]
                )
                primary = res["results"]["primary"]
                self.assertTrue(primary["aligned"])
                self.assertIsNotNone(primary.get("rateRatio"))
                self.assertAlmostEqual(primary["rateRatio"], ratio, delta=0.0002)

    def test_late_movie_large_fps_drift_beyond_180s_locks_via_projection(self):
        # 25/23.976 drift starting around 70 minutes (4,200,000ms -> offset ~179,000ms..205,000ms)
        ratio = 25.0 / 23.976
        offset0 = 0
        vtt_data, windows = self._build_drifted_vtt_and_windows(
            [
                (4_200_000, 0, True),
                (4_500_000, 0, True),
                (4_800_000, 0, True),
                (5_100_000, 0, True),
            ],
            rate_ratio=ratio,
            offset0_ms=offset0,
            end_s_ms=5_400_000,
        )
        res = align_speech_windows(windows, [{"track": "primary", "vttData": vtt_data}])
        primary = res["results"]["primary"]
        self.assertTrue(primary["aligned"])
        self.assertAlmostEqual(primary.get("rateRatio", 1.0), ratio, delta=0.0004)

    def test_non_standard_drift_with_far_outlier_locks_via_all_pairs_empirical_ratio(self):
        # Non-standard rate 1.006 where only 2 early windows align in Pass 1 + 1 furthest outlier,
        # and later windows exceed 45s offset so projection must infer 1.006 from the clean pair.
        ratio = 1.006
        offset0 = 2_000
        vtt_data, windows = self._build_drifted_vtt_and_windows(
            [
                (300_000, 0, True),
                (1_500_000, 0, True),
                (2_700_000, 0, True),
                (3_900_000, 0, True),
            ],
            rate_ratio=ratio,
            offset0_ms=offset0,
            end_s_ms=4_200_000,
        )
        # Replace window 3's cues with a far outlier offset on a separate check in _project_and_fit_framerate_drift
        cues = parse_alignment_cues(vtt_data)
        from alignment import _project_and_fit_framerate_drift

        base_entries = [
            {
                "startAt": 300.0,
                "midMs": 300_000,
                "result": self.make_aligned_result(
                    int(round(offset0 + (1.0 - 1.0 / ratio) * 300_000)), 90
                ),
            },
            {
                "startAt": 1_500.0,
                "midMs": 1_500_000,
                "result": self.make_aligned_result(
                    int(round(offset0 + (1.0 - 1.0 / ratio) * 1_500_000)), 88
                ),
            },
            {
                "startAt": 2_700.0,
                "midMs": 2_700_000,
                "result": {
                    "aligned": False,
                    "offsetMs": 0,
                    "confidence": 20,
                    "speechIntervals": [],
                    "reason": "low_alignment_confidence",
                },
            },
            {
                "startAt": 3_900.0,
                "midMs": 3_900_000,
                # Outlier aligned window at the furthest timestamp
                "result": self.make_aligned_result(-40_000, 70),
            },
        ]
        projected = _project_and_fit_framerate_drift(windows, base_entries, cues)
        self.assertIsNotNone(projected)
        self.assertTrue(projected["aligned"])
        self.assertAlmostEqual(projected.get("rateRatio", 1.0), ratio, delta=0.0005)

    def test_piecewise_split_boundaries_respect_window_duration_sec(self):
        from split_align import compute_piecewise_segments

        entries = [
            {"startAt": 100.0, "durationSec": 30.0, "result": self.make_aligned_result(0, 90)},
            {"startAt": 300.0, "durationSec": 30.0, "result": self.make_aligned_result(0, 90)},
            {"startAt": 400.0, "durationSec": 30.0, "result": self.make_aligned_result(5_000, 90)},
            {"startAt": 700.0, "durationSec": 30.0, "result": self.make_aligned_result(5_000, 90)},
        ]
        segments = compute_piecewise_segments(entries, global_offset_ms=0)
        self.assertEqual(len(segments), 2)
        # Midpoint between (300 + 30) and 400 is 365s (not 380s from hardcoded 60s)
        self.assertEqual(segments[0]["endMs"], 365_000)
        self.assertEqual(segments[1]["startMs"], 365_000)


if __name__ == "__main__":
    unittest.main()
