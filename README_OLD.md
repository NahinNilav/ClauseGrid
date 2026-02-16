Legal Tabular Review Demo

Full-stack take-home implementation for legal document comparison:
- multi-format ingestion (PDF, DOCX, HTML, TXT)
- versioned field templates
- async extraction runs
- review/audit overlay states
- evaluation against human labels
- optional annotation layer

Required Documentation
- Architecture Design: system overview, component boundaries, data flow, storage.
- Functional Design: user flows, API behaviors, status transitions, edge cases.
- Testing & Evaluation: extraction accuracy, coverage, review QA checklist.

Implementation docs:
- `docs/Architecture.md`
- `docs/DataModel.md`
- `docs/APIContracts.md`
- `docs/FunctionalDesign.md`
- `docs/TestingEvaluation.md`
- `docs/Runbook.md`

Dataset Testing
- Sample files live in `data/` and are intended for ingestion and QA smoke tests.
- Use the documents in `data/` as inputs for extraction and table generation.
- Validate that each extracted field includes: value + citations + confidence +
  normalization output.
- Update the field template to verify re-extraction and table refresh behavior.

Quick Start
1. Backend:
   - `cd backend`
   - `./venv/bin/python app.py`
2. Frontend:
   - `cd frontend`
   - `npm install`
   - `npm run dev`
