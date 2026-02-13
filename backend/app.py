from fastapi import FastAPI, UploadFile, File, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from docling.document_converter import DocumentConverter
from docling.datamodel.pipeline_options import PdfPipelineOptions
from docling.datamodel.accelerator_options import AcceleratorDevice, AcceleratorOptions
from docling.datamodel.base_models import InputFormat
from docling.document_converter import PdfFormatOption
from pydantic import BaseModel, Field
from typing import Any, Dict, Literal, Optional
import tempfile
import os
import shutil
import platform
import logging
import json
import time
import uuid

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
# In production, replace with specific origins
origins = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:5173", # Vite default
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Use MPS (Metal Performance Shaders) on Apple Silicon Macs
def create_converter():
    if platform.system() == "Darwin":  # macOS
        print("Detected macOS - enabling MPS (Metal) GPU acceleration")
        accelerator_options = AcceleratorOptions(
            device=AcceleratorDevice.MPS,
            num_threads=4
        )
    else:
        print("Running on CPU (MPS not available)")
        accelerator_options = AcceleratorOptions(
            device=AcceleratorDevice.AUTO,
            num_threads=4
        )
    
    # Configure PDF pipeline with accelerator options
    pdf_pipeline_options = PdfPipelineOptions()
    pdf_pipeline_options.accelerator_options = accelerator_options
    
    return DocumentConverter(
        format_options={
            InputFormat.PDF: PdfFormatOption(pipeline_options=pdf_pipeline_options)
        }
    )

converter = create_converter()


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


@app.post("/convert")
async def convert_document(request: Request, file: UploadFile = File(...)):
    request_id = getattr(request.state, "request_id", None)
    convert_start = time.perf_counter()
    try:
        log_structured(
            logging.INFO,
            "convert_started",
            request_id=request_id,
            filename=file.filename,
            content_type=file.content_type,
        )

        # Create a temporary file to save the uploaded content
        # Docling needs a file path
        suffix = os.path.splitext(file.filename)[1]
        if not suffix:
            suffix = ""
            
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            shutil.copyfileobj(file.file, tmp)
            tmp_path = tmp.name

        try:
            # Convert the document
            result = converter.convert(tmp_path)
            # Export to markdown
            markdown_content = result.document.export_to_markdown()
            duration_ms = round((time.perf_counter() - convert_start) * 1000, 2)
            log_structured(
                logging.INFO,
                "convert_completed",
                request_id=request_id,
                filename=file.filename,
                markdown_chars=len(markdown_content),
                duration_ms=duration_ms,
            )
            return {"markdown": markdown_content}
        finally:
            # Clean up the temporary file
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
                
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
