from __future__ import annotations

import os
import re
from enum import Enum
from typing import Any

from vad import get_vad_session


class ModelArch(Enum):
    TINY = 1
    BASE = 2


class Transcriber:
    def __init__(self, *args, **kwargs):
        pass


def get_model_for_language(wanted_language: str, wanted_model_arch: Any = None):
    return "silero_vad_v5", ModelArch.TINY


LANGUAGE_RE = re.compile(
    r"^[a-z]{2,3}(?:-[a-z]{2,4})?$",
    re.IGNORECASE,
)
ISO_639_3_TO_1 = {
    "ara": "ar",
    "ces": "cs",
    "deu": "de",
    "ell": "el",
    "eng": "en",
    "fas": "fa",
    "fin": "fi",
    "fra": "fr",
    "heb": "he",
    "hin": "hi",
    "ind": "id",
    "ita": "it",
    "jpn": "ja",
    "kor": "ko",
    "nld": "nl",
    "nor": "no",
    "pol": "pl",
    "por": "pt",
    "ron": "ro",
    "rus": "ru",
    "spa": "es",
    "swe": "sv",
    "tha": "th",
    "tur": "tr",
    "ukr": "uk",
    "vie": "vi",
    "zho": "zh",
}


def normalize_language(language: str) -> str:
    value = (language or os.getenv("SYNC_LANGUAGE", "en")).strip().lower()
    if not LANGUAGE_RE.fullmatch(value):
        return "en"
    base_language = value.split("-", 1)[0]
    return ISO_639_3_TO_1.get(base_language, base_language)


def resolve_model_arch() -> str:
    return "silero_vad_v5"


def get_transcriber(language: str = "en") -> Any:
    return get_vad_session()


def preload_transcribers() -> None:
    """Preload Silero VAD model on startup."""
    try:
        get_vad_session()
    except Exception as e:
        print(f"[sync-service] Warning: Failed to preload VAD model: {e}")
