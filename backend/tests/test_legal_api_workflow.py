from __future__ import annotations

import hashlib
import os
from base64 import b64decode
import time
import unittest

from fastapi.testclient import TestClient

from app import app
from legal_service import service


class LegalApiWorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)
        cls.data_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "data"))

    def _wait_for_task(self, task_id: str, timeout_seconds: float = 20.0):
        start = time.time()
        while time.time() - start <= timeout_seconds:
            response = self.client.get(f"/api/tasks/{task_id}")
            self.assertEqual(response.status_code, 200, msg=response.text)
            task = response.json()["task"]
            if task["status"] in {"SUCCEEDED", "FAILED", "CANCELED"}:
                return task
            time.sleep(0.1)
        self.fail(f"Task {task_id} did not finish within {timeout_seconds} seconds")

    def test_full_take_home_workflow(self):
        # Create project
        create_project = self.client.post(
            "/api/projects",
            json={"name": "Take-home Demo", "description": "Workflow validation"},
        )
        self.assertEqual(create_project.status_code, 200, msg=create_project.text)
        project = create_project.json()["project"]
        project_id = project["id"]

        # Create template
        create_template = self.client.post(
            f"/api/projects/{project_id}/templates",
            json={
                "name": "Contract Essentials",
                "fields": [
                    {
                        "key": "effective_date",
                        "name": "Effective Date",
                        "type": "date",
                        "prompt": "Extract the effective date.",
                        "required": True,
                    },
                    {
                        "key": "parties",
                        "name": "Parties",
                        "type": "text",
                        "prompt": "Extract parties and entities.",
                        "required": True,
                    },
                ],
                "validation_policy": {"required_fields": ["effective_date", "parties"]},
                "normalization_policy": {"date_format": "ISO-8601"},
            },
        )
        self.assertEqual(create_template.status_code, 200, msg=create_template.text)
        template_payload = create_template.json()
        template_version_id = template_payload["template_version"]["id"]

        # Upload TXT document
        doc_text = (
            "This agreement is entered into effective as of October 1, 2014 between "
            "Tesla Motors, Inc. and Panasonic Corporation."
        )
        upload = self.client.post(
            f"/api/projects/{project_id}/documents",
            files={"file": ("agreement.txt", doc_text.encode("utf-8"), "text/plain")},
        )
        self.assertEqual(upload.status_code, 200, msg=upload.text)
        parse_task_id = upload.json()["task_id"]
        parse_task = self._wait_for_task(parse_task_id)
        self.assertEqual(parse_task["status"], "SUCCEEDED", msg=parse_task)

        # Ensure table view available and run id present
        table = self.client.get(f"/api/projects/{project_id}/table-view?template_version_id={template_version_id}")
        self.assertEqual(table.status_code, 200, msg=table.text)
        table_payload = table.json()
        self.assertTrue(table_payload["rows"], "Expected at least one row in table view")
        self.assertTrue(table_payload["columns"], "Expected columns from template")
        self.assertTrue(table_payload["extraction_run_id"], "Expected extraction run id")

        first_row = table_payload["rows"][0]
        first_field_key = table_payload["columns"][0]["key"]
        first_cell = first_row["cells"][first_field_key]
        self.assertIn("ai_result", first_cell)
        self.assertIn("effective_value", first_cell)
        self.assertIn("extraction_method", first_cell["ai_result"])

        diagnostics = self.client.get(
            f"/api/projects/{project_id}/extraction-runs/{table_payload['extraction_run_id']}/diagnostics"
        )
        self.assertEqual(diagnostics.status_code, 200, msg=diagnostics.text)
        diagnostics_payload = diagnostics.json()
        self.assertIn("summary", diagnostics_payload)
        self.assertIn("cells", diagnostics_payload)
        self.assertGreaterEqual(diagnostics_payload["summary"].get("total_cells", 0), 1)

        # Review decision overlay
        review = self.client.post(
            f"/api/projects/{project_id}/review-decisions",
            json={
                "document_version_id": first_row["document_version_id"],
                "template_version_id": table_payload["template_version_id"],
                "field_key": first_field_key,
                "status": "MANUAL_UPDATED",
                "manual_value": "2014-10-01",
                "reviewer": "qa@test.local",
                "notes": "Manual correction",
            },
        )
        self.assertEqual(review.status_code, 200, msg=review.text)
        decision = review.json()["review_decision"]
        self.assertEqual(decision["status"], "MANUAL_UPDATED")

        # Annotation
        annotation = self.client.post(
            f"/api/projects/{project_id}/annotations",
            json={
                "document_version_id": first_row["document_version_id"],
                "template_version_id": table_payload["template_version_id"],
                "field_key": first_field_key,
                "body": "Check this against schedule exhibit.",
                "author": "qa@test.local",
                "approved": False,
            },
        )
        self.assertEqual(annotation.status_code, 200, msg=annotation.text)

        annotations = self.client.get(f"/api/projects/{project_id}/annotations")
        self.assertEqual(annotations.status_code, 200, msg=annotations.text)
        self.assertTrue(annotations.json()["annotations"])

        # Ground truth + evaluation
        ground_truth = self.client.post(
            f"/api/projects/{project_id}/ground-truth-sets",
            json={
                "name": "Demo GT",
                "format": "json",
                "labels": [
                    {
                        "document_version_id": first_row["document_version_id"],
                        "field_key": first_field_key,
                        "expected_value": "2014-10-01",
                    }
                ],
            },
        )
        self.assertEqual(ground_truth.status_code, 200, msg=ground_truth.text)
        gt_set_id = ground_truth.json()["ground_truth_set"]["id"]

        eval_create = self.client.post(
            f"/api/projects/{project_id}/evaluation-runs",
            json={
                "ground_truth_set_id": gt_set_id,
                "extraction_run_id": table_payload["extraction_run_id"],
            },
        )
        self.assertEqual(eval_create.status_code, 200, msg=eval_create.text)
        eval_task_id = eval_create.json()["task_id"]
        eval_task = self._wait_for_task(eval_task_id)
        self.assertEqual(eval_task["status"], "SUCCEEDED", msg=eval_task)

        eval_run_id = eval_create.json()["evaluation_run_id"]
        eval_get = self.client.get(f"/api/projects/{project_id}/evaluation-runs/{eval_run_id}")
        self.assertEqual(eval_get.status_code, 200, msg=eval_get.text)
        metrics = eval_get.json()["evaluation_run"]["metrics_json"]
        self.assertIn("field_level_accuracy", metrics)
        self.assertIn("coverage", metrics)
        self.assertIn("normalization_validity", metrics)

    def test_cancel_and_delete_pending_tasks(self):
        create_project = self.client.post(
            "/api/projects",
            json={"name": "Task Cancel Demo", "description": "Task cancellation validation"},
        )
        self.assertEqual(create_project.status_code, 200, msg=create_project.text)
        project_id = create_project.json()["project"]["id"]

        task_a = service.create_task(
            task_type="PARSE_DOCUMENT",
            project_id=project_id,
            entity_id="doc_stub_a",
            payload={"name": "stub-a"},
        )
        task_b = service.create_task(
            task_type="EXTRACTION_RUN",
            project_id=project_id,
            entity_id="run_stub_b",
            payload={"name": "stub-b"},
        )

        bulk_cancel = self.client.post(f"/api/projects/{project_id}/tasks/cancel-pending?purge=true")
        self.assertEqual(bulk_cancel.status_code, 200, msg=bulk_cancel.text)
        bulk_payload = bulk_cancel.json()
        self.assertEqual(bulk_payload.get("canceled_count"), 2)
        self.assertIn(task_a["id"], bulk_payload.get("canceled_task_ids", []))
        self.assertIn(task_b["id"], bulk_payload.get("canceled_task_ids", []))
        self.assertEqual(bulk_payload.get("deleted_count"), 2)

        task_a_get = self.client.get(f"/api/tasks/{task_a['id']}")
        self.assertEqual(task_a_get.status_code, 404, msg=task_a_get.text)

        task_c = service.create_task(
            task_type="PARSE_DOCUMENT",
            project_id=project_id,
            entity_id="doc_stub_c",
            payload={"name": "stub-c"},
        )
        single_cancel = self.client.post(f"/api/tasks/{task_c['id']}/cancel")
        self.assertEqual(single_cancel.status_code, 200, msg=single_cancel.text)
        self.assertEqual(single_cancel.json()["task"]["status"], "CANCELED")

        single_delete = self.client.delete(f"/api/tasks/{task_c['id']}")
        self.assertEqual(single_delete.status_code, 200, msg=single_delete.text)
        self.assertTrue(single_delete.json().get("deleted"))

    def test_delete_project(self):
        create_project = self.client.post(
            "/api/projects",
            json={"name": "Delete Me", "description": "Project delete validation"},
        )
        self.assertEqual(create_project.status_code, 200, msg=create_project.text)
        project_id = create_project.json()["project"]["id"]

        delete_response = self.client.delete(f"/api/projects/{project_id}")
        self.assertEqual(delete_response.status_code, 200, msg=delete_response.text)
        self.assertTrue(delete_response.json().get("deleted"))

        get_response = self.client.get(f"/api/projects/{project_id}")
        self.assertEqual(get_response.status_code, 404, msg=get_response.text)

        create_project_2 = self.client.post(
            "/api/projects",
            json={"name": "Delete Me Compat", "description": "Project delete compatibility validation"},
        )
        self.assertEqual(create_project_2.status_code, 200, msg=create_project_2.text)
        project_id_2 = create_project_2.json()["project"]["id"]

        delete_response_compat = self.client.post(f"/api/projects/{project_id_2}/delete")
        self.assertEqual(delete_response_compat.status_code, 200, msg=delete_response_compat.text)
        self.assertTrue(delete_response_compat.json().get("deleted"))

    def test_pdf_source_endpoint_returns_uploaded_pdf_bytes(self):
        create_project = self.client.post(
            "/api/projects",
            json={"name": "PDF Source Demo", "description": "Source endpoint validation"},
        )
        self.assertEqual(create_project.status_code, 200, msg=create_project.text)
        project_id = create_project.json()["project"]["id"]

        pdf_filename = "tsla-ex103_198.htm.pdf"
        pdf_path = os.path.join(self.data_dir, pdf_filename)
        with open(pdf_path, "rb") as f:
            original_bytes = f.read()
            upload = self.client.post(
                f"/api/projects/{project_id}/documents",
                files={"file": (pdf_filename, original_bytes, "application/pdf")},
            )
        self.assertEqual(upload.status_code, 200, msg=upload.text)
        parse_task = self._wait_for_task(upload.json()["task_id"], timeout_seconds=120.0)
        self.assertEqual(parse_task["status"], "SUCCEEDED", msg=parse_task)

        project_view = self.client.get(f"/api/projects/{project_id}")
        self.assertEqual(project_view.status_code, 200, msg=project_view.text)
        documents = project_view.json().get("documents") or []
        latest = next((doc.get("latest_version") for doc in documents if doc.get("filename") == pdf_filename), None)
        self.assertTrue(latest, "Expected latest version for uploaded PDF document")
        self.assertTrue(latest.get("source_available"), "Expected source_available=true for uploaded PDF")

        document_version_id = latest["id"]
        source_response = self.client.get(f"/api/document-versions/{document_version_id}/source")
        self.assertEqual(source_response.status_code, 200, msg=source_response.text)
        source_payload = source_response.json()
        self.assertEqual(source_payload.get("document_version_id"), document_version_id)
        self.assertEqual(source_payload.get("mime_type"), "application/pdf")
        self.assertEqual(source_payload.get("filename"), pdf_filename)

        returned_bytes = b64decode(source_payload.get("content_base64") or "")
        self.assertEqual(
            hashlib.sha256(returned_bytes).hexdigest(),
            hashlib.sha256(original_bytes).hexdigest(),
            "Stored source bytes should match uploaded PDF bytes",
        )

    def test_template_create_and_version_auto_trigger_and_csv_export(self):
        create_project = self.client.post(
            "/api/projects",
            json={"name": "Template Trigger Demo", "description": "Template trigger and export validation"},
        )
        self.assertEqual(create_project.status_code, 200, msg=create_project.text)
        project_id = create_project.json()["project"]["id"]

        upload = self.client.post(
            f"/api/projects/{project_id}/documents",
            files={"file": ("contract.txt", b"Effective date is January 1, 2025.", "text/plain")},
        )
        self.assertEqual(upload.status_code, 200, msg=upload.text)
        parse_task = self._wait_for_task(upload.json()["task_id"])
        self.assertEqual(parse_task["status"], "SUCCEEDED", msg=parse_task)

        create_template = self.client.post(
            f"/api/projects/{project_id}/templates",
            json={
                "name": "Trigger Template",
                "fields": [
                    {
                        "key": "effective_date",
                        "name": "Effective Date",
                        "type": "date",
                        "prompt": "Extract effective date.",
                        "required": True,
                    }
                ],
            },
        )
        self.assertEqual(create_template.status_code, 200, msg=create_template.text)
        create_payload = create_template.json()
        self.assertIn("triggered_extraction_task_id", create_payload)
        create_trigger_task = self._wait_for_task(create_payload["triggered_extraction_task_id"])
        self.assertIn(create_trigger_task["status"], {"SUCCEEDED", "FAILED", "CANCELED"})

        template_id = create_payload["template"]["id"]
        create_version = self.client.post(
            f"/api/templates/{template_id}/versions",
            json={
                "fields": [
                    {
                        "key": "effective_date",
                        "name": "Effective Date",
                        "type": "date",
                        "prompt": "Extract effective date.",
                        "required": True,
                    },
                    {
                        "key": "parties",
                        "name": "Parties",
                        "type": "text",
                        "prompt": "Extract parties.",
                        "required": False,
                    },
                ],
            },
        )
        self.assertEqual(create_version.status_code, 200, msg=create_version.text)
        version_payload = create_version.json()
        self.assertIn("triggered_extraction_task_id", version_payload)
        version_trigger_task = self._wait_for_task(version_payload["triggered_extraction_task_id"])
        self.assertIn(version_trigger_task["status"], {"SUCCEEDED", "FAILED", "CANCELED"})

        template_version_id = version_payload["template_version"]["id"]
        table = self.client.get(f"/api/projects/{project_id}/table-view?template_version_id={template_version_id}")
        self.assertEqual(table.status_code, 200, msg=table.text)
        table_payload = table.json()
        self.assertTrue(table_payload.get("extraction_run_id"))

        export = self.client.get(
            f"/api/projects/{project_id}/table-export.csv?template_version_id={template_version_id}&value_mode=effective"
        )
        self.assertEqual(export.status_code, 200, msg=export.text)
        self.assertIn("text/csv", export.headers.get("content-type", ""))
        content = export.text
        self.assertIn("document_id,document_version_id,filename,field_key", content)
        self.assertIn("effective_value", content)

    def test_annotation_lifecycle_and_cross_project_validation(self):
        create_a = self.client.post("/api/projects", json={"name": "Project A", "description": "A"})
        create_b = self.client.post("/api/projects", json={"name": "Project B", "description": "B"})
        self.assertEqual(create_a.status_code, 200, msg=create_a.text)
        self.assertEqual(create_b.status_code, 200, msg=create_b.text)
        project_a = create_a.json()["project"]["id"]
        project_b = create_b.json()["project"]["id"]

        template_a = self.client.post(
            f"/api/projects/{project_a}/templates",
            json={
                "name": "Template A",
                "fields": [{"key": "effective_date", "name": "Effective Date", "type": "date", "prompt": "Date"}],
            },
        )
        template_b = self.client.post(
            f"/api/projects/{project_b}/templates",
            json={
                "name": "Template B",
                "fields": [{"key": "effective_date", "name": "Effective Date", "type": "date", "prompt": "Date"}],
            },
        )
        self.assertEqual(template_a.status_code, 200, msg=template_a.text)
        self.assertEqual(template_b.status_code, 200, msg=template_b.text)
        template_version_a = template_a.json()["template_version"]["id"]
        template_version_b = template_b.json()["template_version"]["id"]

        upload_a = self.client.post(
            f"/api/projects/{project_a}/documents",
            files={"file": ("a.txt", b"Effective date January 2, 2025.", "text/plain")},
        )
        upload_b = self.client.post(
            f"/api/projects/{project_b}/documents",
            files={"file": ("b.txt", b"Effective date January 3, 2025.", "text/plain")},
        )
        self.assertEqual(upload_a.status_code, 200, msg=upload_a.text)
        self.assertEqual(upload_b.status_code, 200, msg=upload_b.text)
        self.assertEqual(self._wait_for_task(upload_a.json()["task_id"])["status"], "SUCCEEDED")
        self.assertEqual(self._wait_for_task(upload_b.json()["task_id"])["status"], "SUCCEEDED")

        table_a = self.client.get(f"/api/projects/{project_a}/table-view?template_version_id={template_version_a}")
        self.assertEqual(table_a.status_code, 200, msg=table_a.text)
        row_a = table_a.json()["rows"][0]
        field_key = table_a.json()["columns"][0]["key"]
        extraction_run_a = table_a.json()["extraction_run_id"]

        table_b = self.client.get(f"/api/projects/{project_b}/table-view?template_version_id={template_version_b}")
        self.assertEqual(table_b.status_code, 200, msg=table_b.text)
        row_b = table_b.json()["rows"][0]

        create_annotation = self.client.post(
            f"/api/projects/{project_a}/annotations",
            json={
                "document_version_id": row_a["document_version_id"],
                "template_version_id": template_version_a,
                "field_key": field_key,
                "body": "Needs legal sign-off",
                "author": "qa@test.local",
                "approved": False,
                "resolved": False,
            },
        )
        self.assertEqual(create_annotation.status_code, 200, msg=create_annotation.text)
        annotation = create_annotation.json()["annotation"]
        annotation_id = annotation["id"]

        update_annotation = self.client.patch(
            f"/api/projects/{project_a}/annotations/{annotation_id}",
            json={"body": "Reviewed and approved", "approved": True, "resolved": True},
        )
        self.assertEqual(update_annotation.status_code, 200, msg=update_annotation.text)
        updated = update_annotation.json()["annotation"]
        self.assertEqual(updated["body"], "Reviewed and approved")
        self.assertEqual(updated["approved"], 1)
        self.assertEqual(updated["resolved"], 1)

        delete_annotation = self.client.delete(f"/api/projects/{project_a}/annotations/{annotation_id}")
        self.assertEqual(delete_annotation.status_code, 200, msg=delete_annotation.text)
        self.assertTrue(delete_annotation.json()["deleted"])

        bad_review = self.client.post(
            f"/api/projects/{project_a}/review-decisions",
            json={
                "document_version_id": row_b["document_version_id"],
                "template_version_id": template_version_a,
                "field_key": field_key,
                "status": "CONFIRMED",
            },
        )
        self.assertEqual(bad_review.status_code, 400, msg=bad_review.text)

        gt_b = self.client.post(
            f"/api/projects/{project_b}/ground-truth-sets",
            json={
                "name": "GT B",
                "labels": [
                    {
                        "document_version_id": row_b["document_version_id"],
                        "field_key": field_key,
                        "expected_value": "2025-01-03",
                    }
                ],
            },
        )
        self.assertEqual(gt_b.status_code, 200, msg=gt_b.text)
        gt_b_id = gt_b.json()["ground_truth_set"]["id"]

        bad_eval = self.client.post(
            f"/api/projects/{project_a}/evaluation-runs",
            json={"ground_truth_set_id": gt_b_id, "extraction_run_id": extraction_run_a},
        )
        self.assertEqual(bad_eval.status_code, 400, msg=bad_eval.text)


if __name__ == "__main__":
    unittest.main()
