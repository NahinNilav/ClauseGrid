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

Gemini Configuration (Hybrid / LLM Modes)
- Install deps from `backend/requirements.txt` (includes `google-genai`).
- Set `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) for backend LLM extraction.
- Optional model overrides:
  - `LEGAL_EXTRACTION_MODEL` (default: `gemini-3-pro-preview`)
  - `LEGAL_EXTRACTION_FAST_MODEL` (default: `gemini-3-flash-preview`)
  - `LEGAL_VERIFIER_MODEL` (default: value of `LEGAL_EXTRACTION_MODEL`)
