from __future__ import annotations

import re
from typing import Any, Dict, List

from artifact_schema import Block, Citation


def parse_text(raw_bytes: bytes) -> Dict[str, Any]:
    text = raw_bytes.decode("utf-8", errors="replace")
    text = text.replace("\r\n", "\n")

    paragraphs = [p.strip() for p in re.split(r"\n\s*\n+", text) if p.strip()]
    blocks: List[Block] = []

    offset = 0
    for paragraph in paragraphs:
        start = text.find(paragraph, offset)
        if start < 0:
            start = offset
        end = start + len(paragraph)
        offset = end

        blocks.append(
            Block(
                id=f"block_{len(blocks) + 1}",
                block_type="paragraph",
                text=paragraph,
                citations=[
                    Citation(
                        source="txt",
                        snippet=paragraph[:240],
                        start_char=start,
                        end_char=end,
                    )
                ],
            )
        )

    return {
        "markdown": text,
        "docling_json": {
            "schema_name": "plain_text",
        },
        "blocks": blocks,
        "parser": "plain_text",
    }
