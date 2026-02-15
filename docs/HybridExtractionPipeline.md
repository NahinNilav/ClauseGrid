# Hybrid Extraction Pipeline: 
## Pipeline Overview

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                          HYBRID EXTRACTION PIPELINE                                  │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                     │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐          │
│  │ Document │──▶│  Docling │──▶│  Blocks  │──▶│Embeddings│──▶│ Retrieval│          │
│  │  Upload  │   │  Parser  │   │ & Chunks │   │(OpenAI)  │   │ (Hybrid) │          │
│  └──────────┘   └──────────┘   └──────────┘   └──────────┘   └──────────┘          │
│                                                                   │                │
│                                                                   ▼                │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐          │
│  │  Table   │◀──│  Final   │◀──│Confidence│◀──│ Verifier │◀──│   LLM    │          │
│  │   View   │   │  Output  │   │ Scoring  │   │   LLM    │   │ Extract  │          │
│  └──────────┘   └──────────┘   └──────────┘   └──────────┘   └──────────┘          │
│       │                                                                             │
│       ▼                                                                             │
│  ┌──────────┐                                                                       │
│  │ Citation │                                                                       │
│  │Highlight │                                                                       │
│  └──────────┘                                                                       │
│                                                                                     │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### Key Components

| Component | Technology | Purpose |
|-----------|------------|---------|
| Document Parser | Docling + pypdfium2 | Converts PDF/HTML to structured blocks |
| Embeddings | OpenAI `text-embedding-3-small` | Semantic similarity search |
| LLM Extraction | GPT-5-mini / Gemini-3-pro | Structured field extraction |
| Verifier LLM | GPT-5-nano / Gemini-3-flash | Cross-validates extractions |
| Highlighting | CSS Selectors / PDF Bbox | Visual citation linking |

---

## Stage 1: Document Upload & Parsing

### 1.1 Upload Flow

When a user uploads a document, the frontend sends it to the backend via multipart form:

```typescript
// Frontend: services/documentProcessor.ts
const formData = new FormData();
formData.append('file', file);

const response = await fetch(`${apiUrl}/convert`, {
  method: 'POST',
  body: formData,
});
```

### 1.2 MIME Routing

The backend routes documents to appropriate parsers based on MIME type:

```python
# mime_router.py logic
MIME_HANDLERS = {
    "application/pdf": parse_pdf,
    "text/html": parse_html_with_docling,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": parse_docx,
}
```

### 1.3 Docling PDF Parsing

For PDFs, the system uses **Docling** (via subprocess worker) to extract structured content:

```python
# parsers/pdf_docling.py
def parse_pdf(*, pdf_path: str) -> Dict[str, Any]:
    # Step 1: Get page dimensions from pypdfium2
    page_index = _page_index_from_pdfium(pdf_path)
    
    # Step 2: Run Docling worker subprocess
    payload, worker_error = _run_docling_pdf_worker(pdf_path)
    
    # Step 3: Convert Docling output to blocks
    blocks = blocks_from_docling_json(docling_json, source="pdf")
    
    return {
        "markdown": markdown,
        "docling_json": docling_json,
        "blocks": blocks,
        "page_index": page_index,
    }
```

### 1.4 HTML Parsing with DOM Citations

For HTML documents, the parser creates CSS selectors for citation tracking:

```python
# parsers/html_docling.py
def _css_selector_for_element(element) -> str:
    """Generate unique CSS selector path for any DOM element."""
    parts = []
    current = element
    while current and current.name != "[document]":
        siblings = parent.find_all(current.name, recursive=False)
        if len(siblings) == 1:
            parts.append(current.name)
        else:
            index = siblings.index(current) + 1
            parts.append(f"{current.name}:nth-of-type({index})")
        current = current.parent
    return " > ".join(reversed(parts))
```

**Example Output:**
```
html > body > div:nth-of-type(3) > table > tbody > tr:nth-of-type(2) > td:nth-of-type(1)
```

---

## Stage 2: Block Extraction & Chunking

### 2.1 Block Structure

The system creates **Block** objects from parsed content:

