Backend Service (FastAPI + SQLite)

Purpose
Implements legal tabular review workflows with persistent projects, versioned
templates, extraction runs, review overlays, evaluation runs, and async task
tracking.

Core Modules
- `app.py` - existing parser/render endpoints + router mount
- `legal_api.py` - `/api/*` workflow endpoints
- `legal_service.py` - business logic for lifecycle transitions
- `legal_db.py` - SQLite schema and data access
- `parsers/*` - PDF/HTML/DOCX/TXT parsing

Workflow API
- `POST /api/projects`
- `PATCH /api/projects/{project_id}`
- `GET /api/projects`
- `GET /api/projects/{project_id}`
- `DELETE /api/projects/{project_id}`
- `POST /api/projects/{project_id}/delete` (compatibility alias)
- `POST /api/projects/{project_id}/documents`
- `GET /api/projects/{project_id}/documents`
- `GET /api/document-versions/{document_version_id}/source`
- `POST /api/projects/{project_id}/templates`
- `POST /api/templates/{template_id}/versions`
- `GET /api/projects/{project_id}/templates`
- `POST /api/projects/{project_id}/extraction-runs`
- `GET /api/projects/{project_id}/extraction-runs/{run_id}`
- `GET /api/projects/{project_id}/table-view`
- `GET /api/projects/{project_id}/table-export.csv`
- `POST /api/projects/{project_id}/review-decisions`
- `GET /api/projects/{project_id}/review-decisions`
- `POST /api/projects/{project_id}/ground-truth-sets`
- `POST /api/projects/{project_id}/evaluation-runs`
- `GET /api/projects/{project_id}/evaluation-runs/{eval_run_id}`
- `POST /api/projects/{project_id}/annotations`
- `GET /api/projects/{project_id}/annotations`
- `PATCH /api/projects/{project_id}/annotations/{annotation_id}`
- `DELETE /api/projects/{project_id}/annotations/{annotation_id}`
- `GET /api/projects/{project_id}/tasks`
- `POST /api/projects/{project_id}/tasks/cancel-pending`
- `POST /api/tasks/{task_id}/cancel`
- `DELETE /api/tasks/{task_id}`
- `GET /api/tasks/{task_id}`

Legacy/Parser APIs
- `POST /convert`
- `POST /render-pdf-page`
- `POST /events`

Database
- SQLite file path: `backend/legal_review.db` (override with `LEGAL_REVIEW_DB`)
- Schema includes:
  - projects, documents, document_versions
  - document_version_sources (persisted uploaded source bytes per document version)
  - field_templates, field_template_versions
  - extraction_runs, field_extractions
  - review_decisions, annotations
  - ground_truth_sets, ground_truth_labels, evaluation_runs
  - request_tasks, audit_events

Parser Stability Configuration (Upload/Convert PDF safety)
- `LEGAL_PARSE_MAX_CONCURRENCY` (default: `1`, minimum: `1`)
  - Global process-wide parse slot count used by upload parse tasks and `/convert`.
  - Use `1` for maximum stability on macOS/pdfium workloads.
- `LEGAL_PDF_DOCLING_MODE` (default: `auto`)
  - `auto`: try Docling worker while healthy; auto-disable after fatal runtime signatures and continue with Pdfium fallback.
  - `enabled`: always attempt Docling worker (still falls back to Pdfium on failure).
  - `disabled`: skip Docling worker and use Pdfium fallback directly.

Task payload diagnostics (for `PARSE_DOCUMENT`) exposed by `GET /api/tasks/{task_id}`:
- `queue_wait_ms`
- `pdf_docling_mode_effective`
- `pdf_docling_disable_reason`

LLM Provider Configuration (Hybrid / LLM Modes)
- Install deps from `backend/requirements.txt` (includes `openai` and `google-genai`).
- `LEGAL_LLM_PROVIDER` controls the backend LLM provider:
  - `openai` (default)
  - `gemini`
- There is no automatic provider fallback. If the selected provider is unavailable, hybrid mode falls back to deterministic extraction.

OpenAI Configuration (default provider)
- Required for OpenAI LLM + embeddings:
  - `OPENAI_API_KEY`
- Optional model/effort overrides:
  - `OPENAI_EXTRACTION_MODEL_FAST` (default: `gpt-5-mini`)
  - `OPENAI_EXTRACTION_MODEL_PRO` (default: `gpt-5.2`)
  - `OPENAI_VERIFIER_MODEL` (default: `gpt-5-nano`)
  - `OPENAI_REASONING_EFFORT_FAST` (default: `medium`)
  - `OPENAI_REASONING_EFFORT_PRO` (default: `medium`)
  - `OPENAI_REASONING_EFFORT_VERIFIER` (default: `low`)
  - `OPENAI_EMBEDDING_MODEL` (default: `text-embedding-3-small`)

Relevant Segment Extraction (RSE) Configuration (hybrid/llm_reasoning retrieval)
- Retrieval rank fusion:
  - `LEGAL_RRF_K` (default: `60`) for Reciprocal Rank Fusion over dense + lexical + structure rank lists.
- `LEGAL_RSE_ENABLED` (default: `true`)
- `LEGAL_RSE_WINDOW_RADIUS` (default: `2`)  
  Builds context windows as `prev N + seed block + next N`.
- `LEGAL_RSE_MAX_SEGMENT_CHARS` (default: `12000`)
- `LEGAL_RSE_MAX_CITATIONS` (default: `32`)
- Candidate pool sizes before segment assembly:
  - `LEGAL_RSE_POOL_K_HIGH` (default: `80`)
  - `LEGAL_RSE_POOL_K_BALANCED` (default: `60`)
  - `LEGAL_RSE_POOL_K_FAST` (default: `40`)
  - Expanded retry pools on verifier fail:
    - `LEGAL_RSE_POOL_K_HIGH_EXPANDED` (default: `120`)
    - `LEGAL_RSE_POOL_K_BALANCED_EXPANDED` (default: `90`)
    - `LEGAL_RSE_POOL_K_FAST_EXPANDED` (default: `60`)
- Segment counts sent to extractor:
  - `LEGAL_RSE_TOP_SEGMENTS_HIGH` (default: `10`)
  - `LEGAL_RSE_TOP_SEGMENTS_BALANCED` (default: `8`)
  - `LEGAL_RSE_TOP_SEGMENTS_FAST` (default: `6`)
  - `LEGAL_RSE_TOP_SEGMENTS_EXPANDED` (default: `12`)

Gemini Configuration (optional provider)
- Required only when `LEGAL_LLM_PROVIDER=gemini`:
  - `GEMINI_API_KEY` (or `GOOGLE_API_KEY`)
- Optional model overrides:
  - `LEGAL_EXTRACTION_MODEL` (default: `gemini-3-pro-preview`)
  - `LEGAL_EXTRACTION_FAST_MODEL` (default: `gemini-3-flash-preview`)
  - `LEGAL_VERIFIER_MODEL` (default: value of `LEGAL_EXTRACTION_MODEL`)
