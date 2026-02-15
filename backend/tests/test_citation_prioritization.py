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

        details = LegalReviewService._prioritize_candidate_citations(
            selected_candidate=selected_candidate,
            retrieval_block_by_id=retrieval_block_by_id,
            field_key="parties_entities",
            value='Tesla; Panasonic (as "Seller")',
            raw_text="The parties are Tesla, Inc. and Panasonic Corporation as Seller.",
        )
        ordered_citations = details["citations"]
        evidence_block_id = details["chosen_block_id"]
        evidence_score = details["chosen_score"]

        self.assertEqual(evidence_block_id, "block_1")
        self.assertGreater(evidence_score, 0.0)
        self.assertEqual(ordered_citations[0]["page"], 1)
        self.assertIn("Tesla", ordered_citations[0]["snippet"])
        self.assertEqual(details["anchor_mode"], "segment")

    def test_non_segment_keeps_existing_citation_order(self):
        first = {"source": "pdf", "snippet": "First citation", "page": 8}
        second = {"source": "pdf", "snippet": "Second citation", "page": 9}
        selected_candidate = {
            "block_id": "block_10",
            "citations": [first, second],
        }

        details = LegalReviewService._prioritize_candidate_citations(
            selected_candidate=selected_candidate,
            retrieval_block_by_id={},
            field_key="document_title",
            value="Sample",
            raw_text="Sample",
        )
        ordered_citations = details["citations"]
        evidence_block_id = details["chosen_block_id"]
        evidence_score = details["chosen_score"]

        self.assertIsNone(evidence_block_id)
        self.assertEqual(evidence_score, 0.0)
        self.assertEqual(ordered_citations[0]["snippet"], "First citation")
        self.assertEqual(ordered_citations[1]["snippet"], "Second citation")
        self.assertEqual(details["anchor_mode"], "segment")

    def test_global_rescue_reanchors_generic_segment_to_explicit_date_block(self):
        generic_citation = {
            "source": "pdf",
            "snippet": "Confidential Treatment Requested by Tesla, Inc.",
            "page": 68,
            "doc_version_id": "dv_demo",
        }
        date_citation = {
            "source": "pdf",
            "snippet": "Dated as of August 17, 2017",
            "page": 1,
            "doc_version_id": "dv_demo",
        }
        selected_candidate = {
            "block_id": "segment_66_70",
            "segment_block_ids": ["block_66", "block_67", "block_68"],
            "source_block_ids": ["block_66"],
            "citations": [generic_citation],
        }
        retrieval_block_by_id = {
            "block_66": {
                "text": "Confidential Treatment Requested by Tesla, Inc. rights and waivers.",
                "citations": [generic_citation],
            },
            "block_67": {
                "text": "Confidential Treatment Requested by Tesla, Inc. representations.",
                "citations": [generic_citation],
            },
            "block_68": {
                "text": "Confidential Treatment Requested by Tesla, Inc. obligations.",
                "citations": [generic_citation],
            },
            "block_2": {
                "text": "Loan and Security Agreement dated as of August 17, 2017 among Tesla and TFL.",
                "citations": [date_citation],
            },
        }

        details = LegalReviewService._prioritize_candidate_citations(
            selected_candidate=selected_candidate,
            retrieval_block_by_id=retrieval_block_by_id,
            field_key="effective_date_term",
            value="2017-08-17",
            raw_text="dated as of August 17, 2017",
        )

        self.assertEqual(details["anchor_mode"], "global_rescue")
        self.assertEqual(details["chosen_block_id"], "block_2")
        self.assertGreater(details["global_best_score"], details["segment_best_score"])
        self.assertEqual(details["citations"][0]["page"], 1)
        self.assertIn("August 17, 2017", details["citations"][0]["snippet"])

    def test_early_page_bias_applies_for_header_fields_when_scores_are_close(self):
        late_page = {
            "source": "pdf",
            "snippet": "Loan and Security Agreement title text with weak fit.",
            "page": 168,
            "doc_version_id": "dv_demo",
        }
        early_page = {
            "source": "pdf",
            "snippet": "AMENDED AND RESTATED LOAN AND SECURITY AGREEMENT",
            "page": 1,
            "doc_version_id": "dv_demo",
        }
        selected_candidate = {
            "block_id": "segment_1_2",
            "segment_block_ids": ["block_late", "block_early"],
            "source_block_ids": [],
            "citations": [late_page],
        }
        retrieval_block_by_id = {
            "block_late": {
                "text": "Loan and Security Agreement title text with weak fit and generic context.",
                "citations": [late_page],
            },
            "block_early": {
                "text": "AMENDED AND RESTATED LOAN AND SECURITY AGREEMENT",
                "citations": [early_page],
            },
        }

        details = LegalReviewService._prioritize_candidate_citations(
            selected_candidate=selected_candidate,
            retrieval_block_by_id=retrieval_block_by_id,
            field_key="document_title",
            value="Amended and Restated Loan and Security Agreement",
            raw_text="Amended and Restated Loan and Security Agreement",
        )

        self.assertEqual(details["citations"][0]["page"], 1)


if __name__ == "__main__":
    unittest.main()
