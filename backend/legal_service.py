from __future__ import annotations

import re
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from legal_hybrid import (
    GeminiLegalClient,
    confidence_from_signals,
    retrieve_legal_candidates,
    self_consistency_agreement,
)
from legal_db import db, utc_now_iso


PROJECT_STATUS = {"DRAFT", "ACTIVE", "ARCHIVED"}
PARSE_STATUS = {"QUEUED", "RUNNING", "COMPLETED", "FAILED"}
EXTRACTION_RUN_STATUS = {"QUEUED", "RUNNING", "COMPLETED", "PARTIAL", "FAILED", "CANCELED"}
REVIEW_STATUS = {"CONFIRMED", "REJECTED", "MANUAL_UPDATED", "MISSING_DATA"}
TASK_STATUS = {"QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELED"}
ACTIVE_TASK_STATUS = {"QUEUED", "RUNNING"}
TERMINAL_TASK_STATUS = {"SUCCEEDED", "FAILED", "CANCELED"}
FALLBACK_REASON = {"NOT_FOUND", "AMBIGUOUS", "PARSER_ERROR", "MODEL_ERROR"}
EXTRACTION_MODE = {"deterministic", "hybrid", "llm_reasoning"}
QUALITY_PROFILE = {"high", "balanced", "fast"}
VERIFIER_STATUS = {"PASS", "PARTIAL", "FAIL", "SKIPPED"}


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def _normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def _safe_lower(value: Any) -> str:
    return str(value or "").lower()


def _string_similarity(left: str, right: str) -> bool:
    return _normalize_space(left).lower() == _normalize_space(right).lower()


def _parse_date(value: str) -> Optional[str]:
    text = (value or "").strip()
    if not text:
        return None

    direct = re.search(r"\b(\d{4})-(\d{2})-(\d{2})\b", text)
    if direct:
        return f"{direct.group(1)}-{direct.group(2)}-{direct.group(3)}"

    slash = re.search(r"\b(\d{1,2})/(\d{1,2})/(\d{2,4})\b", text)
    if slash:
        mm = int(slash.group(1))
        dd = int(slash.group(2))
        yy = int(slash.group(3))
        if yy < 100:
            yy += 2000
        return f"{yy:04d}-{mm:02d}-{dd:02d}"

    month_map = {
        "january": 1,
        "february": 2,
        "march": 3,
        "april": 4,
        "may": 5,
        "june": 6,
        "july": 7,
        "august": 8,
        "september": 9,
        "october": 10,
        "november": 11,
        "december": 12,
    }
    month_pat = (
        r"\b("
        + "|".join(month_map.keys())
        + r")\s+(\d{1,2}),\s*(\d{4})\b"
    )
    named = re.search(month_pat, text.lower())
    if named:
        mm = month_map[named.group(1)]
        dd = int(named.group(2))
        yy = int(named.group(3))
        return f"{yy:04d}-{mm:02d}-{dd:02d}"

    return None


def _normalize_value_by_type(field_type: str, value: str) -> Tuple[str, bool]:
    text = _normalize_space(value)
    if not text:
        return "", False

    kind = (field_type or "text").lower()
    if kind == "date":
        parsed = _parse_date(text)
        return (parsed or ""), bool(parsed)

    if kind == "number":
        match = re.search(r"[-+]?\d[\d,]*(?:\.\d+)?", text)
        if not match:
            return "", False
        numeric = match.group(0).replace(",", "")
        return numeric, True

    if kind == "boolean":
        lowered = text.lower()
        if any(token in lowered for token in ["yes", "true", "shall", "must", "agrees", "required"]):
            return "true", True
        if any(token in lowered for token in ["no", "false", "not", "none", "does not"]):
            return "false", True
        return "", False

    if kind == "list":
        items = [item.strip() for item in re.split(r"[\n;,]+", text) if item.strip()]
        if not items:
            return "", False
        return ", ".join(items), True

    return text, True


def _extract_keywords(field: Dict[str, Any]) -> List[str]:
    raw = f"{field.get('name', '')} {field.get('prompt', '')}"
    tokens = [
        token.lower()
        for token in re.findall(r"[a-zA-Z0-9]+", raw)
        if len(token) >= 4
    ]
    # De-duplicate while keeping order.
    seen = set()
    keywords: List[str] = []
    for token in tokens:
        if token in seen:
            continue
        seen.add(token)
        keywords.append(token)
    return keywords[:24]


def _pick_best_block(artifact: Dict[str, Any], field: Dict[str, Any]) -> Tuple[Optional[Dict[str, Any]], float]:
    blocks = artifact.get("blocks") or []
    if not isinstance(blocks, list) or not blocks:
        return None, 0.0

    keywords = _extract_keywords(field)
    if not keywords:
        # Fallback to first informative block.
        for block in blocks:
            text = _normalize_space(str(block.get("text") or ""))
            if text:
                return block, 0.2
        return None, 0.0

    best_block: Optional[Dict[str, Any]] = None
    best_score = 0.0
    for block in blocks:
        text = _safe_lower(block.get("text"))
        if not text.strip():
            continue
        score = 0.0
        for kw in keywords:
            if kw in text:
                score += 1.0
        if block.get("type") == "table":
            score += 0.2
        if score > best_score:
            best_score = score
            best_block = block

    if not best_block:
        return None, 0.0
    return best_block, best_score


def _value_from_block(field: Dict[str, Any], block_text: str) -> str:
    text = _normalize_space(block_text)
    if not text:
        return ""

    kind = str(field.get("type") or "text").lower()
    if kind == "boolean":
        normalized, valid = _normalize_value_by_type(kind, text)
        if valid:
            return normalized
    if kind == "number":
        normalized, valid = _normalize_value_by_type(kind, text)
        if valid:
            return normalized
    if kind == "date":
        normalized, valid = _normalize_value_by_type(kind, text)
        if valid:
            return normalized
    if kind == "list":
        normalized, valid = _normalize_value_by_type(kind, text)
        if valid:
            return normalized

    first_sentence = re.split(r"(?<=[.!?])\s+", text, maxsplit=1)[0]
    return first_sentence[:320]


def _citations_with_doc_version(
    citations: List[Dict[str, Any]],
    doc_version_id: str,
) -> List[Dict[str, Any]]:
    output: List[Dict[str, Any]] = []
    for item in citations or []:
        if not isinstance(item, dict):
            continue
        payload = dict(item)
        payload["doc_version_id"] = doc_version_id
        output.append(payload)
    return output


