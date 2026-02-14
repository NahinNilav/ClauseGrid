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


def _char_span_for_snippet(text_page, snippet: str) -> Optional[tuple[int, int]]:
    candidates = _snippet_candidates(snippet)
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
                    return int(start_char), int(count)
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
            return start_orig, end_orig - start_orig

    return None


@app.post("/render-pdf-page")
async def render_pdf_page(
    request: Request,
    file: UploadFile = File(...),
    page: int = Form(1),
    scale: float = Form(1.5),
    snippet: str = Form(""),
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
                snippet = (snippet or "").strip()
                if snippet:
                    char_span = _char_span_for_snippet(text_page, snippet)
                    if char_span:
                        matched_bbox = _bbox_from_char_range(text_page, char_span[0], char_span[1])
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
