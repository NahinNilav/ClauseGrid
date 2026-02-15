from __future__ import annotations

import sys
import unittest
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from legal_service import _citations_with_doc_version
from parsers.docling_blocks import _extract_bbox


class BboxNormalizationTests(unittest.TestCase):
    def test_docling_bbox_normalizes_descending_y(self):
        raw = [24.0, 824.7, 76.6, 821.1]
        normalized = _extract_bbox(raw)
        self.assertEqual(normalized, [24.0, 821.1, 76.6, 824.7])

    def test_service_citation_hydration_normalizes_bbox(self):
        citations = [
            {
                "source": "pdf",
                "snippet": "sample",
                "page": 1,
                "bbox": [24.0, 824.7, 76.6, 821.1],
            }
        ]
        hydrated = _citations_with_doc_version(citations, "dv_demo")
        self.assertEqual(hydrated[0]["bbox"], [24.0, 821.1, 76.6, 824.7])
        self.assertEqual(hydrated[0]["doc_version_id"], "dv_demo")


if __name__ == "__main__":
    unittest.main()
