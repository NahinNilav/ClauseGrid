from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Literal, Optional

ParsedFormat = Literal["pdf", "html", "txt"]


@dataclass
class Citation:
    source: Literal["pdf", "html", "txt"]
    snippet: str
    page: Optional[int] = None
    bbox: Optional[List[float]] = None
    selector: Optional[str] = None
    start_char: Optional[int] = None
    end_char: Optional[int] = None

    def to_dict(self) -> Dict[str, Any]:
        payload = asdict(self)
        return {k: v for k, v in payload.items() if v is not None and v != ""}


@dataclass
class Block:
    id: str
    block_type: str
    text: str
    citations: List[Citation] = field(default_factory=list)
    meta: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        payload = {
            "id": self.id,
            "type": self.block_type,
            "text": self.text,
            "citations": [citation.to_dict() for citation in self.citations],
        }
        if self.meta:
            payload["meta"] = self.meta
        return payload


@dataclass
class Chunk:
    id: str
    text: str
    block_ids: List[str]
    citations: List[Citation] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "text": self.text,
            "block_ids": self.block_ids,
            "citations": [citation.to_dict() for citation in self.citations],
            "char_count": len(self.text),
        }


def make_artifact(
    *,
    doc_version_id: str,
    doc_format: ParsedFormat,
    filename: str,
    mime_type: str,
    ext: str,
    sha256: str,
    markdown: str,
    docling_json: Dict[str, Any],
    blocks: List[Block],
    chunks: List[Chunk],
    citation_index: Dict[str, Dict[str, Any]],
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    return {
        "doc_version_id": doc_version_id,
        "format": doc_format,
        "filename": filename,
        "mime_type": mime_type,
        "ext": ext,
        "sha256": sha256,
        "markdown": markdown,
        "docling_json": docling_json,
        "blocks": [block.to_dict() for block in blocks],
        "chunks": [chunk.to_dict() for chunk in chunks],
        "citation_index": citation_index,
        "metadata": metadata or {},
    }


def build_citation_index(blocks: List[Block]) -> Dict[str, Dict[str, Any]]:
    citation_index: Dict[str, Dict[str, Any]] = {}
    seen: Dict[str, str] = {}
    next_id = 1

    for block in blocks:
        for citation in block.citations:
            serialized = citation.to_dict()
            key = str(sorted(serialized.items()))
            if key in seen:
                citation_id = seen[key]
            else:
                citation_id = f"cit_{next_id}"
                next_id += 1
                seen[key] = citation_id
                citation_index[citation_id] = serialized

    return citation_index
