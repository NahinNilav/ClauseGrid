Backend Skeleton (Minimal Framework)

Purpose
This folder holds the backend service implementation for the Questionnaire
Agent. It uses a minimal FastAPI setup and serves as the starting point for
implementation.

Planned Modules
- src/api/        HTTP route handlers for the listed endpoints
- src/models/     Data models mirroring the spec data structures
- src/services/   Core business logic (project, answers, ingestion, evaluation)
- src/indexing/   Multi-layer indexing pipeline and chunking
- src/storage/    Persistence layer (DB, vector store, object storage)
- src/workers/    Async/background processing and request status tracking
- src/utils/      Shared helpers, validation, and constants

Endpoints (to be implemented)
- POST /create-project-async
- POST /generate-single-answer
- POST /generate-all-answers
- POST /update-project-async
- POST /update-answer
- GET /get-project-info
- GET /get-project-status
- POST /index-document-async
- GET /get-request-status