```python
# artifact_schema.py
@dataclass
class Block:
    id: str              # e.g., "block_42"
    block_type: str      # "paragraph", "table", "heading"
    text: str            # Extracted text content
    citations: List[Citation]  # Source locations
    meta: Dict[str, Any]       # Additional metadata
```

### 2.2 Citation Structure

Each block carries citations that enable document highlighting:

```python
@dataclass
class Citation:
    source: str          # "pdf" or "html"
    snippet: str         # First 240 chars of text
    page: Optional[int]  # PDF page number (1-indexed)
    bbox: Optional[List[float]]  # [x0, y0, x1, y1] coordinates
    selector: Optional[str]      # CSS selector for HTML
    start_char: Optional[int]    # Character offset start
    end_char: Optional[int]      # Character offset end
```

### 2.3 Chunking Strategy

Blocks are chunked respecting semantic boundaries:

```python
# chunker.py
def chunk_blocks(blocks: List[Block], max_chars: int = 1400) -> List[Chunk]:
    chunks = []
    current_blocks = []
    current_len = 0
    
    for block in blocks:
        # Table blocks remain intact for legal row/cell fidelity
        if block.block_type == "table":
            flush_current()  # Save accumulated blocks
            chunks.append(Chunk(
                id=f"chunk_{chunk_index}",
                text=block.text,
                block_ids=[block.id],
                citations=block.citations,
            ))
            continue
        
        # Accumulate paragraph blocks up to max_chars
        if current_len + len(block.text) > max_chars:
            flush_current()
        
        current_blocks.append(block)
        current_len += len(block.text)
    
    return chunks
```

**Key Design Decision:** Tables are **never split** to preserve legal data integrity.

---

## Stage 3: Embedding Generation

### 3.1 OpenAI Embedding Client

The system uses OpenAI's `text-embedding-3-small` model for semantic search:

```python
# legal_hybrid.py
class OpenAIEmbeddingClient:
    def __init__(self):
        self.model = os.getenv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small")
        self.batch_size = 64
        self.client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    
    def embed_texts(self, texts: List[str]) -> List[List[float]]:
        embeddings = []
        for start in range(0, len(texts), self.batch_size):
            chunk = texts[start:start + self.batch_size]
            response = self.client.embeddings.create(
                model=self.model,
                input=chunk,
            )
            for item in response.data:
                embeddings.append(item.embedding)
        return embeddings
```

### 3.2 Block Embedding Caching

Embeddings are cached per document version to avoid redundant API calls:

```python
# legal_service.py
def _get_or_create_block_embeddings(self, doc_version_id, blocks):
    # Check cache
    existing = self.db.fetch_all("""
        SELECT block_id, embedding_json
        FROM document_block_embeddings
        WHERE document_version_id = :doc_version_id AND model = :model
    """)
    
    # Compute missing embeddings
    missing_texts = [b["text"] for b in blocks if b["block_id"] not in existing]
    new_embeddings = self.embedding_client.embed_texts(missing_texts)
    
    # Store in cache
    self.db.executemany("""
        INSERT OR REPLACE INTO document_block_embeddings(
            document_version_id, block_id, model, embedding_json, created_at
        ) VALUES (...)
    """, upserts)
    
    return aligned_embeddings
```

### 3.3 Field Query Embedding

Field definitions are also embedded for semantic matching:

```python
def _build_field_query_embeddings(self, fields: List[Dict]) -> Dict[int, List[float]]:
    # Expand queries with legal synonyms
    queries = [_expand_legal_query(field) for field in fields]
    vectors = self.embedding_client.embed_texts(queries)
    return {idx: vec for idx, vec in enumerate(vectors) if vec}
```

**Legal Synonym Expansion:**
```python
LEGAL_SYNONYMS = {
    "termination": ["expire", "end", "cancel", "termination for cause"],
    "governing": ["governing law", "jurisdiction", "venue", "applicable law"],
    "indemnity": ["indemnification", "hold harmless", "defend", "indemnify"],
    "liability": ["limitation of liability", "cap", "damages", "liability cap"],
}
```

---

