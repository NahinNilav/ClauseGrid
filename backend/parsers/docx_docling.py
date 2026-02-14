from __future__ import annotations

import os
import tempfile
from typing import Any, Dict

from docling.document_converter import DocumentConverter

from parsers.docling_blocks import blocks_from_docling_json


def parse_docx_with_docling(
    *,
    converter: DocumentConverter,
    raw_bytes: bytes,
    filename: str,
) -> Dict[str, Any]:
    suffix = os.path.splitext(filename)[1].lower() or ".docx"
    with tempfile.NamedTemporaryFile(mode="wb", suffix=suffix, delete=False) as tmp:
        tmp.write(raw_bytes)
        tmp_path = tmp.name

    try:
        result = converter.convert(tmp_path)
        markdown = result.document.export_to_markdown()
        docling_json = result.document.export_to_dict()
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

    blocks = blocks_from_docling_json(docling_json, source="docx")
    return {
        "markdown": markdown,
        "docling_json": docling_json,
        "blocks": blocks,
        "parser": "docling",
    }
