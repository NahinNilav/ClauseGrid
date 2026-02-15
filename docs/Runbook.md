# Runbook

## 1. Purpose
Operational guide for running, monitoring, and troubleshooting the implemented Legal Tabular Review workflow.

Main operational path:
- Backend `/api/*` workflow APIs.
- Backend extraction modes (`hybrid`, `deterministic`) as default production behavior.

Legacy frontend-direct Gemini workflow is out of main operations scope.

## 2. Environment and Startup
### Backend
From repository root:
```bash
cd backend
./venv/bin/python app.py
```

Optional environment variables:
- `LEGAL_REVIEW_DB` (SQLite path override)
- `LEGAL_LLM_PROVIDER` (`openai` default, or `gemini`)
- Parser stability:
  - `LEGAL_PARSE_MAX_CONCURRENCY` (default `1`, minimum `1`)
    - Global parse slot count used by upload parse tasks and `/convert`.
  - `LEGAL_PDF_DOCLING_MODE` (`auto` default)
    - `auto`: attempt Docling worker while healthy, auto-disable after fatal runtime signatures, continue with Pdfium fallback.
    - `enabled`: always attempt Docling worker (still falls back if worker fails).
    - `disabled`: skip Docling worker and use Pdfium fallback directly.
- OpenAI (default provider):
  - `OPENAI_API_KEY`
  - `OPENAI_EXTRACTION_MODEL_FAST` (default `gpt-5-mini`)
  - `OPENAI_EXTRACTION_MODEL_PRO` (default `gpt-5.2`)
  - `OPENAI_VERIFIER_MODEL` (default `gpt-5-nano`)
  - `OPENAI_REASONING_EFFORT_FAST` (default `medium`)
  - `OPENAI_REASONING_EFFORT_PRO` (default `medium`)
  - `OPENAI_REASONING_EFFORT_VERIFIER` (default `low`)
  - `OPENAI_EMBEDDING_MODEL` (default `text-embedding-3-small`)
- Gemini (optional provider when `LEGAL_LLM_PROVIDER=gemini`):
  - `GEMINI_API_KEY` or `GOOGLE_API_KEY`
  - `LEGAL_EXTRACTION_MODEL`
  - `LEGAL_EXTRACTION_FAST_MODEL`
  - `LEGAL_VERIFIER_MODEL`

### Frontend
```bash
cd frontend
npm install
npm run dev
```

Default frontend API target:
- `VITE_API_URL` fallback is `http://localhost:8000`

## 3. Standard Operating Flow
1. Create project.
2. Upload documents (PDF/DOCX/HTML/TXT).
3. Wait for parse task completion.
4. Create template or template version.
5. Wait for auto-triggered extraction (or run extraction manually).
   - Default extraction quality profile is `fast`.
6. Open table view and complete review decisions.
7. Add optional annotations.
8. Create ground truth and run evaluation.
9. Review evaluation metrics and diagnostics.
10. Export current table view as CSV when needed for external review packets.

## 4. Async Task Monitoring
### Task types
- `PARSE_DOCUMENT`
- `EXTRACTION_RUN`
- `EVALUATION_RUN`

### Task statuses
- Active: `QUEUED`, `RUNNING`
- Terminal: `SUCCEEDED`, `FAILED`, `CANCELED`

### API checks
- Single task: `GET /api/tasks/{task_id}`
- Project tasks: `GET /api/projects/{project_id}/tasks`

`PARSE_DOCUMENT` payload diagnostics may include:
- `queue_wait_ms`
- `pdf_docling_mode_effective`
- `pdf_docling_disable_reason`

### Frontend behavior
- Polls pending tasks every ~1.5 seconds.
- On terminal status:
  - removes task from pending list
  - refreshes project/table/evaluation context

## 5. Regeneration Rules (Re-extraction)
Automatic regeneration triggers:
- Document upload with active template -> extraction run (`DOCUMENT_ADDED`).
- Template creation with existing parsed docs -> extraction run (`TEMPLATE_CREATED`).
- Template version creation -> extraction run (`TEMPLATE_VERSION_UPDATED`).

Manual regeneration:
- `POST /api/projects/{project_id}/extraction-runs`

Operational expectation:
- Regenerated run creates new `field_extractions` rows for latest document versions and selected template version.

