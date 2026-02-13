Legal Tabular Review Demo

Minimal skeleton for the Legal Tabular Review take-home project. The system
ingests multiple legal documents, extracts key fields into a structured table,
and supports side-by-side comparison with review workflows and custom field
templates.

Required Documentation
- Architecture Design: system overview, component boundaries, data flow, storage.
- Functional Design: user flows, API behaviors, status transitions, edge cases.
- Testing & Evaluation: extraction accuracy, coverage, review QA checklist.

Dataset Testing
- Sample files live in `data/` and are intended for ingestion and QA smoke tests.
- Use the documents in `data/` as inputs for extraction and table generation.
- Validate that each extracted field includes: value + citations + confidence +
  normalization output.
- Update the field template to verify re-extraction and table refresh behavior.
