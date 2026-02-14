from __future__ import annotations

import json
import os
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, Iterator, List, Optional


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _to_db_value(value: Any) -> Any:
    if isinstance(value, (dict, list)):
        return json.dumps(value)
    return value


class SQLiteDB:
    def __init__(self, db_path: str) -> None:
        self.db_path = db_path
        self._init_lock = threading.Lock()
        Path(os.path.dirname(self.db_path) or ".").mkdir(parents=True, exist_ok=True)
        self.initialize()

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.db_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def initialize(self) -> None:
        with self._init_lock:
            with self.connect() as conn:
                conn.executescript(
                    """
                    CREATE TABLE IF NOT EXISTS projects (
                        id TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        description TEXT,
                        status TEXT NOT NULL,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    );

                    CREATE TABLE IF NOT EXISTS documents (
                        id TEXT PRIMARY KEY,
                        project_id TEXT NOT NULL,
                        filename TEXT NOT NULL,
                        source_mime_type TEXT,
                        sha256 TEXT,
                        created_at TEXT NOT NULL,
                        FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
                    );

                    CREATE TABLE IF NOT EXISTS document_versions (
                        id TEXT PRIMARY KEY,
                        document_id TEXT NOT NULL,
                        version_no INTEGER NOT NULL,
                        parse_status TEXT NOT NULL,
                        artifact_json TEXT,
                        error_message TEXT,
                        created_at TEXT NOT NULL,
                        FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
                    );

                    CREATE UNIQUE INDEX IF NOT EXISTS idx_document_versions_unique
                    ON document_versions(document_id, version_no);

                    CREATE TABLE IF NOT EXISTS field_templates (
                        id TEXT PRIMARY KEY,
                        project_id TEXT NOT NULL,
                        name TEXT NOT NULL,
                        status TEXT NOT NULL,
                        active_version_id TEXT,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
                    );

                    CREATE TABLE IF NOT EXISTS field_template_versions (
                        id TEXT PRIMARY KEY,
                        template_id TEXT NOT NULL,
                        version_no INTEGER NOT NULL,
                        fields_json TEXT NOT NULL,
                        validation_policy_json TEXT,
                        normalization_policy_json TEXT,
                        created_at TEXT NOT NULL,
                        FOREIGN KEY(template_id) REFERENCES field_templates(id) ON DELETE CASCADE
                    );

                    CREATE UNIQUE INDEX IF NOT EXISTS idx_template_versions_unique
                    ON field_template_versions(template_id, version_no);

                    CREATE TABLE IF NOT EXISTS extraction_runs (
                        id TEXT PRIMARY KEY,
                        project_id TEXT NOT NULL,
                        template_version_id TEXT NOT NULL,
                        mode TEXT NOT NULL DEFAULT 'hybrid',
                        quality_profile TEXT NOT NULL DEFAULT 'high',
                        status TEXT NOT NULL,
                        total_cells INTEGER NOT NULL DEFAULT 0,
                        completed_cells INTEGER NOT NULL DEFAULT 0,
                        failed_cells INTEGER NOT NULL DEFAULT 0,
                        trigger_reason TEXT,
                        error_message TEXT,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
                        FOREIGN KEY(template_version_id) REFERENCES field_template_versions(id) ON DELETE CASCADE
                    );

                    CREATE TABLE IF NOT EXISTS field_extractions (
                        id TEXT PRIMARY KEY,
                        extraction_run_id TEXT NOT NULL,
                        project_id TEXT NOT NULL,
                        document_version_id TEXT NOT NULL,
                        template_version_id TEXT NOT NULL,
                        field_key TEXT NOT NULL,
                        field_name TEXT NOT NULL,
                        field_type TEXT NOT NULL,
                        raw_text TEXT,
                        value TEXT,
                        normalized_value TEXT,
                        normalization_valid INTEGER NOT NULL DEFAULT 0,
                        confidence_score REAL NOT NULL DEFAULT 0.0,
                        citations_json TEXT NOT NULL DEFAULT '[]',
                        evidence_summary TEXT,
                        fallback_reason TEXT,
                        extraction_method TEXT NOT NULL DEFAULT 'deterministic',
                        model_name TEXT,
                        retrieval_context_json TEXT NOT NULL DEFAULT '[]',
                        verifier_status TEXT NOT NULL DEFAULT 'SKIPPED',
                        uncertainty_reason TEXT,
                        created_at TEXT NOT NULL,
                        FOREIGN KEY(extraction_run_id) REFERENCES extraction_runs(id) ON DELETE CASCADE,
                        FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
                        FOREIGN KEY(document_version_id) REFERENCES document_versions(id) ON DELETE CASCADE,
                        FOREIGN KEY(template_version_id) REFERENCES field_template_versions(id) ON DELETE CASCADE
                    );

                    CREATE INDEX IF NOT EXISTS idx_field_extractions_lookup
                    ON field_extractions(project_id, template_version_id, document_version_id, field_key);

                    CREATE TABLE IF NOT EXISTS review_decisions (
                        id TEXT PRIMARY KEY,
                        project_id TEXT NOT NULL,
                        document_version_id TEXT NOT NULL,
                        template_version_id TEXT NOT NULL,
                        field_key TEXT NOT NULL,
                        status TEXT NOT NULL,
                        manual_value TEXT,
                        reviewer TEXT,
                        notes TEXT,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
                        FOREIGN KEY(document_version_id) REFERENCES document_versions(id) ON DELETE CASCADE,
                        FOREIGN KEY(template_version_id) REFERENCES field_template_versions(id) ON DELETE CASCADE
                    );

                    CREATE UNIQUE INDEX IF NOT EXISTS idx_review_decision_unique
                    ON review_decisions(project_id, document_version_id, template_version_id, field_key);

                    CREATE TABLE IF NOT EXISTS annotations (
                        id TEXT PRIMARY KEY,
                        project_id TEXT NOT NULL,
                        document_version_id TEXT NOT NULL,
                        template_version_id TEXT NOT NULL,
                        field_key TEXT NOT NULL,
                        body TEXT NOT NULL,
                        author TEXT,
                        approved INTEGER NOT NULL DEFAULT 0,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
                        FOREIGN KEY(document_version_id) REFERENCES document_versions(id) ON DELETE CASCADE,
                        FOREIGN KEY(template_version_id) REFERENCES field_template_versions(id) ON DELETE CASCADE
                    );

                    CREATE TABLE IF NOT EXISTS ground_truth_sets (
                        id TEXT PRIMARY KEY,
                        project_id TEXT NOT NULL,
                        name TEXT NOT NULL,
                        format TEXT NOT NULL,
                        created_at TEXT NOT NULL,
                        FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
                    );

                    CREATE TABLE IF NOT EXISTS ground_truth_labels (
                        id TEXT PRIMARY KEY,
                        ground_truth_set_id TEXT NOT NULL,
                        document_version_id TEXT NOT NULL,
                        field_key TEXT NOT NULL,
                        expected_value TEXT,
                        expected_normalized_value TEXT,
                        notes TEXT,
                        FOREIGN KEY(ground_truth_set_id) REFERENCES ground_truth_sets(id) ON DELETE CASCADE,
                        FOREIGN KEY(document_version_id) REFERENCES document_versions(id) ON DELETE CASCADE
                    );

                    CREATE INDEX IF NOT EXISTS idx_ground_truth_lookup
                    ON ground_truth_labels(ground_truth_set_id, document_version_id, field_key);

                    CREATE TABLE IF NOT EXISTS evaluation_runs (
                        id TEXT PRIMARY KEY,
                        project_id TEXT NOT NULL,
                        ground_truth_set_id TEXT NOT NULL,
                        extraction_run_id TEXT NOT NULL,
                        status TEXT NOT NULL,
                        metrics_json TEXT,
                        notes TEXT,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
                        FOREIGN KEY(ground_truth_set_id) REFERENCES ground_truth_sets(id) ON DELETE CASCADE,
                        FOREIGN KEY(extraction_run_id) REFERENCES extraction_runs(id) ON DELETE CASCADE
                    );

                    CREATE TABLE IF NOT EXISTS request_tasks (
                        id TEXT PRIMARY KEY,
                        project_id TEXT,
                        task_type TEXT NOT NULL,
                        status TEXT NOT NULL,
                        entity_id TEXT,
                        progress_current INTEGER NOT NULL DEFAULT 0,
                        progress_total INTEGER NOT NULL DEFAULT 0,
                        error_message TEXT,
                        payload_json TEXT,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
                    );

                    CREATE TABLE IF NOT EXISTS audit_events (
                        id TEXT PRIMARY KEY,
                        project_id TEXT,
                        actor TEXT,
                        action TEXT NOT NULL,
                        entity_type TEXT NOT NULL,
                        entity_id TEXT NOT NULL,
                        payload_json TEXT,
                        created_at TEXT NOT NULL,
                        FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
                    );
                    """
                )
                self._ensure_column(conn, "extraction_runs", "mode", "TEXT NOT NULL DEFAULT 'hybrid'")
                self._ensure_column(conn, "extraction_runs", "quality_profile", "TEXT NOT NULL DEFAULT 'high'")
                self._ensure_column(
                    conn,
                    "field_extractions",
                    "extraction_method",
                    "TEXT NOT NULL DEFAULT 'deterministic'",
                )
                self._ensure_column(conn, "field_extractions", "model_name", "TEXT")
                self._ensure_column(
                    conn,
                    "field_extractions",
                    "retrieval_context_json",
                    "TEXT NOT NULL DEFAULT '[]'",
                )
                self._ensure_column(
                    conn,
                    "field_extractions",
                    "verifier_status",
                    "TEXT NOT NULL DEFAULT 'SKIPPED'",
                )
                self._ensure_column(conn, "field_extractions", "uncertainty_reason", "TEXT")

    @staticmethod
    def _ensure_column(conn: sqlite3.Connection, table_name: str, column_name: str, column_sql: str) -> None:
        table_info = conn.execute(f"PRAGMA table_info({table_name})").fetchall()
        existing_columns = {row["name"] if isinstance(row, sqlite3.Row) else row[1] for row in table_info}
        if column_name in existing_columns:
            return
        conn.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_sql}")

    def execute(
        self,
        query: str,
        params: Optional[Dict[str, Any]] = None,
    ) -> None:
        db_params = {k: _to_db_value(v) for k, v in (params or {}).items()}
        with self.connect() as conn:
            conn.execute(query, db_params)

    def executemany(self, query: str, params_list: Iterable[Dict[str, Any]]) -> None:
        serialized = [{k: _to_db_value(v) for k, v in p.items()} for p in params_list]
        with self.connect() as conn:
            conn.executemany(query, serialized)

    def fetch_one(
        self,
        query: str,
        params: Optional[Dict[str, Any]] = None,
    ) -> Optional[Dict[str, Any]]:
        db_params = {k: _to_db_value(v) for k, v in (params or {}).items()}
        with self.connect() as conn:
            row = conn.execute(query, db_params).fetchone()
        return self._row_to_dict(row) if row else None

    def fetch_all(
        self,
        query: str,
        params: Optional[Dict[str, Any]] = None,
    ) -> List[Dict[str, Any]]:
        db_params = {k: _to_db_value(v) for k, v in (params or {}).items()}
        with self.connect() as conn:
            rows = conn.execute(query, db_params).fetchall()
        return [self._row_to_dict(row) for row in rows]

    @staticmethod
    def _row_to_dict(row: sqlite3.Row) -> Dict[str, Any]:
        payload: Dict[str, Any] = {}
        for key in row.keys():
            value = row[key]
            if key.endswith("_json") and isinstance(value, str):
                try:
                    payload[key] = json.loads(value)
                    continue
                except json.JSONDecodeError:
                    pass
            payload[key] = value
        return payload


DB_PATH = os.getenv(
    "LEGAL_REVIEW_DB",
    os.path.join(os.path.dirname(__file__), "legal_review.db"),
)
db = SQLiteDB(DB_PATH)
