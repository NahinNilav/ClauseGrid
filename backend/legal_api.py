from __future__ import annotations

import os
import tempfile
import uuid
from base64 import b64encode
from io import StringIO
import csv
import json
from typing import Any, Dict, List, Optional

from docling.datamodel.base_models import InputFormat
from docling.document_converter import DocumentConverter, HTMLFormatOption
from fastapi import APIRouter, BackgroundTasks, File, Form, UploadFile
from pydantic import BaseModel, Field
from starlette.responses import JSONResponse, Response

from artifact_schema import build_citation_index, make_artifact
from chunker import chunk_blocks
from legal_service import EXTRACTION_RUN_STATUS, REVIEW_STATUS, service
from mime_router import route_file
from parsers.docx_docling import parse_docx_with_docling
from parsers.html_docling import parse_html_with_docling
from parsers.pdf_docling import parse_pdf
from parsers.pdf_runtime import acquire_parse_slot
from parsers.text_plain import parse_text


def _problem(status: int, title: str, detail: str, *, instance: str = "") -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={
            "type": "about:blank",
            "title": title,
            "status": status,
            "detail": detail,
            "instance": instance,
        },
    )


def _write_temp_file(raw_bytes: bytes, suffix: str) -> str:
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(raw_bytes)
        return tmp.name


def create_html_converter() -> DocumentConverter:
    return DocumentConverter(
        format_options={
            InputFormat.HTML: HTMLFormatOption(),
        }
    )


html_converter = create_html_converter()
docx_converter = DocumentConverter()


def _parse_document_to_artifact(
    *,
    raw_bytes: bytes,
    filename: str,
    declared_mime_type: str | None,
) -> tuple[Dict[str, Any], Dict[str, Any]]:
    routed = route_file(
        filename=filename or "",
        declared_mime_type=declared_mime_type,
        raw_bytes=raw_bytes,
    )
    if routed.format == "unsupported":
        raise ValueError(f"Unsupported file type: {routed.mime_type or 'unknown'} ({routed.ext or 'no extension'})")

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
            filename=filename or "document.html",
        )
    elif routed.format == "docx":
        parser_result = parse_docx_with_docling(
            converter=docx_converter,
            raw_bytes=raw_bytes,
            filename=filename or "document.docx",
        )
    else:
        parser_result = parse_text(raw_bytes)

    blocks = parser_result["blocks"]
    chunks = chunk_blocks(blocks)
    citation_index = build_citation_index(blocks)
    doc_version_id = f"dv_{uuid.uuid4().hex[:12]}"
    artifact = make_artifact(
        doc_version_id=doc_version_id,
        doc_format=routed.format,  # type: ignore[arg-type]
        filename=filename or "",
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
        },
    )
    return artifact, {
        "format": routed.format,
        "mime_type": routed.mime_type,
        "ext": routed.ext,
        "sha256": routed.sha256,
    }


def _run_extraction_task(task_id: str, run_id: str) -> None:
    task = service.get_task(task_id)
    if not task:
        return
    if task.get("status") == "CANCELED":
        service.mark_extraction_run_canceled(run_id, "Canceled before extraction started.")
        return

    service.update_task(task_id, status="RUNNING")
    if service.is_task_canceled(task_id):
        service.mark_extraction_run_canceled(run_id, "Canceled before extraction started.")
        return
    try:
        run = service.run_extraction(run_id, task_id=task_id)
        if service.is_task_canceled(task_id) or str(run.get("status") or "") == "CANCELED":
            service.update_task(
                task_id,
                status="CANCELED",
                progress_current=run.get("completed_cells", 0) + run.get("failed_cells", 0),
                progress_total=run.get("total_cells", 0),
                payload=run,
                error_message=run.get("error_message") or "Canceled by user.",
            )
            return
        service.update_task(
            task_id,
            status="SUCCEEDED",
            progress_current=run.get("completed_cells", 0) + run.get("failed_cells", 0),
            progress_total=run.get("total_cells", 0),
            payload=run,
        )
    except Exception as exc:
        if service.is_task_canceled(task_id):
            service.mark_extraction_run_canceled(run_id, "Canceled by user.")
            service.update_task(task_id, status="CANCELED", error_message="Canceled by user.")
            return
        service.mark_extraction_run_failed(run_id, str(exc))
        service.update_task(task_id, status="FAILED", error_message=str(exc))


