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

        citations = []
        for block in artifact.get("blocks", []):
            citations.extend(block.get("citations", []))

        self.assertTrue(any(c.get("page") for c in citations), "Expected page-based PDF citations")


if __name__ == "__main__":
    unittest.main()
