# Data Model

## Core Entities

### `projects`
- `id` (pk)
- `name`
- `description`
- `status` (`DRAFT | ACTIVE | ARCHIVED`)
- `created_at`, `updated_at`

### `documents`
- `id` (pk)
- `project_id` (fk -> projects)
- `filename`
- `source_mime_type`
- `sha256`
- `created_at`

### `document_versions`
- `id` (pk)
- `document_id` (fk -> documents)
- `version_no`
- `parse_status` (`QUEUED | RUNNING | COMPLETED | FAILED`)
- `artifact_json` (parsed markdown + blocks + chunks + citations)
- `error_message`
- `created_at`

### `field_templates`
- `id` (pk)
- `project_id` (fk -> projects)
- `name`
- `status` (`ACTIVE | ARCHIVED`)
- `active_version_id` (fk -> field_template_versions)
- `created_at`, `updated_at`

### `field_template_versions`
- `id` (pk)
- `template_id` (fk -> field_templates)
- `version_no`
- `fields_json` (array of field definitions)
- `validation_policy_json`
- `normalization_policy_json`
- `created_at`

### `extraction_runs`
- `id` (pk)
- `project_id` (fk -> projects)
- `template_version_id` (fk -> field_template_versions)
- `status` (`QUEUED | RUNNING | COMPLETED | PARTIAL | FAILED | CANCELED`)
- `total_cells`, `completed_cells`, `failed_cells`
- `trigger_reason` (`DOCUMENT_ADDED | TEMPLATE_CREATED | TEMPLATE_VERSION_UPDATED | MANUAL_TRIGGER`)
- `error_message`
- `created_at`, `updated_at`

### `field_extractions` (immutable AI output)
- `id` (pk)
- `extraction_run_id`, `project_id`, `document_version_id`, `template_version_id`
- `field_key`, `field_name`, `field_type`
- `raw_text`
- `value`
- `normalized_value`
- `normalization_valid`
- `confidence_score` (0..1)
- `citations_json` (stable location references)
- `evidence_summary`
- `fallback_reason` (`NOT_FOUND | AMBIGUOUS | PARSER_ERROR | MODEL_ERROR`)
- `created_at`

### `review_decisions` (audit overlay)
- `id` (pk)
- `project_id`, `document_version_id`, `template_version_id`, `field_key`
- `status` (`CONFIRMED | REJECTED | MANUAL_UPDATED | MISSING_DATA`)
- `manual_value`
- `reviewer`, `notes`
- `created_at`, `updated_at`
- unique key: `(project_id, document_version_id, template_version_id, field_key)`

### `annotations`
- `id` (pk)
- `project_id`, `document_version_id`, `template_version_id`, `field_key`
- `body`
- `author`
- `approved` (bool)
- `created_at`, `updated_at`

### `ground_truth_sets`
- `id` (pk)
- `project_id`
- `name`
- `format` (`json | csv`)
- `created_at`

### `ground_truth_labels`
- `id` (pk)
- `ground_truth_set_id`
- `document_version_id`
- `field_key`
- `expected_value`
- `expected_normalized_value`
- `notes`

### `evaluation_runs`
- `id` (pk)
- `project_id`
- `ground_truth_set_id`
- `extraction_run_id`
- `status` (`QUEUED | RUNNING | COMPLETED | FAILED`)
- `metrics_json`
- `notes`
- `created_at`, `updated_at`

### `request_tasks`
- `id` (pk)
- `project_id`
- `task_type` (`PARSE_DOCUMENT | EXTRACTION_RUN | EVALUATION_RUN`)
- `status` (`QUEUED | RUNNING | SUCCEEDED | FAILED`)
- `entity_id`
- `progress_current`, `progress_total`
- `error_message`
- `payload_json`
- `created_at`, `updated_at`

### `audit_events`
- `id` (pk)
- `project_id`
- `actor`
- `action`
- `entity_type`, `entity_id`
- `payload_json`
- `created_at`

## Field Definition Schema (`fields_json`)
```json
{
  "key": "effective_date",
  "name": "Effective Date",
  "type": "date",
  "prompt": "Extract the effective date.",
  "required": true
}
```

## Review Resolution Rule
`effective_value = manual_value (when status = MANUAL_UPDATED) else ai_result.value`

## Normalization Policies
- date: ISO `YYYY-MM-DD`
- number: comma-stripped decimal string
- boolean: strict `true|false`
- list: canonical comma-separated values
