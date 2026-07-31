import struct
import unittest

from app import (
    build_cleaned_vtt,
    decode_wav,
    find_best_offset,
    normalize_language,
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

    def test_drops_leading_non_speech_cue_after_alignment(self):
        vtt = """WEBVTT

00:00:00.000 --> 00:00:05.000
Subscribe now

00:00:30.000 --> 00:00:34.000
Hello
"""
        cues = parse_vtt(vtt)
        cleaned = build_cleaned_vtt(
            vtt,
            cues,
            [(0, 4_000)],
            -30_000,
            0,
            20_000,
        )

        self.assertNotIn("Subscribe now", cleaned)
        self.assertIn("Hello", cleaned)


if __name__ == "__main__":
    unittest.main()