def _run_parse_task(
    task_id: str,
    *,
    project_id: str,
    document_id: str,
    filename: str,
    declared_mime_type: str | None,
    raw_bytes: bytes,
) -> None:
    task = service.get_task(task_id)
    if not task:
        return
    if task.get("status") == "CANCELED":
        return

    queue_wait_ms = 0.0
    parser_runtime: Dict[str, Any] = {}
    try:
        with acquire_parse_slot() as waited_ms:
            queue_wait_ms = round(waited_ms, 2)
            if service.is_task_canceled(task_id):
                return
            service.update_task(
                task_id,
                status="RUNNING",
                progress_current=0,
                progress_total=1,
                payload={
                    "document_id": document_id,
                    "filename": filename,
                    "queue_wait_ms": queue_wait_ms,
                },
            )
            if service.is_task_canceled(task_id):
                return
            artifact, routed = _parse_document_to_artifact(
                raw_bytes=raw_bytes,
                filename=filename,
                declared_mime_type=declared_mime_type,
            )
        parser_runtime = {
            "pdf_docling_mode_effective": (artifact.get("metadata") or {}).get("pdf_docling_mode_effective"),
            "pdf_docling_disable_reason": (artifact.get("metadata") or {}).get("pdf_docling_disable_reason"),
        }
        if service.is_task_canceled(task_id):
            service.update_task(task_id, status="CANCELED", error_message="Canceled by user.")
            return
        doc_version = service.create_document_version(
            document_id=document_id,
            parse_status="COMPLETED",
            artifact=artifact,
        )
        source_stored = False
        if str(routed.get("format") or "") == "pdf":
            try:
                service.store_document_version_source(
                    document_version_id=doc_version["id"],
                    mime_type=str(routed.get("mime_type") or declared_mime_type or "application/pdf"),
                    filename=filename,
                    content_bytes=raw_bytes,
                )
                source_stored = True
            except Exception:
                source_stored = False
        payload: Dict[str, Any] = {
            "document_id": document_id,
            "document_version_id": doc_version["id"],
            "format": routed["format"],
            "source_stored": source_stored,
            "queue_wait_ms": queue_wait_ms,
        }
        if parser_runtime.get("pdf_docling_mode_effective") is not None:
            payload["pdf_docling_mode_effective"] = parser_runtime.get("pdf_docling_mode_effective")
        if parser_runtime.get("pdf_docling_disable_reason"):
            payload["pdf_docling_disable_reason"] = parser_runtime.get("pdf_docling_disable_reason")

        active = service.active_template_for_project(project_id)
        if active and active.get("active_version_id"):
            run = service.create_extraction_run(
                project_id=project_id,
                template_version_id=active["active_version_id"],
                trigger_reason="DOCUMENT_ADDED",
            )
            extraction_task = service.create_task(
                task_type="EXTRACTION_RUN",
                project_id=project_id,
                entity_id=run["id"],
                payload={"run_id": run["id"]},
            )
            _run_extraction_task(extraction_task["id"], run["id"])
            payload["triggered_extraction_task_id"] = extraction_task["id"]

        if service.is_task_canceled(task_id):
            service.update_task(task_id, status="CANCELED", payload=payload, error_message="Canceled by user.")
            return
        service.update_task(
            task_id,
            status="SUCCEEDED",
            progress_current=1,
            progress_total=1,
            payload=payload,
        )
    except Exception as exc:
        try:
            service.create_document_version(
                document_id=document_id,
                parse_status="FAILED",
                artifact={},
                error_message=str(exc),
            )
        except Exception:
            pass
        if service.is_task_canceled(task_id):
            service.update_task(task_id, status="CANCELED", error_message="Canceled by user.")
            return
        error_payload: Dict[str, Any] = {
            "document_id": document_id,
            "filename": filename,
            "queue_wait_ms": queue_wait_ms,
        }
        if parser_runtime.get("pdf_docling_mode_effective") is not None:
            error_payload["pdf_docling_mode_effective"] = parser_runtime.get("pdf_docling_mode_effective")
        if parser_runtime.get("pdf_docling_disable_reason"):
            error_payload["pdf_docling_disable_reason"] = parser_runtime.get("pdf_docling_disable_reason")
        service.update_task(task_id, status="FAILED", error_message=str(exc), payload=error_payload)


