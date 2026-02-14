from __future__ import annotations

import hashlib
import mimetypes
import os
from dataclasses import dataclass
from typing import Literal

RoutedFormat = Literal["pdf", "html", "txt", "unsupported"]


@dataclass
class RoutedFile:
    format: RoutedFormat
    mime_type: str
    ext: str
    sha256: str


def _looks_like_html(raw_bytes: bytes) -> bool:
    if not raw_bytes:
        return False
    head = raw_bytes[:4096].lstrip().lower()
    return (
        head.startswith(b"<!doctype html")
        or head.startswith(b"<html")
        or b"<html" in head
        or b"<head" in head
        or b"<body" in head
    )


def _looks_like_pdf(raw_bytes: bytes) -> bool:
    return raw_bytes.startswith(b"%PDF-")


def route_file(*, filename: str, declared_mime_type: str | None, raw_bytes: bytes) -> RoutedFile:
    ext = os.path.splitext(filename or "")[1].lower()
    sha256 = hashlib.sha256(raw_bytes).hexdigest()

    guessed_mime_type = mimetypes.guess_type(filename or "", strict=False)[0]
    mime_type = (declared_mime_type or guessed_mime_type or "application/octet-stream").lower()

    if _looks_like_pdf(raw_bytes) or mime_type == "application/pdf" or ext == ".pdf":
        return RoutedFile(format="pdf", mime_type="application/pdf", ext=ext, sha256=sha256)

    if _looks_like_html(raw_bytes) or mime_type in {"text/html", "application/xhtml+xml"} or ext in {".html", ".htm", ".xhtml"}:
        return RoutedFile(format="html", mime_type="text/html", ext=ext, sha256=sha256)

    if mime_type.startswith("text/plain") or ext in {".txt", ".text", ".md"}:
        return RoutedFile(format="txt", mime_type="text/plain", ext=ext, sha256=sha256)

    return RoutedFile(format="unsupported", mime_type=mime_type, ext=ext, sha256=sha256)
