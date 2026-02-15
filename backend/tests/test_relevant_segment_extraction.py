from __future__ import annotations

import sys
import unittest
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from legal_hybrid import assemble_relevant_segments


def _make_block(idx: int, text: str) -> dict:
    block_id = f"b{idx}"
    return {
        "block_id": block_id,
        "id": block_id,
        "type": "paragraph",
        "text": text,
        "citations": [{"source": "pdf", "snippet": text[:40], "page": idx + 1}],
    }


class RelevantSegmentExtractionTests(unittest.TestCase):
    def test_builds_neighbor_segments_and_dedupes_duplicate_seed_hits(self):
        blocks = [
            _make_block(0, "Header section"),
            _make_block(1, "Termination rights and grounds"),
            _make_block(2, "Termination for convenience requires notice"),
            _make_block(3, "Exceptions for bankruptcy"),
            _make_block(4, "General boilerplate"),
        ]
        ranked_candidates = [
            {"block_id": "b1", "scores": {"semantic": 0.9, "lexical": 0.8, "structure": 0.0, "final": 0.88}},
            {"block_id": "b1", "scores": {"semantic": 0.7, "lexical": 0.7, "structure": 0.0, "final": 0.71}},
            {"block_id": "b2", "scores": {"semantic": 0.82, "lexical": 0.75, "structure": 0.0, "final": 0.81}},
        ]

        segments = assemble_relevant_segments(
            blocks=blocks,
            ranked_candidates=ranked_candidates,
            window_radius=1,
            max_segments=6,
            max_chars=1000,
            max_citations=10,
        )

        self.assertEqual(len(segments), 2)
        self.assertEqual(segments[0]["block_type"], "segment")
        self.assertIn("segment_block_ids", segments[0])
        self.assertIn("source_block_ids", segments[0])
        self.assertGreaterEqual(segments[0]["scores"].get("final", 0.0), segments[1]["scores"].get("final", 0.0))

        segment_0_2 = next(item for item in segments if item["block_id"] == "segment_0_2")
        self.assertEqual(segment_0_2["source_block_ids"], ["b1"])
        self.assertEqual(segment_0_2["segment_block_ids"], ["b0", "b1", "b2"])

    def test_ignores_unknown_seeds_and_truncates_segment_text(self):
        long_text = "Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu " * 6
        blocks = [
            _make_block(0, "Lead-in"),
            _make_block(1, long_text),
            _make_block(2, "Tail"),
        ]
        ranked_candidates = [
            {"block_id": "missing", "scores": {"final": 0.91}},
            {"block_id": "b1", "scores": {"semantic": 0.8, "lexical": 0.7, "structure": 0.0, "final": 0.79}},
        ]

        segments = assemble_relevant_segments(
            blocks=blocks,
            ranked_candidates=ranked_candidates,
            window_radius=1,
            max_segments=3,
            max_chars=140,
            max_citations=5,
        )

        self.assertEqual(len(segments), 1)
        self.assertLessEqual(len(segments[0]["text"]), 140)
        self.assertEqual(segments[0]["block_id"], "segment_0_2")


if __name__ == "__main__":
    unittest.main()
