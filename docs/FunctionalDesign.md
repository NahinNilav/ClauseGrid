# Functional Design

## Scope Coverage
This design explicitly covers all 8 required scope areas from `docs/REQUIREMENTS.md`:
1. Product/data-model alignment
2. Document ingestion/parsing
3. Field template/version management
4. Field extraction contract
5. Tabular comparison/review
6. Quality evaluation
7. Optional diff/annotation
8. Frontend workflow coverage

## User Workflows

### 1. Create/Update Project
- User creates project from Projects sidebar
- Optional updates to name/description/status via project API

### 2. Upload and Parse Documents
- User uploads one or more files (PDF/DOCX/HTML/TXT)
- Backend creates parse task and document version
- Parse status tracked by `/api/tasks/{task_id}`

### 3. Configure Field Templates
- User creates template with field definitions
- Fields are persisted as template version `v1`
- Any update creates immutable new version and sets it active

### 4. Run Extraction
- Extraction can be auto-triggered (document/template events) or manual
- Run status and progress are available in extraction runs + task status

### 5. Review and Audit
- User reviews each cell with required states:
  - `CONFIRMED`
  - `REJECTED`
  - `MANUAL_UPDATED`
  - `MISSING_DATA`
- Manual edits never mutate AI records; they are stored in overlay table

### 6. Evaluate Quality
- User uploads ground-truth labels
- User starts evaluation run against chosen extraction run
- System reports numeric metrics + qualitative mismatch notes

### 7. Optional Diff and Annotation
- Baseline document can be selected in table view
- Cell-level `is_diff` computed against baseline effective values
- Reviewer can add non-destructive annotations tied to doc + field

## Extraction Contract
Each extracted field record includes:
- `raw_text`
- `value`
- `normalized_value`
- `normalization_valid`
- `confidence_score`
- `citations[]` with stable source location
- `evidence_summary`
- `fallback_reason` when unresolved

## Fallback Behavior
- Missing evidence: `fallback_reason=NOT_FOUND`
- Ambiguous evidence: `fallback_reason=AMBIGUOUS`
- Parser failure: `fallback_reason=PARSER_ERROR`
- Model failure (reserved): `fallback_reason=MODEL_ERROR`

## Async and Error Handling
- Long-running operations are task-backed (`PARSE_DOCUMENT`, `EXTRACTION_RUN`, `EVALUATION_RUN`)
- Task status transition: `QUEUED -> RUNNING -> SUCCEEDED|FAILED`
- Errors use problem-details response shape

## Regeneration Logic
- Re-uploading a document creates a new document version
- Table always uses latest document versions per project
- New template versions trigger fresh extraction runs on latest versions
