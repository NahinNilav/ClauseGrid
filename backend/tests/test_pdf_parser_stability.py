from __future__ import annotations

import threading
import time
import unittest
import uuid
from contextlib import contextmanager
from typing import Any, Dict
from unittest.mock import patch

from legal_api import _run_parse_task
from legal_service import service
from parsers import pdf_docling
from parsers.pdf_runtime import reset_pdf_docling_runtime_state_for_tests


class _FakeTextPage:
    def get_text_range(self, start: int | None = None, count: int | None = None) -> str:
        if start is None or count is None:
            return "Sample paragraph for fake pdfium page."
        return "Sample paragraph for fake pdfium page."[start : start + count]

    def get_charbox(self, _idx: int):
        return (10.0, 20.0, 40.0, 30.0)

    def close(self) -> None:
        return None


class _FakePage:
    def get_size(self):
        return (612.0, 792.0)

    def get_textpage(self):
        return _FakeTextPage()

    def close(self) -> None:
        return None


class _FakePdfDocument:
    def __init__(self, _path: str):
        self._pages = [_FakePage()]

    def __len__(self):
        return len(self._pages)

    def __getitem__(self, idx: int):
        return self._pages[idx]

    def close(self) -> None:
        return None


class PdfParserStabilityTests(unittest.TestCase):
    def setUp(self) -> None:
        reset_pdf_docling_runtime_state_for_tests("auto")

    def tearDown(self) -> None:
        reset_pdf_docling_runtime_state_for_tests("auto")

    def test_docling_fatal_error_auto_disables_worker(self):
        def fallback(_path: str) -> Dict[str, Any]:
            return {
                "markdown": "",
                "docling_json": {"schema_name": "pdfium_fallback", "pages": 1},
                "blocks": [],
                "parser": "pypdfium2",
            }

        with patch(
            "parsers.pdf_docling._page_index_from_pdfium",
            return_value={"1": {"width": 612.0, "height": 792.0}},
        ), patch(
            "parsers.pdf_docling._blocks_from_pdfium",
            side_effect=fallback,
        ) as fallback_mock, patch(
            "parsers.pdf_docling._run_docling_pdf_worker",
            return_value=(None, "NSRangeException in libmlx Metal pipeline"),
        ) as worker_mock:
            first = pdf_docling.parse_pdf(pdf_path="dummy.pdf")
            second = pdf_docling.parse_pdf(pdf_path="dummy.pdf")

        self.assertEqual(worker_mock.call_count, 1)
        self.assertEqual(fallback_mock.call_count, 2)
        self.assertEqual(first.get("parser"), "pypdfium2")
        self.assertEqual(first.get("pdf_docling_mode_effective"), "auto_disabled")
        self.assertIn("auto_disabled_after_fatal_worker_error", str(first.get("pdf_docling_disable_reason") or ""))
        self.assertEqual(second.get("pdf_docling_mode_effective"), "auto_disabled")

    def test_parse_task_serializes_parse_execution(self):
        project = service.create_project(
            name=f"Parse Semaphore {uuid.uuid4().hex[:8]}",
            description="stability test",
        )
        project_id = project["id"]
        document_a = service.create_document(
            project_id=project_id,
            filename="a.txt",
            source_mime_type="text/plain",
            sha256=uuid.uuid4().hex,
        )
        document_b = service.create_document(
            project_id=project_id,
            filename="b.txt",
            source_mime_type="text/plain",
            sha256=uuid.uuid4().hex,
        )
        task_a = service.create_task(
            task_type="PARSE_DOCUMENT",
            project_id=project_id,
            entity_id=document_a["id"],
            payload={"document_id": document_a["id"]},
        )
        task_b = service.create_task(
            task_type="PARSE_DOCUMENT",
            project_id=project_id,
            entity_id=document_b["id"],
            payload={"document_id": document_b["id"]},
        )

        counters = {"active": 0, "max_active": 0}
        counter_lock = threading.Lock()

        def fake_parse_document_to_artifact(**_kwargs):
            with counter_lock:
                counters["active"] += 1
                counters["max_active"] = max(counters["max_active"], counters["active"])
            time.sleep(0.15)
            with counter_lock:
                counters["active"] -= 1
            return (
                {"metadata": {}, "blocks": [], "chunks": [], "citation_index": [], "markdown": ""},
                {
                    "format": "text",
                    "mime_type": "text/plain",
                    "ext": ".txt",
                    "sha256": uuid.uuid4().hex,
                },
            )

        with patch(
            "parsers.pdf_runtime._PARSE_SEMAPHORE",
            threading.BoundedSemaphore(1),
        ), patch(
            "legal_api._parse_document_to_artifact",
            side_effect=fake_parse_document_to_artifact,
        ), patch(
            "legal_api.service.active_template_for_project",
            return_value=None,
        ):
            thread_a = threading.Thread(
                target=_run_parse_task,
                kwargs={
                    "task_id": task_a["id"],
                    "project_id": project_id,
                    "document_id": document_a["id"],
                    "filename": "a.txt",
                    "declared_mime_type": "text/plain",
                    "raw_bytes": b"a",
                },
            )
            thread_b = threading.Thread(
                target=_run_parse_task,
                kwargs={
                    "task_id": task_b["id"],
                    "project_id": project_id,
                    "document_id": document_b["id"],
                    "filename": "b.txt",
                    "declared_mime_type": "text/plain",
                    "raw_bytes": b"b",
                },
            )
            thread_a.start()
            thread_b.start()
            thread_a.join()
            thread_b.join()

        self.assertEqual(counters["max_active"], 1)
        self.assertEqual(service.get_task(task_a["id"])["status"], "SUCCEEDED")
        self.assertEqual(service.get_task(task_b["id"])["status"], "SUCCEEDED")

    def test_pdfium_helpers_use_runtime_lock(self):
        lock_entries = {"count": 0}

        @contextmanager
        def fake_lock():
            lock_entries["count"] += 1
            yield

        with patch("parsers.pdf_docling.acquire_pdfium_lock", fake_lock), patch(
            "parsers.pdf_docling.pdfium.PdfDocument",
            _FakePdfDocument,
        ):
            page_index = pdf_docling._page_index_from_pdfium("fake.pdf")
            fallback = pdf_docling._blocks_from_pdfium("fake.pdf")

        self.assertEqual(lock_entries["count"], 2)
        self.assertIn("1", page_index)
        self.assertEqual(fallback.get("parser"), "pypdfium2")
        self.assertTrue(isinstance(fallback.get("blocks"), list))


if __name__ == "__main__":
    unittest.main()
