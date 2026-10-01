from __future__ import annotations

import asyncio
import os
import time
from collections import defaultdict
from typing import Any, Callable

from fastapi import HTTPException, Request

MAX_CONCURRENT_INFERENCES = int(os.getenv("MAX_CONCURRENT_INFERENCES", "2"))
CONCURRENCY_TIMEOUT_SEC = float(os.getenv("CONCURRENCY_TIMEOUT_SEC", "5.0"))
INFERENCE_TIMEOUT_SEC = float(os.getenv("INFERENCE_TIMEOUT_SEC", "15.0"))

RATE_LIMIT_BURST = int(os.getenv("RATE_LIMIT_BURST", "6"))
RATE_LIMIT_BURST_PERIOD = float(os.getenv("RATE_LIMIT_BURST_PERIOD", "10.0"))
RATE_LIMIT_SUSTAINED = int(os.getenv("RATE_LIMIT_SUSTAINED", "20"))
RATE_LIMIT_SUSTAINED_PERIOD = float(
    os.getenv("RATE_LIMIT_SUSTAINED_PERIOD", "60.0")
)

_inference_semaphore = asyncio.Semaphore(MAX_CONCURRENT_INFERENCES)


class SlidingWindowRateLimiter:
    def __init__(
        self,
        burst_limit: int = RATE_LIMIT_BURST,
        burst_period: float = RATE_LIMIT_BURST_PERIOD,
        sustained_limit: int = RATE_LIMIT_SUSTAINED,
        sustained_period: float = RATE_LIMIT_SUSTAINED_PERIOD,
    ):
        self._history: dict[str, list[float]] = defaultdict(list)
        self._lock = asyncio.Lock()
        self._last_cleanup = time.time()
        self.burst_limit = burst_limit
        self.burst_period = burst_period
        self.sustained_limit = sustained_limit
        self.sustained_period = sustained_period

    async def check_rate_limit(self, client_id: str) -> None:
        now = time.time()
        async with self._lock:
            if now - self._last_cleanup > 60.0:
                self._cleanup(now)

            timestamps = self._history[client_id]
            timestamps = [
                t for t in timestamps if now - t <= self.sustained_period
            ]
            self._history[client_id] = timestamps

            recent_burst = [
                t for t in timestamps if now - t <= self.burst_period
            ]
            if len(recent_burst) >= self.burst_limit:
                retry_after = (
                    int(self.burst_period - (now - recent_burst[0])) + 1
                )
                raise HTTPException(
                    status_code=429,
                    detail="Too many alignment requests. Please wait a moment before syncing again.",
                    headers={"Retry-After": str(max(1, retry_after))},
                )

            if len(timestamps) >= self.sustained_limit:
                retry_after = (
                    int(self.sustained_period - (now - timestamps[0])) + 1
                )
                raise HTTPException(
                    status_code=429,
                    detail="Rate limit exceeded. Please wait a moment before syncing again.",
                    headers={"Retry-After": str(max(1, retry_after))},
                )

            self._history[client_id].append(now)

    def _cleanup(self, now: float) -> None:
        self._last_cleanup = now
        expired_keys = [
            k
            for k, v in self._history.items()
            if not v or now - v[-1] > self.sustained_period
        ]
        for k in expired_keys:
            del self._history[k]


_rate_limiter = SlidingWindowRateLimiter()


def get_client_id(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    client = request.client
    return client.host if client else "unknown"


async def check_request_rate_limit(request: Request) -> None:
    client_id = get_client_id(request)
    await _rate_limiter.check_rate_limit(client_id)


async def run_protected_inference(func: Callable[..., Any], *args: Any) -> Any:
    try:
        await asyncio.wait_for(
            _inference_semaphore.acquire(), timeout=CONCURRENCY_TIMEOUT_SEC
        )
    except asyncio.TimeoutError:
        raise HTTPException(
            status_code=503,
            detail="AI inference service is currently at capacity. Please retry in a few seconds.",
            headers={"Retry-After": "3"},
        )

    try:
        return await asyncio.wait_for(
            asyncio.to_thread(func, *args),
            timeout=INFERENCE_TIMEOUT_SEC,
        )
    except asyncio.TimeoutError:
        raise HTTPException(
            status_code=504,
            detail="AI inference timed out while processing audio.",
        )
    finally:
        _inference_semaphore.release()