## Stage 4: Hybrid Retrieval

### 4.1 Multi-Signal Retrieval

The retrieval system combines three signals:

```python
# legal_hybrid.py
def retrieve_legal_candidates(
    blocks, field, doc_version_id,
    block_embeddings, query_embedding, top_k=6
) -> List[Dict]:
    candidates = []
    
    for idx, block in enumerate(blocks):
        # Signal 1: Semantic similarity (cosine)
        if query_embedding and block_embeddings[idx]:
            semantic = _cosine(query_embedding, block_embeddings[idx])
        else:
            semantic = _cosine(_hash_embedding(query), _hash_embedding(block["text"]))
        
        # Signal 2: Lexical overlap (token intersection)
        query_tokens = _token_set(query)
        text_tokens = _token_set(block["text"])
        lexical = len(query_tokens & text_tokens) / max(1, len(query_tokens))
        
        # Signal 3: Structure prior (tables get bonus)
        structure = 0.1 if block["type"] == "table" else 0.0
        
        # Weighted combination
        final_score = 0.5 * semantic + 0.3 * lexical + 0.2 * structure
        
        candidates.append({
            "block_id": block["id"],
            "text": block["text"],
            "citations": block["citations"],
            "scores": {
                "semantic": semantic,
                "lexical": lexical,
                "structure": structure,
                "final": final_score,
            }
        })
    
    return sorted(candidates, key=lambda c: c["scores"]["final"], reverse=True)[:top_k]
```

### 4.2 Relevant Segment Extraction (RSE)

After block scoring, hybrid mode now assembles larger context segments before LLM extraction:

1. Retrieve a larger block pool (`80/60/40` for `high/balanced/fast`)
2. Build contiguous windows in document order (`prev2 + self + next2`)
3. Deduplicate windows by span and rerank segment candidates
4. Send top segments to extractor (`10/8/6`)

```python
# legal_hybrid.py
def assemble_relevant_segments(
    blocks,
    ranked_candidates,
    window_radius=2,
    max_segments=8,
):
    # For each retrieved block, create a contiguous span in doc order
    # and merge neighboring block text + citations into a segment candidate.
    # Segments are scored by seed relevance + observed span relevance.
    return top_ranked_segments
```

### 4.3 Score Weights

| Signal | Weight | Purpose |
|--------|--------|---------|
| Semantic | 0.5 | Captures meaning similarity |
| Lexical | 0.3 | Ensures keyword presence |
| Structure | 0.2 | Prioritizes tabular data |

### 4.4 Fallback Hash Embedding

When OpenAI embeddings are unavailable, a hash-based fallback is used:

```python
def _hash_embedding(text: str, dim: int = 256) -> List[float]:
    vec = [0.0] * dim
    for token in _tokenize(text):
        idx = hash(token) % dim
        vec[idx] += 1.0
    # L2 normalize
    norm = math.sqrt(sum(v * v for v in vec))
    return [v / norm for v in vec] if norm > 0 else vec
```

---

## Stage 5: LLM Structured Extraction

### 5.1 Extraction Prompt

The LLM receives retrieved candidates and extracts structured data:

```python
# legal_hybrid.py - OpenAILegalClient.extract()
def extract(self, field, candidates, quality_profile):
    evidence = [{
        "candidate_index": idx,
        "text": c["text"],
        "page": c["citations"][0].get("page") if c["citations"] else None,
        "selector": c["citations"][0].get("selector") if c["citations"] else None,
        "score": c["scores"]["final"],
    } for idx, c in enumerate(candidates)]
    
    prompt = f"""You are extracting legal fields from evidence snippets.
Return ONLY JSON with keys: value, raw_text, evidence_summary, candidate_index, confidence.
Rules: cite only from provided snippets, do not fabricate, keep value concise and field-typed.

Field: {json.dumps(field)}
Quality profile: {quality_profile}
Evidence candidates: {json.dumps(evidence)}"""
    
    response = self.client.responses.create(
        model=model,  # "gpt-5-mini" or "gpt-5.2"
        input=prompt,
        reasoning={"effort": reasoning_effort},
    )
    
    return {
        "value": payload["value"],
        "raw_text": payload["raw_text"],
        "evidence_summary": payload["evidence_summary"],
        "candidate_index": payload["candidate_index"],
        "confidence": payload["confidence"],
    }
```