def _run_evaluation_task(task_id: str, evaluation_run_id: str) -> None:
    task = service.get_task(task_id)
    if not task:
        return
    if task.get("status") == "CANCELED":
        service.mark_evaluation_run_canceled(evaluation_run_id, "Canceled before evaluation started.")
        return

    service.update_task(task_id, status="RUNNING")
    if service.is_task_canceled(task_id):
        service.mark_evaluation_run_canceled(evaluation_run_id, "Canceled before evaluation started.")
        return
    try:
        result = service.run_evaluation(evaluation_run_id, task_id=task_id)
        if service.is_task_canceled(task_id) or str(result.get("status") or "") == "CANCELED":
            service.update_task(
                task_id,
                status="CANCELED",
                progress_current=0,
                progress_total=1,
                payload={"evaluation_run_id": evaluation_run_id, "result": result},
                error_message=result.get("notes") or "Canceled by user.",
            )
            return
        service.update_task(
            task_id,
            status="SUCCEEDED",
            progress_current=1,
            progress_total=1,
            payload={"evaluation_run_id": evaluation_run_id, "result": result},
        )
    except Exception as exc:
        if service.is_task_canceled(task_id):
            service.mark_evaluation_run_canceled(evaluation_run_id, "Canceled by user.")
            service.update_task(task_id, status="CANCELED", error_message="Canceled by user.")
            return
        service.mark_evaluation_run_failed(evaluation_run_id, str(exc))
        service.update_task(task_id, status="FAILED", error_message=str(exc))


def _project_has_completed_documents(project_id: str) -> bool:
    documents = service.latest_document_versions_for_project(project_id)
    for document in documents:
        latest = document.get("latest_version") or {}
        if str(latest.get("parse_status") or "") == "COMPLETED":
            return True
    return False


def _queue_extraction_for_template_version(
    *,
    project_id: str,
    template_version_id: str,
    trigger_reason: str,
    background_tasks: BackgroundTasks,
) -> str:
    run = service.create_extraction_run(
        project_id=project_id,
        template_version_id=template_version_id,
        trigger_reason=trigger_reason,
    )
    task = service.create_task(
        task_type="EXTRACTION_RUN",
        project_id=project_id,
        entity_id=run["id"],
        payload={"run_id": run["id"]},
    )
    background_tasks.add_task(_run_extraction_task, task["id"], run["id"])
    return task["id"]


class FieldDefinition(BaseModel):
    key: str
    name: str
    type: str = "text"
    prompt: str = ""
    required: bool = False


class CreateProjectRequest(BaseModel):
    name: str
    description: str | None = None


class UpdateProjectRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    status: str | None = None


class CreateTemplateRequest(BaseModel):
    name: str
    fields: List[FieldDefinition]
    validation_policy: Dict[str, Any] = Field(default_factory=dict)
    normalization_policy: Dict[str, Any] = Field(default_factory=dict)


class CreateTemplateVersionRequest(BaseModel):
    fields: List[FieldDefinition]
    validation_policy: Dict[str, Any] = Field(default_factory=dict)
    normalization_policy: Dict[str, Any] = Field(default_factory=dict)


class CreateExtractionRunRequest(BaseModel):
    template_version_id: str | None = None
    mode: str | None = None
    quality_profile: str | None = None


class ReviewDecisionRequest(BaseModel):
    document_version_id: str
    template_version_id: str
    field_key: str
    status: str
    manual_value: str | None = None
    reviewer: str | None = None
    notes: str | None = None


class GroundTruthLabel(BaseModel):
    document_version_id: str
    field_key: str
    expected_value: str | None = None
    expected_normalized_value: str | None = None
    notes: str | None = None


class GroundTruthSetRequest(BaseModel):
    name: str
    labels: List[GroundTruthLabel]
    format: str = "json"


class EvaluationRunRequest(BaseModel):
    ground_truth_set_id: str
    extraction_run_id: str


class AnnotationRequest(BaseModel):
    document_version_id: str
    template_version_id: str
    field_key: str
    body: str
    author: str | None = None
    approved: bool = False
    resolved: bool = False


class UpdateAnnotationRequest(BaseModel):
    body: str | None = None
    author: str | None = None
    approved: bool | None = None
    resolved: bool | None = None


router = APIRouter(prefix="/api")


@router.post("/projects")
def create_project(payload: CreateProjectRequest):
    project = service.create_project(name=payload.name, description=payload.description)
    return {"project": project}


