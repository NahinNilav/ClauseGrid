# Architecture Design

## 1. Purpose and Scope
This document describes the implemented architecture for the Legal Tabular Review system.

Primary production path:
- Frontend React workspace calling backend `/api/*` workflow endpoints.
- Backend extraction pipeline running in `hybrid` and `deterministic` modes.

Explicitly out of main scope:
- Legacy frontend-direct Gemini extraction path in `frontend/services/geminiService.ts`.
- That legacy path is kept in the repo but is not part of the accepted end-to-end workflow.

## 2. System Boundaries
### Frontend
- Single-page React app (`frontend/App.tsx`) with tabs for `documents`, `templates`, `table`, `evaluation`, `annotations`.
- Uses `frontend/services/legalReviewApi.ts` as the only workflow API client.
- Polls `/api/tasks/{task_id}` to track background processing.

### Backend
- FastAPI application (`backend/app.py`) with router mount for `/api/*` (`backend/legal_api.py`).
- Service layer (`backend/legal_service.py`) implements project/document/template/extraction/review/evaluation logic.
- Parser layer (`backend/parsers/*`) supports PDF, DOCX, HTML, TXT ingestion.
- SQLite persistence (`backend/legal_db.py`).

### Storage
- SQLite DB file: `backend/legal_review.db` by default (`LEGAL_REVIEW_DB` override supported).
- Core persistent entities:
  - projects, documents, document_versions
  - field_templates, field_template_versions
  - extraction_runs, field_extractions
  - review_decisions, annotations
  - ground_truth_sets, ground_truth_labels, evaluation_runs
  - request_tasks, audit_events

## 3. End-to-End Data Flow
1. Project creation:
   - `POST /api/projects` creates a project in `DRAFT`.
2. Document ingestion:
   - `POST /api/projects/{project_id}/documents` creates a document record and async parse task.
   - Parse task converts file to artifact (markdown + blocks + citations + metadata) and creates a `document_version`.
3. Template configuration:
   - `POST /api/projects/{project_id}/templates` creates template + initial template version.
   - `POST /api/templates/{template_id}/versions` adds immutable template versions.
4. Extraction:
   - Runs created by document addition, template creation/update, or manual trigger.
   - `run_extraction` produces one `field_extractions` row per `(document_version, field)` cell.
5. Review:
   - `POST /api/projects/{project_id}/review-decisions` overlays human decision/manual value without deleting AI output.
6. Table comparison:
   - `GET /api/projects/{project_id}/table-view` aligns extracted cells across docs and computes baseline diffs.
7. Evaluation:
   - Ground truth set + evaluation run compare extracted outputs to labeled references and persist metrics.

## 4. Extraction Architecture
### Deterministic mode
- Keyword-driven block selection.
- Typed normalization (`date`, `number`, `boolean`, `list`, `text`).
- Citation carry-through from selected block.
- No LLM dependency.

### Hybrid mode (default)
- Retrieval over parsed artifact blocks.
- LLM extraction + verifier pass (when Gemini client is available).
- Signal-combined confidence scoring.
- Automatic fallback to deterministic mode if LLM path fails.

### LLM reasoning mode
- Retrieval + LLM extraction without deterministic fallback guarantees.
- Returns `MODEL_ERROR` fallback payload if LLM fails.

## 5. Async Model and Task Tracking
- Async workflows create `request_tasks` records and execute background jobs:
  - `PARSE_DOCUMENT`
  - `EXTRACTION_RUN`
  - `EVALUATION_RUN`
- Frontend polls task status (`QUEUED`, `RUNNING`, terminal states) and refreshes context when tasks complete.
- Task cancellation APIs can cancel individual tasks or all pending project tasks.

## 6. Regeneration Behavior
- Template creation triggers extraction when parsed documents already exist (`trigger_reason=TEMPLATE_CREATED`).
- Template version creation always triggers extraction (`trigger_reason=TEMPLATE_VERSION_UPDATED`).
- Document upload triggers extraction if an active template version exists (`trigger_reason=DOCUMENT_ADDED`).
- Manual extraction endpoint triggers on demand (`trigger_reason=MANUAL_TRIGGER`).

## 7. Error and Fallback Behavior
- Unsupported uploads: `415`.
- Empty uploads: `400`.
- Missing entities: `404` Problem JSON.
- Extraction uncertainty captured per cell:
  - `fallback_reason`: `NOT_FOUND`, `AMBIGUOUS`, `PARSER_ERROR`, `MODEL_ERROR`.
  - `verifier_status`: `PASS`, `PARTIAL`, `FAIL`, `SKIPPED`.
  - `uncertainty_reason` with operator-facing detail.

## 8. Scope Coverage Matrix (All 8 Areas)
| Scope Area | Implemented In | Architectural Outcome |
| --- | --- | --- |
| 1. Product & data model alignment | `legal_service.py`, `legal_db.py`, `/api/*` | Project/document/template/extraction/review/eval lifecycle persisted with auditable overlays |
| 2. Document ingestion & parsing | `/api/projects/{id}/documents`, `parsers/*`, `mime_router.py` | Multi-format parsing with structural blocks, citations, metadata |
| 3. Field template/schema management | template endpoints + version tables | Versioned field schema with validation/normalization policies |
| 4. Field extraction workflow | extraction run endpoints + service extraction methods | Per-cell output includes value/raw/normalized/confidence/citations/fallback diagnostics |
| 5. Tabular comparison & review | `/table-view`, review decision endpoints | Aligned table with AI result + human overlay + effective value + diff flag |
| 6. Quality evaluation | ground truth + evaluation run endpoints | Persisted metrics and qualitative mismatch notes |
| 7. Optional diff & annotation layer | `is_diff` in table view + annotation endpoints | Non-destructive annotation and baseline comparison |
| 8. Frontend experience | `frontend/App.tsx` tabs + task polling | Project-centric UX for ingestion, schema, review, tracking, and evaluation |
