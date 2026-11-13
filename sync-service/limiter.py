from __future__ import annotations

import asyncio
import atexit
import importlib
import ipaddress
import multiprocessing as mp
import os
import sys
import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any, Callable

from fastapi import HTTPException, Request

MAX_CONCURRENT_INFERENCES = max(1, int(os.getenv("MAX_CONCURRENT_INFERENCES", "2")))
MAX_WAITING_INFERENCES = max(
    1,
    int(os.getenv("MAX_WAITING_INFERENCES", str(max(4, MAX_CONCURRENT_INFERENCES * 3)))),
)
CONCURRENCY_TIMEOUT_SEC = float(os.getenv("CONCURRENCY_TIMEOUT_SEC", "5.0"))
INFERENCE_TIMEOUT_SEC = float(os.getenv("INFERENCE_TIMEOUT_SEC", "15.0"))
WORKER_RECYCLE_TASKS = max(1, int(os.getenv("WORKER_RECYCLE_TASKS", "250")))
WORKER_START_TIMEOUT_SEC = float(os.getenv("WORKER_START_TIMEOUT_SEC", "10.0"))

RATE_LIMIT_BURST = int(os.getenv("RATE_LIMIT_BURST", "6"))
RATE_LIMIT_BURST_PERIOD = float(os.getenv("RATE_LIMIT_BURST_PERIOD", "10.0"))
RATE_LIMIT_SUSTAINED = int(os.getenv("RATE_LIMIT_SUSTAINED", "20"))
RATE_LIMIT_SUSTAINED_PERIOD = float(
    os.getenv("RATE_LIMIT_SUSTAINED_PERIOD", "60.0")
)
RATE_LIMIT_MAX_CLIENTS = max(10, int(os.getenv("RATE_LIMIT_MAX_CLIENTS", "10000")))

_inference_semaphore = asyncio.Semaphore(MAX_CONCURRENT_INFERENCES)
_WORKER_SYS_PATHS = tuple(
    dict.fromkeys(
        p
        for p in (os.path.dirname(os.path.abspath(__file__)), os.getcwd(), *sys.path)
        if isinstance(p, str) and p
    )
)


def _is_process_pool_enabled() -> bool:
    return os.getenv("SYNC_USE_PROCESS_POOL", "1").strip().lower() not in {
        "0",
        "false",
        "no",
        "off",
    }


def _parse_trusted_proxy_networks() -> tuple[ipaddress._BaseNetwork, ...]:
    raw = os.getenv("TRUSTED_PROXY_CIDRS", "")
    nets: list[ipaddress._BaseNetwork] = []
    for token in raw.split(","):
        token = token.strip()
        if not token:
            continue
        try:
            nets.append(ipaddress.ip_network(token, strict=False))
        except ValueError:
            continue
    return tuple(nets)


def _is_trusted_proxy_host(
    host: str,
    trusted_nets: tuple[ipaddress._BaseNetwork, ...],
) -> bool:
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False
    if ip.is_loopback:
        return True
    return any(ip in net for net in trusted_nets)


class SlidingWindowRateLimiter:
    def __init__(
        self,
        burst_limit: int = RATE_LIMIT_BURST,
        burst_period: float = RATE_LIMIT_BURST_PERIOD,
        sustained_limit: int = RATE_LIMIT_SUSTAINED,
        sustained_period: float = RATE_LIMIT_SUSTAINED_PERIOD,
        max_clients: int = RATE_LIMIT_MAX_CLIENTS,
    ):
        self._history: OrderedDict[str, list[float]] = OrderedDict()
        self._locks: dict[int, asyncio.Lock] = {}
        self._last_cleanup = time.time()
        self.burst_limit = burst_limit
        self.burst_period = burst_period
        self.sustained_limit = sustained_limit
        self.sustained_period = sustained_period
        self.max_clients = max(10, int(max_clients))

    def _get_lock(self) -> asyncio.Lock:
        loop_id = id(asyncio.get_running_loop())
        lock = self._locks.get(loop_id)
        if lock is None:
            lock = asyncio.Lock()
            # Bound stale event-loop locks across repeated async test runs
            if len(self._locks) >= 64:
                self._locks.clear()
            self._locks[loop_id] = lock
        return lock

    async def check_rate_limit(self, client_id: str) -> None:
        now = time.time()
        key = (client_id or "unknown")[:64]
        async with self._get_lock():
            if now - self._last_cleanup > 60.0:
                self._cleanup(now)

            if key not in self._history and len(self._history) >= self.max_clients:
                self._cleanup(now)
                while len(self._history) >= self.max_clients:
                    self._history.popitem(last=False)

            timestamps = self._history.get(key, [])
            timestamps = [
                t for t in timestamps if now - t <= self.sustained_period
            ]
            if key not in self._history and len(self._history) >= self.max_clients:
                self._history.popitem(last=False)
            self._history[key] = timestamps
            self._history.move_to_end(key)

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

            self._history[key].append(now)

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
    """Resolve client IP without trusting spoofable forwarding headers by default."""
    client = request.client
    peer_host = (client.host if client and client.host else "unknown").strip() or "unknown"
    trust_proxy = os.getenv("TRUST_PROXY_HEADERS", "0").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    if not trust_proxy:
        return peer_host[:64]

    trusted_nets = _parse_trusted_proxy_networks()
    if not _is_trusted_proxy_host(peer_host, trusted_nets):
        return peer_host[:64]

    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        hops = [part.strip() for part in forwarded.split(",") if part.strip()]
        for raw_ip in reversed(hops):
            try:
                parsed = ipaddress.ip_address(raw_ip)
            except ValueError:
                continue
            if not _is_trusted_proxy_host(str(parsed), trusted_nets):
                return str(parsed)[:64]
        for raw_ip in hops:
            try:
                return str(ipaddress.ip_address(raw_ip))[:64]
            except ValueError:
                continue
    return peer_host[:64]


