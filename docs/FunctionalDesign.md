# Functional Design

## 1. Functional Objective
Deliver a project-centric legal review workflow:
`upload -> parse -> configure fields -> extract -> review -> evaluate`

The implemented main feature uses backend `/api/*` workflow APIs and backend extraction modes (`hybrid`, `deterministic`, `llm_reasoning`).

Legacy frontend-direct Gemini extraction is explicitly not part of this main workflow.

## 2. User Roles and Interaction Model
- Primary actor: legal/compliance reviewer.
- Secondary actor: project owner configuring schemas and running evaluation.
- System actor: async background workers (parse, extraction, evaluation).

## 3. Frontend Workflows (As Implemented)
### 3.1 Project workflow
- Create project from sidebar (`POST /api/projects`).
- Select project to load context (`GET /api/projects/{id}`).
- Delete project (`DELETE /api/projects/{id}` with POST fallback alias).
- Update project status/name/description is API-supported (`PATCH /api/projects/{id}`), though no dedicated edit form is currently rendered in `App.tsx`.

### 3.2 Document ingestion workflow
- Upload one or more docs in Documents tab.
- Each file creates a parse task and returns `task_id`.
- Sidebar task panel tracks in-flight tasks via polling.
- Documents table shows latest version and parse status.

### 3.3 Template management workflow
- Create template with field list and policies.
- Create new immutable template version from draft fields.
- Select active template/version for review table.
- Template create/version actions can auto-trigger extraction tasks.

### 3.4 Extraction workflow
- Run extraction from Table tab with:
  - mode: `hybrid`, `deterministic`, `llm_reasoning`
  - quality profile: `high`, `balanced`, `fast`
- Poll task status until terminal.
- Refresh table to inspect extracted cells.

### 3.5 Table review workflow
- Table rows represent documents; columns represent template fields.
- Each cell exposes:
  - AI result payload
  - review overlay
  - effective value
  - baseline diff flag
- Reviewer can set status (`CONFIRMED`, `REJECTED`, `MANUAL_UPDATED`, `MISSING_DATA`), manual value, reviewer id, notes.
- Manual updates are stored as overlay; AI extraction remains intact for auditability.

### 3.6 Annotation workflow
- Annotation can be attached to current document-version + field.
- Annotation is non-destructive and does not modify AI value.
- Separate Annotations tab lists existing comments.

### 3.7 Evaluation workflow (AI vs human)
- User pastes JSON label list into Evaluation tab and saves ground truth set.
- User starts evaluation run for current extraction run.
- Task polling picks up completion and loads `metrics_json`.
- UI renders numeric metrics and qualitative mismatch notes.

### 3.8 Background status workflow
- Frontend polls each pending task every ~1.5s via `GET /api/tasks/{task_id}`.
- Terminal tasks are removed from pending list.
- Users can cancel individual tasks or cancel all pending project tasks.

## 4. Status and Lifecycle Behavior
### 4.1 Project lifecycle
- Created in `DRAFT`.
- Becomes `ACTIVE` when first document is created.
- Can be manually set to `ARCHIVED` via project update API.

### 4.2 Parse lifecycle
- Parse is async task-driven.
- `document_versions.parse_status` currently persisted as `COMPLETED` or `FAILED`.
- Parse failure still creates a failed document version with error message.

### 4.3 Extraction lifecycle
- Run starts `QUEUED` -> `RUNNING`.
- Completes as:
  - `COMPLETED` when all cells succeed
  - `PARTIAL` when mix of success/fallback
  - `FAILED` when all cells fail or worker failure
  - `CANCELED` on cancel path

### 4.4 Review lifecycle
- Review decisions are upserted per unique cell key.
- Status transitions are intentionally flexible between all 4 review statuses.
- `MANUAL_UPDATED` determines `effective_value` in table view.

### 4.5 Evaluation lifecycle
- Evaluation run: `QUEUED` -> `RUNNING` -> terminal (`COMPLETED`/`FAILED`/`CANCELED`).

## 5. Async, Error, and Regeneration Behavior
### Async behavior
- All heavy operations are represented as tasks:
  - parse, extraction, evaluation.
- Client tracks and reacts to task completion before refreshing context.

### Error behavior
- Workflow errors return structured Problem JSON.
- Unsupported uploads fail with `415`.
- Missing entities fail with `404`.
- Cell-level extraction uncertainty captured in:
  - `fallback_reason`
  - `verifier_status`
  - `uncertainty_reason`

### Regeneration behavior
- New template version triggers full re-extraction for project docs.
- New template (if parsed docs exist) triggers extraction.
- New document (if active template exists) triggers extraction.
- Manual rerun endpoint supports explicit regeneration.

## 6. Functional Coverage of Acceptance Scope (All 8 Areas)
| Scope Area | Functional Behavior |
| --- | --- |
| 1. Product & data model alignment | Full lifecycle from project through evaluation with explicit status enums and persistence |
| 2. Document ingestion & parsing | Multi-format upload, parser conversion, artifact + citations, parse task tracking |
| 3. Template/schema management | Field templates, versioning, validation and normalization policy payloads |
| 4. Field extraction workflow | Per-cell extraction with value/raw/normalized/confidence/citations and fallback semantics |
| 5. Tabular comparison & review | Table view alignment, review states, manual overlay auditability |
| 6. Quality evaluation | Ground truth ingestion and metric generation with qualitative notes |
| 7. Optional diff & annotation | Baseline `is_diff` flag and non-destructive annotation records |
| 8. Frontend experience | Tabbed workflows for projects, docs, templates, table, evaluation, annotations and task tracking |

## 7. Non-Goals and Explicit Exclusions
- No automated legal advice generation.
- No replacement of human legal judgment.
- Legacy client-side Gemini extraction path is not part of this functional baseline.
