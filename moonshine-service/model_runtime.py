from __future__ import annotations

import os
import re
import threading
from typing import Any

try:
    from moonshine_voice import ModelArch, Transcriber, get_model_for_language
except ImportError:  # pragma: no cover - exercised only by broken image builds
    ModelArch = None
    Transcriber = None
    get_model_for_language = None


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

PRELOAD_LANGUAGES = ("en", "ko")

_transcribers: dict[str, Any] = {}
_transcriber_lock = threading.Lock()


def normalize_language(language: str) -> str:
    value = (language or os.getenv("MOONSHINE_LANGUAGE", "en")).strip().lower()
    if not LANGUAGE_RE.fullmatch(value):
        return "en"
    base_language = value.split("-", 1)[0]
    return ISO_639_3_TO_1.get(base_language, base_language)


def resolve_model_arch():
    value = os.getenv("MOONSHINE_MODEL_ARCH", "").strip().lower()
    if not value:
        return None
    if ModelArch is None:
        raise RuntimeError("moonshine_voice is not installed")

    named_arches = {
        "tiny": ModelArch.TINY,
        "base": ModelArch.BASE,
    }
    if value in named_arches:
        return named_arches[value]
    try:
        return ModelArch(int(value))
    except (TypeError, ValueError):
        raise RuntimeError(
            "MOONSHINE_MODEL_ARCH must be tiny, base, or a valid model enum value"
        ) from None


def get_transcriber(language: str):
    if Transcriber is None or get_model_for_language is None:
        raise RuntimeError("moonshine_voice is not installed")

    normalized = normalize_language(language)
    with _transcriber_lock:
        transcriber = _transcribers.get(normalized)
        if transcriber is not None:
            return transcriber

        model_arch = resolve_model_arch()
        try:
            model_path, resolved_arch = get_model_for_language(
                normalized,
                model_arch,
            )
        except ValueError:
            if model_arch is None:
                raise
            # Some Moonshine languages only publish a base model.
            model_path, resolved_arch = get_model_for_language(normalized)
        transcriber = Transcriber(
            model_path=model_path,
            model_arch=resolved_arch,
        )
        _transcribers[normalized] = transcriber
        return transcriber


def preload_transcribers() -> None:
    if Transcriber is None or get_model_for_language is None:
        return
    if not os.getenv("MOONSHINE_MODEL_ARCH"):
        os.environ["MOONSHINE_MODEL_ARCH"] = "tiny"
    for language in PRELOAD_LANGUAGES:
        get_transcriber(language)
