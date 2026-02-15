# Testing and Evaluation

## 1. Testing Strategy
Testing is split across:
- API/workflow integration tests.
- Parser acceptance tests for conversion and citations.
- Manual UI workflow validation for review and task tracking.
- Quantitative extraction evaluation against human labels.

## 2. Automated Test Coverage in Repository
### 2.1 Workflow integration
File: `backend/tests/test_legal_api_workflow.py`

Covers:
- Project creation and retrieval.
- Template creation/version behavior.
- Document upload + async parse completion.
- Table view generation and extraction results presence.
- Extraction diagnostics endpoint.
- Review decision upsert and persistence.
- Annotation create/list.
- Ground truth create + async evaluation run.
- Task cancel/delete endpoints.
- Project delete and compatibility delete endpoint.

### 2.2 Parser acceptance
File: `backend/tests/test_convert_acceptance.py`

Covers:
- HTML conversion returns artifact with chunks and selector-based citations.
- PDF conversion returns artifact with chunks, page-index metadata, page citations.
- PDF render endpoint returns image payload and dimensions.

## 3. Acceptance Criteria Mapping
| Acceptance Area | Validation Method | Current Coverage |
| --- | --- | --- |
| Documentation completeness | Design docs set in `docs/` | Covered by this doc set |
| Functional accuracy (`upload->parse->configure->extract->review->evaluate`) | Workflow integration test + manual UI pass | Covered |
| Field payload completeness (value/citations/confidence/normalization) | Extraction result assertions + table review inspection | Covered |
| Template update re-extraction | Template version API behavior + task triggers | Covered |
| Review/auditability | Review decision upsert behavior and table overlay | Covered |
| Quality evaluation output | Evaluation run metrics JSON | Covered |
| Async/status/error/regeneration description | Task APIs + runbook validation | Covered |
| Frontend UX workflows | Manual UI checklist | Covered manually |

## 4. Extraction Evaluation Method
Implemented in `LegalReviewService.run_evaluation`.

Inputs:
- Ground truth labels keyed by `(document_version_id, field_key)`.
- Extraction run outputs keyed by same pair.

Computed metrics:
- `field_level_accuracy = matched_labels / total_labels`
- `coverage = labeled cells with non-empty extracted value / total_labels`
- `normalization_validity = normalization_valid cells / covered cells`
- `precision = matched_labels / covered`
- `recall = matched_labels / total_labels`
- `f1 = harmonic_mean(precision, recall)`
- `qualitative_notes = sampled mismatch summaries`

Output:
- Persisted to `evaluation_runs.metrics_json`.
- Exposed by `GET /api/projects/{project_id}/evaluation-runs/{eval_run_id}`.

## 5. Manual QA Checklist
Run this checklist against sample documents in `data/`:
1. Create a project and confirm `DRAFT` state appears.
2. Upload at least one PDF and one HTML/TXT; verify parse tasks reach terminal status.
3. Confirm document table shows latest version and parse status.
4. Create template and verify extraction task triggers when docs are present.
5. Open table view and confirm each cell has AI result payload:
   - `value`
   - `citations_json`
   - `confidence_score`
   - `normalized_value` + `normalization_valid`
6. Change extraction mode (`hybrid` and `deterministic`) and run again.
7. Apply `MANUAL_UPDATED` and `MISSING_DATA` review statuses and verify effective value behavior.
8. Add annotation and verify it appears in Annotations tab.
9. Create ground truth and run evaluation; verify metrics render in Evaluation tab.
10. Cancel an in-flight task and confirm `CANCELED` status behavior.

## 6. Diagnostic and Regression Checks
Use extraction diagnostics endpoint:
- `GET /api/projects/{project_id}/extraction-runs/{run_id}/diagnostics`

Inspect:
- `method_breakdown`
- `fallback_breakdown`
- `avg_confidence`
- verifier failure/partial counts

Regression signals:
- sudden increase in `fallback_cells`
- drop in `coverage` or `field_level_accuracy`
- spike in low-confidence cells (`confidence < 0.55`)

## 7. Scope Area Coverage (All 8)
| Scope Area | Testing/Evaluation Evidence |
| --- | --- |
| 1. Product/data model alignment | API integration workflow and entity-lifecycle assertions |
| 2. Ingestion/parsing | Convert acceptance tests and parse task completion |
| 3. Template/schema management | Template creation/version + retrigger checks |
| 4. Field extraction workflow | Cell payload and diagnostics validation |
| 5. Tabular comparison/review | Review upsert behavior and effective value checks |
| 6. Quality evaluation | Metrics contract and mismatch notes checks |
| 7. Diff/annotation | Annotation create/list and table diff visibility |
| 8. Frontend UX | Manual tab-by-tab checklist and async task panel behavior |

## 8. Known Gaps and Residual Risk
- Frontend currently has no dedicated project edit form; update is API-level.
- Legacy frontend Gemini service remains in codebase and can confuse ownership if used accidentally.
- Full end-to-end UI tests are not yet automated in this repo; current UI validation is manual.
