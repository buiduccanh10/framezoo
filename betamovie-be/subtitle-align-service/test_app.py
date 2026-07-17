import unittest
import sys
import types
from types import SimpleNamespace
from unittest.mock import patch


def install_import_stubs():
    fastapi = types.ModuleType("fastapi")

    class FakeFastAPI:
        def __init__(self, *args, **kwargs):
            pass

        def on_event(self, *args, **kwargs):
            return lambda function: function

        def get(self, *args, **kwargs):
            return lambda function: function

        def post(self, *args, **kwargs):
            return lambda function: function

    class FakeHTTPException(Exception):
        pass

    def fake_header(default=None, **kwargs):
        return default

    fastapi.FastAPI = FakeFastAPI
    fastapi.Header = fake_header
    fastapi.HTTPException = FakeHTTPException
    sys.modules["fastapi"] = fastapi

    faster_whisper = types.ModuleType("faster_whisper")
    faster_whisper.WhisperModel = object
    sys.modules["faster_whisper"] = faster_whisper

    pydantic = types.ModuleType("pydantic")

    class FakeBaseModel:
        pass

    def fake_field(default=None, **kwargs):
        return default

    pydantic.BaseModel = FakeBaseModel
    pydantic.Field = fake_field
    sys.modules["pydantic"] = pydantic


try:
    import app
    from app import align_cues, parse_vtt, speech_align
except ModuleNotFoundError:
    install_import_stubs()
    import app
    from app import align_cues, parse_vtt, speech_align

app.ASR_ONSET_DELAY_MS = 0  # Disable delay offset compensation for clean unit tests


def window(start_ms=0, duration_ms=60_000):
    return SimpleNamespace(startMs=start_ms, durationMs=duration_ms)


def text_segment(start_ms, end_ms, text):
    normalized = text.casefold().split()
    return {
        "startMs": start_ms,
        "endMs": end_ms,
        "text": " ".join(normalized),
        "tokens": normalized,
    }


def worded_segment(start_ms, end_ms, text, words):
    segment = text_segment(start_ms, end_ms, text)
    segment["words"] = [
        {"startMs": word_start, "endMs": word_end, "text": word_text}
        for word_start, word_end, word_text in words
    ]
    return segment


