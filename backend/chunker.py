from __future__ import annotations

from typing import List

from artifact_schema import Block, Chunk, Citation


def _dedupe_citations(citations: List[Citation]) -> List[Citation]:
    seen = set()
    deduped: List[Citation] = []
    for citation in citations:
        key = str(sorted(citation.to_dict().items()))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(citation)
    return deduped


def chunk_blocks(blocks: List[Block], max_chars: int = 1400) -> List[Chunk]:
    chunks: List[Chunk] = []
    current_blocks: List[Block] = []
    current_len = 0
    chunk_index = 1

    def flush_current() -> None:
        nonlocal chunk_index, current_blocks, current_len
        if not current_blocks:
            return

        text = "\n\n".join(block.text for block in current_blocks if block.text)
        citations: List[Citation] = []
        for block in current_blocks:
            citations.extend(block.citations)

        chunks.append(
            Chunk(
                id=f"chunk_{chunk_index}",
                text=text,
                block_ids=[block.id for block in current_blocks],
                citations=_dedupe_citations(citations),
            )
        )
        chunk_index += 1
        current_blocks = []
        current_len = 0

    for block in blocks:
        if not block.text.strip():
            continue

        block_len = len(block.text)

        # Keep table blocks intact for legal row/cell fidelity.
        if block.block_type == "table":
            flush_current()
            chunks.append(
                Chunk(
                    id=f"chunk_{chunk_index}",
                    text=block.text,
                    block_ids=[block.id],
                    citations=_dedupe_citations(block.citations),
                )
            )
            chunk_index += 1
            continue

        if current_blocks and (current_len + block_len) > max_chars:
            flush_current()

        current_blocks.append(block)
        current_len += block_len

    flush_current()
    return chunks
