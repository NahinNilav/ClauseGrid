Frontend Workspace (React + Vite)

Purpose
Implements a project-centric legal tabular review workspace against `/api/*`
backend endpoints.

Implemented Screens (tabbed workspace)
- Projects: create/select projects
- Documents: upload and parse status tracking
- Templates: create field templates and immutable versions
- Table Review: side-by-side document comparison with review overlay states
- Evaluation: upload ground truth and run quality scoring
- Annotations: optional non-destructive diff/comment layer

Implemented Features
- API-backed workflow (no file-only project lifecycle dependency)
- Project edit workflow (name/description/status) via `PATCH /api/projects/{id}`
- Task polling via `/api/tasks/{task_id}`
- CSV export from table review (`effective` or `ai` value mode)
- Required review states: `CONFIRMED | REJECTED | MANUAL_UPDATED | MISSING_DATA`
- Citation viewer integration through existing `DocumentViewer` stack
- Annotation lifecycle controls (edit/approve/resolve/delete)
