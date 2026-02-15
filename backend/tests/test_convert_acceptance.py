from __future__ import annotations

import os
import unittest

from fastapi.testclient import TestClient

from app import app


class ConvertAcceptanceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)
        cls.data_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "data"))

    def _convert_file(self, filename: str, content_type: str):
        path = os.path.join(self.data_dir, filename)
        with open(path, "rb") as f:
            response = self.client.post(
                "/convert",
                files={"file": (filename, f, content_type)},
            )
        self.assertEqual(response.status_code, 200, msg=response.text)
        return response.json()

    def test_html_exhibit_conversion_returns_chunks_and_dom_citations(self):
        payload = self._convert_file("EX-10.2.html", "text/html")

        self.assertIn("markdown", payload)
        self.assertTrue(payload["markdown"].strip())

        artifact = payload.get("artifact") or {}
        self.assertEqual(artifact.get("format"), "html")
        self.assertTrue((artifact.get("chunks") or []), "Expected non-empty chunks for HTML")
        self.assertTrue((artifact.get("preview_html") or "").strip(), "Expected non-empty HTML preview payload")

        citations = []
        for block in artifact.get("blocks", []):
            citations.extend(block.get("citations", []))

        self.assertTrue(any(c.get("selector") for c in citations), "Expected selector-based HTML citations")

    def test_pdf_exhibit_conversion_returns_chunks_and_page_citations(self):
        payload = self._convert_file("tsla-ex103_462.htm.pdf", "application/pdf")

        self.assertIn("markdown", payload)
        self.assertTrue(payload["markdown"].strip())

        artifact = payload.get("artifact") or {}
        self.assertEqual(artifact.get("format"), "pdf")
        self.assertTrue((artifact.get("chunks") or []), "Expected non-empty chunks for PDF")
        page_index = (((artifact.get("metadata") or {}).get("page_index")) or {})
        self.assertTrue(page_index, "Expected page_index metadata for PDF")
        self.assertIn("1", page_index)
        self.assertIn("width", page_index["1"])
        self.assertIn("height", page_index["1"])

        citations = []
        for block in artifact.get("blocks", []):
            citations.extend(block.get("citations", []))

        self.assertTrue(any(c.get("page") for c in citations), "Expected page-based PDF citations")

    def test_pdf_page_render_endpoint_returns_image_and_dimensions(self):
        path = os.path.join(self.data_dir, "tsla-ex103_462.htm.pdf")
        with open(path, "rb") as f:
            response = self.client.post(
                "/render-pdf-page",
                files={"file": ("tsla-ex103_462.htm.pdf", f, "application/pdf")},
                data={"page": "1", "scale": "1.4", "snippet": "Exhibit 10.3"},
            )

        self.assertEqual(response.status_code, 200, msg=response.text)
        payload = response.json()
        self.assertEqual(payload.get("page"), 1)
        self.assertGreater(payload.get("page_count", 0), 0)
        self.assertGreater(payload.get("page_width", 0), 0)
        self.assertGreater(payload.get("page_height", 0), 0)
        self.assertGreater(payload.get("image_width", 0), 0)
        self.assertGreater(payload.get("image_height", 0), 0)
        self.assertTrue((payload.get("image_base64") or "").strip())
        self.assertIn(payload.get("match_mode"), {"exact", "fuzzy", "char_range", "none"})
        self.assertIsInstance(payload.get("match_confidence"), (int, float))
        self.assertIn(payload.get("bbox_source"), {"matched_snippet", "citation_bbox", "none"})

    def test_pdf_page_render_low_overlap_returns_no_anchor_bbox(self):
        path = os.path.join(self.data_dir, "tsla-ex103_462.htm.pdf")
        with open(path, "rb") as f:
            response = self.client.post(
                "/render-pdf-page",
                files={"file": ("tsla-ex103_462.htm.pdf", f, "application/pdf")},
                data={
                    "page": "1",
                    "scale": "1.4",
                    "snippet": "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
                    "snippet_candidates_json": "[\"zzzzzzzzzzzzzzzzzzzzzzzzzzzzzz\"]",
                },
            )

        self.assertEqual(response.status_code, 200, msg=response.text)
        payload = response.json()
        self.assertIsNone(payload.get("matched_bbox"))
        self.assertEqual(payload.get("match_mode"), "none")
        self.assertLess(float(payload.get("match_confidence") or 0.0), 0.55)

    def test_pdf_page_render_uses_snippet_candidates(self):
        path = os.path.join(self.data_dir, "tsla-ex103_462.htm.pdf")
        with open(path, "rb") as f:
            response = self.client.post(
                "/render-pdf-page",
                files={"file": ("tsla-ex103_462.htm.pdf", f, "application/pdf")},
                data={
                    "page": "1",
                    "scale": "1.4",
                    "snippet": "",
                    "snippet_candidates_json": "[\"Exhibit 10.3\"]",
                },
            )

        self.assertEqual(response.status_code, 200, msg=response.text)
        payload = response.json()
        self.assertIn(payload.get("match_mode"), {"exact", "fuzzy"})
        self.assertIsNotNone(payload.get("used_snippet"))


if __name__ == "__main__":
    unittest.main()
