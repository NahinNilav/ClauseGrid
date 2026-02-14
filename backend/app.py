from __future__ import annotations

import json
import logging
import os
import tempfile
import time
import uuid
from typing import Any, Dict, Literal, Optional

from docling.datamodel.base_models import InputFormat
from docling.document_converter import DocumentConverter, HTMLFormatOption
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from artifact_schema import build_citation_index, make_artifact
from chunker import chunk_blocks
from mime_router import route_file
from parsers.html_docling import parse_html_with_docling
from parsers.pdf_docling import parse_pdf
from parsers.text_plain import parse_text

app = FastAPI()

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
            metadata={
                "parser": parser_result.get("parser", "unknown"),
                "dom_map_size": parser_result.get("dom_map_size"),
                "worker_error": parser_result.get("worker_error"),
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
