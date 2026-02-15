from __future__ import annotations

import os
import threading
import time
from contextlib import contextmanager
from typing import Iterator, Optional


def _env_int(name: str, default: int, *, minimum: int = 1) -> int:
    raw = os.getenv(name)
    try:
        value = int(raw) if raw is not None else int(default)
    except (TypeError, ValueError):
        value = int(default)
    return max(minimum, value)


def _normalize_docling_mode(value: str | None) -> str:
    normalized = str(value or "auto").strip().lower()
    if normalized in {"auto", "enabled", "disabled"}:
        return normalized
    return "auto"


def _is_fatal_docling_error(message: str) -> bool:
    text = str(message or "").lower()
    if not text:
        return False
    fatal_markers = (
        "nsrangeexception",
        "libmlx",
        "metal",
        "abort trap",
        "pure virtual function",
    )
    return any(marker in text for marker in fatal_markers)


_PARSE_MAX_CONCURRENCY = _env_int("LEGAL_PARSE_MAX_CONCURRENCY", 1, minimum=1)
_PARSE_SEMAPHORE = threading.BoundedSemaphore(_PARSE_MAX_CONCURRENCY)
_PDFIUM_LOCK = threading.RLock()

_PDF_DOCLING_MODE = _normalize_docling_mode(os.getenv("LEGAL_PDF_DOCLING_MODE", "auto"))
_PDF_DOCLING_STATE_LOCK = threading.Lock()
_PDF_DOCLING_DISABLED_REASON: Optional[str] = (
    "disabled_by_env: LEGAL_PDF_DOCLING_MODE=disabled"
    if _PDF_DOCLING_MODE == "disabled"
    else None
)


def parse_max_concurrency() -> int:
    return _PARSE_MAX_CONCURRENCY


@contextmanager
def acquire_parse_slot() -> Iterator[float]:
    start = time.perf_counter()
    _PARSE_SEMAPHORE.acquire()
    wait_ms = (time.perf_counter() - start) * 1000.0
    try:
        yield wait_ms
    finally:
        _PARSE_SEMAPHORE.release()


@contextmanager
def acquire_pdfium_lock() -> Iterator[None]:
    _PDFIUM_LOCK.acquire()
    try:
        yield
    finally:
        _PDFIUM_LOCK.release()


def pdf_docling_runtime_state() -> dict[str, Optional[str] | bool]:
    with _PDF_DOCLING_STATE_LOCK:
        disabled_reason = _PDF_DOCLING_DISABLED_REASON
        mode = _PDF_DOCLING_MODE
        worker_enabled = mode == "enabled" or (mode == "auto" and disabled_reason is None)
        if mode == "auto" and disabled_reason:
            effective = "auto_disabled"
        elif mode == "disabled":
            effective = "disabled"
        elif mode == "enabled":
            effective = "enabled"
        else:
            effective = "auto"
        return {
            "configured_mode": mode,
            "effective_mode": effective,
            "worker_enabled": worker_enabled,
            "disable_reason": disabled_reason,
        }


def record_pdf_docling_worker_error(error_message: str) -> None:
    global _PDF_DOCLING_DISABLED_REASON
    if not _is_fatal_docling_error(error_message):
        return
    with _PDF_DOCLING_STATE_LOCK:
        if _PDF_DOCLING_MODE != "auto":
            return
        if _PDF_DOCLING_DISABLED_REASON:
            return
        _PDF_DOCLING_DISABLED_REASON = f"auto_disabled_after_fatal_worker_error: {str(error_message or '').strip()[:240]}"


def reset_pdf_docling_runtime_state_for_tests(mode: str = "auto") -> None:
    normalized_mode = _normalize_docling_mode(mode)
    with _PDF_DOCLING_STATE_LOCK:
        global _PDF_DOCLING_MODE
        global _PDF_DOCLING_DISABLED_REASON
        _PDF_DOCLING_MODE = normalized_mode
        _PDF_DOCLING_DISABLED_REASON = (
            "disabled_by_env: LEGAL_PDF_DOCLING_MODE=disabled"
            if normalized_mode == "disabled"
            else None
        )
