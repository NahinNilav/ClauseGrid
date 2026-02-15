# API Contracts

## 1. Contract Conventions
- Workflow base URL: `/api`.
- Supporting parser/viewer endpoints: `/convert`, `/render-pdf-page`, `/events`.
- Success payloads are JSON objects.
- Error payloads for workflow endpoints use Problem-style JSON:
  - `type`, `title`, `status`, `detail`, `instance`
- Common HTTP errors:
  - `400` invalid request
  - `404` missing project/template/run/task
  - `409` task deletion blocked while active
  - `415` unsupported file format

## 2. Endpoint-to-Entity Mapping (Full)
| Endpoint | Sync/Async | Primary Entities | Notes |
| --- | --- | --- | --- |
| `POST /api/projects` | Sync | `projects`, `audit_events` | Creates project in `DRAFT` |
| `PATCH /api/projects/{project_id}` | Sync | `projects`, `audit_events` | Updates name/description/status |
| `GET /api/projects` | Sync | `projects` | Lists projects |
| `GET /api/projects/{project_id}` | Sync | `projects`, `documents`, `document_versions`, `field_templates`, `field_template_versions` | Project context snapshot |
| `DELETE /api/projects/{project_id}` | Sync | `projects` (+ cascade), `request_tasks` cancel best effort | Deletes project graph |
| `POST /api/projects/{project_id}/delete` | Sync | same as delete | Compatibility alias |
| `POST /api/projects/{project_id}/documents` | Async | `documents`, `request_tasks` | Creates parse task; parse task creates `document_versions`; may trigger extraction task/run |
| `GET /api/projects/{project_id}/documents` | Sync | `documents`, `document_versions` | Latest document versions |
| `GET /api/document-versions/{document_version_id}/source` | Sync | `document_version_sources` | Returns persisted original source bytes as base64 when available |
| `POST /api/projects/{project_id}/templates` | Mixed | `field_templates`, `field_template_versions`; optional `extraction_runs`, `request_tasks` | Creates template + v1; triggers extraction when parsed docs exist |
| `POST /api/templates/{template_id}/versions` | Async | `field_template_versions`, `field_templates`, `extraction_runs`, `request_tasks` | Creates new version and triggers extraction |
| `GET /api/projects/{project_id}/templates` | Sync | `field_templates`, `field_template_versions` | Lists templates with versions |
| `POST /api/projects/{project_id}/extraction-runs` | Async | `extraction_runs`, `request_tasks` | Manual extraction trigger |
| `GET /api/projects/{project_id}/extraction-runs/{run_id}` | Sync | `extraction_runs`, `field_extractions` | Run and per-cell results |
| `GET /api/projects/{project_id}/extraction-runs/{run_id}/diagnostics` | Sync | `extraction_runs`, `field_extractions` | Aggregated diagnostics |
| `GET /api/projects/{project_id}/table-view` | Sync | reads `document_versions`, `field_extractions`, `review_decisions` | Returns aligned review table |
| `GET /api/projects/{project_id}/table-export.csv` | Sync | reads table-view projection | Exports comparison table as CSV (`value_mode=effective|ai`) |
| `POST /api/projects/{project_id}/review-decisions` | Sync | `review_decisions`, `audit_events` | Upsert review state per cell |
| `GET /api/projects/{project_id}/review-decisions` | Sync | `review_decisions` | List review overlays |
| `POST /api/projects/{project_id}/ground-truth-sets` | Sync | `ground_truth_sets`, `ground_truth_labels`, `audit_events` | Creates reference labels |
| `POST /api/projects/{project_id}/evaluation-runs` | Async | `evaluation_runs`, `request_tasks` | Starts evaluation worker |
| `GET /api/projects/{project_id}/evaluation-runs/{eval_run_id}` | Sync | `evaluation_runs` | Returns metrics and notes |
| `POST /api/projects/{project_id}/annotations` | Sync | `annotations`, `audit_events` | Adds non-destructive note |
| `GET /api/projects/{project_id}/annotations` | Sync | `annotations` | Lists annotations |
| `PATCH /api/projects/{project_id}/annotations/{annotation_id}` | Sync | `annotations`, `audit_events` | Edits annotation body/approval/resolution |
| `DELETE /api/projects/{project_id}/annotations/{annotation_id}` | Sync | `annotations`, `audit_events` | Deletes annotation |
| `GET /api/projects/{project_id}/tasks` | Sync | `request_tasks` | Task list/filter for status tracking |
| `POST /api/tasks/{task_id}/cancel` | Sync | `request_tasks`; may update `extraction_runs`/`evaluation_runs` | Cancel one task; optional purge |
| `POST /api/projects/{project_id}/tasks/cancel-pending` | Sync | `request_tasks` (+ optional delete) | Bulk cancel active project tasks |
| `DELETE /api/tasks/{task_id}` | Sync | `request_tasks`, `audit_events` | Delete task (blocked if active unless forced) |
| `GET /api/tasks/{task_id}` | Sync | `request_tasks` | Polling endpoint |
| `POST /convert` | Sync | none (stateless parse) | File -> artifact payload |
| `POST /render-pdf-page` | Sync | none (stateless render) | Renders cited page image + anchored bbox diagnostics |
| `POST /events` | Sync | server logs only | Client runtime event ingestion |