### 5.2 Model Selection by Quality Profile

| Profile | Model | Reasoning Effort | Use Case |
|---------|-------|------------------|----------|
| fast | gpt-5-mini | medium | Quick review |
| balanced | gpt-5-mini | medium | General use |
| high | gpt-5.2 | medium | Accuracy-critical |

### 5.3 Structured Output Schema

```json
{
  "value": "December 31, 2025",
  "raw_text": "This Agreement will terminate on December 31, 2025 unless renewed.",
  "evidence_summary": "Found in Section 8.1 Termination clause.",
  "candidate_index": 2,
  "confidence": 0.87
}
```

---

## Stage 6: Verification & Confidence Scoring

### 6.1 Verifier LLM

A second LLM call validates the extraction:

```python
def verify(self, field, value, raw_text, candidates, quality_profile):
    prompt = f"""You are verifying a legal extraction against evidence snippets.
Return ONLY JSON with keys: verifier_status, reason, best_candidate_index.
verifier_status must be PASS, PARTIAL, or FAIL.

Field: {json.dumps(field)}
Claimed value: {value}
Claimed raw_text: {raw_text}
Evidence: {json.dumps(evidence)}"""
    
    return {
        "verifier_status": "PASS" | "PARTIAL" | "FAIL",
        "reason": "Value matches text in candidate 2, Section 8.1",
        "best_candidate_index": 2,
    }
```

### 6.2 Self-Consistency Check (High Quality)

For `high` quality profiles, extraction runs twice with reversed candidates:

```python
if quality_profile == "high":
    alternative = self.llm_client.extract(
        field=field,
        candidates=list(reversed(candidates)),  # Reversed order
        quality_profile=quality_profile,
    )
    self_consistent = (primary["value"].lower() == alternative["value"].lower())
```

### 6.3 Confidence Scoring Algorithm

```python
def confidence_from_signals(
    base_confidence,      # LLM's self-reported confidence
    retrieval_score,      # Best candidate's final score
    verifier_status,      # PASS/PARTIAL/FAIL
    self_consistent,      # High-mode consistency check
) -> float:
    score = 0.45 * base_confidence + 0.35 * retrieval_score
    
    # Verifier adjustment
    if verifier_status == "PASS":
        score += 0.15
    elif verifier_status == "PARTIAL":
        score += 0.03
    else:  # FAIL
        score -= 0.20
    
    # Self-consistency bonus
    if self_consistent:
        score += 0.08
    
    return max(0.05, min(0.98, score))
```

### 6.4 Retry on Verification Failure

If verifier returns FAIL, retrieval pool expands, RSE reassembles context, and extraction retries with top-12 segments:

```python
if verifier.get("verifier_status") == "FAIL":
    expanded_pool = retrieve_legal_candidates(
        blocks=blocks, field=field, ..., top_k=120  # high profile example
    )
    expanded_candidates = assemble_relevant_segments(
        blocks=blocks, ranked_candidates=expanded_pool, max_segments=12
    )
    primary = self.llm_client.extract(field, expanded_candidates, quality_profile)
    verifier = self.llm_client.verify(field, primary["value"], ...)
```

---

## Stage 7: Table View Generation

### 7.1 Cell Data Structure

Each table cell contains rich metadata:

```python
# legal_service.py - table_view()
row_cells[field_key] = {
    "field_key": field_key,
    "ai_result": {
        "value": "December 31, 2025",
        "raw_text": "terminate on December 31, 2025",
        "confidence_score": 0.87,
        "citations_json": [...],
        "extraction_method": "llm_hybrid",
        "verifier_status": "PASS",
    },
    "review_overlay": None,  # Human override if exists
    "effective_value": "December 31, 2025",
    "is_diff": False,  # Baseline comparison
}
```

### 7.2 Review Decision Overlay

Human reviewers can override AI values:

```python
def upsert_review_decision(
    self, project_id, document_version_id, template_version_id,
    field_key, status, manual_value, reviewer, notes
):
    # status: CONFIRMED | REJECTED | MANUAL_UPDATED | MISSING_DATA
    if status == "MANUAL_UPDATED":
        effective_value = manual_value  # Human value takes precedence
```

---

## Stage 8: Citation & Document Highlighting

### 8.1 HTML Citation Highlighting

For HTML documents, CSS selectors enable precise highlighting:

```typescript
// HtmlCitationViewer.tsx
const applyHighlight = () => {
  // Try CSS selector first
  if (primaryCitation.selector) {
    targetNode = doc.querySelector(primaryCitation.selector);
  }
  
  // Fallback to text search
  if (!targetNode && primaryCitation.snippet) {
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    // ... search for snippet text
  }
  
  // Apply inline highlight with character range
  if (primaryCitation.start_char && primaryCitation.end_char) {
    const mark = highlightRangeInElement(
      doc, targetNode, primaryCitation.start_char, primaryCitation.end_char
    );
  } else {
    targetNode.classList.add('citation-block-highlight');
  }
  
  // Scroll to highlighted element
  win.scrollTo({
    top: targetY - win.innerHeight / 2,
    behavior: 'smooth',
  });
};
```

### 8.2 PDF Citation Highlighting

For PDFs, bounding boxes enable visual overlays:

```typescript
// PdfCitationViewer.tsx
const bboxToOverlayStyle = (bbox, imageWidth, imageHeight, pageWidth, pageHeight) => {
  const scaleX = imageWidth / pageWidth;
  const scaleY = imageHeight / pageHeight;
  
  return {
    left: bbox[0] * scaleX,
    top: (pageHeight - bbox[3]) * scaleY,  // PDF coords are bottom-up
    width: (bbox[2] - bbox[0]) * scaleX,
    height: (bbox[3] - bbox[1]) * scaleY,
  };
};
```

### 8.3 Citation CSS Styles

```css
.citation-block-highlight {
  background: rgba(216, 220, 229, 0.65);
  outline: 2px solid #8B97AD;
}

.citation-inline-highlight {
  background: rgba(216, 220, 229, 0.9);
  border-bottom: 2px solid #8B97AD;
}
```

---



## Complete Example Case

### Input Document

**Filename:** `ACME_Service_Agreement.pdf`

**Relevant Section (Page 5):**
```
8. TERM AND TERMINATION

8.1 Initial Term. This Agreement shall commence on the Effective Date 
and continue for a period of twenty-four (24) months ("Initial Term"), 
unless earlier terminated in accordance with Section 8.2.

8.2 Termination for Cause. Either party may terminate this Agreement 
upon thirty (30) days written notice if the other party materially 
breaches any provision hereof.
```

### Field Definition

```json
{
  "key": "termination_notice_period",
  "name": "Termination Notice Period",
  "type": "text",
  "prompt": "How many days notice is required to terminate the agreement for cause?"
}
```

### Stage-by-Stage Processing

#### Stage 1: Parsing Output

```python
Block(
    id="block_47",
    block_type="paragraph",
    text="8.2 Termination for Cause. Either party may terminate this Agreement upon thirty (30) days written notice if the other party materially breaches any provision hereof.",
    citations=[
        Citation(
            source="pdf",
            page=5,
            bbox=[72.0, 425.3, 540.0, 465.8],
            snippet="8.2 Termination for Cause. Either party may terminate...",
            start_char=1842,
            end_char=2054,
        )
    ]
)
```

#### Stage 2: Chunking

```python
Chunk(
    id="chunk_12",
    text="8. TERM AND TERMINATION\n\n8.1 Initial Term. This Agreement shall commence...\n\n8.2 Termination for Cause. Either party may terminate...",
    block_ids=["block_46", "block_47"],
    citations=[...],
)
```

#### Stage 3: Embeddings

