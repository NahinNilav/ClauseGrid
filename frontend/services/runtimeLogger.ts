type RuntimeLogLevel = 'info' | 'warning' | 'error';

interface RuntimeEventPayload {
  event: string;
  level?: RuntimeLogLevel;
  stage?: string;
  runId?: string;
  message?: string;
  metadata?: Record<string, unknown>;
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export const createRunId = (prefix: string): string =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export const logRuntimeEvent = (payload: RuntimeEventPayload): void => {
  const body = {
    event: payload.event,
    level: payload.level ?? 'info',
    stage: payload.stage,
    run_id: payload.runId,
    message: payload.message,
    metadata: payload.metadata ?? {},
  };

  void fetch(`${API_URL}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => {
    // Best-effort telemetry only: never interrupt UX when backend logger is unreachable.
  });
};
