Legal Tabular Review — Task Description & Acceptance Criteria

Background
You are implementing a full-stack solution for a Legal Tabular Review system.
The system ingests contract documents, extracts key fields into a structured
table, supports side-by-side comparison, and enables review workflows with
customizable field schemas.

This is a take-home exercise: do not build any code framework. Provide task
descriptions only, with clear acceptance criteria.

Scope of Work (Task Descriptions)

1) Product & Data Model Alignment
- Define end-to-end data flow for review projects, documents, field templates,
  extracted records, and review states.
- Map API request/response models to database entities and storage layout.
- Ensure enumerations and status transitions are captured (Project, Extraction,
  Review).

2) Document Ingestion & Parsing
- Describe how multiple formats (PDF, DOCX, HTML, TXT) are ingested and parsed.
- Define how text, structure, and metadata are preserved for extraction.
- Describe how new documents affect existing projects (reprocessing rules).

3) Field Template & Schema Management
- Define how users create and version field templates (custom fields).
- Describe field types, validation rules, and normalization policies.
- Explain how template updates trigger re-extraction.

4) Field Extraction Workflow
- Describe extraction behavior per field:
  - Must include source citations (document + location)
  - Must include confidence score
  - Must include normalization output and raw text
- Define fallback behavior when a field is missing or ambiguous.

5) Tabular Comparison & Review
- Describe how extracted fields are aligned across documents in a table.
- Define review states: CONFIRMED / REJECTED / MANUAL_UPDATED / MISSING_DATA.
- Explain how manual edits are stored alongside AI results for auditability.

6) Quality Evaluation
- Define how extraction output is evaluated against human-labeled references.
- Specify metrics (field-level accuracy, coverage, and normalization validity).
- Describe evaluation outputs and reporting.

7) Optional Diff & Annotation Layer
- Describe how difference highlighting is computed across documents.
- Define annotation and comment storage tied to fields and documents.
- Ensure annotations do not change the underlying extraction unless approved.

8) Frontend Experience (High-Level)
- Describe UI screens: project list, project detail, document list, table review,
  template management, evaluation report.
- Specify user interactions required for project creation, field configuration,
  status tracking, and review workflow.

Acceptance Criteria

A. Documentation Completeness
- Document includes all 8 scope areas above.
- Every API endpoint listed is explained in context (create, update, extract,
  review, evaluate).
- Data structures in the spec are mapped to the system design.

B. Functional Accuracy
- Workflow shows: upload -> parse -> configure fields -> extract -> review ->
  evaluate.
- Each extracted field includes: value + citations + confidence + normalization.
- Template updates trigger re-extraction for impacted projects.

C. Review & Auditability
- Manual edits are preserved alongside AI results.
- Review status transitions are explicitly described.

D. Quality Evaluation
- Clear method for comparing AI vs. human extraction.
- Output includes numeric scores and qualitative notes.

E. Non-Functional Requirements
- Async processing and status tracking are described.
- Error handling, missing data, and regeneration logic are described.

F. Frontend UX
- All core user workflows are described:
  - Create/update project
  - Configure field templates
  - Review table output
  - Track background status
  - Compare AI vs. human