async def check_request_rate_limit(request: Request) -> None:
    client_id = get_client_id(request)
    await _rate_limiter.check_rate_limit(client_id)


def _worker_main(
    req_recv: Any,
    resp_send: Any,
    sys_paths: tuple[str, ...],
) -> None:
    """Persistent isolated subprocess executing CPU-bound alignment calls."""
    for env_key in (
        "OMP_NUM_THREADS",
        "OPENBLAS_NUM_THREADS",
        "MKL_NUM_THREADS",
        "NUMEXPR_NUM_THREADS",
        "ORT_INTRA_OP_THREADS",
    ):
        os.environ.setdefault(env_key, "1")

    for path in reversed(sys_paths):
        if path and path not in sys.path:
            sys.path.insert(0, path)

    try:
        from model_runtime import preload_transcribers

        preload_transcribers()
    except Exception:
        pass

    try:
        resp_send.send(("ready", os.getpid()))
    except (BrokenPipeError, OSError):
        return

    while True:
        try:
            task = req_recv.recv()
        except (EOFError, OSError):
            break
        if task is None:
            break

        module_name, func_name, args = task
        try:
            mod = importlib.import_module(module_name)
            fn = getattr(mod, func_name)
            result = fn(*args)
        except HTTPException as exc:
            headers = dict(exc.headers) if exc.headers else None
            try:
                resp_send.send(("http_err", exc.status_code, exc.detail, headers))
            except (BrokenPipeError, OSError):
                break
        except ValueError as exc:
            try:
                resp_send.send(("value_err", str(exc)))
            except (BrokenPipeError, OSError):
                break
        except BaseException as exc:
            try:
                resp_send.send(("runtime_err", f"{type(exc).__name__}: {exc}"))
            except (BrokenPipeError, OSError):
                break
        else:
            try:
                resp_send.send(("ok", result))
            except (BrokenPipeError, OSError):
                break


@dataclass
class _WorkerSlot:
    slot_id: int
    process: Any = None
    req_send: Any = None
    resp_recv: Any = None
    tasks_completed: int = 0

    def is_alive(self) -> bool:
        return (
            self.process is not None
            and self.process.is_alive()
            and self.req_send is not None
            and self.resp_recv is not None
        )

    def ensure_started(self) -> None:
        if self.is_alive():
            return
        self.kill()
        ctx = mp.get_context("spawn")
        child_req_recv, parent_req_send = ctx.Pipe(duplex=False)
        parent_resp_recv, child_resp_send = ctx.Pipe(duplex=False)
        proc = ctx.Process(
            target=_worker_main,
            args=(child_req_recv, child_resp_send, _WORKER_SYS_PATHS),
            daemon=True,
            name=f"sync-worker-{self.slot_id}",
        )
        proc.start()
        # Close child ends in parent so EOF triggers immediately on worker exit/crash
        try:
            child_req_recv.close()
        except Exception:
            pass
        try:
            child_resp_send.close()
        except Exception:
            pass
        if not parent_resp_recv.poll(WORKER_START_TIMEOUT_SEC):
            try:
                proc.kill()
                proc.join(timeout=0.4)
            except Exception:
                pass
            raise TimeoutError("Sync worker process failed to become ready in time")
        ready_msg = parent_resp_recv.recv()
        if not isinstance(ready_msg, tuple) or ready_msg[0] != "ready":
            raise RuntimeError("Sync worker process sent unexpected startup handshake")
        self.process = proc
        self.req_send = parent_req_send
        self.resp_recv = parent_resp_recv
        self.tasks_completed = 0

    def kill(self) -> None:
        proc = self.process
        req_send = self.req_send
        resp_recv = self.resp_recv
        self.process = None
        self.req_send = None
        self.resp_recv = None
        self.tasks_completed = 0

        if req_send is not None:
            try:
                req_send.close()
            except Exception:
                pass
        if resp_recv is not None:
            try:
                resp_recv.close()
            except Exception:
                pass
        if proc is not None:
            try:
                if proc.is_alive():
                    proc.terminate()
                    proc.join(timeout=0.4)
                    if proc.is_alive():
                        proc.kill()
                        proc.join(timeout=0.4)
                else:
                    proc.join(timeout=0.1)
            except Exception:
                pass


