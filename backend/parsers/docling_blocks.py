from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional, Tuple

from artifact_schema import Block, Citation


def _parse_ref(ref_value: str) -> Optional[Tuple[str, int]]:
    if not isinstance(ref_value, str) or not ref_value.startswith("#/"):
        return None
    try:
        _, collection, index = ref_value.split("/")
        return collection, int(index)
    except ValueError:
        return None


def _extract_bbox(raw_bbox: Any) -> Optional[List[float]]:
    if raw_bbox is None:
        return None

    if isinstance(raw_bbox, (list, tuple)) and len(raw_bbox) == 4:
        try:
            return [float(raw_bbox[0]), float(raw_bbox[1]), float(raw_bbox[2]), float(raw_bbox[3])]
        except (TypeError, ValueError):
            return None

    if isinstance(raw_bbox, dict):
        # Handle common bbox schema variants.
        if {"l", "t", "r", "b"}.issubset(raw_bbox.keys()):
            return [
                float(raw_bbox["l"]),
                float(raw_bbox["t"]),
                float(raw_bbox["r"]),
                float(raw_bbox["b"]),
            ]
        if {"x0", "y0", "x1", "y1"}.issubset(raw_bbox.keys()):
            return [
                float(raw_bbox["x0"]),
                float(raw_bbox["y0"]),
                float(raw_bbox["x1"]),
                float(raw_bbox["y1"]),
            ]

    return None


def _extract_page(raw_prov: Dict[str, Any]) -> Optional[int]:
    candidates = ["page_no", "page", "page_index"]
    for key in candidates:
        if key not in raw_prov:
            continue
        value = raw_prov.get(key)
        if value is None:
            continue
        try:
            page = int(value)
            if key == "page_index":
                page += 1
            return page
        except (TypeError, ValueError):
            continue
    return None


def _citations_from_prov(prov: Iterable[Dict[str, Any]], source: str, snippet: str) -> List[Citation]:
    citations: List[Citation] = []
    for entry in prov:
        if not isinstance(entry, dict):
            continue
        charspan = entry.get("charspan")
        start_char = None
        end_char = None
        if isinstance(charspan, (list, tuple)) and len(charspan) == 2:
            try:
                start_char = int(charspan[0])
                end_char = int(charspan[1])
            except (TypeError, ValueError):
                start_char = None
                end_char = None

        citations.append(
            Citation(
                source=source,
                snippet=snippet,
                page=_extract_page(entry),
                bbox=_extract_bbox(entry.get("bbox")),
                start_char=start_char,
                end_char=end_char,
            )
        )

    return citations


def _table_to_text(table_data: Dict[str, Any]) -> str:
    cells = table_data.get("table_cells", [])
    if not isinstance(cells, list) or not cells:
        return ""

    row_map: Dict[int, Dict[int, str]] = {}
    max_col = 0
    for cell in cells:
        if not isinstance(cell, dict):
            continue
        try:
            row = int(cell.get("start_row_offset_idx", 0))
            col = int(cell.get("start_col_offset_idx", 0))
        except (TypeError, ValueError):
            continue

        text = str(cell.get("text", "")).strip()
        if not text:
            continue

        row_map.setdefault(row, {})[col] = text
        max_col = max(max_col, col)

    rows: List[str] = []
    for row_index in sorted(row_map.keys()):
        cols = row_map[row_index]
        row_values = [cols.get(col_index, "") for col_index in range(max_col + 1)]
        row_text = " | ".join(value.strip() for value in row_values).strip()
        if row_text:
            rows.append(row_text)

    return "\n".join(rows)


def blocks_from_docling_json(docling_json: Dict[str, Any], source: str) -> List[Block]:
    texts = docling_json.get("texts") or []
    tables = docling_json.get("tables") or []
    groups = docling_json.get("groups") or []
    body = docling_json.get("body") or {}
    body_children = body.get("children") or []

    blocks: List[Block] = []
    visited_refs: set[str] = set()

    def walk_refs(ref_objects: Iterable[Dict[str, Any]]) -> None:
        for ref_obj in ref_objects:
            if not isinstance(ref_obj, dict):
                continue
            ref_value = ref_obj.get("$ref")
            if not isinstance(ref_value, str) or ref_value in visited_refs:
                continue
            visited_refs.add(ref_value)

            parsed_ref = _parse_ref(ref_value)
            if not parsed_ref:
                continue
            collection, index = parsed_ref

            if collection == "texts" and 0 <= index < len(texts):
                text_item = texts[index]
                raw_text = str(text_item.get("text", "")).strip()
                if not raw_text:
                    continue
                snippet = raw_text[:240]
                citations = _citations_from_prov(text_item.get("prov") or [], source=source, snippet=snippet)
                blocks.append(
                    Block(
                        id=f"block_{len(blocks) + 1}",
                        block_type=str(text_item.get("label") or "paragraph"),
                        text=raw_text,
                        citations=citations,
                        meta={"docling_ref": ref_value},
                    )
                )
                continue

            if collection == "tables" and 0 <= index < len(tables):
                table_item = tables[index]
                table_text = _table_to_text(table_item.get("data") or {})
                if not table_text:
                    continue
                snippet = table_text[:240]
                citations = _citations_from_prov(table_item.get("prov") or [], source=source, snippet=snippet)
                blocks.append(
                    Block(
                        id=f"block_{len(blocks) + 1}",
                        block_type="table",
                        text=table_text,
                        citations=citations,
                        meta={"docling_ref": ref_value},
                    )
                )
                continue

            if collection == "groups" and 0 <= index < len(groups):
                group_item = groups[index]
                walk_refs(group_item.get("children") or [])

    walk_refs(body_children)

    if blocks:
        return blocks

    # Fallback when body references are sparse: use texts list directly.
    for text_item in texts:
        raw_text = str(text_item.get("text", "")).strip()
        if not raw_text:
            continue
        snippet = raw_text[:240]
        blocks.append(
            Block(
                id=f"block_{len(blocks) + 1}",
                block_type=str(text_item.get("label") or "paragraph"),
                text=raw_text,
                citations=_citations_from_prov(text_item.get("prov") or [], source=source, snippet=snippet),
            )
        )

    return blocks