```python
# Query embedding for field
query = "termination_notice_period Termination Notice Period text How many days notice is required to terminate the agreement for cause? expire end cancel termination for cause termination for convenience"
query_embedding = embed_texts([query])[0]  # 1536-dim vector

# Block embedding (cached)
block_embedding = cached_embeddings["block_47"]  # 1536-dim vector
```

#### Stage 4: Retrieval Scores

```python
{
    "block_id": "block_47",
    "text": "8.2 Termination for Cause. Either party may terminate...",
    "scores": {
        "semantic": 0.847,    # High cosine similarity
        "lexical": 0.625,     # Keyword overlap
        "structure": 0.0,     # Not a table
        "final": 0.611,       # Weighted: 0.5*0.847 + 0.3*0.625 + 0.2*0.0
    }
}
```

#### Stage 5: LLM Extraction

**Prompt sent to GPT-5-mini:**
```
You are extracting legal fields from evidence snippets.
Return ONLY JSON with keys: value, raw_text, evidence_summary, candidate_index, confidence.

Field: {"key": "termination_notice_period", "name": "Termination Notice Period", "type": "text", "prompt": "How many days notice is required to terminate the agreement for cause?"}

Evidence candidates: [
  {"candidate_index": 0, "text": "8.2 Termination for Cause. Either party may terminate this Agreement upon thirty (30) days written notice...", "page": 5, "score": 0.611}
]
```

**LLM Response:**
```json
{
  "value": "30 days",
  "raw_text": "Either party may terminate this Agreement upon thirty (30) days written notice",
  "evidence_summary": "Found in Section 8.2 Termination for Cause clause on page 5.",
  "candidate_index": 0,
  "confidence": 0.92
}
```

#### Stage 6: Verification

**Verifier Response:**
```json
{
  "verifier_status": "PASS",
  "reason": "Value '30 days' directly matches 'thirty (30) days' in the cited text.",
  "best_candidate_index": 0
}
```

**Confidence Calculation:**
```python
confidence = confidence_from_signals(
    base_confidence=0.92,      # LLM confidence
    retrieval_score=0.611,     # Best candidate score
    verifier_status="PASS",    # +0.15 bonus
    self_consistent=True,      # +0.08 bonus (high mode)
)
# = 0.45*0.92 + 0.35*0.611 + 0.15 + 0.08
# = 0.414 + 0.214 + 0.15 + 0.08
# = 0.858 → rounded to 0.86
```

#### Stage 7: Table Cell Output

```python
{
    "field_key": "termination_notice_period",
    "ai_result": {
        "id": "ext_a1b2c3d4e5f6",
        "value": "30 days",
        "raw_text": "Either party may terminate this Agreement upon thirty (30) days written notice",
        "normalized_value": "30 days",
        "normalization_valid": True,
        "confidence_score": 0.86,
        "citations_json": [{
            "source": "pdf",
            "page": 5,
            "bbox": [72.0, 425.3, 540.0, 465.8],
            "snippet": "8.2 Termination for Cause...",
            "doc_version_id": "dv_x7y8z9"
        }],
        "evidence_summary": "Found in Section 8.2 Termination for Cause clause on page 5.",
        "extraction_method": "llm_hybrid",
        "model_name": "gpt-5-mini",
        "verifier_status": "PASS",
    },
    "effective_value": "30 days",
    "is_diff": False,
}
```

#### Stage 8: PDF Highlight

When user clicks the cell, the viewer:

1. Loads PDF page 5 at 1.8x scale
2. Calculates overlay position from bbox:
   ```typescript
   {
     left: 72.0 * 1.8 = 129.6px,
     top: (792 - 465.8) * 1.8 = 587.2px,
     width: (540.0 - 72.0) * 1.8 = 842.4px,
     height: (465.8 - 425.3) * 1.8 = 72.9px,
   }
   ```
3. Renders yellow highlight overlay
4. Auto-scrolls to center the highlight

---

## Data Flow Diagrams

### Extraction Run Flow