def _is_importable_top_level(func: Any) -> bool:
    mod_name = getattr(func, "__module__", None)
    qualname = getattr(func, "__qualname__", "")
    func_name = getattr(func, "__name__", "")
    if not mod_name or not func_name or "." in qualname or "<locals>" in qualname:
        return False
    mod = sys.modules.get(mod_name)
    if mod is None:
        return False
    return getattr(mod, func_name, None) is func


def _contains_mock_in_scope(func: Any, args: tuple[Any, ...]) -> bool:
    if "unittest.mock" not in sys.modules:
        return False
    from unittest.mock import Base as MockBase

    if isinstance(func, MockBase):
        return True
    if any(isinstance(arg, MockBase) for arg in args):
        return True

    checked_modules: list[Any] = []
    mod = sys.modules.get(getattr(func, "__module__", ""))
    if mod is not None:
        checked_modules.append(mod)
    for helper_name in ("app", "alignment", "vad", "fft_align", "split_align"):
        helper_mod = sys.modules.get(helper_name)
        if helper_mod is not None and helper_mod not in checked_modules:
            checked_modules.append(helper_mod)

    for module in checked_modules:
        for val in vars(module).values():
            if isinstance(val, MockBase):
                return True
            if hasattr(val, "__dict__") and not isinstance(val, type):
                for attr_val in vars(val).values():
                    if isinstance(attr_val, MockBase):
                        return True
    return False


class _InferenceSlotPool:
    """Manages bounded worker slots, fail-fast queueing, and timeout PID reaping."""

    def __init__(self) -> None:
        self._slots: list[_WorkerSlot] = []
        self._loop: asyncio.AbstractEventLoop | None = None
        self._free_slots: asyncio.Queue[_WorkerSlot] | None = None
        self._waiting_count = 0

    def _ensure_loop_queue(self) -> asyncio.Queue[_WorkerSlot]:
        loop = asyncio.get_running_loop()
        target_size = max(1, int(MAX_CONCURRENT_INFERENCES))
        if (
            self._loop is not loop
            or self._free_slots is None
            or len(self._slots) != target_size
        ):
            if len(self._slots) != target_size:
                for slot in self._slots:
                    slot.kill()
                self._slots = [_WorkerSlot(slot_id=i) for i in range(target_size)]
            self._loop = loop
            self._free_slots = asyncio.Queue(maxsize=target_size)
            for slot in self._slots:
                self._free_slots.put_nowait(slot)
            self._waiting_count = 0
        return self._free_slots

    async def acquire(self) -> _WorkerSlot:
        queue = self._ensure_loop_queue()
        max_waiting = max(1, int(MAX_WAITING_INFERENCES))
        if queue.empty() and self._waiting_count >= max_waiting:
            raise HTTPException(
                status_code=503,
                detail="AI inference service is currently at capacity. Please retry in a few seconds.",
                headers={"Retry-After": "3"},
            )

        self._waiting_count += 1
        try:
            return await asyncio.wait_for(
                queue.get(),
                timeout=float(CONCURRENCY_TIMEOUT_SEC),
            )
        except asyncio.TimeoutError:
            raise HTTPException(
                status_code=503,
                detail="AI inference service is currently at capacity. Please retry in a few seconds.",
                headers={"Retry-After": "3"},
            )
        finally:
            self._waiting_count = max(0, self._waiting_count - 1)

    def release(self, slot: _WorkerSlot) -> None:
        if self._free_slots is None:
            return
        try:
            self._free_slots.put_nowait(slot)
        except asyncio.QueueFull:
            pass

    async def warmup(self) -> None:
        self._ensure_loop_queue()
        slots = list(self._slots)
        await asyncio.to_thread(lambda: [s.ensure_started() for s in slots])

    def shutdown_sync(self) -> None:
        for slot in self._slots:
            slot.kill()
        self._slots = []
        self._free_slots = None
        self._loop = None
        self._waiting_count = 0


