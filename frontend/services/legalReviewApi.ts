import {
  Project,
  TemplateVersion,
  RequestTask,
  ReviewStatus,
  EvaluationReport,
} from '../types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const requestJson = async <T>(path: string, options: RequestInit = {}): Promise<T> => {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  const contentType = response.headers.get('content-type') || '';
  let data: any = null;
  if (contentType.includes('application/json')) {
    data = await response.json();
  } else {
    const text = await response.text();
    data = { detail: text };
  }
  if (!response.ok) {
    throw new Error(data?.detail || data?.title || `Request failed (${response.status})`);
  }
  return data as T;
};

export const api = {
  createProject: (payload: { name: string; description?: string }) =>
    requestJson<{ project: Project }>('/api/projects', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateProject: (projectId: string, payload: { name?: string; description?: string; status?: string }) =>
    requestJson<{ project: Project }>(`/api/projects/${projectId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  listProjects: () => requestJson<{ projects: Project[] }>('/api/projects'),

  getProject: (projectId: string) =>
    requestJson<{
      project: Project;
      documents: any[];
      templates: any[];
    }>(`/api/projects/${projectId}`),

  deleteProject: async (projectId: string) => {
    try {
      return await requestJson<{ project_id: string; deleted: boolean }>(`/api/projects/${projectId}`, {
        method: 'DELETE',
      });
    } catch (err: any) {
      const message = String(err?.message || '');
      if (message.toLowerCase().includes('method not allowed') || message.includes('(405)')) {
        return requestJson<{ project_id: string; deleted: boolean }>(`/api/projects/${projectId}/delete`, {
          method: 'POST',
        });
      }
      throw err;
    }
  },

  uploadProjectDocument: async (projectId: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return requestJson<{ document_id: string; task_id: string }>(`/api/projects/${projectId}/documents`, {
      method: 'POST',
      body: form,
    });
  },

  listProjectDocuments: (projectId: string) =>
    requestJson<{ documents: any[] }>(`/api/projects/${projectId}/documents`),

  createTemplate: (projectId: string, payload: { name: string; fields: any[]; validation_policy?: Record<string, unknown>; normalization_policy?: Record<string, unknown> }) =>
    requestJson<{ template: any; template_version: TemplateVersion }>(
      `/api/projects/${projectId}/templates`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  createTemplateVersion: (templateId: string, payload: { fields: any[]; validation_policy?: Record<string, unknown>; normalization_policy?: Record<string, unknown> }) =>
    requestJson<{ template_version: TemplateVersion }>(
      `/api/templates/${templateId}/versions`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  listTemplates: (projectId: string) =>
    requestJson<{ templates: any[] }>(`/api/projects/${projectId}/templates`),

  createExtractionRun: (
    projectId: string,
    templateVersionId?: string,
    mode?: 'deterministic' | 'hybrid' | 'llm_reasoning',
    qualityProfile?: 'high' | 'balanced' | 'fast'
  ) =>
    requestJson<{ run_id: string; task_id: string }>(`/api/projects/${projectId}/extraction-runs`, {
      method: 'POST',
      body: JSON.stringify({
        template_version_id: templateVersionId || null,
        mode: mode || null,
        quality_profile: qualityProfile || null,
      }),
    }),

  getExtractionRun: (projectId: string, runId: string) =>
    requestJson<{ run: any; results: any[] }>(`/api/projects/${projectId}/extraction-runs/${runId}`),

  getExtractionRunDiagnostics: (projectId: string, runId: string) =>
    requestJson<{ run: any; summary: any; cells: any[] }>(`/api/projects/${projectId}/extraction-runs/${runId}/diagnostics`),

  getTableView: (projectId: string, templateVersionId?: string, baselineDocumentId?: string) => {
    const params = new URLSearchParams();
    if (templateVersionId) params.set('template_version_id', templateVersionId);
    if (baselineDocumentId) params.set('baseline_document_id', baselineDocumentId);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return requestJson<any>(`/api/projects/${projectId}/table-view${qs}`);
  },

  upsertReviewDecision: (
    projectId: string,
    payload: {
      document_version_id: string;
      template_version_id: string;
      field_key: string;
      status: ReviewStatus;
      manual_value?: string | null;
      reviewer?: string | null;
      notes?: string | null;
    }
  ) =>
    requestJson<{ review_decision: any }>(`/api/projects/${projectId}/review-decisions`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  listReviewDecisions: (projectId: string, templateVersionId?: string) => {
    const qs = templateVersionId ? `?template_version_id=${encodeURIComponent(templateVersionId)}` : '';
    return requestJson<{ review_decisions: any[] }>(`/api/projects/${projectId}/review-decisions${qs}`);
  },

  createGroundTruthSet: (
    projectId: string,
    payload: {
      name: string;
      labels: Array<{
        document_version_id: string;
        field_key: string;
        expected_value?: string;
        expected_normalized_value?: string;
        notes?: string;
      }>;
      format?: string;
    }
  ) =>
    requestJson<{ ground_truth_set: any }>(`/api/projects/${projectId}/ground-truth-sets`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  createEvaluationRun: (projectId: string, payload: { ground_truth_set_id: string; extraction_run_id: string }) =>
    requestJson<{ evaluation_run_id: string; task_id: string }>(`/api/projects/${projectId}/evaluation-runs`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getEvaluationRun: (projectId: string, evaluationRunId: string) =>
    requestJson<{ evaluation_run: { metrics_json?: EvaluationReport } }>(`/api/projects/${projectId}/evaluation-runs/${evaluationRunId}`),

  createAnnotation: (
    projectId: string,
    payload: {
      document_version_id: string;
      template_version_id: string;
      field_key: string;
      body: string;
      author?: string;
      approved?: boolean;
    }
  ) =>
    requestJson<{ annotation: any }>(`/api/projects/${projectId}/annotations`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  listAnnotations: (projectId: string, templateVersionId?: string) => {
    const qs = templateVersionId ? `?template_version_id=${encodeURIComponent(templateVersionId)}` : '';
    return requestJson<{ annotations: any[] }>(`/api/projects/${projectId}/annotations${qs}`);
  },

  listProjectTasks: (projectId: string, status?: string, limit = 200) => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (limit) params.set('limit', String(limit));
    const qs = params.toString() ? `?${params.toString()}` : '';
    return requestJson<{ tasks: RequestTask[] }>(`/api/projects/${projectId}/tasks${qs}`);
  },

  cancelTask: (taskId: string, options?: { reason?: string; purge?: boolean }) => {
    const params = new URLSearchParams();
    if (options?.reason) params.set('reason', options.reason);
    if (options?.purge) params.set('purge', 'true');
    const qs = params.toString() ? `?${params.toString()}` : '';
    return requestJson<{ task?: RequestTask; task_id?: string; status?: string; deleted?: boolean }>(
      `/api/tasks/${taskId}/cancel${qs}`,
      {
        method: 'POST',
      }
    );
  },

  cancelProjectPendingTasks: (projectId: string, purge = false) =>
    requestJson<{ project_id: string; canceled_count: number; canceled_task_ids: string[]; deleted_count: number }>(
      `/api/projects/${projectId}/tasks/cancel-pending${purge ? '?purge=true' : ''}`,
      {
        method: 'POST',
      }
    ),

  deleteTask: (taskId: string, force = false) =>
    requestJson<{ task_id: string; deleted: boolean }>(`/api/tasks/${taskId}${force ? '?force=true' : ''}`, {
      method: 'DELETE',
    }),

  getTask: (taskId: string) => requestJson<{ task: RequestTask }>(`/api/tasks/${taskId}`),
};