```
┌────────────────────────────────────────────────────────────────────────┐
│                        EXTRACTION RUN FLOW                              │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  Template Fields            Documents                                   │
│  ┌──────────────┐          ┌──────────────┐                            │
│  │ Field 1      │          │ Document A   │                            │
│  │ Field 2      │    ×     │ Document B   │   = Total Cells            │
│  │ Field 3      │          │ Document C   │     (3 × 3 = 9)            │
│  └──────────────┘          └──────────────┘                            │
│                                                                        │
│  For each (Document, Field) pair:                                      │
│                                                                        │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ 1. Load artifact.blocks for document                            │   │
│  │ 2. Get/create block embeddings (cached)                         │   │
│  │ 3. Get field query embedding (precomputed)                      │   │
│  │ 4. Retrieve block pool + assemble top segment candidates (RSE)  │   │
│  │ 5. LLM extract value from segments                              │   │
│  │ 6. LLM verify extraction against segments                       │   │
│  │ 7. Compute final confidence score                               │   │
│  │ 8. Store field_extraction record with citations                 │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

### Citation Resolution Flow

```
┌────────────────────────────────────────────────────────────────────────┐
│                     CITATION RESOLUTION FLOW                            │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  User clicks table cell                                                │
│         │                                                              │
│         ▼                                                              │
│  ┌─────────────────┐                                                   │
│  │ Load cell data  │                                                   │
│  │ with citations  │                                                   │
│  └────────┬────────┘                                                   │
│           │                                                            │
│           ▼                                                            │
│  ┌─────────────────┐      ┌─────────────────┐                         │
│  │ citation.source │      │ citation.source │                         │
│  │   == "pdf"      │      │   == "html"     │                         │
│  └────────┬────────┘      └────────┬────────┘                         │
│           │                        │                                   │
│           ▼                        ▼                                   │
│  ┌─────────────────┐      ┌─────────────────┐                         │
│  │ Render PDF page │      │ Query selector  │                         │
│  │ at citation.page│      │ in iframe DOM   │                         │
│  └────────┬────────┘      └────────┬────────┘                         │
│           │                        │                                   │
│           ▼                        ▼                                   │
│  ┌─────────────────┐      ┌─────────────────┐                         │
│  │ Overlay rect at │      │ Apply highlight │                         │
│  │ citation.bbox   │      │ CSS class       │                         │
│  └────────┬────────┘      └────────┬────────┘                         │
│           │                        │                                   │
│           └────────┬───────────────┘                                   │
│                    ▼                                                   │
│           ┌─────────────────┐                                          │
│           │ Smooth scroll   │                                          │
│           │ to center view  │                                          │
│           └─────────────────┘                                          │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Configuration Reference

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | - | API key for embeddings and LLM |
| `OPENAI_EMBEDDING_MODEL` | `text-embedding-3-small` | Embedding model |
| `OPENAI_EMBEDDING_BATCH_SIZE` | `64` | Texts per API call |
| `OPENAI_EXTRACTION_MODEL_FAST` | `gpt-5-mini` | Fast extraction model |
| `OPENAI_EXTRACTION_MODEL_PRO` | `gpt-5.2` | High-quality model |
| `OPENAI_VERIFIER_MODEL` | `gpt-5-nano` | Verification model |
| `LEGAL_LLM_PROVIDER` | `openai` | `openai` or `gemini` |
| `LEGAL_DEBUG_LOGGING` | `0` | Enable verbose logging |

### Quality Profiles

| Profile | top_k | Model | Reasoning | Self-Consistency |
|---------|-------|-------|-----------|------------------|
| fast | 4 | gpt-5-mini | medium | No |
| balanced | 6 | gpt-5-mini | medium | No |
| high | 8 | gpt-5.2 | medium | Yes |

---

## Summary

The Hybrid Extraction Pipeline combines:

1. **Docling** for robust document parsing with positional citations
2. **OpenAI embeddings** for semantic understanding
3. **Hybrid retrieval** balancing semantic, lexical, and structural signals
4. **LLM extraction** with structured JSON output
5. **Verification LLM** for cross-validation
6. **Multi-signal confidence scoring** for transparency
7. **Interactive highlighting** linking table values to source documents

This architecture enables high-accuracy legal field extraction while maintaining full traceability from extracted value to source text.