_slot_pool = _InferenceSlotPool()


def shutdown_inference_pool_sync() -> None:
    _slot_pool.shutdown_sync()


atexit.register(shutdown_inference_pool_sync)


async def warmup_inference_pool() -> None:
    if _is_process_pool_enabled() and "PYTEST_CURRENT_TEST" not in os.environ:
        await _slot_pool.warmup()


async def shutdown_inference_pool() -> None:
    await asyncio.to_thread(_slot_pool.shutdown_sync)


async def _recv_from_slot(slot: _WorkerSlot, timeout: float) -> Any:
    resp_recv = slot.resp_recv
    if resp_recv is None:
        raise RuntimeError("Worker response pipe closed")

    loop = asyncio.get_running_loop()
    try:
        fd = resp_recv.fileno()
    except (OSError, ValueError):
        fd = -1

    if fd >= 0:
        fut: asyncio.Future[Any] = loop.create_future()

        def _on_readable() -> None:
            if fut.done():
                return
            try:
                msg = resp_recv.recv()
            except BaseException as exc:
                fut.set_exception(exc)
            else:
                fut.set_result(msg)

        try:
            loop.add_reader(fd, _on_readable)
        except NotImplementedError:
            fd = -1
        else:
            try:
                return await asyncio.wait_for(fut, timeout=timeout)
            finally:
                try:
                    loop.remove_reader(fd)
                except Exception:
                    pass

    return await asyncio.wait_for(asyncio.to_thread(resp_recv.recv), timeout=timeout)


def _raise_worker_error(msg: tuple[Any, ...]) -> Any:
    kind = msg[0]
    if kind == "ok":
        return msg[1]
    if kind == "http_err":
        _, status_code, detail, headers = msg
        raise HTTPException(status_code=status_code, detail=detail, headers=headers)
    if kind == "value_err":
        raise ValueError(msg[1])
    raise RuntimeError(msg[1] if len(msg) > 1 else "Worker execution failed")


async def run_protected_inference(func: Callable[..., Any], *args: Any) -> Any:
    """Execute bounded inference, killing timed-out subprocess workers cleanly."""
    slot = await _slot_pool.acquire()
    use_process = (
        _is_process_pool_enabled()
        and _is_importable_top_level(func)
        and not _contains_mock_in_scope(func, args)
    )

    if not use_process:
        try:
            return await asyncio.wait_for(
                asyncio.to_thread(func, *args),
                timeout=float(INFERENCE_TIMEOUT_SEC),
            )
        except asyncio.TimeoutError:
            raise HTTPException(
                status_code=504,
                detail="AI inference timed out while processing audio.",
            )
        finally:
            _slot_pool.release(slot)

    reap_worker = False
    msg: tuple[Any, ...] | None = None
    try:
        await asyncio.wait_for(
            asyncio.to_thread(slot.ensure_started),
            timeout=WORKER_START_TIMEOUT_SEC,
        )
        req_send = slot.req_send
        if req_send is None:
            raise RuntimeError("Worker request pipe unavailable")
        await asyncio.to_thread(
            req_send.send,
            (func.__module__, func.__name__, args),
        )
        msg = await _recv_from_slot(slot, float(INFERENCE_TIMEOUT_SEC))
        slot.tasks_completed += 1
        if slot.tasks_completed >= WORKER_RECYCLE_TASKS:
            reap_worker = True
    except asyncio.TimeoutError:
        reap_worker = True
        raise HTTPException(
            status_code=504,
            detail="AI inference timed out while processing audio.",
        )
    except (EOFError, BrokenPipeError, OSError) as exc:
        reap_worker = True
        raise HTTPException(
            status_code=503,
            detail="AI inference worker restarted unexpectedly. Please retry.",
            headers={"Retry-After": "1"},
        ) from exc
    except asyncio.CancelledError:
        reap_worker = True
        raise
    finally:
        if reap_worker:
            try:
                await asyncio.shield(asyncio.to_thread(slot.kill))
            except BaseException:
                slot.kill()
        _slot_pool.release(slot)

    if msg is None:
        raise RuntimeError("Empty worker response")
    return _raise_worker_error(msg)