@router.patch("/projects/{project_id}")
def update_project(project_id: str, payload: UpdateProjectRequest):
    try:
        project = service.update_project(
            project_id,
            name=payload.name,
            description=payload.description,
            status=payload.status,
        )
    except ValueError as exc:
        return _problem(404, "Project Not Found", str(exc), instance=f"/api/projects/{project_id}")
    return {"project": project}


@router.get("/projects")
def list_projects():
    return {"projects": service.list_projects()}


@router.get("/projects/{project_id}")
def get_project(project_id: str):
    project = service.get_project(project_id)
    if not project:
        return _problem(404, "Project Not Found", "Project does not exist", instance=f"/api/projects/{project_id}")
    documents = service.latest_document_versions_for_project(project_id)
    templates = service.list_templates(project_id)
    return {"project": project, "documents": documents, "templates": templates}


@router.delete("/projects/{project_id}")
def delete_project(project_id: str):
    deleted = service.delete_project(project_id)
    if not deleted:
        return _problem(404, "Project Not Found", "Project does not exist", instance=f"/api/projects/{project_id}")
    return {"project_id": project_id, "deleted": True}


@router.post("/projects/{project_id}/delete")
def delete_project_post(project_id: str):
    deleted = service.delete_project(project_id)
    if not deleted:
        return _problem(404, "Project Not Found", "Project does not exist", instance=f"/api/projects/{project_id}/delete")
    return {"project_id": project_id, "deleted": True}


@router.post("/projects/{project_id}/documents")
async def upload_document(
    project_id: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
):
    project = service.get_project(project_id)
    if not project:
        return _problem(404, "Project Not Found", "Project does not exist", instance=f"/api/projects/{project_id}/documents")

    raw_bytes = await file.read()
    if not raw_bytes:
        return _problem(400, "Invalid Upload", "Uploaded file is empty", instance=f"/api/projects/{project_id}/documents")

    routed = route_file(
        filename=file.filename or "",
        declared_mime_type=file.content_type,
        raw_bytes=raw_bytes,
    )
    if routed.format == "unsupported":
        return _problem(
            415,
            "Unsupported Media Type",
            f"Unsupported file type: {routed.mime_type or 'unknown'} ({routed.ext or 'no extension'})",
            instance=f"/api/projects/{project_id}/documents",
        )

    document = service.create_document(
        project_id=project_id,
        filename=file.filename or "document",
        source_mime_type=file.content_type or routed.mime_type,
        sha256=routed.sha256,
    )
    task = service.create_task(
        task_type="PARSE_DOCUMENT",
        project_id=project_id,
        entity_id=document["id"],
        payload={"document_id": document["id"], "filename": document["filename"]},
    )
    background_tasks.add_task(
        _run_parse_task,
        task["id"],
        project_id=project_id,
        document_id=document["id"],
        filename=file.filename or "document",
        declared_mime_type=file.content_type,
        raw_bytes=raw_bytes,
    )
    return {"document_id": document["id"], "task_id": task["id"]}


@router.get("/projects/{project_id}/documents")
def list_documents(project_id: str):
    project = service.get_project(project_id)
    if not project:
        return _problem(404, "Project Not Found", "Project does not exist", instance=f"/api/projects/{project_id}/documents")
    return {"documents": service.latest_document_versions_for_project(project_id)}


@router.get("/document-versions/{document_version_id}/source")
def get_document_version_source(document_version_id: str):
    source = service.get_document_version_source(document_version_id)
    if not source:
        return _problem(
            404,
            "Document Source Not Found",
            "Original source bytes are not available for this document version.",
            instance=f"/api/document-versions/{document_version_id}/source",
        )

    content_blob = source.get("content_blob")
    if not isinstance(content_blob, (bytes, bytearray)) or not content_blob:
        return _problem(
            404,
            "Document Source Not Found",
            "Original source bytes are not available for this document version.",
            instance=f"/api/document-versions/{document_version_id}/source",
        )

    return {
        "document_version_id": source.get("document_version_id") or document_version_id,
        "mime_type": source.get("mime_type") or "application/octet-stream",
        "filename": source.get("filename") or "document",
        "content_base64": b64encode(bytes(content_blob)).decode("ascii"),
        "size_bytes": int(source.get("size_bytes") or len(content_blob)),
    }