class LegalReviewService:
    def __init__(self) -> None:
        self.db = db
        self.llm_client = GeminiLegalClient()

    # Project
    def create_project(self, *, name: str, description: str | None = None) -> Dict[str, Any]:
        now = utc_now_iso()
        project = {
            "id": _new_id("prj"),
            "name": name.strip() or "Untitled Project",
            "description": description or "",
            "status": "DRAFT",
            "created_at": now,
            "updated_at": now,
        }
        self.db.execute(
            """
            INSERT INTO projects(id, name, description, status, created_at, updated_at)
            VALUES(:id, :name, :description, :status, :created_at, :updated_at)
            """,
            project,
        )
        self._audit(
            project_id=project["id"],
            actor="system",
            action="project_created",
            entity_type="project",
            entity_id=project["id"],
            payload=project,
        )
        return project

    def update_project(self, project_id: str, *, name: str | None, description: str | None, status: str | None) -> Dict[str, Any]:
        project = self.get_project(project_id)
        if not project:
            raise ValueError("Project not found")
        updates = {
            "name": (name.strip() if isinstance(name, str) else project["name"]),
            "description": description if description is not None else project.get("description") or "",
            "status": status if status in PROJECT_STATUS else project["status"],
            "updated_at": utc_now_iso(),
            "id": project_id,
        }
        self.db.execute(
            """
            UPDATE projects
            SET name=:name, description=:description, status=:status, updated_at=:updated_at
            WHERE id=:id
            """,
            updates,
        )
        updated = self.get_project(project_id)
        self._audit(
            project_id=project_id,
            actor="system",
            action="project_updated",
            entity_type="project",
            entity_id=project_id,
            payload=updates,
        )
        return updated or updates

    def list_projects(self) -> List[Dict[str, Any]]:
        return self.db.fetch_all(
            """
            SELECT id, name, description, status, created_at, updated_at
            FROM projects
            ORDER BY created_at DESC
            """
        )

    def get_project(self, project_id: str) -> Optional[Dict[str, Any]]:
        return self.db.fetch_one(
            """
            SELECT id, name, description, status, created_at, updated_at
            FROM projects
            WHERE id=:project_id
            """,
            {"project_id": project_id},
        )

    def delete_project(self, project_id: str) -> bool:
        project = self.get_project(project_id)
        if not project:
            return False

        # Best-effort cancellation before delete to reduce in-flight background work.
        self.cancel_project_tasks(project_id, reason="Canceled due to project deletion.")
        self.db.execute("DELETE FROM projects WHERE id=:project_id", {"project_id": project_id})
        return True

    # Tasks
    def create_task(
        self,
        *,
        task_type: str,
        project_id: str | None,
        entity_id: str | None = None,
        payload: Dict[str, Any] | None = None,
    ) -> Dict[str, Any]:
        now = utc_now_iso()
        task = {
            "id": _new_id("tsk"),
            "project_id": project_id,
            "task_type": task_type,
            "status": "QUEUED",
            "entity_id": entity_id,
            "progress_current": 0,
            "progress_total": 0,
            "error_message": None,
            "payload_json": payload or {},
            "created_at": now,
            "updated_at": now,
        }
        self.db.execute(
            """
            INSERT INTO request_tasks(
                id, project_id, task_type, status, entity_id, progress_current,
                progress_total, error_message, payload_json, created_at, updated_at
            )
            VALUES(
                :id, :project_id, :task_type, :status, :entity_id, :progress_current,
                :progress_total, :error_message, :payload_json, :created_at, :updated_at
            )
            """,
            task,
        )
        return self.get_task(task["id"]) or task

    def update_task(
        self,
        task_id: str,
        *,
        status: str | None = None,
        progress_current: int | None = None,
        progress_total: int | None = None,
        error_message: str | None = None,
        payload: Dict[str, Any] | None = None,
    ) -> None:
        task = self.get_task(task_id)
        if not task:
            return
        current_status = str(task.get("status") or "QUEUED")
        next_status = status if status in TASK_STATUS else current_status
        # Preserve explicit cancellation and prevent terminal tasks from re-entering active states.
        if current_status == "CANCELED" and next_status != "CANCELED":
            next_status = "CANCELED"
        if current_status in {"SUCCEEDED", "FAILED"} and next_status in ACTIVE_TASK_STATUS:
            next_status = current_status
        updates = {
            "id": task_id,
            "status": next_status,
            "progress_current": progress_current if progress_current is not None else task.get("progress_current", 0),
            "progress_total": progress_total if progress_total is not None else task.get("progress_total", 0),
            "error_message": error_message,
            "payload_json": payload if payload is not None else task.get("payload_json") or {},
            "updated_at": utc_now_iso(),
        }
        self.db.execute(
            """
            UPDATE request_tasks
            SET status=:status,
                progress_current=:progress_current,
                progress_total=:progress_total,
                error_message=:error_message,
                payload_json=:payload_json,
                updated_at=:updated_at
            WHERE id=:id
            """,
            updates,
        )

    def get_task(self, task_id: str) -> Optional[Dict[str, Any]]:
        return self.db.fetch_one(
            """
            SELECT id, project_id, task_type, status, entity_id, progress_current,
                   progress_total, error_message, payload_json, created_at, updated_at
            FROM request_tasks
            WHERE id=:task_id
            """,
            {"task_id": task_id},
        )

    def list_tasks(
        self,
        *,
        project_id: str | None = None,
        statuses: List[str] | None = None,
        limit: int = 200,
    ) -> List[Dict[str, Any]]:
        safe_limit = max(1, min(int(limit or 200), 2000))
        params: Dict[str, Any] = {"limit": safe_limit}
        clauses: List[str] = []
        if project_id:
            clauses.append("project_id=:project_id")
            params["project_id"] = project_id
        if statuses is not None:
            normalized = [status for status in [str(s).upper() for s in statuses] if status in TASK_STATUS]
            if not normalized:
                return []
            tokens: List[str] = []
            for idx, status in enumerate(normalized):
                key = f"status_{idx}"
                tokens.append(f":{key}")
                params[key] = status
            clauses.append(f"status IN ({', '.join(tokens)})")

        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        return self.db.fetch_all(
            f"""
            SELECT id, project_id, task_type, status, entity_id, progress_current,
                   progress_total, error_message, payload_json, created_at, updated_at
            FROM request_tasks
            {where}
            ORDER BY created_at DESC
            LIMIT :limit
            """,
            params,
        )

    def is_task_canceled(self, task_id: str) -> bool:
        task = self.get_task(task_id)
        if not task:
            return True
        return str(task.get("status") or "").upper() == "CANCELED"

    def cancel_task(self, task_id: str, *, reason: str | None = None) -> Optional[Dict[str, Any]]:
        task = self.get_task(task_id)
        if not task:
            return None

        status = str(task.get("status") or "")
        if status in TERMINAL_TASK_STATUS:
            return task

        message = (reason or "Canceled by user.").strip()
        self.db.execute(
            """
            UPDATE request_tasks
            SET status='CANCELED',
                error_message=:error_message,
                updated_at=:updated_at
            WHERE id=:task_id
            """,
            {
                "task_id": task_id,
                "error_message": message,
                "updated_at": utc_now_iso(),
            },
        )

        task_type = str(task.get("task_type") or "")
        entity_id = task.get("entity_id")
        if task_type == "EXTRACTION_RUN" and entity_id:
            self.mark_extraction_run_canceled(str(entity_id), message)
        elif task_type == "EVALUATION_RUN" and entity_id:
            self.mark_evaluation_run_canceled(str(entity_id), message)

        if task.get("project_id"):
            self._audit(
                project_id=str(task["project_id"]),
                actor="system",
                action="task_canceled",
                entity_type="task",
                entity_id=task_id,
                payload={"task_type": task_type, "reason": message},
            )
        return self.get_task(task_id)

    def cancel_project_tasks(self, project_id: str, *, reason: str | None = None) -> List[Dict[str, Any]]:
        tasks = self.list_tasks(project_id=project_id, statuses=sorted(ACTIVE_TASK_STATUS), limit=2000)
        canceled: List[Dict[str, Any]] = []
        for task in tasks:
            item = self.cancel_task(task["id"], reason=reason)
            if item:
                canceled.append(item)
        return canceled

    def delete_task(self, task_id: str, *, force: bool = False) -> bool:
        task = self.get_task(task_id)
        if not task:
            return False

        status = str(task.get("status") or "")
        if status in ACTIVE_TASK_STATUS:
            if not force:
                raise ValueError("Task is still active. Cancel it first or use force=true.")
            self.cancel_task(task_id, reason="Force-canceled before deletion.")

        self.db.execute("DELETE FROM request_tasks WHERE id=:task_id", {"task_id": task_id})
        if task.get("project_id"):
            self._audit(
                project_id=str(task["project_id"]),
                actor="system",
                action="task_deleted",
                entity_type="task",
                entity_id=task_id,
                payload={"forced": bool(force)},
            )
        return True

    def delete_tasks(self, task_ids: List[str], *, force: bool = False) -> int:
        deleted = 0
        for task_id in task_ids:
            try:
                ok = self.delete_task(task_id, force=force)
            except ValueError:
                ok = False
            if ok:
                deleted += 1
        return deleted

    # Documents
    def create_document(self, *, project_id: str, filename: str, source_mime_type: str, sha256: str) -> Dict[str, Any]:
        project = self.get_project(project_id)
        if not project:
            raise ValueError("Project not found")
        now = utc_now_iso()
        document = {
            "id": _new_id("doc"),
            "project_id": project_id,
            "filename": filename,
            "source_mime_type": source_mime_type,
            "sha256": sha256,
            "created_at": now,
        }
        self.db.execute(
            """
            INSERT INTO documents(id, project_id, filename, source_mime_type, sha256, created_at)
            VALUES(:id, :project_id, :filename, :source_mime_type, :sha256, :created_at)
            """,
            document,
        )
        self.db.execute(
            """
            UPDATE projects
            SET status='ACTIVE', updated_at=:updated_at
            WHERE id=:project_id
            """,
            {"updated_at": now, "project_id": project_id},
        )
        self._audit(
            project_id=project_id,
            actor="system",
            action="document_created",
            entity_type="document",
            entity_id=document["id"],
            payload={"filename": filename},
        )
        return document

    def create_document_version(
        self,
        *,
        document_id: str,
        parse_status: str,
        artifact: Dict[str, Any] | None,
        error_message: str | None = None,
    ) -> Dict[str, Any]:
        doc = self.db.fetch_one(
            "SELECT id, project_id FROM documents WHERE id=:document_id",
            {"document_id": document_id},
        )
        if not doc:
            raise ValueError("Document not found")

        current = self.db.fetch_one(
            """
            SELECT MAX(version_no) AS max_version
            FROM document_versions
            WHERE document_id=:document_id
            """,
            {"document_id": document_id},
        )
        next_version = int((current or {}).get("max_version") or 0) + 1
        now = utc_now_iso()
        version = {
            "id": _new_id("dv"),
            "document_id": document_id,
            "version_no": next_version,
            "parse_status": parse_status if parse_status in PARSE_STATUS else "FAILED",
            "artifact_json": artifact or {},
            "error_message": error_message,
            "created_at": now,
        }
        if isinstance(version["artifact_json"], dict):
            version["artifact_json"]["doc_version_id"] = version["id"]
        self.db.execute(
            """
            INSERT INTO document_versions(
                id, document_id, version_no, parse_status, artifact_json, error_message, created_at
            )
            VALUES(
                :id, :document_id, :version_no, :parse_status, :artifact_json, :error_message, :created_at
            )
            """,
            version,
        )
        self._audit(
            project_id=doc["project_id"],
            actor="system",
            action="document_version_created",
            entity_type="document_version",
            entity_id=version["id"],
            payload={"parse_status": version["parse_status"], "version_no": next_version},
        )
        return self.get_document_version(version["id"]) or version

    def get_document_version(self, doc_version_id: str) -> Optional[Dict[str, Any]]:
        return self.db.fetch_one(
            """
            SELECT id, document_id, version_no, parse_status, artifact_json, error_message, created_at
            FROM document_versions
            WHERE id=:doc_version_id
            """,
            {"doc_version_id": doc_version_id},
        )

    def latest_document_versions_for_project(self, project_id: str) -> List[Dict[str, Any]]:
        rows = self.db.fetch_all(
            """
            SELECT d.id AS document_id, d.filename, d.source_mime_type, d.created_at AS document_created_at,
                   dv.id AS document_version_id, dv.version_no, dv.parse_status, dv.artifact_json,
                   dv.error_message, dv.created_at AS version_created_at
            FROM documents d
            LEFT JOIN document_versions dv
              ON dv.document_id = d.id
             AND dv.version_no = (
                SELECT MAX(version_no)
                FROM document_versions dv2
                WHERE dv2.document_id = d.id
             )
            WHERE d.project_id=:project_id
            ORDER BY d.created_at ASC
            """,
            {"project_id": project_id},
        )
        documents: List[Dict[str, Any]] = []
        for row in rows:
            documents.append(
                {
                    "id": row["document_id"],
                    "filename": row["filename"],
                    "source_mime_type": row["source_mime_type"],
                    "created_at": row["document_created_at"],
                    "latest_version": {
                        "id": row.get("document_version_id"),
                        "version_no": row.get("version_no"),
                        "parse_status": row.get("parse_status"),
                        "artifact": row.get("artifact_json") or {},
                        "error_message": row.get("error_message"),
                        "created_at": row.get("version_created_at"),
                    }
                    if row.get("document_version_id")
                    else None,
                }
            )
        return documents

    # Templates
    def create_template_with_version(
        self,
        *,
        project_id: str,
        name: str,
        fields: List[Dict[str, Any]],
        validation_policy: Dict[str, Any] | None = None,
        normalization_policy: Dict[str, Any] | None = None,
    ) -> Tuple[Dict[str, Any], Dict[str, Any]]:
        if not self.get_project(project_id):
            raise ValueError("Project not found")
        now = utc_now_iso()
        template = {
            "id": _new_id("tpl"),
            "project_id": project_id,
            "name": name.strip() or "Default Template",
            "status": "ACTIVE",
            "active_version_id": None,
            "created_at": now,
            "updated_at": now,
        }
        self.db.execute(
            """
            INSERT INTO field_templates(
                id, project_id, name, status, active_version_id, created_at, updated_at
            )
            VALUES(
                :id, :project_id, :name, :status, :active_version_id, :created_at, :updated_at
            )
            """,
            template,
        )
        version = self.create_template_version(
            template_id=template["id"],
            fields=fields,
            validation_policy=validation_policy or {},
            normalization_policy=normalization_policy or {},
        )
        return self.get_template(template["id"]) or template, version

    def create_template_version(
        self,
        *,
        template_id: str,
        fields: List[Dict[str, Any]],
        validation_policy: Dict[str, Any] | None = None,
        normalization_policy: Dict[str, Any] | None = None,
    ) -> Dict[str, Any]:
        template = self.get_template(template_id)
        if not template:
            raise ValueError("Template not found")

        current = self.db.fetch_one(
            """
            SELECT MAX(version_no) AS max_version
            FROM field_template_versions
            WHERE template_id=:template_id
            """,
            {"template_id": template_id},
        )
        next_version = int((current or {}).get("max_version") or 0) + 1
        version = {
            "id": _new_id("tpv"),
            "template_id": template_id,
            "version_no": next_version,
            "fields_json": fields,
            "validation_policy_json": validation_policy or {},
            "normalization_policy_json": normalization_policy or {},
            "created_at": utc_now_iso(),
        }
        self.db.execute(
            """
            INSERT INTO field_template_versions(
                id, template_id, version_no, fields_json, validation_policy_json,
                normalization_policy_json, created_at
            )
            VALUES(
                :id, :template_id, :version_no, :fields_json, :validation_policy_json,
                :normalization_policy_json, :created_at
            )
            """,
            version,
        )
        self.db.execute(
            """
            UPDATE field_templates
            SET active_version_id=:active_version_id,
                updated_at=:updated_at
            WHERE id=:template_id
            """,
            {
                "active_version_id": version["id"],
                "updated_at": utc_now_iso(),
                "template_id": template_id,
            },
        )
        self._audit(
            project_id=template["project_id"],
            actor="system",
            action="template_version_created",
            entity_type="template_version",
            entity_id=version["id"],
            payload={"template_id": template_id, "version_no": next_version},
        )
        return self.get_template_version(version["id"]) or version

    def get_template(self, template_id: str) -> Optional[Dict[str, Any]]:
        return self.db.fetch_one(
            """
            SELECT id, project_id, name, status, active_version_id, created_at, updated_at
            FROM field_templates
            WHERE id=:template_id
            """,
            {"template_id": template_id},
        )

    def get_template_version(self, template_version_id: str) -> Optional[Dict[str, Any]]:
        return self.db.fetch_one(
            """
            SELECT id, template_id, version_no, fields_json, validation_policy_json,
                   normalization_policy_json, created_at
            FROM field_template_versions
            WHERE id=:template_version_id
            """,
            {"template_version_id": template_version_id},
        )

    def list_templates(self, project_id: str) -> List[Dict[str, Any]]:
        templates = self.db.fetch_all(
            """
            SELECT id, project_id, name, status, active_version_id, created_at, updated_at
            FROM field_templates
            WHERE project_id=:project_id
            ORDER BY created_at DESC
            """,
            {"project_id": project_id},
        )
        for template in templates:
            versions = self.db.fetch_all(
                """
                SELECT id, template_id, version_no, fields_json, validation_policy_json,
                       normalization_policy_json, created_at
                FROM field_template_versions
                WHERE template_id=:template_id
                ORDER BY version_no DESC
                """,
                {"template_id": template["id"]},
            )
            template["versions"] = versions
        return templates

    def active_template_for_project(self, project_id: str) -> Optional[Dict[str, Any]]:
        return self.db.fetch_one(
            """
            SELECT id, project_id, name, status, active_version_id, created_at, updated_at
            FROM field_templates
            WHERE project_id=:project_id AND status='ACTIVE'
            ORDER BY updated_at DESC
            LIMIT 1
            """,
            {"project_id": project_id},
        )

    # Extraction
    def create_extraction_run(
        self,
        *,
        project_id: str,
        template_version_id: str,
        trigger_reason: str,
        mode: str | None = None,
        quality_profile: str | None = None,
    ) -> Dict[str, Any]:
        template_version = self.get_template_version(template_version_id)
        if not template_version:
            raise ValueError("Template version not found")
        selected_mode = mode if mode in EXTRACTION_MODE else "hybrid"
        selected_quality_profile = quality_profile if quality_profile in QUALITY_PROFILE else "high"
        run = {
            "id": _new_id("run"),
            "project_id": project_id,
            "template_version_id": template_version_id,
            "mode": selected_mode,
            "quality_profile": selected_quality_profile,
            "status": "QUEUED",
            "total_cells": 0,
            "completed_cells": 0,
            "failed_cells": 0,
            "trigger_reason": trigger_reason,
            "error_message": None,
            "created_at": utc_now_iso(),
            "updated_at": utc_now_iso(),
        }
        self.db.execute(
            """
            INSERT INTO extraction_runs(
                id, project_id, template_version_id, mode, quality_profile, status, total_cells, completed_cells,
                failed_cells, trigger_reason, error_message, created_at, updated_at
            )
            VALUES(
                :id, :project_id, :template_version_id, :mode, :quality_profile, :status, :total_cells, :completed_cells,
                :failed_cells, :trigger_reason, :error_message, :created_at, :updated_at
            )
            """,
            run,
        )
        return self.get_extraction_run(project_id, run["id"]) or run

    def get_extraction_run(self, project_id: str, run_id: str) -> Optional[Dict[str, Any]]:
        return self.db.fetch_one(
            """
            SELECT id, project_id, template_version_id, mode, quality_profile, status, total_cells, completed_cells,
                   failed_cells, trigger_reason, error_message, created_at, updated_at
            FROM extraction_runs
            WHERE project_id=:project_id AND id=:run_id
            """,
            {"project_id": project_id, "run_id": run_id},
        )

    def latest_extraction_run(
        self,
        project_id: str,
        template_version_id: str,
    ) -> Optional[Dict[str, Any]]:
        return self.db.fetch_one(
            """
            SELECT id, project_id, template_version_id, mode, quality_profile, status, total_cells, completed_cells,
                   failed_cells, trigger_reason, error_message, created_at, updated_at
            FROM extraction_runs
            WHERE project_id=:project_id
              AND template_version_id=:template_version_id
              AND status IN ('COMPLETED', 'PARTIAL')
            ORDER BY created_at DESC
            LIMIT 1
            """,
            {"project_id": project_id, "template_version_id": template_version_id},
        )

    def run_extraction(self, run_id: str, task_id: str | None = None) -> Dict[str, Any]:
        run = self.db.fetch_one(
            """
            SELECT id, project_id, template_version_id, mode, quality_profile, status
            FROM extraction_runs
            WHERE id=:run_id
            """,
            {"run_id": run_id},
        )
        if not run:
            raise ValueError("Extraction run not found")
        if str(run.get("status") or "") == "CANCELED":
            return self.db.fetch_one(
                """
                SELECT id, project_id, template_version_id, mode, quality_profile, status, total_cells, completed_cells,
                       failed_cells, trigger_reason, error_message, created_at, updated_at
                FROM extraction_runs
                WHERE id=:run_id
                """,
                {"run_id": run_id},
            ) or {}
        if task_id and self.is_task_canceled(task_id):
            self.mark_extraction_run_canceled(run_id, "Canceled before extraction started.")
            return self.db.fetch_one(
                """
                SELECT id, project_id, template_version_id, mode, quality_profile, status, total_cells, completed_cells,
                       failed_cells, trigger_reason, error_message, created_at, updated_at
                FROM extraction_runs
                WHERE id=:run_id
                """,
                {"run_id": run_id},
            ) or {}

        template_version = self.get_template_version(run["template_version_id"])
        if not template_version:
            raise ValueError("Template version not found")

        documents = self.latest_document_versions_for_project(run["project_id"])
        latest_versions = [doc for doc in documents if doc.get("latest_version")]
        fields = template_version.get("fields_json") or []
        total_cells = len(latest_versions) * len(fields)

        self.db.execute(
            """
            UPDATE extraction_runs
            SET status='RUNNING',
                total_cells=:total_cells,
                completed_cells=0,
                failed_cells=0,
                error_message=NULL,
                updated_at=:updated_at
            WHERE id=:run_id
            """,
            {"total_cells": total_cells, "updated_at": utc_now_iso(), "run_id": run_id},
        )

        completed = 0
        failed = 0

        for doc in latest_versions:
            version = doc["latest_version"]
            doc_version_id = version["id"]
            artifact = version.get("artifact") or {}
            for field in fields:
                if task_id and self.is_task_canceled(task_id):
                    self.mark_extraction_run_canceled(
                        run_id,
                        "Canceled by user.",
                        completed_cells=completed,
                        failed_cells=failed,
                    )
                    run_row = self.db.fetch_one(
                        """
                        SELECT id, project_id, template_version_id, mode, quality_profile, status, total_cells, completed_cells,
                               failed_cells, trigger_reason, error_message, created_at, updated_at
                        FROM extraction_runs
                        WHERE id=:run_id
                        """,
                        {"run_id": run_id},
                    )
                    if run_row:
                        self._audit(
                            project_id=run_row["project_id"],
                            actor="system",
                            action="extraction_run_canceled",
                            entity_type="extraction_run",
                            entity_id=run_id,
                            payload={
                                "completed_cells": run_row.get("completed_cells", 0),
                                "failed_cells": run_row.get("failed_cells", 0),
                            },
                        )
                    return run_row or {}
                result = self._extract_field_cell(
                    field=field,
                    artifact=artifact,
                    doc_version_id=doc_version_id,
                    mode=str(run.get("mode") or "hybrid"),
                    quality_profile=str(run.get("quality_profile") or "high"),
                )
                if result["fallback_reason"]:
                    failed += 1
                else:
                    completed += 1
                payload = {
                    "id": _new_id("ext"),
                    "extraction_run_id": run_id,
                    "project_id": run["project_id"],
                    "document_version_id": doc_version_id,
                    "template_version_id": run["template_version_id"],
                    "field_key": str(field.get("key") or field.get("id") or field.get("name")),
                    "field_name": str(field.get("name") or field.get("key") or "Field"),
                    "field_type": str(field.get("type") or "text"),
                    "raw_text": result["raw_text"],
                    "value": result["value"],
                    "normalized_value": result["normalized_value"],
                    "normalization_valid": 1 if result["normalization_valid"] else 0,
                    "confidence_score": result["confidence_score"],
                    "citations_json": result["citations"],
                    "evidence_summary": result["evidence_summary"],
                    "fallback_reason": result["fallback_reason"],
                    "extraction_method": result["extraction_method"],
                    "model_name": result["model_name"],
                    "retrieval_context_json": result["retrieval_context"],
                    "verifier_status": result["verifier_status"],
                    "uncertainty_reason": result["uncertainty_reason"],
                    "created_at": utc_now_iso(),
                }
                self.db.execute(
                    """
                    INSERT INTO field_extractions(
                        id, extraction_run_id, project_id, document_version_id,
                        template_version_id, field_key, field_name, field_type, raw_text, value,
                        normalized_value, normalization_valid, confidence_score, citations_json,
                        evidence_summary, fallback_reason, extraction_method, model_name,
                        retrieval_context_json, verifier_status, uncertainty_reason, created_at
                    )
                    VALUES(
                        :id, :extraction_run_id, :project_id, :document_version_id,
                        :template_version_id, :field_key, :field_name, :field_type, :raw_text, :value,
                        :normalized_value, :normalization_valid, :confidence_score, :citations_json,
                        :evidence_summary, :fallback_reason, :extraction_method, :model_name,
                        :retrieval_context_json, :verifier_status, :uncertainty_reason, :created_at
                    )
                    """,
                    payload,
                )

        final_status = "COMPLETED"
        if failed and completed:
            final_status = "PARTIAL"
        elif failed and not completed:
            final_status = "FAILED"

        self.db.execute(
            """
            UPDATE extraction_runs
            SET status=:status,
                completed_cells=:completed_cells,
                failed_cells=:failed_cells,
                updated_at=:updated_at
            WHERE id=:run_id
            """,
            {
                "status": final_status,
                "completed_cells": completed,
                "failed_cells": failed,
                "updated_at": utc_now_iso(),
                "run_id": run_id,
            },
        )
        run_row = self.db.fetch_one(
            """
            SELECT id, project_id, template_version_id, mode, quality_profile, status, total_cells, completed_cells,
                   failed_cells, trigger_reason, error_message, created_at, updated_at
            FROM extraction_runs
            WHERE id=:run_id
            """,
            {"run_id": run_id},
        )
        if run_row:
            self._audit(
                project_id=run_row["project_id"],
                actor="system",
                action="extraction_run_completed",
                entity_type="extraction_run",
                entity_id=run_id,
                payload={
                    "status": run_row["status"],
                    "completed_cells": run_row["completed_cells"],
                    "failed_cells": run_row["failed_cells"],
                },
            )
        return run_row or {}

    def mark_extraction_run_failed(self, run_id: str, error_message: str) -> None:
        self.db.execute(
            """
            UPDATE extraction_runs
            SET status='FAILED',
                error_message=:error_message,
                updated_at=:updated_at
            WHERE id=:run_id
            """,
            {
                "run_id": run_id,
                "error_message": error_message,
                "updated_at": utc_now_iso(),
            },
        )

    def mark_extraction_run_canceled(
        self,
        run_id: str,
        reason: str | None = None,
        *,
        completed_cells: int | None = None,
        failed_cells: int | None = None,
    ) -> None:
        run = self.db.fetch_one(
            """
            SELECT id, status, completed_cells, failed_cells
            FROM extraction_runs
            WHERE id=:run_id
            """,
            {"run_id": run_id},
        )
        if not run:
            return
        if str(run.get("status") or "") in {"COMPLETED", "PARTIAL", "FAILED", "CANCELED"}:
            return
        self.db.execute(
            """
            UPDATE extraction_runs
            SET status='CANCELED',
                completed_cells=:completed_cells,
                failed_cells=:failed_cells,
                error_message=:error_message,
                updated_at=:updated_at
            WHERE id=:run_id
            """,
            {
                "run_id": run_id,
                "completed_cells": completed_cells if completed_cells is not None else int(run.get("completed_cells") or 0),
                "failed_cells": failed_cells if failed_cells is not None else int(run.get("failed_cells") or 0),
                "error_message": (reason or "Canceled by user.").strip(),
                "updated_at": utc_now_iso(),
            },
        )

    def _extract_field_cell(
        self,
        *,
        field: Dict[str, Any],
        artifact: Dict[str, Any],
        doc_version_id: str,
        mode: str = "hybrid",
        quality_profile: str = "high",
    ) -> Dict[str, Any]:
        selected_mode = mode if mode in EXTRACTION_MODE else "hybrid"
        selected_quality_profile = quality_profile if quality_profile in QUALITY_PROFILE else "high"

        if selected_mode == "deterministic":
            return self._extract_field_cell_deterministic(field=field, artifact=artifact, doc_version_id=doc_version_id)

        llm_result = self._extract_field_cell_llm(
            field=field,
            artifact=artifact,
            doc_version_id=doc_version_id,
            mode=selected_mode,
            quality_profile=selected_quality_profile,
        )
        if llm_result:
            return llm_result

        if selected_mode == "llm_reasoning":
            return {
                "raw_text": "",
                "value": "",
                "normalized_value": "",
                "normalization_valid": False,
                "confidence_score": 0.05,
                "citations": [],
                "evidence_summary": "LLM reasoning mode failed before producing a supported extraction.",
                "fallback_reason": "MODEL_ERROR",
                "extraction_method": "llm_reasoning",
                "model_name": self.llm_client.extraction_model,
                "retrieval_context": [],
                "verifier_status": "FAIL",
                "uncertainty_reason": "LLM unavailable or returned invalid payload.",
            }

        deterministic = self._extract_field_cell_deterministic(field=field, artifact=artifact, doc_version_id=doc_version_id)
        deterministic["uncertainty_reason"] = (
            deterministic.get("uncertainty_reason") or "Hybrid mode fell back to deterministic extraction."
        )
        return deterministic

    def _extract_field_cell_deterministic(
        self,
        *,
        field: Dict[str, Any],
        artifact: Dict[str, Any],
        doc_version_id: str,
    ) -> Dict[str, Any]:
        best_block, score = _pick_best_block(artifact, field)
        if not best_block:
            return {
                "raw_text": "",
                "value": "",
                "normalized_value": "",
                "normalization_valid": False,
                "confidence_score": 0.1,
                "citations": [],
                "evidence_summary": "No reliable evidence found for this field in the parsed document.",
                "fallback_reason": "NOT_FOUND",
                "extraction_method": "deterministic",
                "model_name": None,
                "retrieval_context": [],
                "verifier_status": "SKIPPED",
                "uncertainty_reason": "No candidate block matched field keywords.",
            }

        raw_text = _normalize_space(str(best_block.get("text") or ""))
        if not raw_text:
            return {
                "raw_text": "",
                "value": "",
                "normalized_value": "",
                "normalization_valid": False,
                "confidence_score": 0.1,
                "citations": [],
                "evidence_summary": "Block selected but contains no extractable text.",
                "fallback_reason": "AMBIGUOUS",
                "extraction_method": "deterministic",
                "model_name": None,
                "retrieval_context": [],
                "verifier_status": "SKIPPED",
                "uncertainty_reason": "Selected block had empty normalized text.",
            }

        value = _value_from_block(field, raw_text)
        normalized_value, valid = _normalize_value_by_type(str(field.get("type") or "text"), value)
        citations = _citations_with_doc_version(best_block.get("citations") or [], doc_version_id)
        confidence = 0.35 + min(4.0, score) * 0.12
        confidence = max(0.2, min(0.95, confidence))
        location = "document"
        first_citation = citations[0] if citations else {}
        if isinstance(first_citation, dict):
            if first_citation.get("page"):
                location = f"page {first_citation.get('page')}"
            elif first_citation.get("selector"):
                location = f"selector {first_citation.get('selector')}"
        return {
            "raw_text": raw_text[:5000],
            "value": value,
            "normalized_value": normalized_value,
            "normalization_valid": bool(valid),
            "confidence_score": round(confidence, 3),
            "citations": citations,
            "evidence_summary": f"Selected best matching block from {location} using field prompt keywords.",
            "fallback_reason": None,
            "extraction_method": "deterministic",
            "model_name": None,
            "retrieval_context": [],
            "verifier_status": "SKIPPED",
            "uncertainty_reason": None,
        }

    @staticmethod
    def _compact_retrieval_context(candidates: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        compact: List[Dict[str, Any]] = []
        for candidate in candidates:
            compact.append(
                {
                    "block_id": candidate.get("block_id"),
                    "block_type": candidate.get("block_type"),
                    "scores": candidate.get("scores") or {},
                    "text_preview": str(candidate.get("text") or "")[:500],
                    "citations": (candidate.get("citations") or [])[:2],
                }
            )
        return compact

    def _extract_field_cell_llm(
        self,
        *,
        field: Dict[str, Any],
        artifact: Dict[str, Any],
        doc_version_id: str,
        mode: str,
        quality_profile: str,
    ) -> Optional[Dict[str, Any]]:
        top_k = 8 if quality_profile == "high" else (6 if quality_profile == "balanced" else 4)
        candidates = retrieve_legal_candidates(
            artifact=artifact,
            field=field,
            doc_version_id=doc_version_id,
            top_k=top_k,
        )
        retrieval_context = self._compact_retrieval_context(candidates)
        if not candidates:
            return {
                "raw_text": "",
                "value": "",
                "normalized_value": "",
                "normalization_valid": False,
                "confidence_score": 0.1,
                "citations": [],
                "evidence_summary": "No legal evidence candidates found by retrieval.",
                "fallback_reason": "NOT_FOUND",
                "extraction_method": "llm_hybrid" if mode == "hybrid" else "llm_reasoning",
                "model_name": self.llm_client.extraction_model if self.llm_client.enabled else None,
                "retrieval_context": retrieval_context,
                "verifier_status": "FAIL",
                "uncertainty_reason": "Retriever found no evidence candidates.",
            }

        if not self.llm_client.enabled:
            return None

        try:
            primary = self.llm_client.extract(field=field, candidates=candidates, quality_profile=quality_profile)
            verifier = self.llm_client.verify(
                field=field,
                value=primary.get("value") or "",
                raw_text=primary.get("raw_text") or "",
                candidates=candidates,
                quality_profile=quality_profile,
            )

            if verifier.get("verifier_status") == "FAIL":
                expanded_candidates = retrieve_legal_candidates(
                    artifact=artifact,
                    field=field,
                    doc_version_id=doc_version_id,
                    top_k=12,
                )
                if expanded_candidates:
                    candidates = expanded_candidates
                    retrieval_context = self._compact_retrieval_context(candidates)
                    primary = self.llm_client.extract(field=field, candidates=candidates, quality_profile=quality_profile)
                    verifier = self.llm_client.verify(
                        field=field,
                        value=primary.get("value") or "",
                        raw_text=primary.get("raw_text") or "",
                        candidates=candidates,
                        quality_profile=quality_profile,
                    )

            self_consistent = True
            if quality_profile == "high":
                alternative = self.llm_client.extract(
                    field=field,
                    candidates=list(reversed(candidates)),
                    quality_profile=quality_profile,
                )
                self_consistent = self_consistency_agreement(
                    str(primary.get("value") or ""),
                    str(alternative.get("value") or ""),
                )

            verifier_status = str(verifier.get("verifier_status") or "PARTIAL")
            if verifier_status not in VERIFIER_STATUS:
                verifier_status = "PARTIAL"

            candidate_index = verifier.get("best_candidate_index")
            try:
                candidate_index = int(candidate_index)
            except (TypeError, ValueError):
                candidate_index = int(primary.get("candidate_index") or 0)
            candidate_index = max(0, min(candidate_index, len(candidates) - 1))
            selected = candidates[candidate_index]

            value = str(primary.get("value") or "").strip()
            raw_text = _normalize_space(str(primary.get("raw_text") or "")) or _normalize_space(str(selected.get("text") or ""))
            if not value and raw_text:
                value = _value_from_block(field, raw_text)
            normalized_value, valid = _normalize_value_by_type(str(field.get("type") or "text"), value)

            retrieval_score = float((selected.get("scores") or {}).get("final") or 0.0)
            base_confidence = float(primary.get("confidence") or 0.65)
            confidence = confidence_from_signals(
                base_confidence=base_confidence,
                retrieval_score=retrieval_score,
                verifier_status=verifier_status,
                self_consistent=self_consistent,
            )

            fallback_reason = None
            uncertainty_reason = None
            if verifier_status == "FAIL":
                fallback_reason = "AMBIGUOUS"
                uncertainty_reason = str(verifier.get("reason") or "Verifier rejected unsupported extraction.")
            elif verifier_status == "PARTIAL" and quality_profile == "high" and not self_consistent:
                fallback_reason = "AMBIGUOUS"
                uncertainty_reason = "High-quality mode detected inconsistent LLM answers."
            elif verifier_status == "PARTIAL":
                uncertainty_reason = str(verifier.get("reason") or "Verifier marked extraction as partially supported.")

            return {
                "raw_text": raw_text[:5000],
                "value": value,
                "normalized_value": normalized_value,
                "normalization_valid": bool(valid),
                "confidence_score": confidence,
                "citations": selected.get("citations") or [],
                "evidence_summary": str(primary.get("evidence_summary") or "LLM extracted from retrieved legal evidence."),
                "fallback_reason": fallback_reason,
                "extraction_method": "llm_hybrid" if mode == "hybrid" else "llm_reasoning",
                "model_name": str(primary.get("model_name") or self.llm_client.extraction_model),
                "retrieval_context": retrieval_context,
                "verifier_status": verifier_status,
                "uncertainty_reason": uncertainty_reason,
            }
        except Exception as exc:
            if mode == "hybrid":
                return None
            return {
                "raw_text": "",
                "value": "",
                "normalized_value": "",
                "normalization_valid": False,
                "confidence_score": 0.05,
                "citations": [],
                "evidence_summary": "LLM reasoning extraction failed.",
                "fallback_reason": "MODEL_ERROR",
                "extraction_method": "llm_reasoning",
                "model_name": self.llm_client.extraction_model,
                "retrieval_context": retrieval_context,
                "verifier_status": "FAIL",
                "uncertainty_reason": str(exc),
            }

    def field_extractions_for_run(self, run_id: str) -> List[Dict[str, Any]]:
        return self.db.fetch_all(
            """
            SELECT id, extraction_run_id, project_id, document_version_id, template_version_id,
                   field_key, field_name, field_type, raw_text, value, normalized_value,
                   normalization_valid, confidence_score, citations_json, evidence_summary,
                   fallback_reason, extraction_method, model_name, retrieval_context_json,
                   verifier_status, uncertainty_reason, created_at
            FROM field_extractions
            WHERE extraction_run_id=:run_id
            ORDER BY created_at ASC
            """,
            {"run_id": run_id},
        )

    def extraction_run_diagnostics(self, project_id: str, run_id: str) -> Dict[str, Any]:
        run = self.get_extraction_run(project_id, run_id)
        if not run:
            raise ValueError("Extraction run not found")
        rows = self.field_extractions_for_run(run_id)

        summary = {
            "total_cells": len(rows),
            "fallback_cells": 0,
            "verifier_failures": 0,
            "verifier_partial": 0,
            "low_confidence_cells": 0,
            "method_breakdown": {},
            "fallback_breakdown": {},
            "avg_confidence": 0.0,
        }
        confidence_total = 0.0

        for row in rows:
            method = str(row.get("extraction_method") or "deterministic")
            summary["method_breakdown"][method] = int(summary["method_breakdown"].get(method, 0)) + 1

            confidence = float(row.get("confidence_score") or 0.0)
            confidence_total += confidence
            if confidence < 0.55:
                summary["low_confidence_cells"] += 1

            fallback = row.get("fallback_reason")
            if fallback:
                summary["fallback_cells"] += 1
                key = str(fallback)
                summary["fallback_breakdown"][key] = int(summary["fallback_breakdown"].get(key, 0)) + 1

            verifier_status = str(row.get("verifier_status") or "SKIPPED")
            if verifier_status == "FAIL":
                summary["verifier_failures"] += 1
            elif verifier_status == "PARTIAL":
                summary["verifier_partial"] += 1

        if rows:
            summary["avg_confidence"] = round(confidence_total / len(rows), 4)

        return {
            "run": run,
            "summary": summary,
            "cells": rows,
        }

    # Review
    def upsert_review_decision(
        self,
        *,
        project_id: str,
        document_version_id: str,
        template_version_id: str,
        field_key: str,
        status: str,
        manual_value: str | None,
        reviewer: str | None,
        notes: str | None,
    ) -> Dict[str, Any]:
        if status not in REVIEW_STATUS:
            raise ValueError("Invalid review status")
        existing = self.db.fetch_one(
            """
            SELECT id FROM review_decisions
            WHERE project_id=:project_id
              AND document_version_id=:document_version_id
              AND template_version_id=:template_version_id
              AND field_key=:field_key
            """,
            {
                "project_id": project_id,
                "document_version_id": document_version_id,
                "template_version_id": template_version_id,
                "field_key": field_key,
            },
        )
        now = utc_now_iso()
        if existing:
            self.db.execute(
                """
                UPDATE review_decisions
                SET status=:status,
                    manual_value=:manual_value,
                    reviewer=:reviewer,
                    notes=:notes,
                    updated_at=:updated_at
                WHERE id=:id
                """,
                {
                    "id": existing["id"],
                    "status": status,
                    "manual_value": manual_value,
                    "reviewer": reviewer,
                    "notes": notes,
                    "updated_at": now,
                },
            )
            decision_id = existing["id"]
        else:
            decision_id = _new_id("rvw")
            self.db.execute(
                """
                INSERT INTO review_decisions(
                    id, project_id, document_version_id, template_version_id,
                    field_key, status, manual_value, reviewer, notes, created_at, updated_at
                )
                VALUES(
                    :id, :project_id, :document_version_id, :template_version_id,
                    :field_key, :status, :manual_value, :reviewer, :notes, :created_at, :updated_at
                )
                """,
                {
                    "id": decision_id,
                    "project_id": project_id,
                    "document_version_id": document_version_id,
                    "template_version_id": template_version_id,
                    "field_key": field_key,
                    "status": status,
                    "manual_value": manual_value,
                    "reviewer": reviewer,
                    "notes": notes,
                    "created_at": now,
                    "updated_at": now,
                },
            )
        decision = self.db.fetch_one(
            """
            SELECT id, project_id, document_version_id, template_version_id, field_key, status,
                   manual_value, reviewer, notes, created_at, updated_at
            FROM review_decisions
            WHERE id=:id
            """,
            {"id": decision_id},
        )
        if decision:
            self._audit(
                project_id=project_id,
                actor=reviewer or "reviewer",
                action="review_decision_upserted",
                entity_type="review_decision",
                entity_id=decision["id"],
                payload={"field_key": field_key, "status": status},
            )
        return decision or {}

    def list_review_decisions(self, project_id: str, template_version_id: str | None = None) -> List[Dict[str, Any]]:
        if template_version_id:
            return self.db.fetch_all(
                """
                SELECT id, project_id, document_version_id, template_version_id, field_key, status,
                       manual_value, reviewer, notes, created_at, updated_at
                FROM review_decisions
                WHERE project_id=:project_id AND template_version_id=:template_version_id
                ORDER BY updated_at DESC
                """,
                {"project_id": project_id, "template_version_id": template_version_id},
            )
        return self.db.fetch_all(
            """
            SELECT id, project_id, document_version_id, template_version_id, field_key, status,
                   manual_value, reviewer, notes, created_at, updated_at
            FROM review_decisions
            WHERE project_id=:project_id
            ORDER BY updated_at DESC
            """,
            {"project_id": project_id},
        )

    # Table view
    def table_view(
        self,
        *,
        project_id: str,
        template_version_id: str | None,
        baseline_document_id: str | None = None,
    ) -> Dict[str, Any]:
        if not template_version_id:
            active = self.active_template_for_project(project_id)
            if not active:
                raise ValueError("No active template found for project")
            template_version_id = active.get("active_version_id")
        if not template_version_id:
            raise ValueError("No template version found")

        template_version = self.get_template_version(template_version_id)
        if not template_version:
            raise ValueError("Template version not found")

        run = self.latest_extraction_run(project_id, template_version_id)
        if not run:
            return {
                "project_id": project_id,
                "template_version_id": template_version_id,
                "extraction_run_id": None,
                "columns": template_version.get("fields_json") or [],
                "rows": [],
            }

        extractions = self.field_extractions_for_run(run["id"])
        ext_map: Dict[Tuple[str, str], Dict[str, Any]] = {}
        for item in extractions:
            ext_map[(item["document_version_id"], item["field_key"])] = item

        decisions = self.list_review_decisions(project_id, template_version_id)
        dec_map: Dict[Tuple[str, str], Dict[str, Any]] = {}
        for dec in decisions:
            dec_map[(dec["document_version_id"], dec["field_key"])] = dec

        documents = self.latest_document_versions_for_project(project_id)
        rows: List[Dict[str, Any]] = []
        field_list = template_version.get("fields_json") or []
        baseline_doc_version = None
        for doc in documents:
            if doc.get("id") == baseline_document_id and doc.get("latest_version"):
                baseline_doc_version = doc["latest_version"]["id"]
                break
        if not baseline_doc_version and documents:
            first = next((doc for doc in documents if doc.get("latest_version")), None)
            if first:
                baseline_doc_version = first["latest_version"]["id"]

        baseline_values: Dict[str, str] = {}
        if baseline_doc_version:
            for field in field_list:
                key = str(field.get("key") or field.get("id") or field.get("name"))
                baseline_extraction = ext_map.get((baseline_doc_version, key))
                baseline_decision = dec_map.get((baseline_doc_version, key))
                base_val = ""
                if baseline_decision and baseline_decision.get("status") == "MANUAL_UPDATED":
                    base_val = baseline_decision.get("manual_value") or ""
                elif baseline_extraction:
                    base_val = baseline_extraction.get("value") or ""
                baseline_values[key] = _normalize_space(base_val).lower()

        for doc in documents:
            latest = doc.get("latest_version")
            if not latest:
                continue
            row_cells: Dict[str, Any] = {}
            for field in field_list:
                field_key = str(field.get("key") or field.get("id") or field.get("name"))
                ai_result = ext_map.get((latest["id"], field_key))
                review = dec_map.get((latest["id"], field_key))
                ai_value = (ai_result or {}).get("value") or ""
                effective_value = ai_value
                if review and review.get("status") == "MANUAL_UPDATED":
                    effective_value = review.get("manual_value") or ""
                diff_baseline = baseline_values.get(field_key, "")
                is_diff = bool(diff_baseline and _normalize_space(effective_value).lower() != diff_baseline)
                row_cells[field_key] = {
                    "field_key": field_key,
                    "ai_result": ai_result,
                    "review_overlay": review,
                    "effective_value": effective_value,
                    "is_diff": is_diff,
                }

            rows.append(
                {
                    "document_id": doc["id"],
                    "document_version_id": latest["id"],
                    "filename": doc["filename"],
                    "artifact": latest.get("artifact") or {},
                    "parse_status": latest.get("parse_status"),
                    "cells": row_cells,
                }
            )
        return {
            "project_id": project_id,
            "template_version_id": template_version_id,
            "extraction_run_id": run["id"],
            "columns": field_list,
            "rows": rows,
        }

    # Ground truth and evaluation
    def create_ground_truth_set(
        self,
        *,
        project_id: str,
        name: str,
        labels: List[Dict[str, Any]],
        label_format: str = "json",
    ) -> Dict[str, Any]:
        gt_set = {
            "id": _new_id("gts"),
            "project_id": project_id,
            "name": name.strip() or "Ground Truth Set",
            "format": label_format,
            "created_at": utc_now_iso(),
        }
        self.db.execute(
            """
            INSERT INTO ground_truth_sets(id, project_id, name, format, created_at)
            VALUES(:id, :project_id, :name, :format, :created_at)
            """,
            gt_set,
        )
        label_rows: List[Dict[str, Any]] = []
        for label in labels:
            label_rows.append(
                {
                    "id": _new_id("gtl"),
                    "ground_truth_set_id": gt_set["id"],
                    "document_version_id": label.get("document_version_id"),
                    "field_key": label.get("field_key"),
                    "expected_value": label.get("expected_value"),
                    "expected_normalized_value": label.get("expected_normalized_value"),
                    "notes": label.get("notes"),
                }
            )
        if label_rows:
            self.db.executemany(
                """
                INSERT INTO ground_truth_labels(
                    id, ground_truth_set_id, document_version_id, field_key,
                    expected_value, expected_normalized_value, notes
                )
                VALUES(
                    :id, :ground_truth_set_id, :document_version_id, :field_key,
                    :expected_value, :expected_normalized_value, :notes
                )
                """,
                label_rows,
            )
        self._audit(
            project_id=project_id,
            actor="system",
            action="ground_truth_created",
            entity_type="ground_truth_set",
            entity_id=gt_set["id"],
            payload={"labels": len(label_rows)},
        )
        payload = dict(gt_set)
        payload["labels"] = label_rows
        return payload

    def create_evaluation_run(
        self,
        *,
        project_id: str,
        ground_truth_set_id: str,
        extraction_run_id: str,
    ) -> Dict[str, Any]:
        now = utc_now_iso()
        run = {
            "id": _new_id("evr"),
            "project_id": project_id,
            "ground_truth_set_id": ground_truth_set_id,
            "extraction_run_id": extraction_run_id,
            "status": "QUEUED",
            "metrics_json": {},
            "notes": "",
            "created_at": now,
            "updated_at": now,
        }
        self.db.execute(
            """
            INSERT INTO evaluation_runs(
                id, project_id, ground_truth_set_id, extraction_run_id, status,
                metrics_json, notes, created_at, updated_at
            )
            VALUES(
                :id, :project_id, :ground_truth_set_id, :extraction_run_id, :status,
                :metrics_json, :notes, :created_at, :updated_at
            )
            """,
            run,
        )
        return self.get_evaluation_run(project_id, run["id"]) or run

    def get_evaluation_run(self, project_id: str, eval_run_id: str) -> Optional[Dict[str, Any]]:
        return self.db.fetch_one(
            """
            SELECT id, project_id, ground_truth_set_id, extraction_run_id, status,
                   metrics_json, notes, created_at, updated_at
            FROM evaluation_runs
            WHERE project_id=:project_id AND id=:eval_run_id
            """,
            {"project_id": project_id, "eval_run_id": eval_run_id},
        )

    def run_evaluation(self, eval_run_id: str, task_id: str | None = None) -> Dict[str, Any]:
        run = self.db.fetch_one(
            """
            SELECT id, project_id, ground_truth_set_id, extraction_run_id
            FROM evaluation_runs
            WHERE id=:eval_run_id
            """,
            {"eval_run_id": eval_run_id},
        )
        if not run:
            raise ValueError("Evaluation run not found")
        if task_id and self.is_task_canceled(task_id):
            self.mark_evaluation_run_canceled(eval_run_id, "Canceled before evaluation started.")
            return self.get_evaluation_run(run["project_id"], eval_run_id) or {}

        self.db.execute(
            """
            UPDATE evaluation_runs
            SET status='RUNNING', updated_at=:updated_at
            WHERE id=:eval_run_id
            """,
            {"updated_at": utc_now_iso(), "eval_run_id": eval_run_id},
        )

        labels = self.db.fetch_all(
            """
            SELECT id, document_version_id, field_key, expected_value,
                   expected_normalized_value, notes
            FROM ground_truth_labels
            WHERE ground_truth_set_id=:ground_truth_set_id
            """,
            {"ground_truth_set_id": run["ground_truth_set_id"]},
        )
        extractions = self.db.fetch_all(
            """
            SELECT document_version_id, field_key, value, normalized_value, normalization_valid
            FROM field_extractions
            WHERE extraction_run_id=:extraction_run_id
            """,
            {"extraction_run_id": run["extraction_run_id"]},
        )
        ext_map: Dict[Tuple[str, str], Dict[str, Any]] = {
            (item["document_version_id"], item["field_key"]): item for item in extractions
        }

        total = len(labels)
        matched = 0
        covered = 0
        normalization_valid = 0
        mismatches: List[str] = []

        for label in labels:
            if task_id and self.is_task_canceled(task_id):
                self.mark_evaluation_run_canceled(eval_run_id, "Canceled by user during evaluation.")
                return self.get_evaluation_run(run["project_id"], eval_run_id) or {}
            key = (label["document_version_id"], label["field_key"])
            extracted = ext_map.get(key)
            if extracted and _normalize_space(extracted.get("value") or ""):
                covered += 1
            if extracted and extracted.get("normalization_valid"):
                normalization_valid += 1

            expected_norm = label.get("expected_normalized_value") or label.get("expected_value") or ""
            got_norm = (extracted or {}).get("normalized_value") or (extracted or {}).get("value") or ""
            if _string_similarity(expected_norm, got_norm):
                matched += 1
            else:
                if len(mismatches) < 20:
                    mismatches.append(
                        f"{label['field_key']} ({label['document_version_id']}): expected `{expected_norm}` got `{got_norm}`"
                    )

        precision = (matched / covered) if covered else 0.0
        recall = (matched / total) if total else 0.0
        f1 = 0.0
        if precision and recall:
            f1 = 2 * (precision * recall) / (precision + recall)
        metrics = {
            "total_labels": total,
            "matched_labels": matched,
            "field_level_accuracy": round((matched / total) if total else 0.0, 4),
            "coverage": round((covered / total) if total else 0.0, 4),
            "normalization_validity": round((normalization_valid / covered) if covered else 0.0, 4),
            "precision": round(precision, 4),
            "recall": round(recall, 4),
            "f1": round(f1, 4),
            "qualitative_notes": mismatches,
        }
        status = "COMPLETED"
        note = "Evaluation completed successfully."
        self.db.execute(
            """
            UPDATE evaluation_runs
            SET status=:status,
                metrics_json=:metrics_json,
                notes=:notes,
                updated_at=:updated_at
            WHERE id=:eval_run_id
            """,
            {
                "status": status,
                "metrics_json": metrics,
                "notes": note,
                "updated_at": utc_now_iso(),
                "eval_run_id": eval_run_id,
            },
        )
        self._audit(
            project_id=run["project_id"],
            actor="system",
            action="evaluation_completed",
            entity_type="evaluation_run",
            entity_id=eval_run_id,
            payload=metrics,
        )
        return self.get_evaluation_run(run["project_id"], eval_run_id) or {}

    def mark_evaluation_run_failed(self, eval_run_id: str, error_message: str) -> None:
        self.db.execute(
            """
            UPDATE evaluation_runs
            SET status='FAILED',
                notes=:notes,
                updated_at=:updated_at
            WHERE id=:eval_run_id
            """,
            {
                "eval_run_id": eval_run_id,
                "notes": error_message,
                "updated_at": utc_now_iso(),
            },
        )

    def mark_evaluation_run_canceled(self, eval_run_id: str, reason: str | None = None) -> None:
        run = self.db.fetch_one(
            """
            SELECT id, status
            FROM evaluation_runs
            WHERE id=:eval_run_id
            """,
            {"eval_run_id": eval_run_id},
        )
        if not run:
            return
        if str(run.get("status") or "") in {"COMPLETED", "FAILED", "CANCELED"}:
            return
        self.db.execute(
            """
            UPDATE evaluation_runs
            SET status='CANCELED',
                notes=:notes,
                updated_at=:updated_at
            WHERE id=:eval_run_id
            """,
            {
                "eval_run_id": eval_run_id,
                "notes": (reason or "Canceled by user.").strip(),
                "updated_at": utc_now_iso(),
            },
        )

    # Annotation
    def create_annotation(
        self,
        *,
        project_id: str,
        document_version_id: str,
        template_version_id: str,
        field_key: str,
        body: str,
        author: str | None,
        approved: bool = False,
    ) -> Dict[str, Any]:
        now = utc_now_iso()
        annotation = {
            "id": _new_id("ann"),
            "project_id": project_id,
            "document_version_id": document_version_id,
            "template_version_id": template_version_id,
            "field_key": field_key,
            "body": body.strip(),
            "author": author or "reviewer",
            "approved": 1 if approved else 0,
            "created_at": now,
            "updated_at": now,
        }
        self.db.execute(
            """
            INSERT INTO annotations(
                id, project_id, document_version_id, template_version_id,
                field_key, body, author, approved, created_at, updated_at
            )
            VALUES(
                :id, :project_id, :document_version_id, :template_version_id,
                :field_key, :body, :author, :approved, :created_at, :updated_at
            )
            """,
            annotation,
        )
        self._audit(
            project_id=project_id,
            actor=annotation["author"],
            action="annotation_created",
            entity_type="annotation",
            entity_id=annotation["id"],
            payload={"field_key": field_key, "approved": bool(annotation["approved"])},
        )
        return self.db.fetch_one(
            """
            SELECT id, project_id, document_version_id, template_version_id, field_key,
                   body, author, approved, created_at, updated_at
            FROM annotations
            WHERE id=:id
            """,
            {"id": annotation["id"]},
        ) or annotation

    def list_annotations(self, project_id: str, template_version_id: str | None = None) -> List[Dict[str, Any]]:
        if template_version_id:
            return self.db.fetch_all(
                """
                SELECT id, project_id, document_version_id, template_version_id, field_key,
                       body, author, approved, created_at, updated_at
                FROM annotations
                WHERE project_id=:project_id AND template_version_id=:template_version_id
                ORDER BY created_at DESC
                """,
                {"project_id": project_id, "template_version_id": template_version_id},
            )
        return self.db.fetch_all(
            """
            SELECT id, project_id, document_version_id, template_version_id, field_key,
                   body, author, approved, created_at, updated_at
            FROM annotations
            WHERE project_id=:project_id
            ORDER BY created_at DESC
            """,
            {"project_id": project_id},
        )

    # Audit
    def _audit(
        self,
        *,
        project_id: str | None,
        actor: str,
        action: str,
        entity_type: str,
        entity_id: str,
        payload: Dict[str, Any] | None = None,
    ) -> None:
        event = {
            "id": _new_id("aud"),
            "project_id": project_id,
            "actor": actor,
            "action": action,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "payload_json": payload or {},
            "created_at": utc_now_iso(),
        }
        self.db.execute(
            """
            INSERT INTO audit_events(
                id, project_id, actor, action, entity_type, entity_id, payload_json, created_at
            )
            VALUES(
                :id, :project_id, :actor, :action, :entity_type, :entity_id, :payload_json, :created_at
            )
            """,
            event,
        )


service = LegalReviewService()
