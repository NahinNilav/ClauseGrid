# Runbook

## Prerequisites
- Python 3.10+
- Node 18+
- Backend virtualenv with `backend/requirements.txt`

## Start Backend
```bash
cd backend
./venv/bin/python app.py
```

Server runs at `http://localhost:8000`.

## Start Frontend
```bash
cd frontend
npm install
npm run dev
```

Frontend defaults to `VITE_API_URL=http://localhost:8000`.

## Verify Core Workflow

1. Create a project
2. Upload legal docs (PDF/DOCX/HTML/TXT)
3. Create template and fields
4. Trigger extraction run
5. Review table cells with required statuses
6. Add annotations
7. Upload ground truth labels and run evaluation

## API Smoke Commands

```bash
curl -X POST http://localhost:8000/api/projects \
  -H 'Content-Type: application/json' \
  -d '{"name":"Smoke Project"}'
```

```bash
curl http://localhost:8000/api/projects
```

## Test Commands

```bash
cd backend
./venv/bin/python -m unittest tests/test_convert_acceptance.py tests/test_legal_api_workflow.py
```

```bash
cd frontend
npm run build
```

## Troubleshooting
- If parse task fails, check `/api/tasks/{task_id}` `error_message`
- If table view is empty, ensure at least one completed extraction run for selected template version
- If evaluation fails, verify `ground_truth_set_id` and `extraction_run_id` are valid and aligned to same project