## 3. Core Request/Response Contracts
### 3.1 Create/Update Project
`POST /api/projects`
```json
{
  "name": "Take-home Demo",
  "description": "Workflow validation"
}
```
Response:
```json
{
  "project": {
    "id": "prj_x",
    "name": "Take-home Demo",
    "description": "Workflow validation",
    "status": "DRAFT",
    "created_at": "ISO-8601",
    "updated_at": "ISO-8601"
  }
}
```

`PATCH /api/projects/{project_id}` accepts partial `name`, `description`, `status`.

### 3.2 Upload Document (Async Parse)
`POST /api/projects/{project_id}/documents` (multipart file)  
Response:
```json
{
  "document_id": "doc_x",
  "task_id": "tsk_x"
}
```
- Poll task via `GET /api/tasks/{task_id}`.
- Parse task success creates `document_versions` with `artifact_json`.
- If active template exists, parse flow creates extraction run/task.

### 3.3 Template and Template Version
`POST /api/projects/{project_id}/templates`
```json
{
  "name": "Contract Essentials",
  "fields": [
    {
      "key": "effective_date",
      "name": "Effective Date",
      "type": "date",
      "prompt": "Extract the effective date.",
      "required": true
    }
  ],
  "validation_policy": {
    "required_fields": ["effective_date"]
  },
  "normalization_policy": {
    "date_format": "ISO-8601"
  }
}
```
Response includes:
- `template`
- `template_version`
- optional `triggered_extraction_task_id`

`POST /api/templates/{template_id}/versions` returns:
- `template_version`
- `triggered_extraction_task_id`

### 3.4 Start Extraction Run (Async)
`POST /api/projects/{project_id}/extraction-runs`
```json
{
  "template_version_id": "tpv_x",
  "mode": "hybrid",
  "quality_profile": "high"
}
```
Response:
```json
{
  "run_id": "run_x",
  "task_id": "tsk_x"
}
```

Run result endpoint:
- `GET /api/projects/{project_id}/extraction-runs/{run_id}` -> `{ run, results[] }`

Each `results[]` cell includes:
- value/raw/normalized/normalization_valid
- confidence
- citations
- extraction method and model metadata
- verifier/fallback/uncertainty diagnostics

### 3.5 Table Review Contract
`GET /api/projects/{project_id}/table-view?template_version_id=tpv_x&baseline_document_id=doc_x`

Response structure:
- `columns[]` from template fields
- `rows[]` by latest document version
- each cell:
  - `ai_result`
  - `review_overlay`
  - `effective_value`
  - `is_diff`
  - `baseline_value`
  - `current_value`
  - `compare_mode`
  - `annotation_count`
 - each row also includes:
   - `document_version_id`
   - `source_available` (whether original source bytes can be fetched for structured viewers)

CSV export:
- `GET /api/projects/{project_id}/table-export.csv?template_version_id=tpv_x&baseline_document_id=doc_x&value_mode=effective|ai`
- Includes: document/version identifiers, field key/name, exported value, effective/AI values, review status, confidence, citations JSON, diff metadata, annotation count.

### 3.6 Review Decision Contract
`POST /api/projects/{project_id}/review-decisions`
```json
{
  "document_version_id": "dv_x",
  "template_version_id": "tpv_x",
  "field_key": "effective_date",
  "status": "MANUAL_UPDATED",
  "manual_value": "2014-10-01",
  "reviewer": "analyst@demo.local",
  "notes": "Manual correction"
}
```
`status` must be one of:
- `CONFIRMED`
- `REJECTED`
- `MANUAL_UPDATED`
- `MISSING_DATA`