@router.post("/projects/{project_id}/templates")
def create_template(project_id: str, payload: CreateTemplateRequest, background_tasks: BackgroundTasks):
    if not service.get_project(project_id):
        return _problem(404, "Project Not Found", "Project does not exist", instance=f"/api/projects/{project_id}/templates")

    try:
        template, version = service.create_template_with_version(
            project_id=project_id,
            name=payload.name,
            fields=[field.model_dump() for field in payload.fields],
            validation_policy=payload.validation_policy,
            normalization_policy=payload.normalization_policy,
        )
    except ValueError as exc:
        return _problem(400, "Template Creation Failed", str(exc), instance=f"/api/projects/{project_id}/templates")

    triggered_extraction_task_id: str | None = None
    if _project_has_completed_documents(project_id):
        triggered_extraction_task_id = _queue_extraction_for_template_version(
            project_id=project_id,
            template_version_id=version["id"],
            trigger_reason="TEMPLATE_CREATED",
            background_tasks=background_tasks,
        )

    response = {"template": template, "template_version": version}
    if triggered_extraction_task_id:
        response["triggered_extraction_task_id"] = triggered_extraction_task_id
    return response


@router.post("/templates/{template_id}/versions")
def create_template_version(template_id: str, payload: CreateTemplateVersionRequest, background_tasks: BackgroundTasks):
    template = service.get_template(template_id)
    if not template:
        return _problem(404, "Template Not Found", "Template does not exist", instance=f"/api/templates/{template_id}/versions")
    try:
        version = service.create_template_version(
            template_id=template_id,
            fields=[field.model_dump() for field in payload.fields],
            validation_policy=payload.validation_policy,
            normalization_policy=payload.normalization_policy,
        )
    except ValueError as exc:
        return _problem(400, "Template Version Failed", str(exc), instance=f"/api/templates/{template_id}/versions")

    project_id = str(template.get("project_id") or "")
    triggered_extraction_task_id: str | None = None
    if project_id and _project_has_completed_documents(project_id):
        triggered_extraction_task_id = _queue_extraction_for_template_version(
            project_id=project_id,
            template_version_id=version["id"],
            trigger_reason="TEMPLATE_VERSION_UPDATED",
            background_tasks=background_tasks,
        )

    response = {"template_version": version}
    if triggered_extraction_task_id:
        response["triggered_extraction_task_id"] = triggered_extraction_task_id
    return response


@router.get("/projects/{project_id}/templates")
def list_templates(project_id: str):
    if not service.get_project(project_id):
        return _problem(404, "Project Not Found", "Project does not exist", instance=f"/api/projects/{project_id}/templates")
    return {"templates": service.list_templates(project_id)}


@router.post("/projects/{project_id}/extraction-runs")
def create_extraction_run(project_id: str, payload: CreateExtractionRunRequest, background_tasks: BackgroundTasks):
    if not service.get_project(project_id):
        return _problem(404, "Project Not Found", "Project does not exist", instance=f"/api/projects/{project_id}/extraction-runs")
    template_version_id = payload.template_version_id
    if not template_version_id:
        active = service.active_template_for_project(project_id)
        if not active or not active.get("active_version_id"):
            return _problem(
                400,
                "Missing Template",
                "No active template version found for this project",
                instance=f"/api/projects/{project_id}/extraction-runs",
            )
        template_version_id = active["active_version_id"]
    try:
        run = service.create_extraction_run(
            project_id=project_id,
            template_version_id=template_version_id,
            trigger_reason="MANUAL_TRIGGER",
            mode=payload.mode,
            quality_profile=payload.quality_profile,
        )
    except ValueError as exc:
        return _problem(400, "Extraction Run Failed", str(exc), instance=f"/api/projects/{project_id}/extraction-runs")
    task = service.create_task(
        task_type="EXTRACTION_RUN",
        project_id=project_id,
        entity_id=run["id"],
        payload={"run_id": run["id"]},
    )
    background_tasks.add_task(_run_extraction_task, task["id"], run["id"])
    return {"run_id": run["id"], "task_id": task["id"]}


@router.get("/projects/{project_id}/extraction-runs/{run_id}")
def get_extraction_run(project_id: str, run_id: str):
    run = service.get_extraction_run(project_id, run_id)
    if not run:
        return _problem(404, "Extraction Run Not Found", "Run does not exist", instance=f"/api/projects/{project_id}/extraction-runs/{run_id}")
    return {"run": run, "results": service.field_extractions_for_run(run_id)}


