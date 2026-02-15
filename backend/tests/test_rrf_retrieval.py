from __future__ import annotations

import sys
import unittest
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from legal_hybrid import bm25_like_scores, confidence_from_signals, retrieve_legal_candidates


def _block(block_id: str, text: str, block_type: str = "paragraph") -> dict:
    return {
        "block_id": block_id,
        "id": block_id,
        "type": block_type,
        "text": text,
        "citations": [{"source": "pdf", "snippet": text[:40], "page": 1}],
    }


class RrfRetrievalTests(unittest.TestCase):
    def test_rrf_rewards_consistent_cross_signal_candidates(self):
        field = {
            "name": "Alpha Beta",
            "prompt": "alpha beta",
            "type": "text",
        }
        blocks = [
            _block("bA", "alpha", "paragraph"),
            _block("bB", "alpha beta obligations", "table"),
            _block("bC", "beta beta gamma", "paragraph"),
        ]
        query_embedding = [1.0, 0.0]
        block_embeddings = [
            [1.0, 0.0],  # strongest dense score only
            [0.6, 0.8],  # dense rank 2, but lexical + structure rank 1
            [0.0, 1.0],
        ]

        candidates = retrieve_legal_candidates(
            blocks=blocks,
            field=field,
            doc_version_id="dv_demo",
            block_embeddings=block_embeddings,
            query_embedding=query_embedding,
            top_k=3,
        )

        self.assertEqual(len(candidates), 3)
        self.assertEqual(candidates[0]["block_id"], "bB")
        self.assertEqual(candidates[0]["scores"]["rank_dense"], 2)
        self.assertEqual(candidates[0]["scores"]["rank_lexical"], 1)
        self.assertEqual(candidates[0]["scores"]["rank_structure"], 1)

    def test_rrf_tie_breaking_is_deterministic_by_block_id(self):
        field = {"name": "Delta", "prompt": "delta", "type": "text"}
        blocks = [
            _block("b2", "lorem ipsum", "paragraph"),
            _block("b10", "lorem ipsum", "paragraph"),
            _block("b1", "lorem ipsum", "paragraph"),
        ]
        query_embedding = [1.0, 0.0]
        block_embeddings = [[1.0, 0.0], [1.0, 0.0], [1.0, 0.0]]

        candidates = retrieve_legal_candidates(
            blocks=blocks,
            field=field,
            doc_version_id="dv_demo",
            block_embeddings=block_embeddings,
            query_embedding=query_embedding,
            top_k=3,
        )

        self.assertEqual([item["block_id"] for item in candidates], ["b1", "b10", "b2"])

    def test_bm25_like_scores_capture_tf_and_idf_effects(self):
        tf_scores = bm25_like_scores(
            query_tokens=["alpha", "beta"],
            documents_tokens=[
                ["alpha", "alpha", "alpha", "beta"],
                ["alpha", "beta"],
                ["beta", "beta", "beta"],
            ],
        )
        self.assertGreater(tf_scores[0], tf_scores[1])
        self.assertGreater(tf_scores[1], 0.0)

        idf_scores = bm25_like_scores(
            query_tokens=["common", "rare"],
            documents_tokens=[
                ["common", "rare"],
                ["common", "common"],
                ["common", "common", "common"],
            ],
        )
        self.assertGreater(idf_scores[0], idf_scores[1])
        self.assertGreater(idf_scores[0], idf_scores[2])

    def test_rrf_final_scores_are_bounded_for_confidence(self):
        field = {"name": "Obligations", "prompt": "party obligations notice", "type": "text"}
        blocks = [
            _block("b1", "party obligations notice period", "paragraph"),
            _block("b2", "table rows and values", "table"),
            _block("b3", "miscellaneous boilerplate", "paragraph"),
        ]
        candidates = retrieve_legal_candidates(
            blocks=blocks,
            field=field,
            doc_version_id="dv_demo",
            block_embeddings=None,
            query_embedding=None,
            top_k=3,
        )

        self.assertTrue(candidates)
        finals = [float((item.get("scores") or {}).get("final") or 0.0) for item in candidates]
        self.assertTrue(all(0.0 <= value <= 1.0 for value in finals))
        self.assertAlmostEqual(max(finals), 1.0, places=4)

        confidence = confidence_from_signals(
            base_confidence=0.72,
            retrieval_score=finals[0],
            verifier_status="PASS",
            self_consistent=True,
        )
        self.assertGreaterEqual(confidence, 0.05)
        self.assertLessEqual(confidence, 0.98)


if __name__ == "__main__":
    unittest.main()