## 6. Cancellation and Recovery
### Cancel a single task
- `POST /api/tasks/{task_id}/cancel?reason=...`
- Optional `purge=true` removes canceled task record where allowed.

### Cancel all pending tasks in a project
- `POST /api/projects/{project_id}/tasks/cancel-pending?purge=true`

### Recovery after cancel/failure
1. Confirm task is terminal.
2. Inspect run/evaluation status and error message.
3. Fix root cause (template, file issue, model availability, etc.).
4. Trigger manual extraction/evaluation rerun.

## 7. Error Handling Playbook
### Common API errors
- `400 Invalid Upload/Request`:
  - Empty file, invalid params, missing active template for run creation.
- `404 Not Found`:
  - Missing project/template/run/task IDs.
- `415 Unsupported Media Type`:
  - File format not recognized by MIME router.
- `409 Task Deletion Blocked`:
  - Attempted delete of active task without force/cancel path.

### Cell-level extraction uncertainty
Inspect fields:
- `fallback_reason`
- `verifier_status`
- `uncertainty_reason`
- `confidence_score`

Use diagnostics endpoint for run-wide patterns:
- `GET /api/projects/{project_id}/extraction-runs/{run_id}/diagnostics`

### PDF highlight reliability policy
- Precision-first policy for PDF visual anchors:
  - do not render bbox when anchor confidence is weak.
  - show cited page with warning metadata instead.
- Runtime anchor thresholds:
  - `match_confidence >= 0.55` required for drawing bbox.
  - bbox area ratio must be within `[0.0001, 0.35]` of page area.
- Coordinate normalization:
  - bbox coordinates are canonicalized to `[x_min, y_min, x_max, y_max]` at parse/read time.
- Highlight diagnostics available from `/render-pdf-page`:
  - `match_mode`, `match_confidence`, `bbox_source`, `warning_code`.

### Upload crash troubleshooting (macOS/pdfium native aborts)
- If uploads crash with native errors (`Abort trap`, `Pure virtual function called`), verify:
  - `LEGAL_PARSE_MAX_CONCURRENCY=1`
  - `LEGAL_PDF_DOCLING_MODE=auto` (or `disabled` for maximum stability)
- Confirm parse-task diagnostics in `GET /api/tasks/{task_id}`:
  - high `queue_wait_ms` confirms queueing is active
  - `pdf_docling_mode_effective=auto_disabled` indicates runtime circuit breaker engaged
- Restart backend to reset process-local Docling auto-disable state.

## 8. Review and Audit Operations
### Review overlay policy
- AI extraction rows remain immutable.
- Human edits are stored in `review_decisions`.
- `MANUAL_UPDATED` sets effective value for table display.

### Annotation policy
- Annotations are non-destructive.
- Comments do not mutate extraction values.
- Annotation lifecycle supports edit/approve/resolve/delete without touching extraction rows.

### Audit events
- Critical lifecycle events are logged in `audit_events`.

## 9. Data Operations
### Backups
- Backup SQLite file before major demos or migrations.

### Reset (local development only)
- Stop backend and remove/reset DB file referenced by `LEGAL_REVIEW_DB`.
- Restart backend to recreate schema.

## 10. Frontend Workflow Operations
Supported UX workflows:
- Create/select/update/delete project.
- Upload documents and track parse/extraction/evaluation background statuses.
- Configure template fields and versioning.
- Review table output, apply statuses, and manual updates.
- Compare AI vs human via Evaluation tab metrics.
- Add/list/edit/approve/resolve/delete annotations.

## 11. Scope Coverage Checklist (All 8 Areas)
| Scope Area | Runbook Guidance |
| --- | --- |
| 1. Product/data model alignment | Operational flow follows persisted lifecycle entities |
| 2. Ingestion/parsing | Upload/run/monitor parse guidance |
| 3. Template/schema management | Template creation/versioning and rerun behavior |
| 4. Field extraction workflow | Mode selection, diagnostics, cell uncertainty handling |
| 5. Tabular review | Review status handling and audit overlay behavior |
| 6. Quality evaluation | Ground truth + evaluation run operations |
| 7. Diff/annotation | Baseline comparison + annotation non-destructive handling |
| 8. Frontend UX | End-user tab and task tracking procedures |
