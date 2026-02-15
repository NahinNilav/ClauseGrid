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
- `POST /api/projects/{project_id}/templates`
- `POST /api/templates/{template_id}/versions`
- `GET /api/projects/{project_id}/templates`
- `POST /api/projects/{project_id}/extraction-runs`
- `GET /api/projects/{project_id}/extraction-runs/{run_id}`
- `GET /api/projects/{project_id}/table-view`
- `POST /api/projects/{project_id}/review-decisions`
- `GET /api/projects/{project_id}/review-decisions`
- `POST /api/projects/{project_id}/ground-truth-sets`
- `POST /api/projects/{project_id}/evaluation-runs`
- `GET /api/projects/{project_id}/evaluation-runs/{eval_run_id}`
- `POST /api/projects/{project_id}/annotations`
- `GET /api/projects/{project_id}/annotations`
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
  - field_templates, field_template_versions
  - extraction_runs, field_extractions
  - review_decisions, annotations
  - ground_truth_sets, ground_truth_labels, evaluation_runs
  - request_tasks, audit_events

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

Gemini Configuration (optional provider)
- Required only when `LEGAL_LLM_PROVIDER=gemini`:
  - `GEMINI_API_KEY` (or `GOOGLE_API_KEY`)
- Optional model overrides:
  - `LEGAL_EXTRACTION_MODEL` (default: `gemini-3-pro-preview`)
  - `LEGAL_EXTRACTION_FAST_MODEL` (default: `gemini-3-flash-preview`)
  - `LEGAL_VERIFIER_MODEL` (default: value of `LEGAL_EXTRACTION_MODEL`)
