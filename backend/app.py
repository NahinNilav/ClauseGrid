from __future__ import annotations

import json
import logging
import os

from dotenv import load_dotenv
load_dotenv()
import re
import tempfile
import time
import uuid
from base64 import b64encode
from io import BytesIO
from typing import Any, Dict, Literal, Optional

import pypdfium2 as pdfium
from docling.datamodel.base_models import InputFormat
from docling.document_converter import DocumentConverter, HTMLFormatOption
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from artifact_schema import build_citation_index, make_artifact
from chunker import chunk_blocks
from legal_api import router as legal_router
from mime_router import route_file
from parsers.docx_docling import parse_docx_with_docling
from parsers.html_docling import parse_html_with_docling
from parsers.pdf_docling import parse_pdf
from parsers.pdf_runtime import acquire_parse_slot, acquire_pdfium_lock
from parsers.text_plain import parse_text

app = FastAPI()
app.include_router(legal_router)

# Configure logging
logger = logging.getLogger("tabular.server")
if not logger.handlers:
    handler = logging.StreamHandler()
    formatter = logging.Formatter(
        "%(asctime)s %(levelname)s %(name)s %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    handler.setFormatter(formatter)
    logger.addHandler(handler)
logger.setLevel(logging.INFO)
logger.propagate = False


def log_structured(level: int, event: str, **fields: Any) -> None:
    payload = {"event": event, **fields}
    logger.log(level, json.dumps(payload, default=str))


# Configure CORS
origins = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:5173",  # Vite default
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def create_html_converter() -> DocumentConverter:
    return DocumentConverter(
        format_options={
            InputFormat.HTML: HTMLFormatOption(),
        }
    )


html_converter = create_html_converter()
docx_converter = DocumentConverter()


@app.middleware("http")
async def request_logging_middleware(request: Request, call_next):
    request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
    request.state.request_id = request_id
    start = time.perf_counter()

    try:
        response = await call_next(request)
    except Exception:
        duration_ms = round((time.perf_counter() - start) * 1000, 2)
        log_structured(
            logging.ERROR,
            "request_failed",
            request_id=request_id,
            method=request.method,
            path=request.url.path,
            duration_ms=duration_ms,
        )
        raise

    duration_ms = round((time.perf_counter() - start) * 1000, 2)
    log_structured(
        logging.INFO,
        "request_completed",
        request_id=request_id,
        method=request.method,
        path=request.url.path,
        status_code=response.status_code,
        duration_ms=duration_ms,
    )
    response.headers["x-request-id"] = request_id
    return response


class ClientLogEvent(BaseModel):
    event: str
    level: Literal["info", "warning", "error"] = "info"
    stage: Optional[str] = None
    run_id: Optional[str] = None
    message: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


def _write_temp_file(raw_bytes: bytes, suffix: str) -> str:
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(raw_bytes)
        return tmp.name


@app.post("/convert")
async def convert_document(request: Request, file: UploadFile = File(...)):
    request_id = getattr(request.state, "request_id", None)
    convert_start = time.perf_counter()

    try:
        raw_bytes = await file.read()
        if not raw_bytes:
            raise HTTPException(status_code=400, detail="Uploaded file is empty")

        routed = route_file(
            filename=file.filename or "",
            declared_mime_type=file.content_type,
            raw_bytes=raw_bytes,
        )

        log_structured(
            logging.INFO,
            "convert_started",
            request_id=request_id,
            filename=file.filename,
            content_type=file.content_type,
            routed_format=routed.format,
            routed_mime_type=routed.mime_type,
            ext=routed.ext,
            sha256=routed.sha256,
        )

        if routed.format == "unsupported":
            raise HTTPException(
                status_code=415,
                detail=f"Unsupported file type: {routed.mime_type or 'unknown'} ({routed.ext or 'no extension'})",
            )

        parser_result: Dict[str, Any]
        queue_wait_ms = 0.0
        with acquire_parse_slot() as waited_ms:
            queue_wait_ms = round(waited_ms, 2)

            if routed.format == "pdf":
                suffix = routed.ext or ".pdf"
                tmp_path = _write_temp_file(raw_bytes, suffix=suffix)
                try:
                    parser_result = parse_pdf(pdf_path=tmp_path)
                finally:
                    if os.path.exists(tmp_path):
                        os.remove(tmp_path)

            elif routed.format == "html":
                parser_result = parse_html_with_docling(
                    converter=html_converter,
                    raw_bytes=raw_bytes,
                    filename=file.filename or "document.html",
                )

            elif routed.format == "docx":
                parser_result = parse_docx_with_docling(
                    converter=docx_converter,
                    raw_bytes=raw_bytes,
                    filename=file.filename or "document.docx",
                )

            else:
                parser_result = parse_text(raw_bytes)

        blocks = parser_result["blocks"]
        chunks = chunk_blocks(blocks)
        citation_index = build_citation_index(blocks)

        doc_version_id = f"dv_{uuid.uuid4().hex[:12]}"
        artifact = make_artifact(
            doc_version_id=doc_version_id,
            doc_format=routed.format,
            filename=file.filename or "",
            mime_type=routed.mime_type,
            ext=routed.ext,
            sha256=routed.sha256,
            markdown=parser_result.get("markdown", ""),
            docling_json=parser_result.get("docling_json", {}),
            blocks=blocks,
            chunks=chunks,
            citation_index=citation_index,
            preview_html=parser_result.get("preview_html"),
            metadata={
                "parser": parser_result.get("parser", "unknown"),
                "dom_map_size": parser_result.get("dom_map_size"),
                "worker_error": parser_result.get("worker_error"),
                "page_index": parser_result.get("page_index", {}),
                "pdf_docling_mode_effective": parser_result.get("pdf_docling_mode_effective"),
                "pdf_docling_disable_reason": parser_result.get("pdf_docling_disable_reason"),
                "queue_wait_ms": queue_wait_ms,
            },
        )

        duration_ms = round((time.perf_counter() - convert_start) * 1000, 2)
        log_structured(
            logging.INFO,
            "convert_completed",
            request_id=request_id,
            filename=file.filename,
            markdown_chars=len(artifact["markdown"]),
            block_count=len(artifact["blocks"]),
            chunk_count=len(artifact["chunks"]),
            citations_count=len(artifact["citation_index"]),
            parser=artifact["metadata"].get("parser"),
            queue_wait_ms=queue_wait_ms,
            pdf_docling_mode_effective=artifact["metadata"].get("pdf_docling_mode_effective"),
            pdf_docling_disable_reason=artifact["metadata"].get("pdf_docling_disable_reason"),
            duration_ms=duration_ms,
        )

        # Preserve markdown for existing frontend behavior, add rich artifact payload.
        return {
            "markdown": artifact["markdown"],
            "artifact": artifact,
        }

    except HTTPException:
        raise
    except Exception as e:
        duration_ms = round((time.perf_counter() - convert_start) * 1000, 2)
        log_structured(
            logging.ERROR,
            "convert_failed",
            request_id=request_id,
            filename=file.filename,
            duration_ms=duration_ms,
            error=str(e),
        )
        raise HTTPException(status_code=500, detail=str(e))


def _bbox_from_char_range(text_page, start: int, count: int) -> Optional[list[float]]:
    if count <= 0:
        return None
    boxes = []
    for idx in range(start, start + count):
        try:
            x0, y0, x1, y1 = text_page.get_charbox(idx)
        except Exception:
            continue
        if x1 <= x0 or y1 <= y0:
            continue
        boxes.append((x0, y0, x1, y1))

    if not boxes:
        return None

    return [
        float(min(b[0] for b in boxes)),
        float(min(b[1] for b in boxes)),
        float(max(b[2] for b in boxes)),
        float(max(b[3] for b in boxes)),
    ]


def _normalize_with_index_map(text: str) -> tuple[str, list[int]]:
    normalized_chars: list[str] = []
    index_map: list[int] = []
    prev_space = True
    for idx, ch in enumerate(text.lower()):
        if ch.isalnum():
            normalized_chars.append(ch)
            index_map.append(idx)
            prev_space = False
            continue
        if not prev_space:
            normalized_chars.append(" ")
            index_map.append(idx)
            prev_space = True

    while normalized_chars and normalized_chars[-1] == " ":
        normalized_chars.pop()
        index_map.pop()

    return "".join(normalized_chars), index_map


def _normalize_bbox(raw_bbox: Any) -> Optional[list[float]]:
    if not isinstance(raw_bbox, (list, tuple)) or len(raw_bbox) != 4:
        return None
    try:
        x0, y0, x1, y1 = [float(value) for value in raw_bbox]
    except (TypeError, ValueError):
        return None

    left = min(x0, x1)
    right = max(x0, x1)
    bottom = min(y0, y1)
    top = max(y0, y1)
    if right <= left or top <= bottom:
        return None
    return [left, bottom, right, top]


def _snippet_candidates(snippet: str) -> list[str]:
    raw = re.sub(r"\s+", " ", snippet.strip())
    if not raw:
        return []

    words = re.findall(r"\w+", raw)
    candidates = [raw]

    if words:
        for n in (18, 14, 10, 8, 6):
            if len(words) >= n:
                candidates.append(" ".join(words[:n]))
                candidates.append(" ".join(words[-n:]))
        if len(words) >= 5:
            mid = len(words) // 2
            candidates.append(" ".join(words[max(0, mid - 4): mid + 4]))

    deduped: list[str] = []
    seen = set()
    for candidate in candidates:
        c = candidate.strip()
        if c and c not in seen:
            seen.add(c)
            deduped.append(c)
    return deduped


def _token_overlap(left: str, right: str) -> float:
    left_tokens = {
        token
        for token in re.findall(r"[a-z0-9]+", (left or "").lower())
        if len(token) >= 2
    }
    right_tokens = {
        token
        for token in re.findall(r"[a-z0-9]+", (right or "").lower())
        if len(token) >= 2
    }
    if not left_tokens or not right_tokens:
        return 0.0
    return len(left_tokens & right_tokens) / max(1, len(right_tokens))


def _char_span_for_snippet(
    text_page,
    probe: str,
) -> Optional[tuple[int, int, str, str]]:
    candidates = _snippet_candidates(probe)
    if not candidates:
        return None

    # Try exact Pdfium search first with multiple snippet variants.
    for candidate in candidates:
        try:
            searcher = text_page.search(candidate)
            first = searcher.get_next()
            if first:
                start_char, count = first
                if count > 0:
                    return int(start_char), int(count), "exact", candidate
        except Exception:
            continue

    # Fuzzy fallback: normalize both strings and map back to original char range.
    try:
        page_text = text_page.get_text_range()
    except Exception:
        return None

    normalized_page, index_map = _normalize_with_index_map(page_text)
    if not normalized_page or not index_map:
        return None

    for candidate in candidates:
        normalized_candidate, _ = _normalize_with_index_map(candidate)
        if not normalized_candidate:
            continue
        pos = normalized_page.find(normalized_candidate)
        if pos < 0:
            continue
        end_pos = pos + len(normalized_candidate) - 1
        if end_pos >= len(index_map):
            continue

        start_orig = index_map[pos]
        end_orig = index_map[end_pos] + 1
        if end_orig > start_orig:
            return start_orig, end_orig - start_orig, "fuzzy", candidate

    return None


def _safe_text_range(text_page, start_char: int, count: int) -> str:
    if count <= 0:
        return ""
    try:
        return str(text_page.get_text_range(start_char, count) or "")
    except Exception:
        return ""


def _parse_json_array_of_strings(raw_value: str) -> list[str]:
    value = (raw_value or "").strip()
    if not value:
        return []
    try:
        payload = json.loads(value)
    except Exception:
        return []
    if not isinstance(payload, list):
        return []
    output: list[str] = []
    seen: set[str] = set()
    for item in payload:
        if not isinstance(item, str):
            continue
        normalized = re.sub(r"\s+", " ", item.strip())
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        output.append(normalized)
    return output


@app.post("/render-pdf-page")
async def render_pdf_page(
    request: Request,
    file: UploadFile = File(...),
    page: int = Form(1),
    scale: float = Form(1.5),
    snippet: str = Form(""),
    snippet_candidates_json: str = Form(""),
    citation_start_char: int | None = Form(None),
    citation_end_char: int | None = Form(None),
    citation_bbox_json: str = Form(""),
):
    request_id = getattr(request.state, "request_id", None)
    start = time.perf_counter()

    if page < 1:
        raise HTTPException(status_code=400, detail="page must be >= 1")
    if scale <= 0.1 or scale > 4.0:
        raise HTTPException(status_code=400, detail="scale out of range")

    raw_bytes = await file.read()
    if not raw_bytes:
        raise HTTPException(status_code=400, detail="Uploaded PDF is empty")

    tmp_path = _write_temp_file(raw_bytes, suffix=".pdf")
    try:
        with acquire_pdfium_lock():
            pdf = pdfium.PdfDocument(tmp_path)
            try:
                page_count = len(pdf)
                if page > page_count:
                    raise HTTPException(
                        status_code=400,
                        detail=f"page out of range: {page} > {page_count}",
                    )

                page_obj = pdf[page - 1]
                text_page = page_obj.get_textpage()
                try:
                    width, height = page_obj.get_size()

                    rendered = page_obj.render(scale=scale)
                    try:
                        pil_image = rendered.to_pil()
                        buffer = BytesIO()
                        pil_image.save(buffer, format="PNG")
                        image_base64 = b64encode(buffer.getvalue()).decode("ascii")
                    finally:
                        rendered.close()

                    matched_bbox = None
                    match_mode = "none"
                    match_confidence = 0.0
                    used_snippet = None
                    bbox_source = "none"
                    warning_code = None

                    snippet = (snippet or "").strip()
                    candidate_probes = []
                    if snippet:
                        candidate_probes.append(snippet)
                    for candidate in _parse_json_array_of_strings(snippet_candidates_json):
                        if candidate not in candidate_probes:
                            candidate_probes.append(candidate)

                    citation_bbox = None
                    if citation_bbox_json:
                        try:
                            citation_bbox = _normalize_bbox(json.loads(citation_bbox_json))
                        except Exception:
                            citation_bbox = None

                    # Prefer citation char-range anchors when plausible and supported by text overlap.
                    if (
                        citation_start_char is not None
                        and citation_end_char is not None
                        and citation_start_char >= 0
                        and citation_end_char > citation_start_char
                        and (citation_end_char - citation_start_char) <= 600
                    ):
                        count = citation_end_char - citation_start_char
                        char_bbox = _bbox_from_char_range(text_page, citation_start_char, count)
                        if char_bbox:
                            char_text = _safe_text_range(text_page, citation_start_char, count)
                            if candidate_probes:
                                char_overlap = max(_token_overlap(char_text, probe) for probe in candidate_probes)
                            else:
                                char_overlap = 0.85
                            if char_overlap >= 0.55:
                                matched_bbox = char_bbox
                                match_mode = "char_range"
                                match_confidence = round(min(1.0, char_overlap), 4)
                                bbox_source = "matched_snippet"
                            else:
                                warning_code = "char_range_low_overlap"

                    if not matched_bbox and candidate_probes:
                        best_rejected_overlap = 0.0
                        for probe in candidate_probes:
                            char_span = _char_span_for_snippet(text_page, probe)
                            if not char_span:
                                continue
                            start_char, count, candidate_mode, resolved_candidate = char_span
                            probe_bbox = _bbox_from_char_range(text_page, start_char, count)
                            if not probe_bbox:
                                continue
                            matched_text = _safe_text_range(text_page, start_char, count)
                            overlap = _token_overlap(matched_text, probe)
                            if overlap < 0.55:
                                best_rejected_overlap = max(best_rejected_overlap, overlap)
                                continue

                            matched_bbox = probe_bbox
                            match_mode = candidate_mode
                            match_confidence = round(min(1.0, overlap), 4)
                            used_snippet = resolved_candidate
                            bbox_source = "matched_snippet"
                            break

                        if not matched_bbox and best_rejected_overlap > 0:
                            warning_code = "snippet_overlap_below_threshold"
                            match_confidence = round(best_rejected_overlap, 4)

                    if not matched_bbox and citation_bbox:
                        matched_bbox = citation_bbox
                        bbox_source = "citation_bbox"
                        match_confidence = max(match_confidence, 0.35)
                        if warning_code is None:
                            warning_code = "fallback_citation_bbox"
                finally:
                    text_page.close()
                    page_obj.close()
            finally:
                pdf.close()

        duration_ms = round((time.perf_counter() - start) * 1000, 2)
        log_structured(
            logging.INFO,
            "render_pdf_page_completed",
            request_id=request_id,
            filename=file.filename,
            page=page,
            scale=scale,
            match_mode=match_mode,
            match_confidence=round(match_confidence, 4),
            bbox_source=bbox_source,
            warning_code=warning_code,
            duration_ms=duration_ms,
        )

        return {
            "page": page,
            "page_count": page_count,
            "page_width": float(width),
            "page_height": float(height),
            "image_width": pil_image.width,
            "image_height": pil_image.height,
            "image_base64": image_base64,
            "matched_bbox": matched_bbox,
            "match_mode": match_mode,
            "match_confidence": round(match_confidence, 4),
            "used_snippet": used_snippet,
            "bbox_source": bbox_source,
            "warning_code": warning_code,
        }
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


@app.post("/events")
async def ingest_client_event(request: Request, payload: ClientLogEvent):
    request_id = getattr(request.state, "request_id", None)
    level_map = {
        "info": logging.INFO,
        "warning": logging.WARNING,
        "error": logging.ERROR,
    }

    log_structured(
        level_map.get(payload.level, logging.INFO),
        "client_event",
        request_id=request_id,
        client_event=payload.event,
        stage=payload.stage,
        run_id=payload.run_id,
        message=payload.message,
        metadata=payload.metadata,
    )
    return {"ok": True}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
