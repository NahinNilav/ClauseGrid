from __future__ import annotations

import time
import unittest

from fastapi.testclient import TestClient

from app import app


class LegalApiWorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def _wait_for_task(self, task_id: str, timeout_seconds: float = 20.0):
        start = time.time()
        while time.time() - start <= timeout_seconds:
            response = self.client.get(f"/api/tasks/{task_id}")
            self.assertEqual(response.status_code, 200, msg=response.text)
            task = response.json()["task"]
            if task["status"] in {"SUCCEEDED", "FAILED"}:
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


if __name__ == "__main__":
    unittest.main()
