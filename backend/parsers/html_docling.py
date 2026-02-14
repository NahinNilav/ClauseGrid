from __future__ import annotations

import os
import re
import tempfile
from typing import Any, Dict, List, Tuple

from bs4 import BeautifulSoup
from docling.document_converter import DocumentConverter

from artifact_schema import Citation
from parsers.docling_blocks import blocks_from_docling_json


def _decode_html(raw_bytes: bytes) -> str:
    # Basic charset detection from meta tags; fallback to utf-8/latin-1.
    head = raw_bytes[:4096]
    meta_match = re.search(br"charset\s*=\s*['\"]?([a-zA-Z0-9_\-]+)", head, flags=re.IGNORECASE)

    tried: List[str] = []
    if meta_match:
        tried.append(meta_match.group(1).decode("ascii", errors="ignore"))
    tried.extend(["utf-8", "cp1252", "latin-1"])

    for encoding in tried:
        if not encoding:
            continue
        try:
            return raw_bytes.decode(encoding)
        except UnicodeDecodeError:
            continue

    return raw_bytes.decode("utf-8", errors="replace")


def _normalize_text(text: str) -> str:
    text = text.replace("\xa0", " ")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _css_selector_for_element(element) -> str:
    parts: List[str] = []
    current = element
    while current and getattr(current, "name", None) and current.name != "[document]":
        parent = current.parent
        if not parent or not getattr(parent, "find_all", None):
            parts.append(current.name)
            break
        siblings = [sib for sib in parent.find_all(current.name, recursive=False)]
        if len(siblings) == 1:
            parts.append(current.name)
        else:
            index = siblings.index(current) + 1
            parts.append(f"{current.name}:nth-of-type({index})")
        current = parent
    return " > ".join(reversed(parts))


def preprocess_html(raw_bytes: bytes) -> Tuple[str, List[Dict[str, Any]]]:
    html = _decode_html(raw_bytes)
    soup = BeautifulSoup(html, "html.parser")

    for tag_name in ["script", "style", "noscript"]:
        for node in soup.find_all(tag_name):
            node.decompose()

    dom_map: List[Dict[str, Any]] = []
    candidate_tags = ["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "td", "th", "div"]

    root = soup.body or soup
    for element in root.find_all(candidate_tags):
        text = _normalize_text(element.get_text(" ", strip=True))
        if len(text) < 3:
            continue
        dom_map.append(
            {
                "selector": _css_selector_for_element(element),
                "text": text,
            }
        )

    cleaned_html = str(soup).replace("\xa0", " ")
    return cleaned_html, dom_map


def _attach_dom_citations(blocks, dom_map: List[Dict[str, Any]]) -> None:
    if not dom_map:
        return

    for block in blocks:
        if block.citations:
            continue

        block_text = _normalize_text(block.text)
        if not block_text:
            continue

        snippet = block_text[:180]
        snippet_lower = snippet.lower()

        best_match = None
        best_index = -1

        for node in dom_map:
            node_text = node["text"]
            node_lower = node_text.lower()
            position = node_lower.find(snippet_lower)
            if position >= 0:
                best_match = node
                best_index = position
                break

            # Lightweight fallback match for table-heavy content.
            short_probe = snippet_lower[:80]
            position = node_lower.find(short_probe)
            if position >= 0:
                best_match = node
                best_index = position
                break

        if not best_match:
            continue

        citation = Citation(
            source="html",
            selector=best_match["selector"],
            start_char=best_index,
            end_char=best_index + len(snippet),
            snippet=snippet,
        )
        block.citations = [citation]


def parse_html_with_docling(
    *,
    converter: DocumentConverter,
    raw_bytes: bytes,
    filename: str,
) -> Dict[str, Any]:
    cleaned_html, dom_map = preprocess_html(raw_bytes)

    suffix = os.path.splitext(filename)[1].lower() or ".html"
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", suffix=suffix, delete=False) as tmp:
        tmp.write(cleaned_html)
        tmp_path = tmp.name

    try:
        result = converter.convert(tmp_path)
        markdown = result.document.export_to_markdown()
        docling_json = result.document.export_to_dict()
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

    blocks = blocks_from_docling_json(docling_json, source="html")
    _attach_dom_citations(blocks, dom_map)

    return {
        "markdown": markdown,
        "docling_json": docling_json,
        "blocks": blocks,
        "preview_html": cleaned_html,
        "dom_map_size": len(dom_map),
        "parser": "docling",
    }
