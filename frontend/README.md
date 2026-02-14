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
- Task polling via `/api/tasks/{task_id}`
- Required review states: `CONFIRMED | REJECTED | MANUAL_UPDATED | MISSING_DATA`
- Citation viewer integration through existing `DocumentViewer` stack