class SubtitleAlignmentTests(unittest.TestCase):
    def test_provider_ad_cues_do_not_anchor_alignment(self):
        cues = parse_vtt(
            """WEBVTT

00:00:00.000 --> 00:00:02.000
Visit provider.example

00:00:10.000 --> 00:00:11.000
Hello there

00:00:12.000 --> 00:00:13.000
How are you

00:00:14.000 --> 00:00:15.000
I am fine
"""
        )
        transcript = [
            text_segment(9_500, 10_900, "Hello there"),
            text_segment(11_500, 12_900, "How are you"),
            text_segment(13_500, 14_900, "I am fine"),
        ]

        result = align_cues(cues, [transcript], [window()])

        self.assertEqual(result["offsetMs"], -500)
        self.assertEqual(result["matchedCueCount"], 3)

    def test_first_window_can_miss_while_middle_window_matches(self):
        cues = parse_vtt(
            """WEBVTT

00:08:00.000 --> 00:08:01.000
The middle scene

00:08:02.000 --> 00:08:03.000
Continues here

00:08:04.000 --> 00:08:05.000
And ends
"""
        )
        result = align_cues(
            cues,
            [
                [],
                [
                    text_segment(479_500, 480_900, "The middle scene"),
                    text_segment(481_500, 482_900, "Continues here"),
                    text_segment(483_500, 484_900, "And ends"),
                ],
            ],
            [window(0), window(480_000)],
        )

        self.assertEqual(result["offsetMs"], -500)
        self.assertEqual(result["windowOffsetsMs"], [-500])
        self.assertNotEqual(result["confidence"], "rejected")

    def test_drift_between_windows_uses_median_offset(self):
        cues = parse_vtt(
            """WEBVTT

00:10.000 --> 00:11.000
First scene

00:12.000 --> 00:13.000
Second scene

00:14.000 --> 00:15.000
Third scene

00:30.000 --> 00:31.000
Later first

00:32.000 --> 00:33.000
Later second

00:34.000 --> 00:35.000
Later third
"""
        )
        result = align_cues(
            cues,
            [
                [
                    text_segment(9_500, 10_900, "First scene"),
                    text_segment(11_500, 12_900, "Second scene"),
                    text_segment(13_500, 14_900, "Third scene"),
                ],
                [
                    text_segment(30_500, 31_900, "Later first"),
                    text_segment(32_500, 33_900, "Later second"),
                    text_segment(34_500, 35_900, "Later third"),
                ],
            ],
            [window(0), window(20_000)],
        )

        self.assertNotEqual(result["confidence"], "rejected")
        self.assertEqual(result["offsetMs"], 0)
        self.assertGreater(result["driftMs"], 350)

    def test_different_language_uses_speech_fallback(self):
        cues = parse_vtt(
            """WEBVTT

00:10.000 --> 00:11.000
Bonjour tout le monde

00:12.000 --> 00:13.000
Comment allez-vous

00:14.000 --> 00:15.000
Je vais bien
"""
        )
        transcript = [
            text_segment(9_500, 10_900, "Hello everyone"),
            text_segment(11_500, 12_900, "How are you"),
            text_segment(13_500, 14_900, "I am fine"),
        ]

        result = align_cues(parse_vtt(cues_to_vtt(cues)), [transcript], [window()])

        self.assertEqual(result["methods"], ["speech"])
        self.assertGreaterEqual(result["offsetMs"], -1_000)
        self.assertLessEqual(result["offsetMs"], -250)

    def test_word_timestamps_prevent_long_segment_false_peak(self):
        cues = parse_vtt(
            """WEBVTT

00:01:43.020 --> 00:01:44.814
I am sorry

00:01:44.814 --> 00:01:46.315
I messed up okay

00:01:46.315 --> 00:01:47.691
How am I supposed to get ahead

00:01:47.775 --> 00:01:49.485
When you are wasting my money
"""
        )
        transcript = [
            worded_segment(
                58_960,
                104_780,
                "40 tip",
                [
                    (58_960, 59_360, "40"),
                    (104_480, 104_780, "tip"),
                ],
            ),
            worded_segment(
                104_980,
                105_740,
                "I messed up okay",
                [
                    (104_980, 105_120, "I"),
                    (105_120, 105_300, "messed"),
                    (105_300, 105_500, "up"),
                    (105_540, 105_740, "okay"),
                ],
            ),
            worded_segment(
                106_260,
                107_460,
                "How am I supposed to get ahead",
                [
                    (106_260, 106_480, "How"),
                    (106_480, 106_560, "am"),
                    (106_560, 106_660, "I"),
                    (106_660, 106_860, "supposed"),
                    (106_860, 107_080, "to"),
                    (107_080, 107_200, "get"),
                    (107_200, 107_460, "ahead"),
                ],
            ),
            worded_segment(
                107_460,
                108_960,
                "When you are wasting my money",
                [
                    (107_460, 107_620, "When"),
                    (107_620, 107_780, "you are"),
                    (107_780, 107_980, "wasting"),
                    (107_980, 108_220, "my"),
                    (108_220, 108_620, "money"),
                ],
            ),
        ]

        result = align_cues(cues, [transcript], [window(57_000)])

        self.assertNotEqual(result["confidence"], "rejected")
        self.assertGreaterEqual(result["offsetMs"], -500)
        self.assertLessEqual(result["offsetMs"], 500)

    def test_sparse_word_timestamps_fall_back_to_segment_interval(self):
        cues = parse_vtt(
            """WEBVTT

00:00:49.000 --> 00:00:50.500
First line

00:00:51.000 --> 00:00:53.000
Second line

00:00:54.000 --> 00:00:56.000
Third line

00:00:57.000 --> 00:00:59.000
Fourth line
"""
        )
        transcript = [
            worded_segment(
                49_200,
                59_200,
                "A long recognized segment",
                [
                    (49_200, 49_500, "A"),
                    (58_800, 59_200, "segment"),
                ],
            )
        ]

        result = align_cues(cues, [transcript], [window(30_000)])

        self.assertNotEqual(result["confidence"], "rejected")
        self.assertGreaterEqual(result["offsetMs"], -1_000)
        self.assertLessEqual(result["offsetMs"], 1_000)

    def test_large_offset_uses_cues_outside_reference_window(self):
        cues = parse_vtt(
            """WEBVTT

00:01:40.000 --> 00:01:41.000
First translated line

00:01:42.000 --> 00:01:43.000
Second translated line

00:01:44.000 --> 00:01:45.000
Third translated line
"""
        )
        transcript = [
            worded_segment(
                68_000,
                69_000,
                "First line",
                [(68_000, 68_400, "First")],
            ),
            worded_segment(
                70_000,
                71_000,
                "Second line",
                [(70_000, 70_400, "Second")],
            ),
            worded_segment(
                72_000,
                73_000,
                "Third line",
                [(72_000, 72_400, "Third")],
            ),
        ]

        result = align_cues(cues, [transcript], [window(30_000)])

        self.assertNotEqual(result["confidence"], "rejected")
        self.assertGreaterEqual(result["offsetMs"], -33_000)
        self.assertLessEqual(result["offsetMs"], -31_000)

    def test_speech_alignment_prefers_contiguous_dialogue_over_provider_cues(self):
        cues = parse_vtt(
            """WEBVTT

00:00:06.000 --> 00:00:12.000
Do you want subtitles for any video? tryray.app

00:00:36.870 --> 00:00:39.330
MỌI NHÂN VẬT, ĐỊA ĐIỂM, TỔ CHỨC

00:00:49.299 --> 00:00:50.717
Hey!

00:00:50.800 --> 00:00:52.302
Get out of here.

00:00:52.385 --> 00:00:53.887
You killed her.

00:00:53.970 --> 00:00:54.888
What are you doing?

00:00:55.388 --> 00:00:57.015
You killed her.

00:00:57.098 --> 00:00:59.726
You have the eyes of a killer.
"""
        )
        speech = [
            text_segment(70_200, 71_100, "Korean speech"),
            text_segment(71_700, 73_000, "Korean speech"),
            text_segment(73_300, 74_800, "Korean speech"),
            text_segment(75_000, 75_900, "Korean speech"),
            text_segment(76_400, 78_200, "Korean speech"),
            text_segment(78_200, 80_400, "Korean speech"),
        ]

        result = align_cues(cues, [speech], [window(30_000)])

        self.assertNotEqual(result["confidence"], "rejected")
        self.assertGreaterEqual(result["offsetMs"], 20_000)
        self.assertLessEqual(result["offsetMs"], 22_000)
        self.assertGreaterEqual(result["matchedCueCount"], 5)

    def test_first_window_finds_cue_nine_offset(self):
        cues = parse_vtt(
            """WEBVTT

00:00:06.000 --> 00:00:12.000
Do you want subtitles for any video? tryray.app

00:00:36.870 --> 00:00:39.330
MỌI NHÂN VẬT, ĐỊA ĐIỂM, TỔ CHỨC

00:00:49.299 --> 00:00:50.717
Hey!

00:00:50.800 --> 00:00:52.302
Get out of here.

00:00:52.385 --> 00:00:53.887
You killed her.

00:00:53.970 --> 00:00:54.888
What are you doing?

00:00:55.388 --> 00:00:57.015
You killed her.

00:00:57.098 --> 00:00:59.726
You have the eyes of a killer.
"""
        )
        transcript = [
            worded_segment(
                70_200,
                71_100,
                "Korean speech",
                [(70_200, 70_500, "speech")],
            ),
            worded_segment(
                71_700,
                73_000,
                "Korean speech",
                [(71_700, 72_100, "speech")],
            ),
            worded_segment(
                73_300,
                74_800,
                "Korean speech",
                [(73_300, 73_700, "speech")],
            ),
            worded_segment(
                75_000,
                75_900,
                "Korean speech",
                [(75_000, 75_400, "speech")],
            ),
            worded_segment(
                76_400,
                78_200,
                "Korean speech",
                [(76_400, 76_800, "speech")],
            ),
            worded_segment(
                78_200,
                80_400,
                "Korean speech",
                [(78_200, 78_600, "speech")],
            ),
        ]

        result = align_cues(cues, [transcript], [window(30_000)])

        self.assertGreaterEqual(result["offsetMs"], 20_000)
        self.assertLessEqual(result["offsetMs"], 22_000)
        self.assertNotEqual(result["confidence"], "rejected")
        self.assertGreaterEqual(result["matchedCueCount"], 5)

    def test_two_asr_segments_choose_best_dialogue_run_not_earliest(self):
        cues = parse_vtt(
            """WEBVTT

00:00:06.000 --> 00:00:12.074
Watch Online Movies and Series for FREE www.osdb.link/lm

00:00:37.370 --> 00:00:39.664
MỌI NHÂN VẬT, ĐỊA ĐIỂM, TỔ CHỨC ĐỀU LÀ HƯ CẤU

00:00:39.748 --> 00:00:42.041
KHÁN GIẢ CÂN NHẮC VÌ CẢNH PHIM CÓ THỂ GÂY KHÓ CHỊU.

00:00:55.722 --> 00:00:58.391
Cho Do Chul bị kết án mười năm tù vì tội tấn công tình dục

00:00:58.475 --> 00:01:01.811
và sát hại trẻ vị thành niên sẽ được ra tù từ hôm nay.

00:01:43.311 --> 00:01:45.563
Later dialogue one

00:01:45.647 --> 00:01:48.024
Later dialogue two

00:01:48.108 --> 00:01:49.359
Later dialogue three

00:01:49.442 --> 00:01:52.320
Later dialogue four
"""
        )
        transcript = [
            worded_segment(
                77_080,
                77_720,
                "English speech",
                [(77_080, 77_480, "speech")],
            ),
            worded_segment(
                78_180,
                80_260,
                "English speech",
                [(78_180, 78_580, "speech")],
            ),
        ]

        speech_result = speech_align(cues, transcript, window(30_000))
        result = align_cues(cues, [transcript], [window(30_000)])

        # The early two-cue sequence is a false peak. The video speech at
        # 01:18 matches the subtitle sequence around cue 09 at 01:49.
        self.assertGreaterEqual(result["offsetMs"], -31_500)
        self.assertLessEqual(result["offsetMs"], -30_800)
        self.assertEqual(result["matchedCueCount"], 2)
        self.assertEqual(result["methods"], ["speech"])
        self.assertNotEqual(result["confidence"], "rejected")
        self.assertEqual(speech_result["matchedCueStartsMs"], [108_108, 109_442])

    def test_an_danh_cue_nine_is_visible_at_video_78_seconds(self):
        cues = parse_vtt(
            """WEBVTT

01:48.108 --> 01:49.359
Đi chết đi!

01:49.442 --> 01:52.320
Tôi sẽ sống và sám hối cả đời.

01:52.403 --> 01:53.571
Tôi xin lỗi.

01:53.655 --> 01:55.782
- Ông Cho Do Chul! - Ông sẽ cư trú ở đâu?

01:55.865 --> 01:57.325
- Xin hãy phát biểu! - Ông Cho!
"""
        )
        transcript = [
            worded_segment(
                79_330,
                80_050,
                "살겠습니다",
                [(79_330, 80_050, "살겠습니다")],
            ),
            worded_segment(
                80_870,
                81_450,
                "죄송합니다",
                [(80_870, 81_450, "죄송합니다")],
            ),
            worded_segment(
                81_890,
                82_370,
                "종국 씨",
                [(81_890, 82_150, "종국"), (82_150, 82_370, "씨")],
            ),
            worded_segment(
                82_670,
                84_010,
                "주거진은 어디로 정하셨습니까",
                [
                    (82_670, 83_210, "주거진은"),
                    (83_210, 83_450, "어디로"),
                    (83_450, 84_010, "정하셨습니까"),
                ],
            ),
        ]

        result = speech_align(cues, transcript, window(30_000))
        target = next(
            cue for cue in cues if cue["text"] == "tôi sẽ sống và sám hối cả đời"
        )
        shifted_start = target["startMs"] + result["offsetMs"]
        shifted_end = target["endMs"] + result["offsetMs"]

        self.assertGreaterEqual(result["offsetMs"], -34_000)
        self.assertLessEqual(result["offsetMs"], -32_000)
        self.assertLessEqual(shifted_start, 78_000)
        self.assertGreater(shifted_end, 78_000)

    def test_hls_audio_seek_is_accurate_after_input(self):
        completed = SimpleNamespace(returncode=0, stdout=b"wav", stderr=b"")
        with patch.object(app.subprocess, "run", return_value=completed) as run:
            app.extract_audio("https://example.com/video.m3u8", window(30_000))

        command = run.call_args.args[0]
        self.assertLess(command.index("-i"), command.index("-ss"))

    def test_unrelated_subtitle_is_rejected(self):
        cues = parse_vtt(
            """WEBVTT

00:10.000 --> 00:11.000
Unrelated line one

00:12.000 --> 00:13.000
Unrelated line two
"""
        )
        transcript = [
            text_segment(9_500, 10_900, "Different movie"),
            text_segment(11_500, 12_900, "Different dialogue"),
        ]

        result = align_cues(cues, [transcript], [window()])

        self.assertEqual(result["confidence"], "rejected")

    def test_sparse_asr_avoids_false_peak_at_window_boundary(self):
        """When the ASR produces only a few speech segments, a wrong offset
        can score higher because a small set of cues coincidentally aligns
        with near-perfect IoU at the window boundary.  The algorithm should
        prefer the offset that places more dialogue cues in the window
        (indicating a dialogue-rich region) over one with fewer but
        perfectly-overlapping cues."""
        cues = parse_vtt(
            """\
WEBVTT

00:00:06.000 --> 00:00:12.074
Do you want subtitles for any video? tryray.app

00:00:36.870 --> 00:00:39.330
MỌI NHÂN VẬT, ĐỊA ĐIỂM, TỔ CHỨC

00:00:39.414 --> 00:00:42.041
KHÁN GIẢ CÂN NHẮC VÌ CẢNH PHIM CÓ THỂ GÂY KHÓ CHỊU.

00:00:49.299 --> 00:00:50.717
Thằng ranh!

00:00:50.800 --> 00:00:52.302
Biến đi!

00:00:52.385 --> 00:00:53.887
Mày giết cô ấy.

00:00:53.970 --> 00:00:54.888
Mày đang làm gì thế?

00:00:55.388 --> 00:00:57.015
Mày giết cô ấy.

00:00:57.098 --> 00:00:59.726
Thằng ranh này cũng có ánh mắt của kẻ giết người đấy.

00:01:01.394 --> 00:01:03.146
Tự tay anh sẽ xử lý đám rác đó.

00:01:03.230 --> 00:01:05.607
Cho Do Chul bị kết án mười năm tù

00:01:05.690 --> 00:01:09.027
vì tội tấn công tình dục và sát hại trẻ vị thành niên

00:01:09.110 --> 00:01:11.488
sẽ được ra tù từ hôm nay.
"""
        )
        # Four speech segments that coincidentally match cues 9-12 at
        # offset -30.5s, but the correct offset is ~-24s where cues
        # 7-10 match the same speech with looser IoU.
        transcript = [
            worded_segment(
                30_900, 32_600, "Korean speech",
                [(30_900, 32_600, "speech")],
            ),
            worded_segment(
                32_700, 35_100, "Korean speech",
                [(32_700, 35_100, "speech")],
            ),
            worded_segment(
                35_200, 38_500, "Korean speech",
                [(35_200, 38_500, "speech")],
            ),
            worded_segment(
                38_600, 41_000, "Korean speech",
                [(38_600, 41_000, "speech")],
            ),
        ]

        result = align_cues(cues, [transcript], [window(30_000)])

        # The correct offset should be around -24s, NOT -30.5s.
        self.assertNotEqual(result["confidence"], "rejected")
        self.assertGreaterEqual(result["offsetMs"], -26_000)
        self.assertLessEqual(result["offsetMs"], -22_000)


def cues_to_vtt(cues):
    def timestamp(milliseconds):
        seconds = milliseconds / 1000
        hours = int(seconds // 3600)
        minutes = int((seconds % 3600) // 60)
        remainder = seconds % 60
        return f"{hours:02d}:{minutes:02d}:{remainder:06.3f}"

    blocks = ["WEBVTT"]
    for cue in cues:
        blocks.extend(
            [
                "",
                f"{timestamp(cue['startMs'])} --> {timestamp(cue['endMs'])}",
                cue["text"],
            ]
        )
    return "\n".join(blocks)


if __name__ == "__main__":
    unittest.main()