@router.get("/projects/{project_id}/extraction-runs/{run_id}/diagnostics")
def get_extraction_run_diagnostics(project_id: str, run_id: str):
    try:
        diagnostics = service.extraction_run_diagnostics(project_id, run_id)
    except ValueError as exc:
        return _problem(
            404,
            "Extraction Run Not Found",
            str(exc),
            instance=f"/api/projects/{project_id}/extraction-runs/{run_id}/diagnostics",
        )
    return diagnostics


@router.get("/projects/{project_id}/table-view")
def get_table_view(project_id: str, template_version_id: str | None = None, baseline_document_id: str | None = None):
    if not service.get_project(project_id):
        return _problem(404, "Project Not Found", "Project does not exist", instance=f"/api/projects/{project_id}/table-view")
    try:
        view = service.table_view(
            project_id=project_id,
            template_version_id=template_version_id,
            baseline_document_id=baseline_document_id,
        )
    except ValueError as exc:
        return _problem(400, "Table View Failed", str(exc), instance=f"/api/projects/{project_id}/table-view")
    return view


@router.get("/projects/{project_id}/table-export.csv")
def export_table_csv(
    project_id: str,
    template_version_id: str | None = None,
    baseline_document_id: str | None = None,
    value_mode: str = "effective",
):
    if not service.get_project(project_id):
        return _problem(
            404,
            "Project Not Found",
            "Project does not exist",
            instance=f"/api/projects/{project_id}/table-export.csv",
        )
    mode = str(value_mode or "effective").strip().lower()
    if mode not in {"effective", "ai"}:
        return _problem(
            400,
            "Invalid Value Mode",
            "value_mode must be one of: effective, ai",
            instance=f"/api/projects/{project_id}/table-export.csv",
        )
    try:
        view = service.table_view(
            project_id=project_id,
            template_version_id=template_version_id,
            baseline_document_id=baseline_document_id,
        )
    except ValueError as exc:
        return _problem(
            400,
            "Table Export Failed",
            str(exc),
            instance=f"/api/projects/{project_id}/table-export.csv",
        )

    output = StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "document_id",
            "document_version_id",
            "filename",
            "field_key",
            "field_name",
            "value_mode",
            "export_value",
            "effective_value",
            "ai_value",
            "review_status",
            "confidence_score",
            "citations_json",
            "is_diff",
            "baseline_value",
            "current_value",
            "compare_mode",
            "annotation_count",
        ]
    )

    columns = view.get("columns") or []
    for row in view.get("rows") or []:
        for field in columns:
            field_key = str(field.get("key") or field.get("id") or field.get("name"))
            cell = ((row.get("cells") or {}).get(field_key) or {})
            ai_result = cell.get("ai_result") or {}
            ai_value = str(ai_result.get("value") or "")
            effective_value = str(cell.get("effective_value") or "")
            export_value = ai_value if mode == "ai" else effective_value
            writer.writerow(
                [
                    row.get("document_id") or "",
                    row.get("document_version_id") or "",
                    row.get("filename") or "",
                    field_key,
                    str(field.get("name") or field_key),
                    mode,
                    export_value,
                    effective_value,
                    ai_value,
                    str((cell.get("review_overlay") or {}).get("status") or ""),
                    ai_result.get("confidence_score") if ai_result else "",
                    json.dumps(ai_result.get("citations_json") or [], ensure_ascii=False),
                    "1" if cell.get("is_diff") else "0",
                    cell.get("baseline_value") or "",
                    cell.get("current_value") or "",
                    cell.get("compare_mode") or "",
                    int(cell.get("annotation_count") or 0),
                ]
            )

    csv_payload = output.getvalue()
    filename = f"project_{project_id}_table_export.csv"
    return Response(
        content=csv_payload,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/projects/{project_id}/review-decisions")
def upsert_review(project_id: str, payload: ReviewDecisionRequest):
    if not service.get_project(project_id):
        return _problem(404, "Project Not Found", "Project does not exist", instance=f"/api/projects/{project_id}/review-decisions")
    if payload.status not in REVIEW_STATUS:
        return _problem(400, "Invalid Review Status", f"Status must be one of {sorted(REVIEW_STATUS)}")
    try:
        decision = service.upsert_review_decision(
            project_id=project_id,
            document_version_id=payload.document_version_id,
            template_version_id=payload.template_version_id,
            field_key=payload.field_key,
            status=payload.status,
            manual_value=payload.manual_value,
            reviewer=payload.reviewer,
            notes=payload.notes,
        )
    except ValueError as exc:
        return _problem(400, "Review Update Failed", str(exc), instance=f"/api/projects/{project_id}/review-decisions")
    return {"review_decision": decision}


@router.get("/projects/{project_id}/review-decisions")
def list_review_decisions(project_id: str, template_version_id: str | None = None):
    if not service.get_project(project_id):
        return _problem(404, "Project Not Found", "Project does not exist", instance=f"/api/projects/{project_id}/review-decisions")
    decisions = service.list_review_decisions(project_id, template_version_id=template_version_id)
    return {"review_decisions": decisions}


@router.post("/projects/{project_id}/ground-truth-sets")
def create_ground_truth_set(project_id: str, payload: GroundTruthSetRequest):
    if not service.get_project(project_id):
        return _problem(404, "Project Not Found", "Project does not exist", instance=f"/api/projects/{project_id}/ground-truth-sets")
    gt_set = service.create_ground_truth_set(
        project_id=project_id,
        name=payload.name,
        labels=[label.model_dump() for label in payload.labels],
        label_format=payload.format,
    )
    return {"ground_truth_set": gt_set}


@router.post("/projects/{project_id}/evaluation-runs")
def create_evaluation_run(project_id: str, payload: EvaluationRunRequest, background_tasks: BackgroundTasks):
    if not service.get_project(project_id):
        return _problem(404, "Project Not Found", "Project does not exist", instance=f"/api/projects/{project_id}/evaluation-runs")
    try:
        eval_run = service.create_evaluation_run(
            project_id=project_id,
            ground_truth_set_id=payload.ground_truth_set_id,
            extraction_run_id=payload.extraction_run_id,
        )
    except ValueError as exc:
        return _problem(400, "Evaluation Run Failed", str(exc), instance=f"/api/projects/{project_id}/evaluation-runs")
    task = service.create_task(
        task_type="EVALUATION_RUN",
        project_id=project_id,
        entity_id=eval_run["id"],
        payload={"evaluation_run_id": eval_run["id"]},
    )
    background_tasks.add_task(_run_evaluation_task, task["id"], eval_run["id"])
    return {"evaluation_run_id": eval_run["id"], "task_id": task["id"]}


@router.get("/projects/{project_id}/evaluation-runs/{eval_run_id}")
def get_evaluation_run(project_id: str, eval_run_id: str):
    if not service.get_project(project_id):
        return _problem(404, "Project Not Found", "Project does not exist", instance=f"/api/projects/{project_id}/evaluation-runs/{eval_run_id}")
    run = service.get_evaluation_run(project_id, eval_run_id)
    if not run:
        return _problem(
            404,
            "Evaluation Run Not Found",
            "Evaluation run does not exist",
            instance=f"/api/projects/{project_id}/evaluation-runs/{eval_run_id}",
        )
    return {"evaluation_run": run}


@router.post("/projects/{project_id}/annotations")
def create_annotation(project_id: str, payload: AnnotationRequest):
    if not service.get_project(project_id):
        return _problem(404, "Project Not Found", "Project does not exist", instance=f"/api/projects/{project_id}/annotations")
    try:
        annotation = service.create_annotation(
            project_id=project_id,
            document_version_id=payload.document_version_id,
            template_version_id=payload.template_version_id,
            field_key=payload.field_key,
            body=payload.body,
            author=payload.author,
            approved=payload.approved,
            resolved=payload.resolved,
        )
    except ValueError as exc:
        return _problem(400, "Annotation Creation Failed", str(exc), instance=f"/api/projects/{project_id}/annotations")
    return {"annotation": annotation}


@router.get("/projects/{project_id}/annotations")
def list_annotations(project_id: str, template_version_id: str | None = None):
    if not service.get_project(project_id):
        return _problem(404, "Project Not Found", "Project does not exist", instance=f"/api/projects/{project_id}/annotations")
    annotations = service.list_annotations(project_id, template_version_id=template_version_id)
    return {"annotations": annotations}


@router.patch("/projects/{project_id}/annotations/{annotation_id}")
def update_annotation(project_id: str, annotation_id: str, payload: UpdateAnnotationRequest):
    if not service.get_project(project_id):
        return _problem(
            404,
            "Project Not Found",
            "Project does not exist",
            instance=f"/api/projects/{project_id}/annotations/{annotation_id}",
        )
    try:
        annotation = service.update_annotation(
            project_id=project_id,
            annotation_id=annotation_id,
            body=payload.body,
            author=payload.author,
            approved=payload.approved,
            resolved=payload.resolved,
        )
    except ValueError as exc:
        detail = str(exc)
        status_code = 404 if "not found" in detail.lower() else 400
        title = "Annotation Not Found" if status_code == 404 else "Annotation Update Failed"
        return _problem(
            status_code,
            title,
            detail,
            instance=f"/api/projects/{project_id}/annotations/{annotation_id}",
        )
    return {"annotation": annotation}


@router.delete("/projects/{project_id}/annotations/{annotation_id}")
def delete_annotation(project_id: str, annotation_id: str):
    if not service.get_project(project_id):
        return _problem(
            404,
            "Project Not Found",
            "Project does not exist",
            instance=f"/api/projects/{project_id}/annotations/{annotation_id}",
        )
    try:
        deleted = service.delete_annotation(project_id=project_id, annotation_id=annotation_id)
    except ValueError as exc:
        return _problem(
            400,
            "Annotation Delete Failed",
            str(exc),
            instance=f"/api/projects/{project_id}/annotations/{annotation_id}",
        )
    if not deleted:
        return _problem(
            404,
            "Annotation Not Found",
            "Annotation does not exist",
            instance=f"/api/projects/{project_id}/annotations/{annotation_id}",
        )
    return {"annotation_id": annotation_id, "deleted": True}


@router.get("/projects/{project_id}/tasks")
def list_project_tasks(project_id: str, status: str | None = None, limit: int = 200):
    if not service.get_project(project_id):
        return _problem(404, "Project Not Found", "Project does not exist", instance=f"/api/projects/{project_id}/tasks")
    statuses = None
    if status:
        statuses = [item.strip().upper() for item in status.split(",") if item.strip()]
    tasks = service.list_tasks(project_id=project_id, statuses=statuses, limit=limit)
    return {"tasks": tasks}


@router.post("/tasks/{task_id}/cancel")
def cancel_task(task_id: str, reason: str | None = None, purge: bool = False):
    task = service.cancel_task(task_id, reason=reason)
    if not task:
        return _problem(404, "Task Not Found", "Task does not exist", instance=f"/api/tasks/{task_id}/cancel")

    deleted = False
    if purge:
        try:
            deleted = service.delete_task(task_id, force=False)
        except ValueError:
            deleted = False
    if deleted:
        return {"task_id": task_id, "status": "CANCELED", "deleted": True}
    return {"task": task}


@router.post("/projects/{project_id}/tasks/cancel-pending")
def cancel_project_pending_tasks(project_id: str, purge: bool = False):
    if not service.get_project(project_id):
        return _problem(
            404,
            "Project Not Found",
            "Project does not exist",
            instance=f"/api/projects/{project_id}/tasks/cancel-pending",
        )
    canceled_tasks = service.cancel_project_tasks(project_id, reason="Canceled by user.")
    canceled_ids = [task["id"] for task in canceled_tasks]
    deleted_count = service.delete_tasks(canceled_ids) if purge and canceled_ids else 0
    return {
        "project_id": project_id,
        "canceled_count": len(canceled_ids),
        "canceled_task_ids": canceled_ids,
        "deleted_count": deleted_count,
    }


@router.delete("/tasks/{task_id}")
def delete_task(task_id: str, force: bool = False):
    task = service.get_task(task_id)
    if not task:
        return _problem(404, "Task Not Found", "Task does not exist", instance=f"/api/tasks/{task_id}")
    try:
        deleted = service.delete_task(task_id, force=force)
    except ValueError as exc:
        return _problem(409, "Task Deletion Blocked", str(exc), instance=f"/api/tasks/{task_id}")
    return {"task_id": task_id, "deleted": bool(deleted)}


@router.get("/tasks/{task_id}")
def get_task(task_id: str):
    task = service.get_task(task_id)
    if not task:
        return _problem(404, "Task Not Found", "Task does not exist", instance=f"/api/tasks/{task_id}")
    return {"task": task}
