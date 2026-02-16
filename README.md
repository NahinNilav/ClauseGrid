# Legal Tabular Review

Full-stack take-home implementation for legal document ingestion, extraction, tabular comparison, human review, and evaluation against ground truth.

## Demo Video
- Add demo video link here: `[TODO: paste demo video URL]`

## Evaluator Quick Start
1. Read the submission-critical docs in the order listed under **Documentation Reading Order**.
2. Run backend and frontend using **Run Locally**.
3. Use sample files in `data/` to run a full workflow smoke test.
4. Validate extraction, review overlay, and evaluation outputs.

## Documentation Reading Order
The `docs/` folder contains the submission-critical design and operational documentation.

1. `docs/Architecture.md`  
   System boundaries, component responsibilities, and end-to-end flow.
2. `docs/DataModel.md`  
   Entity model, lifecycle states, and table-cell extraction payload design.
3. `docs/APIContracts.md`  
   Full API contract coverage, request/response structures, and endpoint-to-entity mapping.
4. `docs/FunctionalDesign.md`  
   Implemented user workflows and behavior (upload -> parse -> extract -> review -> evaluate).
5. `docs/TestingEvaluation.md`  
   Test coverage, acceptance mapping, and evaluation methodology.
6. `docs/Runbook.md`  
   Runtime operations, task monitoring, troubleshooting, and environment controls.

Reference-only template docs (not part of submitted implementation docs):
- `docs/README.md`
- `docs/REQUIREMENTS.md`

## Run Locally
### Prerequisites
- Python 3.10+
- Node.js 18+
- npm

### Backend (Terminal 1)
From repository root:

```bash
cd backend
./start-backend.sh
```

Alternative (manual startup):

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
./venv/bin/python app.py
```

Backend endpoints:
- API: `http://localhost:8000`
- API docs: `http://localhost:8000/docs`

### Frontend (Terminal 2)
From repository root:

```bash
cd frontend
npm install
npm run dev
```

Frontend:
- App: `http://localhost:5173`
- Default backend target: `http://localhost:8000`

## Evaluator Smoke-Test Flow
1. Create a project.
2. Upload one or more files from `data/` (PDF/DOCX/HTML/TXT supported).
3. Create a field template (or template version).
4. Wait for parse/extraction tasks to complete.
5. Open table review and verify each extracted cell includes value, citation(s), confidence, and normalization output.
6. Apply review states (`CONFIRMED`, `REJECTED`, `MANUAL_UPDATED`, `MISSING_DATA`) on selected cells.
7. Create ground-truth labels and run evaluation.
8. Review metrics and optionally export table CSV.

## Repository Layout
- `backend/` FastAPI workflow APIs, extraction pipeline, SQLite persistence, tests.
- `frontend/` React + Vite reviewer workspace.
- `docs/` Submission-critical architecture/design/contracts/testing/runbook docs.
- `data/` Sample documents for ingestion and QA.
