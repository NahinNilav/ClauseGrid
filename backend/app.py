from fastapi import FastAPI

app = FastAPI(title="Questionnaire Agent API")


@app.get("/health")
def health_check() -> dict:
    return {"status": "ok"}
