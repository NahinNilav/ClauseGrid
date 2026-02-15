from __future__ import annotations

import sys
import unittest
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from legal_service import LegalReviewService


class CitationPrioritizationTests(unittest.TestCase):
    def test_segment_citations_put_primary_evidence_first(self):
        boilerplate_citation = {
            "source": "pdf",
            "snippet": "Standard notice and waiver language.",
            "page": 12,
            "doc_version_id": "dv_demo",
        }
        parties_citation = {
            "source": "pdf",
            "snippet": "The parties are Tesla, Inc. and Panasonic Corporation as Seller.",
            "page": 1,
            "doc_version_id": "dv_demo",
        }

        selected_candidate = {
            "block_id": "segment_0_2",
            "segment_block_ids": ["block_0", "block_1", "block_2"],
            "source_block_ids": ["block_1"],
            "citations": [boilerplate_citation, parties_citation],
        }
        retrieval_block_by_id = {
            "block_0": {
                "text": "Standard notice and waiver language.",
                "citations": [boilerplate_citation],
            },
            "block_1": {
                "text": "The parties are Tesla, Inc. and Panasonic Corporation as Seller.",
                "citations": [parties_citation],
            },
            "block_2": {
                "text": "Miscellaneous and governing law.",
                "citations": [],
            },
        }

        ordered_citations, evidence_block_id, evidence_score = LegalReviewService._prioritize_candidate_citations(
            selected_candidate=selected_candidate,
            retrieval_block_by_id=retrieval_block_by_id,
            value='Tesla; Panasonic (as "Seller")',
            raw_text="The parties are Tesla, Inc. and Panasonic Corporation as Seller.",
        )

        self.assertEqual(evidence_block_id, "block_1")
        self.assertGreater(evidence_score, 0.0)
        self.assertEqual(ordered_citations[0]["page"], 1)
        self.assertIn("Tesla", ordered_citations[0]["snippet"])

    def test_non_segment_keeps_existing_citation_order(self):
        first = {"source": "pdf", "snippet": "First citation", "page": 8}
        second = {"source": "pdf", "snippet": "Second citation", "page": 9}
        selected_candidate = {
            "block_id": "block_10",
            "citations": [first, second],
        }

        ordered_citations, evidence_block_id, evidence_score = LegalReviewService._prioritize_candidate_citations(
            selected_candidate=selected_candidate,
            retrieval_block_by_id={},
            value="Sample",
            raw_text="Sample",
        )

        self.assertIsNone(evidence_block_id)
        self.assertEqual(evidence_score, 0.0)
        self.assertEqual(ordered_citations[0]["snippet"], "First citation")
        self.assertEqual(ordered_citations[1]["snippet"], "Second citation")


if __name__ == "__main__":
    unittest.main()
