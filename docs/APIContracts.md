# API Contracts

Base URL: `/api`

## Project APIs

### `POST /projects`
Create project.

Request:
```json
{ "name": "Take-home Demo", "description": "optional" }
```

Response:
```json
{ "project": { "id": "prj_x", "name": "...", "status": "DRAFT" } }
```

### `PATCH /projects/{project_id}`
Update name/description/status.

### `GET /projects`
List projects.

### `GET /projects/{project_id}`
Project detail with documents and templates.

## Document APIs

### `POST /projects/{project_id}/documents`
Upload one document (`multipart/form-data`).
- Supported: PDF, DOCX, HTML/HTM, TXT/MD
- Starts async parse task.

Response:
```json
{ "document_id": "doc_x", "task_id": "tsk_x" }
```

### `GET /projects/{project_id}/documents`
List documents and their latest version/parse status.

## Template APIs

### `POST /projects/{project_id}/templates`
Create template + version `v1`.
- If documents exist, auto-triggers extraction.

### `POST /templates/{template_id}/versions`
Create immutable new template version and auto-trigger extraction.

### `GET /projects/{project_id}/templates`
List templates and versions.

## Extraction APIs

### `POST /projects/{project_id}/extraction-runs`
Create extraction run.

Request:
```json
{ "template_version_id": "tpv_x" }
```

Response:
```json
{ "run_id": "run_x", "task_id": "tsk_x" }
```

### `GET /projects/{project_id}/extraction-runs/{run_id}`
Run status + immutable extraction records.

### `GET /projects/{project_id}/table-view?template_version_id=...&baseline_document_id=...`
Field-aligned table for side-by-side comparison.

Response cells include:
- `ai_result`
- `review_overlay`
- `effective_value`
- `is_diff`

## Review APIs

### `POST /projects/{project_id}/review-decisions`
Upsert audit overlay with required states:
- `CONFIRMED`
- `REJECTED`
- `MANUAL_UPDATED`
- `MISSING_DATA`

### `GET /projects/{project_id}/review-decisions`
List review decisions (optionally filter by `template_version_id`).

## Evaluation APIs

### `POST /projects/{project_id}/ground-truth-sets`
Create human-labeled ground-truth set.

### `POST /projects/{project_id}/evaluation-runs`
Start async evaluation run.

Request:
```json
{ "ground_truth_set_id": "gts_x", "extraction_run_id": "run_x" }
```

### `GET /projects/{project_id}/evaluation-runs/{eval_run_id}`
Return metrics + qualitative notes.

## Annotation APIs (Optional Layer)

### `POST /projects/{project_id}/annotations`
Create non-destructive annotation.

### `GET /projects/{project_id}/annotations`
List annotations (optional `template_version_id` filter).

## Task API

### `GET /tasks/{task_id}`
Get async task status/progress/payload.

## Error Format (Problem Details)
Errors use:
```json
{
  "type": "about:blank",
  "title": "Error Title",
  "status": 400,
  "detail": "Human-readable detail",
  "instance": "/api/..."
}
```