### 3.7 Ground Truth and Evaluation (Async)
`POST /api/projects/{project_id}/ground-truth-sets`
```json
{
  "name": "Demo GT",
  "format": "json",
  "labels": [
    {
      "document_version_id": "dv_x",
      "field_key": "effective_date",
      "expected_value": "2014-10-01",
      "expected_normalized_value": "2014-10-01",
      "notes": "Reference value"
    }
  ]
}
```

`POST /api/projects/{project_id}/evaluation-runs`
```json
{
  "ground_truth_set_id": "gts_x",
  "extraction_run_id": "run_x"
}
```
Response:
```json
{
  "evaluation_run_id": "evr_x",
  "task_id": "tsk_x"
}
```

Evaluation result metrics in `evaluation_run.metrics_json`:
- `field_level_accuracy`
- `coverage`
- `normalization_validity`
- `precision`, `recall`, `f1`
- `qualitative_notes`

### 3.8 Annotation Contract
`POST /api/projects/{project_id}/annotations`
```json
{
  "document_version_id": "dv_x",
  "template_version_id": "tpv_x",
  "field_key": "effective_date",
  "body": "Check this against exhibit",
  "author": "analyst@demo.local",
  "approved": false
}
```

`PATCH /api/projects/{project_id}/annotations/{annotation_id}`
```json
{
  "body": "Reviewed and approved",
  "approved": true,
  "resolved": true
}
```

`DELETE /api/projects/{project_id}/annotations/{annotation_id}`
- Returns `{ "annotation_id": "...", "deleted": true }` when deleted.

### 3.9 PDF Render Anchor Contract
`POST /render-pdf-page` (multipart):
- required:
  - `file`
  - `page`
- optional:
  - `snippet`
  - `snippet_candidates_json` (JSON array of probe strings)
  - `citation_start_char`
  - `citation_end_char`
  - `citation_bbox_json` (JSON bbox array)

Response includes:
- `page`, `page_count`, `page_width`, `page_height`
- `image_width`, `image_height`, `image_base64`
- `matched_bbox`
- `match_mode`: `exact | fuzzy | char_range | none`
- `match_confidence`: `0..1`
- `used_snippet`: matched probe when snippet matching succeeds
- `bbox_source`: `matched_snippet | citation_bbox | none`
- `warning_code`: optional fallback reason

Contract notes:
- If snippet overlap is below threshold, response uses `match_mode=none` and `matched_bbox=null` unless explicit bbox fallback is provided.
- Consumers should treat low-confidence (`<0.55`) anchors as no-box fallback for review safety.

## 4. Async, Cancellation, and Regeneration Contracts
### Async lifecycle
- Worker-backed endpoints return `task_id`.
- Task terminal states: `SUCCEEDED`, `FAILED`, `CANCELED`.
- Frontend polls `GET /api/tasks/{task_id}`.

### Cancellation
- `POST /api/tasks/{task_id}/cancel` optionally accepts:
  - `reason`
  - `purge=true` (delete canceled task record when possible)
- `POST /api/projects/{project_id}/tasks/cancel-pending` cancels all active tasks for project; optional purge.

### Regeneration triggers
- Document upload with active template -> extraction run (`DOCUMENT_ADDED`).
- Template creation with existing parsed docs -> extraction run (`TEMPLATE_CREATED`).
- Template version creation -> extraction run (`TEMPLATE_VERSION_UPDATED`).
- Manual re-run endpoint -> extraction run (`MANUAL_TRIGGER`).

## 5. Error Handling and Missing Data Behavior
- Parse and extraction are resilient to partial failures:
  - extraction run may end as `PARTIAL`
  - per-cell fallback reasons identify missing/ambiguous/model issues
- Review workflow allows explicit unresolved state (`MISSING_DATA`) independent of AI fallback.
- Task deletion safety:
  - active task deletion blocked unless `force=true` (and then canceled first).

## 6. Scope Coverage (All 8 Areas)
| Scope Area | API Contract Coverage |
| --- | --- |
| 1. Product/data alignment | CRUD + lifecycle endpoints across project/document/template/extraction/review/eval entities |
| 2. Ingestion/parsing | document upload + parser endpoints + parse task status |
| 3. Template/schema management | template create/version/list endpoints with policy payloads |
| 4. Field extraction workflow | extraction run create/get/diagnostics contracts |
| 5. Tabular review | table-view + review decision endpoints |
| 6. Quality evaluation | ground-truth + evaluation run endpoints and metric schema |
| 7. Diff/annotation | baseline diff parameter + annotation create/list endpoints |
| 8. Frontend workflow support | task polling/cancel APIs and table/evaluation data shapes |
