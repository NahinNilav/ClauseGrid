# Testing and Evaluation

## Automated Tests

### Existing parser acceptance tests
- `backend/tests/test_convert_acceptance.py`
- Validates:
  - HTML conversion + selector citations
  - PDF conversion + page citations
  - PDF page rendering endpoint

### New workflow integration test
- `backend/tests/test_legal_api_workflow.py`
- Validates:
  - Project creation
  - Template creation
  - Async document parse
  - Table view generation
  - Review decision overlay
  - Annotation storage
  - Ground truth creation
  - Evaluation run metrics

## Evaluation Metrics
Evaluation compares `field_extractions` vs `ground_truth_labels`:

- `field_level_accuracy = matched_labels / total_labels`
- `coverage = extracted_non_empty / total_labels`
- `normalization_validity = normalization_valid / extracted_non_empty`
- `precision = matched_labels / extracted_non_empty`
- `recall = matched_labels / total_labels`
- `f1 = 2 * precision * recall / (precision + recall)`

Also returned:
- `qualitative_notes[]` with mismatch examples

## Manual QA Checklist

1. Upload PDF/DOCX/HTML/TXT in one project
2. Confirm parse tasks complete and document versions exist
3. Create template `v1` and run extraction
4. Confirm each cell includes value + citations + confidence + normalization fields
5. Set review statuses across all required values
6. Verify `MANUAL_UPDATED` overlays value without deleting AI record
7. Add annotation and ensure extraction data does not change
8. Upload ground truth and run evaluation
9. Confirm evaluation report shows numeric + qualitative outputs

## Expected Demo Output Artifacts
- Table view JSON via `/api/projects/{id}/table-view`
- Review decisions via `/api/projects/{id}/review-decisions`
- Evaluation metrics via `/api/projects/{id}/evaluation-runs/{eval_run_id}`
