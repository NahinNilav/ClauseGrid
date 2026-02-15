from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
from typing import Any, Dict, List, Optional, Tuple

import pypdfium2 as pdfium

from artifact_schema import Block, Citation
from parsers.docling_blocks import blocks_from_docling_json
from parsers.pdf_runtime import (
    acquire_pdfium_lock,
    pdf_docling_runtime_state,
    record_pdf_docling_worker_error,
)


def _normalize_whitespace(text: str) -> str:
    return re.sub(r"[ \t]+", " ", text).strip()


def _union_bboxes(bboxes: List[Tuple[float, float, float, float]]) -> Optional[List[float]]:
    if not bboxes:
        return None
    x0 = min(b[0] for b in bboxes)
    y0 = min(b[1] for b in bboxes)
    x1 = max(b[2] for b in bboxes)
    y1 = max(b[3] for b in bboxes)
    return [float(x0), float(y0), float(x1), float(y1)]


def _bbox_for_char_range(text_page, start_char: int, end_char: int, max_chars: int = 512) -> Optional[List[float]]:
    bboxes: List[Tuple[float, float, float, float]] = []
    last = min(end_char, start_char + max_chars)
    for index in range(start_char, max(start_char, last)):
        try:
            x0, y0, x1, y1 = text_page.get_charbox(index)
        except Exception:
            continue
        if (x1 - x0) <= 0 or (y1 - y0) <= 0:
            continue
        bboxes.append((x0, y0, x1, y1))

    return _union_bboxes(bboxes)


def _page_index_from_pdfium(pdf_path: str) -> Dict[str, Dict[str, float]]:
    page_index: Dict[str, Dict[str, float]] = {}
    with acquire_pdfium_lock():
        pdf = pdfium.PdfDocument(pdf_path)
        try:
            for page_no in range(1, len(pdf) + 1):
                page = pdf[page_no - 1]
                try:
                    width, height = page.get_size()
                finally:
                    page.close()
                page_index[str(page_no)] = {
                    "width": float(width),
                    "height": float(height),
                }
        finally:
            pdf.close()
    return page_index


def _blocks_from_pdfium(pdf_path: str) -> Dict[str, Any]:
    with acquire_pdfium_lock():
        pdf = pdfium.PdfDocument(pdf_path)

        try:
            markdown_pages: List[str] = []
            blocks: List[Block] = []

            for page_index in range(len(pdf)):
                page = pdf[page_index]
                text_page = page.get_textpage()
                try:
                    page_text = text_page.get_text_range()
                    page_text = page_text.replace("\r", "")

                    paragraphs = [p for p in re.split(r"\n\s*\n+", page_text) if _normalize_whitespace(p)]
                    search_offset = 0

                    markdown_pages.append(f"## Page {page_index + 1}\n\n{page_text.strip()}")

                    for paragraph in paragraphs:
                        normalized = _normalize_whitespace(paragraph)
                        if not normalized:
                            continue

                        start = page_text.find(paragraph, search_offset)
                        if start < 0:
                            start = max(search_offset, 0)
                        end = start + len(paragraph)
                        search_offset = end

                        snippet = normalized[:240]
                        citation = Citation(
                            source="pdf",
                            page=page_index + 1,
                            start_char=start,
                            end_char=end,
                            bbox=_bbox_for_char_range(text_page, start, end),
                            snippet=snippet,
                        )

                        block_type = "table" if "|" in paragraph else "paragraph"
                        blocks.append(
                            Block(
                                id=f"block_{len(blocks) + 1}",
                                block_type=block_type,
                                text=normalized,
                                citations=[citation],
                            )
                        )
                finally:
                    text_page.close()
                    page.close()

            return {
                "markdown": "\n\n".join(markdown_pages),
                "docling_json": {
                    "schema_name": "pdfium_fallback",
                    "pages": len(pdf),
                },
                "blocks": blocks,
                "parser": "pypdfium2",
            }
        finally:
            pdf.close()


def _run_docling_pdf_worker(pdf_path: str, timeout_seconds: int = 180) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    worker_path = os.path.join(os.path.dirname(__file__), "pdf_docling_worker.py")

    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as tmp:
        output_path = tmp.name

    cmd = [sys.executable, worker_path, pdf_path, output_path]
    try:
        completed = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
        )
    except subprocess.TimeoutExpired:
        if os.path.exists(output_path):
            os.remove(output_path)
        return None, "docling_pdf_worker_timeout"
    except OSError as exc:
        if os.path.exists(output_path):
            os.remove(output_path)
        return None, f"docling_pdf_worker_failed_to_start: {exc}"

    if completed.returncode != 0:
        stderr = (completed.stderr or "").strip()
        stdout = (completed.stdout or "").strip()
        details = stderr or stdout or f"worker exit code {completed.returncode}"
        if os.path.exists(output_path):
            os.remove(output_path)
        return None, details

    try:
        with open(output_path, "r", encoding="utf-8") as f:
            payload = json.load(f)
    finally:
        if os.path.exists(output_path):
            os.remove(output_path)

    return payload, None


def parse_pdf(
    *,
    pdf_path: str,
) -> Dict[str, Any]:
    page_index = _page_index_from_pdfium(pdf_path)
    runtime_state = pdf_docling_runtime_state()
    payload: Optional[Dict[str, Any]] = None
    worker_error: Optional[str] = None

    if bool(runtime_state.get("worker_enabled")):
        payload, worker_error = _run_docling_pdf_worker(pdf_path)
        if worker_error:
            record_pdf_docling_worker_error(worker_error)
            runtime_state = pdf_docling_runtime_state()
    else:
        worker_error = str(runtime_state.get("disable_reason") or "docling_worker_disabled")

    if payload:
        docling_json = payload.get("docling_json") or {}
        blocks = blocks_from_docling_json(docling_json, source="pdf")

        # If Docling returns no structural blocks, fallback to robust text extraction.
        if blocks:
            has_page_citations = any(
                citation.page is not None
                for block in blocks
                for citation in block.citations
            )
            if not has_page_citations:
                fallback = _blocks_from_pdfium(pdf_path)
                fallback["worker_error"] = "docling_returned_blocks_without_page_citations"
                fallback["page_index"] = page_index
                fallback["pdf_docling_mode_effective"] = runtime_state.get("effective_mode")
                fallback["pdf_docling_disable_reason"] = runtime_state.get("disable_reason")
                return fallback

            return {
                "markdown": str(payload.get("markdown") or ""),
                "docling_json": docling_json,
                "blocks": blocks,
                "parser": "docling",
                "worker_error": None,
                "page_index": page_index,
                "pdf_docling_mode_effective": runtime_state.get("effective_mode"),
                "pdf_docling_disable_reason": runtime_state.get("disable_reason"),
            }

    fallback = _blocks_from_pdfium(pdf_path)
    fallback["worker_error"] = worker_error
    fallback["page_index"] = page_index
    fallback["pdf_docling_mode_effective"] = runtime_state.get("effective_mode")
    fallback["pdf_docling_disable_reason"] = runtime_state.get("disable_reason")
    return fallback
