from __future__ import annotations

import hashlib
import sys
import unittest
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from legal_service import service
from legal_db import utc_now_iso


class TableDiffLogicTests(unittest.TestCase):
    def test_diff_marks_baseline_empty_vs_non_empty(self):
        project = service.create_project(name="Diff Logic Project", description="baseline empty comparison")
        project_id = project["id"]

        template, template_version = service.create_template_with_version(
            project_id=project_id,
            name="Diff Template",
            fields=[
                {
                    "key": "key_term",
                    "name": "Key Term",
                    "type": "text",
                    "prompt": "Extract key term.",
                }
            ],
            validation_policy={},
            normalization_policy={},
        )
        template_version_id = template_version["id"]

        doc1 = service.create_document(
            project_id=project_id,
            filename="baseline.txt",
            source_mime_type="text/plain",
            sha256=hashlib.sha256(b"baseline").hexdigest(),
        )
        doc2 = service.create_document(
            project_id=project_id,
            filename="candidate.txt",
            source_mime_type="text/plain",
            sha256=hashlib.sha256(b"candidate").hexdigest(),
        )

        artifact = {
            "format": "txt",
            "markdown": "",
            "blocks": [],
            "chunks": [],
            "citation_index": {},
        }
        dv1 = service.create_document_version(
            document_id=doc1["id"],
            parse_status="COMPLETED",
            artifact=artifact,
        )
        dv2 = service.create_document_version(
            document_id=doc2["id"],
            parse_status="COMPLETED",
            artifact=artifact,
        )

        run = service.create_extraction_run(
            project_id=project_id,
            template_version_id=template_version_id,
            trigger_reason="MANUAL_TRIGGER",
            mode="deterministic",
            quality_profile="fast",
        )
        run_id = run["id"]

        service.db.execute(
            """
            INSERT INTO field_extractions(
                id, extraction_run_id, project_id, document_version_id, template_version_id,
                field_key, field_name, field_type, raw_text, value, normalized_value,
                normalization_valid, confidence_score, citations_json, evidence_summary,
                fallback_reason, extraction_method, model_name, retrieval_context_json,
                verifier_status, uncertainty_reason, created_at
            )
            VALUES(
                :id, :extraction_run_id, :project_id, :document_version_id, :template_version_id,
                :field_key, :field_name, :field_type, :raw_text, :value, :normalized_value,
                :normalization_valid, :confidence_score, :citations_json, :evidence_summary,
                :fallback_reason, :extraction_method, :model_name, :retrieval_context_json,
                :verifier_status, :uncertainty_reason, :created_at
            )
            """,
            {
                "id": "ext_baseline_empty",
                "extraction_run_id": run_id,
                "project_id": project_id,
                "document_version_id": dv1["id"],
                "template_version_id": template_version_id,
                "field_key": "key_term",
                "field_name": "Key Term",
                "field_type": "text",
                "raw_text": "",
                "value": "",
                "normalized_value": "",
                "normalization_valid": 0,
                "confidence_score": 0.8,
                "citations_json": [],
                "evidence_summary": "",
                "fallback_reason": None,
                "extraction_method": "deterministic",
                "model_name": None,
                "retrieval_context_json": [],
                "verifier_status": "SKIPPED",
                "uncertainty_reason": None,
                "created_at": utc_now_iso(),
            },
        )

        service.db.execute(
            """
            INSERT INTO field_extractions(
                id, extraction_run_id, project_id, document_version_id, template_version_id,
                field_key, field_name, field_type, raw_text, value, normalized_value,
                normalization_valid, confidence_score, citations_json, evidence_summary,
                fallback_reason, extraction_method, model_name, retrieval_context_json,
                verifier_status, uncertainty_reason, created_at
            )
            VALUES(
                :id, :extraction_run_id, :project_id, :document_version_id, :template_version_id,
                :field_key, :field_name, :field_type, :raw_text, :value, :normalized_value,
                :normalization_valid, :confidence_score, :citations_json, :evidence_summary,
                :fallback_reason, :extraction_method, :model_name, :retrieval_context_json,
                :verifier_status, :uncertainty_reason, :created_at
            )
            """,
            {
                "id": "ext_candidate_value",
                "extraction_run_id": run_id,
                "project_id": project_id,
                "document_version_id": dv2["id"],
                "template_version_id": template_version_id,
                "field_key": "key_term",
                "field_name": "Key Term",
                "field_type": "text",
                "raw_text": "Alpha clause",
                "value": "Alpha clause",
                "normalized_value": "alpha clause",
                "normalization_valid": 1,
                "confidence_score": 0.9,
                "citations_json": [],
                "evidence_summary": "",
                "fallback_reason": None,
                "extraction_method": "deterministic",
                "model_name": None,
                "retrieval_context_json": [],
                "verifier_status": "SKIPPED",
                "uncertainty_reason": None,
                "created_at": utc_now_iso(),
            },
        )

        service.db.execute(
            """
            UPDATE extraction_runs
            SET status='COMPLETED', total_cells=2, completed_cells=2, failed_cells=0, updated_at=:updated_at
            WHERE id=:run_id
            """,
            {"run_id": run_id, "updated_at": utc_now_iso()},
        )

        view = service.table_view(
            project_id=project_id,
            template_version_id=template_version_id,
            baseline_document_id=doc1["id"],
        )
        rows = {row["document_id"]: row for row in view["rows"]}
        baseline_cell = rows[doc1["id"]]["cells"]["key_term"]
        candidate_cell = rows[doc2["id"]]["cells"]["key_term"]

        self.assertFalse(baseline_cell["is_diff"])
        self.assertTrue(candidate_cell["is_diff"])
        self.assertEqual(candidate_cell["baseline_value"], "")
        self.assertEqual(candidate_cell["current_value"], "Alpha clause")
        self.assertEqual(candidate_cell["compare_mode"], "normalized_value")


if __name__ == "__main__":
    unittest.main()
