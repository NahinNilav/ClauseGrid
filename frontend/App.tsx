import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './services/legalReviewApi';
import {
  AIFieldExtraction,
  DocumentFile,
  EvaluationReport,
  ExtractionCell,
  Project,
  RequestTask,
  ReviewStatus,
  SourceCitation,
  TemplateFieldDefinition,
} from './types';
import { DocumentViewer } from './components/document-viewers';
import { Trash2, FolderOpen, ChevronRight, ChevronLeft, X, GripVertical, ZoomIn, ZoomOut, Maximize2, ChevronUp, ChevronDown, FileText } from './components/Icons';

const REVIEW_STATUSES: ReviewStatus[] = [
  'CONFIRMED',
  'REJECTED',
  'MANUAL_UPDATED',
  'MISSING_DATA',
];

type WorkspaceTab = 'documents' | 'templates' | 'table' | 'evaluation' | 'annotations';
type ExtractionMode = 'deterministic' | 'hybrid' | 'llm_reasoning';
type QualityProfile = 'high' | 'balanced' | 'fast';

const EXTRACTION_MODES: ExtractionMode[] = ['hybrid', 'deterministic', 'llm_reasoning'];
const QUALITY_PROFILES: QualityProfile[] = ['high', 'balanced', 'fast'];

interface TableCell {
  field_key: string;
  ai_result: AIFieldExtraction | null;
  review_overlay: {
    id?: string;
    status: ReviewStatus;
    manual_value?: string | null;
    reviewer?: string | null;
    notes?: string | null;
  } | null;
  effective_value: string;
  is_diff: boolean;
}

interface TableRow {
  document_id: string;
  document_version_id: string;
  filename: string;
  artifact: any;
  parse_status: string;
  cells: Record<string, TableCell>;
}

interface TableViewPayload {
  project_id: string;
  template_version_id: string;
  extraction_run_id: string | null;
  columns: TemplateFieldDefinition[];
  rows: TableRow[];
}

const toBase64 = (value: string): string => {
  try {
    return btoa(unescape(encodeURIComponent(value || '')));
  } catch {
    return btoa(value || '');
  }
};

const confidenceLabel = (score: number): 'High' | 'Medium' | 'Low' => {
  if (score >= 0.75) return 'High';
  if (score >= 0.45) return 'Medium';
  return 'Low';
};

const toCitationArray = (citations: AIFieldExtraction['citations_json']): SourceCitation[] => {
  if (!citations) return [];
  if (Array.isArray(citations)) return citations as SourceCitation[];
  if (typeof citations === 'object') return [citations as SourceCitation];
  return [];
};

const toLegacyCell = (cell: TableCell | null): ExtractionCell | null => {
  if (!cell || !cell.ai_result) return null;
  const ai = cell.ai_result;
  const citations = toCitationArray(ai.citations_json);
  return {
    value: cell.effective_value || ai.value || '',
    confidence: confidenceLabel(ai.confidence_score || 0),
    quote: ai.raw_text || ai.value || '',
    page: citations?.[0]?.page || 1,
    reasoning: ai.evidence_summary || '',
    citations,
    status: cell.review_overlay?.status === 'CONFIRMED' ? 'verified' : 'needs_review',
  };
};

const toViewerDocument = (row: TableRow): DocumentFile => {
  const markdown = row.artifact?.markdown || '';
  return {
    id: row.document_id,
    name: row.filename,
    type: row.artifact?.mime_type || 'text/plain',
    size: markdown.length,
    content: toBase64(markdown),
    mimeType: 'text/markdown',
    artifact: row.artifact,
  };
};

const defaultFields: TemplateFieldDefinition[] = [
  {
    key: 'parties_entities',
    name: 'Parties and Entities',
    type: 'text',
    prompt: 'Extract the parties/entities to this legal agreement.',
    required: true,
  },
  {
    key: 'effective_date',
    name: 'Effective Date',
    type: 'date',
    prompt: 'Extract the effective date of the agreement.',
    required: true,
  },
  {
    key: 'dispute_resolution',
    name: 'Dispute Resolution',
    type: 'text',
    prompt: 'Extract dispute resolution clause and governing approach.',
    required: false,
  },
  {
    key: 'payment_terms',
    name: 'Payment Terms',
    type: 'text',
    prompt: 'Extract payment terms or timing obligations.',
    required: false,
  },
];

const App: React.FC = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);

  const [documents, setDocuments] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [selectedTemplateVersionId, setSelectedTemplateVersionId] = useState<string | null>(null);

  const [tableView, setTableView] = useState<TableViewPayload | null>(null);
  const [selectedRowVersionId, setSelectedRowVersionId] = useState<string | null>(null);
  const [selectedFieldKey, setSelectedFieldKey] = useState<string | null>(null);
  const [baselineDocumentId, setBaselineDocumentId] = useState<string>('');

  const [annotations, setAnnotations] = useState<any[]>([]);
  const [reviewStatus, setReviewStatus] = useState<ReviewStatus>('CONFIRMED');
  const [manualValue, setManualValue] = useState<string>('');
  const [reviewer, setReviewer] = useState<string>('analyst@demo.local');
  const [reviewNotes, setReviewNotes] = useState<string>('');
  const [annotationBody, setAnnotationBody] = useState<string>('');

  const [groundTruthName, setGroundTruthName] = useState<string>('Demo Ground Truth');
  const [groundTruthInput, setGroundTruthInput] = useState<string>('[]');
  const [groundTruthSetId, setGroundTruthSetId] = useState<string>('');
  const [evaluationRunId, setEvaluationRunId] = useState<string>('');
  const [evaluationReport, setEvaluationReport] = useState<EvaluationReport | null>(null);

  const [newProjectName, setNewProjectName] = useState<string>('Legal Tabular Review Project');
  const [newProjectDescription, setNewProjectDescription] = useState<string>('Take-home demo project for legal contract comparison.');
  const [showCreateProjectForm, setShowCreateProjectForm] = useState<boolean>(false);

  const [templateName, setTemplateName] = useState<string>('Default Legal Template');
  const [draftFields, setDraftFields] = useState<TemplateFieldDefinition[]>(defaultFields);

  const [tab, setTab] = useState<WorkspaceTab>('documents');
  const [tasks, setTasks] = useState<Record<string, RequestTask>>({});
  const [pendingTaskIds, setPendingTaskIds] = useState<string[]>([]);
  const [error, setError] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  const [extractionMode, setExtractionMode] = useState<ExtractionMode>('hybrid');
  const [qualityProfile, setQualityProfile] = useState<QualityProfile>('high');
  const [showUnresolvedOnly, setShowUnresolvedOnly] = useState<boolean>(false);
  const [showLowConfidenceOnly, setShowLowConfidenceOnly] = useState<boolean>(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  const [reviewPanelWidth, setReviewPanelWidth] = useState<number>(380);
  const [viewerPanelWidth, setViewerPanelWidth] = useState<number>(480);
  const [viewerZoom, setViewerZoom] = useState<number>(100);
  const isDraggingDivider = useRef<'review' | 'viewer' | null>(null);
  const dragStartX = useRef<number>(0);
  const dragStartWidth = useRef<number>(0);

  const handleDividerMouseDown = useCallback((e: React.MouseEvent, panel: 'review' | 'viewer') => {
    e.preventDefault();
    isDraggingDivider.current = panel;
    dragStartX.current = e.clientX;
    dragStartWidth.current = panel === 'review' ? reviewPanelWidth : viewerPanelWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingDivider.current) return;
      const diff = isDraggingDivider.current === 'review'
        ? dragStartX.current - moveEvent.clientX // review panel: dragging left grows
        : moveEvent.clientX - dragStartX.current; // viewer panel: dragging right grows — but we need inverse since it's on the right
      const actualDiff = isDraggingDivider.current === 'viewer'
        ? dragStartX.current - moveEvent.clientX
        : diff;
      const newWidth = Math.max(280, Math.min(600, dragStartWidth.current + actualDiff));
      if (isDraggingDivider.current === 'review') {
        setReviewPanelWidth(newWidth);
      } else {
        setViewerPanelWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      isDraggingDivider.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [reviewPanelWidth, viewerPanelWidth]);

  const selectedCell = useMemo(() => {
    if (!tableView || !selectedRowVersionId || !selectedFieldKey) return null;
    const row = tableView.rows.find((r) => r.document_version_id === selectedRowVersionId);
    if (!row) return null;
    const cell = row.cells[selectedFieldKey];
    if (!cell) return null;
    return { row, cell };
  }, [tableView, selectedRowVersionId, selectedFieldKey]);

  const rowHasUnresolved = (row: TableRow): boolean =>
    (tableView?.columns || []).some((col) => {
      const cell = row.cells[col.key];
      const ai = cell?.ai_result;
      if (!ai) return true;
      if (ai.fallback_reason) return true;
      if ((ai.verifier_status || 'SKIPPED') === 'FAIL') return true;
      if ((ai.verifier_status || 'SKIPPED') === 'PARTIAL') return true;
      if ((ai.confidence_score || 0) < 0.55) return true;
      return false;
    });

  const rowHasLowConfidence = (row: TableRow): boolean =>
    (tableView?.columns || []).some((col) => {
      const score = row.cells[col.key]?.ai_result?.confidence_score || 0;
      return score < 0.55;
    });

  const displayRows = useMemo(() => {
    if (!tableView) return [];
    let rows = tableView.rows || [];
    if (showUnresolvedOnly) {
      rows = rows.filter((row) => rowHasUnresolved(row));
    }
    if (showLowConfidenceOnly) {
      rows = rows.filter((row) => rowHasLowConfidence(row));
    }
    return rows;
  }, [tableView, showUnresolvedOnly, showLowConfidenceOnly]);

  const uniquePendingTaskIds = useMemo(() => Array.from(new Set(pendingTaskIds)), [pendingTaskIds]);

  const addPendingTaskIds = (ids: Array<string | null | undefined>) => {
    const normalized = ids.filter((id): id is string => Boolean(id));
    if (!normalized.length) return;
    setPendingTaskIds((prev) => Array.from(new Set([...prev, ...normalized])));
  };

  const removePendingTaskId = (taskId: string) => {
    setPendingTaskIds((prev) => prev.filter((id) => id !== taskId));
  };

  const refreshProjects = async () => {
    try {
      const data = await api.listProjects();
      setProjects(data.projects || []);
      if (!selectedProjectId && data.projects?.length) {
        setSelectedProjectId(data.projects[0].id);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load projects');
    }
  };

  const refreshProjectContext = async (projectId: string, loadTable = false) => {
    try {
      const data = await api.getProject(projectId);
      setSelectedProject(data.project);
      setDocuments(data.documents || []);
      setTemplates(data.templates || []);

      let nextTemplateId = selectedTemplateId;
      let nextTemplateVersionId = selectedTemplateVersionId;

      if (!nextTemplateId || !(data.templates || []).some((t: any) => t.id === nextTemplateId)) {
        const activeTemplate = (data.templates || []).find((t: any) => t.status === 'ACTIVE') || data.templates?.[0] || null;
        nextTemplateId = activeTemplate?.id || null;
        nextTemplateVersionId = activeTemplate?.active_version_id || activeTemplate?.versions?.[0]?.id || null;
      }

      setSelectedTemplateId(nextTemplateId);
      setSelectedTemplateVersionId(nextTemplateVersionId);

      if (loadTable && nextTemplateVersionId) {
        const table = await api.getTableView(projectId, nextTemplateVersionId, baselineDocumentId || undefined);
        setTableView(table);
      }

      const annotationData = await api.listAnnotations(projectId, nextTemplateVersionId || undefined);
      setAnnotations(annotationData.annotations || []);
    } catch (err: any) {
      setError(err.message || 'Failed to refresh project context');
    }
  };

  useEffect(() => {
    void refreshProjects();
  }, []);

  useEffect(() => {
    if (!selectedProjectId) return;
    void refreshProjectContext(selectedProjectId, tab === 'table');
  }, [selectedProjectId]);

  useEffect(() => {
    if (!uniquePendingTaskIds.length) return;
    let isPolling = false;
    const timer = setInterval(async () => {
      if (isPolling) return;
      isPolling = true;
      for (const taskId of uniquePendingTaskIds) {
        try {
          const data = await api.getTask(taskId);
          const task = data.task;
          setTasks((prev) => ({ ...prev, [taskId]: task }));

          if (task.status === 'SUCCEEDED' || task.status === 'FAILED' || task.status === 'CANCELED') {
            removePendingTaskId(taskId);

            if (selectedProjectId) {
              await refreshProjectContext(selectedProjectId, tab === 'table');
            }

            if (task.task_type === 'EVALUATION_RUN' && task.status === 'SUCCEEDED' && selectedProjectId) {
              const payload = (task.payload_json || {}) as any;
              const evalId = payload?.evaluation_run_id || evaluationRunId;
              if (evalId) {
                const evalData = await api.getEvaluationRun(selectedProjectId, evalId);
                setEvaluationRunId(evalId);
                setEvaluationReport(evalData.evaluation_run?.metrics_json || null);
              }
            }
          }
        } catch (err: any) {
          const message = String(err?.message || '');
          if (message.includes('Task does not exist') || message.includes('(404)')) {
            removePendingTaskId(taskId);
            continue;
          }
          // Ignore transient polling failures.
        }
      }
      isPolling = false;
    }, 1500);
    return () => clearInterval(timer);
  }, [uniquePendingTaskIds, selectedProjectId, tab, evaluationRunId]);

  const createProject = async () => {
    if (!newProjectName.trim()) return;
    setBusy(true);
    setError('');
    try {
      const data = await api.createProject({
        name: newProjectName.trim(),
        description: newProjectDescription,
      });
      setNewProjectName('Legal Tabular Review Project');
      setNewProjectDescription('Take-home demo project for legal contract comparison.');
      setShowCreateProjectForm(false);
      await refreshProjects();
      setSelectedProjectId(data.project.id);
      setTab('documents');
    } catch (err: any) {
      setError(err.message || 'Failed to create project');
    } finally {
      setBusy(false);
    }
  };

  const deleteProjectById = async (projectId: string) => {
    const project = projects.find((item) => item.id === projectId);
    const projectName = project?.name || 'this project';
    const confirmed = window.confirm(`Delete "${projectName}" and all related data? This cannot be undone.`);
    if (!confirmed) return;

    setBusy(true);
    setError('');
    try {
      await api.deleteProject(projectId);

      const removedTaskIds = Object.entries(tasks)
        .filter(([, task]) => task.project_id === projectId)
        .map(([taskId]) => taskId);
      if (removedTaskIds.length) {
        setPendingTaskIds((prev) => prev.filter((taskId) => !removedTaskIds.includes(taskId)));
        setTasks((prev) => {
          const next: Record<string, RequestTask> = {};
          Object.entries(prev).forEach(([taskId, task]) => {
            if (!removedTaskIds.includes(taskId)) {
              next[taskId] = task;
            }
          });
          return next;
        });
      }

      const data = await api.listProjects();
      const nextProjects = data.projects || [];
      setProjects(nextProjects);

      if (selectedProjectId === projectId) {
        const nextProjectId = nextProjects[0]?.id || null;
        setSelectedProjectId(nextProjectId);
        if (!nextProjectId) {
          setSelectedProject(null);
          setDocuments([]);
          setTemplates([]);
          setTableView(null);
          setAnnotations([]);
          setSelectedTemplateId(null);
          setSelectedTemplateVersionId(null);
          setSelectedRowVersionId(null);
          setSelectedFieldKey(null);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to delete project');
    } finally {
      setBusy(false);
    }
  };

  const uploadDocuments = async (fileList: FileList | null) => {
    if (!fileList || !selectedProjectId) return;
    setBusy(true);
    setError('');
    try {
      const ids: string[] = [];
      for (const file of Array.from(fileList)) {
        const result = await api.uploadProjectDocument(selectedProjectId, file);
        ids.push(result.task_id);
      }
      addPendingTaskIds(ids);
      await refreshProjectContext(selectedProjectId, false);
    } catch (err: any) {
      setError(err.message || 'Failed to upload documents');
    } finally {
      setBusy(false);
    }
  };

  const updateDraftField = (idx: number, patch: Partial<TemplateFieldDefinition>) => {
    setDraftFields((prev) => prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
  };

  const addDraftField = () => {
    setDraftFields((prev) => [
      ...prev,
      { key: `field_${prev.length + 1}`, name: `Field ${prev.length + 1}`, type: 'text', prompt: '', required: false },
    ]);
  };

  const removeDraftField = (idx: number) => {
    setDraftFields((prev) => prev.filter((_, i) => i !== idx));
  };

  const createTemplate = async () => {
    if (!selectedProjectId || !templateName.trim() || !draftFields.length) return;
    setBusy(true);
    setError('');
    try {
      const payload = {
        name: templateName,
        fields: draftFields,
        validation_policy: { required_fields: draftFields.filter((f) => f.required).map((f) => f.key) },
        normalization_policy: {
          date_format: 'ISO-8601',
          numeric_policy: 'strip_commas',
          boolean_policy: 'strict_true_false',
        },
      };
      const data = await api.createTemplate(selectedProjectId, payload);
      if (data.triggered_extraction_task_id) {
        addPendingTaskIds([data.triggered_extraction_task_id]);
      }
      await refreshProjectContext(selectedProjectId, true);
      setSelectedTemplateId(data.template.id);
      setSelectedTemplateVersionId(data.template_version.id);
      setTab('table');
    } catch (err: any) {
      setError(err.message || 'Failed to create template');
    } finally {
      setBusy(false);
    }
  };

  const createTemplateVersion = async () => {
    if (!selectedTemplateId || !selectedProjectId || !draftFields.length) return;
    setBusy(true);
    setError('');
    try {
      const data = await api.createTemplateVersion(selectedTemplateId, {
        fields: draftFields,
        validation_policy: { required_fields: draftFields.filter((f) => f.required).map((f) => f.key) },
        normalization_policy: {
          date_format: 'ISO-8601',
          numeric_policy: 'strip_commas',
          boolean_policy: 'strict_true_false',
        },
      });
      addPendingTaskIds([data.triggered_extraction_task_id]);
      setSelectedTemplateVersionId(data.template_version.id);
      await refreshProjectContext(selectedProjectId, true);
      setTab('table');
    } catch (err: any) {
      setError(err.message || 'Failed to create template version');
    } finally {
      setBusy(false);
    }
  };

  const runExtraction = async () => {
    if (!selectedProjectId) return;
    setBusy(true);
    setError('');
    try {
      const data = await api.createExtractionRun(
        selectedProjectId,
        selectedTemplateVersionId || undefined,
        extractionMode,
        qualityProfile
      );
      addPendingTaskIds([data.task_id]);
    } catch (err: any) {
      setError(err.message || 'Failed to start extraction run');
    } finally {
      setBusy(false);
    }
  };

  const refreshTable = async () => {
    if (!selectedProjectId || !selectedTemplateVersionId) return;
    setBusy(true);
    setError('');
    try {
      const table = await api.getTableView(selectedProjectId, selectedTemplateVersionId, baselineDocumentId || undefined);
      setTableView(table);
      if (!baselineDocumentId && table.rows.length) {
        setBaselineDocumentId(table.rows[0].document_id);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load table view');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (tab === 'table' && selectedProjectId && selectedTemplateVersionId) {
      void refreshTable();
    }
  }, [tab, selectedProjectId, selectedTemplateVersionId]);

  useEffect(() => {
    if (!selectedCell) return;
    setReviewStatus(selectedCell.cell.review_overlay?.status || 'CONFIRMED');
    setManualValue(selectedCell.cell.review_overlay?.manual_value || selectedCell.cell.effective_value || '');
    setReviewer(selectedCell.cell.review_overlay?.reviewer || 'analyst@demo.local');
    setReviewNotes(selectedCell.cell.review_overlay?.notes || '');
  }, [selectedCell?.row.document_version_id, selectedCell?.cell.field_key]);

  const saveReview = async () => {
    if (!selectedProjectId || !selectedTemplateVersionId || !selectedCell) return;
    setBusy(true);
    setError('');
    try {
      await api.upsertReviewDecision(selectedProjectId, {
        document_version_id: selectedCell.row.document_version_id,
        template_version_id: selectedTemplateVersionId,
        field_key: selectedCell.cell.field_key,
        status: reviewStatus,
        manual_value: reviewStatus === 'MANUAL_UPDATED' ? manualValue : null,
        reviewer,
        notes: reviewNotes,
      });
      await refreshTable();
    } catch (err: any) {
      setError(err.message || 'Failed to save review decision');
    } finally {
      setBusy(false);
    }
  };

  const addAnnotation = async () => {
    if (!selectedProjectId || !selectedTemplateVersionId || !selectedCell || !annotationBody.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api.createAnnotation(selectedProjectId, {
        document_version_id: selectedCell.row.document_version_id,
        template_version_id: selectedTemplateVersionId,
        field_key: selectedCell.cell.field_key,
        body: annotationBody,
        author: reviewer,
        approved: false,
      });
      setAnnotationBody('');
      const data = await api.listAnnotations(selectedProjectId, selectedTemplateVersionId);
      setAnnotations(data.annotations || []);
    } catch (err: any) {
      setError(err.message || 'Failed to add annotation');
    } finally {
      setBusy(false);
    }
  };

  const createGroundTruth = async () => {
    if (!selectedProjectId) return;
    setBusy(true);
    setError('');
    try {
      const labels = JSON.parse(groundTruthInput || '[]');
      const data = await api.createGroundTruthSet(selectedProjectId, {
        name: groundTruthName,
        labels,
        format: 'json',
      });
      setGroundTruthSetId(data.ground_truth_set.id);
    } catch (err: any) {
      setError(err.message || 'Failed to create ground truth set (check JSON format)');
    } finally {
      setBusy(false);
    }
  };

  const runEvaluation = async () => {
    if (!selectedProjectId || !groundTruthSetId || !tableView?.extraction_run_id) return;
    setBusy(true);
    setError('');
    try {
      const data = await api.createEvaluationRun(selectedProjectId, {
        ground_truth_set_id: groundTruthSetId,
        extraction_run_id: tableView.extraction_run_id,
      });
      setEvaluationRunId(data.evaluation_run_id);
      addPendingTaskIds([data.task_id]);
    } catch (err: any) {
      setError(err.message || 'Failed to start evaluation run');
    } finally {
      setBusy(false);
    }
  };

  const cancelTaskById = async (taskId: string) => {
    setBusy(true);
    setError('');
    try {
      const data = await api.cancelTask(taskId, { reason: 'Canceled by user from UI.', purge: true });
      removePendingTaskId(taskId);
      if (data.task) {
        setTasks((prev) => ({ ...prev, [taskId]: data.task as RequestTask }));
      } else {
        setTasks((prev) => {
          const next = { ...prev };
          delete next[taskId];
          return next;
        });
      }
      if (selectedProjectId) {
        await refreshProjectContext(selectedProjectId, tab === 'table');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to cancel task');
    } finally {
      setBusy(false);
    }
  };

  const cancelAllPendingTasks = async () => {
    if (!selectedProjectId || !uniquePendingTaskIds.length) return;
    setBusy(true);
    setError('');
    try {
      const result = await api.cancelProjectPendingTasks(selectedProjectId, true);
      const canceled = result.canceled_task_ids || [];
      if (canceled.length) {
        setTasks((prev) => {
          const next = { ...prev };
          canceled.forEach((id) => {
            delete next[id];
          });
          return next;
        });
      }
      setPendingTaskIds((prev) => prev.filter((id) => !canceled.includes(id)));
      if (selectedProjectId) {
        await refreshProjectContext(selectedProjectId, tab === 'table');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to cancel pending tasks');
    } finally {
      setBusy(false);
    }
  };

  const selectedViewerDocument = selectedCell ? toViewerDocument(selectedCell.row) : null;
  const selectedViewerCell = selectedCell ? toLegacyCell(selectedCell.cell) : null;

  return (
    <div className="h-screen w-screen bg-[#F5F4F0] text-[#1C1C1C] flex overflow-hidden font-sans">
      <aside className={`${sidebarCollapsed ? 'w-[72px]' : 'w-[320px]'} border-r border-[#E5E7EB] bg-white flex flex-col transition-all duration-200`}>
        <div className="p-3 border-b border-[#E5E7EB]">
          {!sidebarCollapsed ? (
            <div className="flex items-center justify-between gap-2">
              <div className="flex-1 pr-2">
                <div className="text-[11px] font-bold tracking-[0.15em] text-[#2A2A2A] uppercase mb-1">Makebell</div>
                <h1 className="text-2xl font-serif font-bold leading-tight">ClauseGrid</h1>
              </div>
              <button
                onClick={() => setSidebarCollapsed(true)}
                className="p-1.5 rounded-lg hover:bg-[#F5F4F0] text-[#8A8470] hover:text-[#6B6555] transition-colors flex-shrink-0"
                title="Collapse sidebar"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-center">
              <button
                onClick={() => setSidebarCollapsed(false)}
                className="p-2 rounded-lg hover:bg-[#F5F4F0] text-[#8A8470] hover:text-[#6B6555] transition-colors"
                title="Expand sidebar"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {!sidebarCollapsed && (
          <div className="p-4 border-b border-[#E5E7EB] space-y-2">
            {!showCreateProjectForm ? (
              <button
                onClick={() => setShowCreateProjectForm(true)}
                disabled={busy}
                className="w-full bg-[#1C1C1C] text-white rounded-pill px-4 py-2 text-sm font-semibold disabled:opacity-50 hover:bg-[#2A2A2A] transition-colors"
              >
                + New Project
              </button>
            ) : (
              <>
                <input
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  placeholder="Project name"
                  className="w-full border border-[#E5E7EB] rounded-lg px-3 py-2 text-sm"
                />
                <textarea
                  value={newProjectDescription}
                  onChange={(e) => setNewProjectDescription(e.target.value)}
                  placeholder="Project description"
                  className="w-full border border-[#E5E7EB] rounded-lg px-3 py-2 text-sm min-h-[70px]"
                />
                <div className="flex gap-2">
                  <button
                    onClick={createProject}
                    disabled={busy}
                    className="flex-1 bg-[#1C1C1C] text-white rounded-pill px-4 py-2 text-sm font-semibold disabled:opacity-50 hover:bg-[#2A2A2A] transition-colors"
                  >
                    Create Project
                  </button>
                  <button
                    onClick={() => {
                      setShowCreateProjectForm(false);
                      setNewProjectName('Legal Tabular Review Project');
                      setNewProjectDescription('Take-home demo project for legal contract comparison.');
                    }}
                    disabled={busy}
                    className="px-4 py-2 rounded-pill text-sm font-semibold bg-[#F5F4F0] text-[#6B6555] disabled:opacity-50 hover:bg-[#E5E7EB] transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        <div className={`flex-1 overflow-auto ${sidebarCollapsed ? 'p-2' : 'p-3'}`}>
          {!sidebarCollapsed ? (
            <>
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#8A8470] px-2 pb-2">Projects</div>
              <div className="space-y-2">
                {projects.map((project) => (
                  <div
                    key={project.id}
                    className={`group/project w-full rounded-lg border transition-colors px-3 py-3 flex items-center gap-2 ${
                      selectedProjectId === project.id
                        ? 'bg-[#EFF1F5] border-[#B8BFCE]'
                        : 'bg-white border-[#E5E7EB] hover:bg-[#FAFAF7]'
                    }`}
                  >
                    <button
                      onClick={() => setSelectedProjectId(project.id)}
                      className="flex-1 text-left min-w-0"
                    >
                      <div className="text-sm font-semibold truncate">{project.name}</div>
                      <div className="text-[11px] text-[#8A8470] mt-0.5">{project.status}</div>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void deleteProjectById(project.id);
                      }}
                      disabled={busy}
                      className="p-1.5 rounded-lg text-[#C4BFB3] hover:text-red-500 hover:bg-red-50 opacity-0 group-hover/project:opacity-100 transition-all disabled:opacity-50"
                      title="Delete project"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="space-y-1">
              {projects.map((project) => (
                <button
                  key={project.id}
                  onClick={() => setSelectedProjectId(project.id)}
                  className={`w-full h-10 rounded-lg border flex items-center justify-center transition-colors ${
                    selectedProjectId === project.id
                      ? 'bg-[#EFF1F5] border-[#B8BFCE] text-[#4A5A7B]'
                      : 'bg-white border-[#E5E7EB] text-[#C4BFB3] hover:text-[#6B6555] hover:bg-[#FAFAF7]'
                  }`}
                  title={project.name}
                >
                  <FolderOpen className="w-4 h-4" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className={`border-t border-[#E5E7EB] p-3 text-xs transition-all duration-200 ${
          uniquePendingTaskIds.length > 0
            ? 'bg-gradient-to-b from-[#FDF5F3] to-[#FBE7D8] border-t-2 border-t-[#E5B89F]'
            : 'bg-white text-[#8A8470]'
        }`}>
          {!sidebarCollapsed ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className={`${
                    uniquePendingTaskIds.length > 0 ? 'font-bold text-[#8A3B00]' : 'text-[#8A8470]'
                  }`}>
                    Tasks In Flight:
                  </span>
                  {uniquePendingTaskIds.length > 0 ? (
                    <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-[#D97757] text-white text-[10px] font-bold animate-pulse">
                      {uniquePendingTaskIds.length}
                    </span>
                  ) : (
                    <span className="text-[#8A8470]">{uniquePendingTaskIds.length}</span>
                  )}
                </div>
                <button
                  onClick={cancelAllPendingTasks}
                  disabled={busy || !selectedProjectId || !uniquePendingTaskIds.length}
                  className="px-2 py-1 rounded bg-[#FBE7D8] text-[#8A3B00] text-[10px] font-semibold disabled:opacity-30 hover:bg-[#F5D5C3] transition-colors"
                >
                  Cancel Pending
                </button>
              </div>
              {uniquePendingTaskIds.slice(0, 6).map((id) => {
                const task = tasks[id];
                return (
                  <div key={id} className="mt-2 flex items-center justify-between gap-2 bg-white/60 rounded-lg px-2 py-1.5 border border-[#E5B89F]">
                    <span className="truncate text-[#8A3B00] font-medium">
                      {task?.task_type || 'TASK'} · {task?.status || 'QUEUED'}
                    </span>
                    <button
                      onClick={() => void cancelTaskById(id)}
                      disabled={busy}
                      className="px-2 py-0.5 rounded bg-[#FBE7D8] text-[10px] font-semibold text-[#8A3B00] disabled:opacity-50 hover:bg-[#F5D5C3] transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                );
              })}
            </>
          ) : (
            <div className={`text-center text-[10px] ${
              uniquePendingTaskIds.length > 0 ? 'font-bold text-[#8A3B00]' : ''
            }`}>
              {uniquePendingTaskIds.length > 0 ? (
                <div className="flex flex-col items-center gap-1">
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[#D97757] text-white text-xs font-bold animate-pulse">
                    {uniquePendingTaskIds.length}
                  </span>
                  <span className="text-[8px]">Tasks</span>
                </div>
              ) : (
                `Tasks: ${uniquePendingTaskIds.length}`
              )}
            </div>
          )}
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-16 border-b border-[#E5E7EB] bg-white flex items-center justify-between px-5">
          <div>
            <div className="text-sm font-semibold">{selectedProject?.name || 'No project selected'}</div>
            <div className="text-xs text-[#8A8470]">{selectedProject?.description || 'Create or select a project to begin.'}</div>
          </div>
          <div className="flex items-center gap-2">
            {(['documents', 'templates', 'table', 'evaluation', 'annotations'] as WorkspaceTab[]).map((item) => (
              <button
                key={item}
                onClick={() => setTab(item)}
                className={`px-3 py-1.5 rounded-pill text-xs font-semibold ${
                  tab === item ? 'bg-[#1C1C1C] text-white' : 'bg-[#F5F4F0] text-[#6B6555]'
                }`}
              >
                {item}
              </button>
            ))}
          </div>
        </header>

        {error && (
          <div className="mx-5 mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className={`flex-1 min-h-0 overflow-hidden ${tab === 'table' ? 'p-0' : 'p-5'}`}>
          {!selectedProjectId ? (
            <div className="h-full flex items-center justify-center text-[#8A8470] text-sm">
              Select a project to continue.
            </div>
          ) : (
            <div className="h-full overflow-auto">
              {tab === 'documents' && (
                <section className="space-y-4">
                  <div className="bg-white border border-[#E5E7EB] rounded-xl p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="font-semibold">Document Ingestion</h2>
                        <p className="text-xs text-[#8A8470]">Upload PDF, DOCX, HTML, TXT. Each upload creates a parse task and document version.</p>
                      </div>
                      <label className="px-4 py-2 rounded-pill bg-[#1C1C1C] text-white text-xs font-semibold cursor-pointer">
                        Upload Files
                        <input
                          type="file"
                          className="hidden"
                          multiple
                          accept=".pdf,.doc,.docx,.html,.htm,.txt,.md"
                          onChange={(e) => uploadDocuments(e.target.files)}
                        />
                      </label>
                    </div>
                  </div>

                  <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-[#FAFAF7]">
                        <tr>
                          <th className="text-left px-4 py-3 text-xs uppercase tracking-[0.1em] text-[#8A8470]">Document</th>
                          <th className="text-left px-4 py-3 text-xs uppercase tracking-[0.1em] text-[#8A8470]">Latest Version</th>
                          <th className="text-left px-4 py-3 text-xs uppercase tracking-[0.1em] text-[#8A8470]">Parse Status</th>
                          <th className="text-left px-4 py-3 text-xs uppercase tracking-[0.1em] text-[#8A8470]">MIME</th>
                        </tr>
                      </thead>
                      <tbody>
                        {documents.map((doc) => (
                          <tr key={doc.id} className="border-t border-[#F0F0EC]">
                            <td className="px-4 py-3">{doc.filename}</td>
                            <td className="px-4 py-3">{doc.latest_version?.version_no || '-'}</td>
                            <td className="px-4 py-3">{doc.latest_version?.parse_status || 'PENDING'}</td>
                            <td className="px-4 py-3">{doc.source_mime_type || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {tab === 'templates' && (
                <section className="space-y-4">
                  <div className="bg-white border border-[#E5E7EB] rounded-xl p-4 space-y-4">
                    <div>
                      <h2 className="font-semibold">Field Template Management</h2>
                      <p className="text-xs text-[#8A8470]">Versioned schema with normalization and validation policies.</p>
                    </div>
                    <input
                      value={templateName}
                      onChange={(e) => setTemplateName(e.target.value)}
                      className="w-full border border-[#E5E7EB] rounded-lg px-3 py-2 text-sm"
                      placeholder="Template name"
                    />

                    <div className="space-y-3">
                      {draftFields.map((field, idx) => (
                        <div key={`${field.key}_${idx}`} className="grid grid-cols-12 gap-2 items-center">
                          <input
                            value={field.key}
                            onChange={(e) => updateDraftField(idx, { key: e.target.value })}
                            className="col-span-2 border border-[#E5E7EB] rounded px-2 py-1 text-xs"
                            placeholder="key"
                          />
                          <input
                            value={field.name}
                            onChange={(e) => updateDraftField(idx, { name: e.target.value })}
                            className="col-span-3 border border-[#E5E7EB] rounded px-2 py-1 text-xs"
                            placeholder="name"
                          />
                          <select
                            value={field.type}
                            onChange={(e) => updateDraftField(idx, { type: e.target.value })}
                            className="col-span-2 border border-[#E5E7EB] rounded px-2 py-1 text-xs"
                          >
                            <option value="text">text</option>
                            <option value="date">date</option>
                            <option value="number">number</option>
                            <option value="boolean">boolean</option>
                            <option value="list">list</option>
                          </select>
                          <input
                            value={field.prompt}
                            onChange={(e) => updateDraftField(idx, { prompt: e.target.value })}
                            className="col-span-4 border border-[#E5E7EB] rounded px-2 py-1 text-xs"
                            placeholder="prompt"
                          />
                          <button
                            onClick={() => removeDraftField(idx)}
                            className="col-span-1 text-xs rounded bg-red-50 text-red-700 px-2 py-1"
                          >
                            Del
                          </button>
                        </div>
                      ))}
                    </div>

                    <div className="flex gap-2">
                      <button onClick={addDraftField} className="px-3 py-1.5 rounded-pill bg-[#F5F4F0] text-xs font-semibold">
                        Add Field
                      </button>
                      <button onClick={createTemplate} disabled={busy} className="px-3 py-1.5 rounded-pill bg-[#1C1C1C] text-white text-xs font-semibold disabled:opacity-50">
                        Create Template
                      </button>
                      <button onClick={createTemplateVersion} disabled={busy || !selectedTemplateId} className="px-3 py-1.5 rounded-pill bg-[#4A5A7B] text-white text-xs font-semibold disabled:opacity-50">
                        Create New Version
                      </button>
                    </div>
                  </div>

                  <div className="bg-white border border-[#E5E7EB] rounded-xl p-4">
                    <h3 className="font-semibold mb-2">Existing Templates</h3>
                    <div className="space-y-2">
                      {templates.map((tpl) => (
                        <div key={tpl.id} className="border border-[#E5E7EB] rounded-lg p-3">
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="text-sm font-semibold">{tpl.name}</div>
                              <div className="text-xs text-[#8A8470]">Active Version: {tpl.active_version_id || '-'}</div>
                            </div>
                            <button
                              onClick={() => {
                                setSelectedTemplateId(tpl.id);
                                setSelectedTemplateVersionId(tpl.active_version_id || tpl.versions?.[0]?.id || null);
                              }}
                              className="px-3 py-1 rounded-pill bg-[#EFF1F5] text-xs font-semibold"
                            >
                              Select
                            </button>
                          </div>
                          <div className="mt-2 text-xs text-[#6B6555]">
                            Versions: {(tpl.versions || []).map((v: any) => `v${v.version_no}`).join(', ')}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
              )}

              {tab === 'table' && (
                <section className="h-full flex">
                  {/* Table Panel */}
                  <div className="flex-1 min-w-0 flex flex-col bg-white border border-[#E5E7EB] rounded-xl overflow-hidden">
                    {/* Toolbar */}
                    <div className="border-b border-[#E5E7EB] bg-[#FAFAF7]">
                      <div className="flex items-center justify-between px-4 py-2.5 gap-3">
                        {/* Actions */}
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <button onClick={runExtraction} className="px-4 py-2 rounded-lg bg-[#1C1C1C] text-white text-xs font-semibold hover:bg-[#333] transition-colors">
                            Run Extraction
                          </button>
                          <button onClick={refreshTable} className="px-4 py-2 rounded-lg bg-white border border-[#E5E7EB] text-xs font-semibold text-[#1C1C1C] hover:bg-[#F5F4F0] transition-colors">
                            Refresh Table
                          </button>
                        </div>

                        {/* Separator */}
                        <div className="w-px h-7 bg-[#E5E7EB] flex-shrink-0" />

                        {/* Configuration */}
                        <div className="flex items-center gap-4 flex-shrink-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-semibold text-[#8A8470] uppercase tracking-wider">Mode</span>
                            <select
                              value={extractionMode}
                              onChange={(e) => setExtractionMode(e.target.value as ExtractionMode)}
                              className="border border-[#E5E7EB] rounded-lg px-2.5 py-1.5 text-xs text-[#1C1C1C] bg-white focus:ring-1 focus:ring-[#4A5A7B] focus:border-[#4A5A7B] outline-none"
                            >
                              {EXTRACTION_MODES.map((mode) => (
                                <option key={mode} value={mode}>{mode}</option>
                              ))}
                            </select>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-semibold text-[#8A8470] uppercase tracking-wider">Quality</span>
                            <select
                              value={qualityProfile}
                              onChange={(e) => setQualityProfile(e.target.value as QualityProfile)}
                              className="border border-[#E5E7EB] rounded-lg px-2.5 py-1.5 text-xs text-[#1C1C1C] bg-white focus:ring-1 focus:ring-[#4A5A7B] focus:border-[#4A5A7B] outline-none"
                            >
                              {QUALITY_PROFILES.map((profile) => (
                                <option key={profile} value={profile}>{profile}</option>
                              ))}
                            </select>
                          </div>
                        </div>

                        {/* Separator */}
                        <div className="w-px h-7 bg-[#E5E7EB] flex-shrink-0" />

                        {/* Filters */}
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-[10px] font-semibold text-[#8A8470] uppercase tracking-wider hidden lg:inline">Filters</span>
                          <button
                            onClick={() => setShowUnresolvedOnly((prev) => !prev)}
                            className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${showUnresolvedOnly ? 'bg-[#FBE7D8] text-[#8A3B00] ring-1 ring-[#F0C9A8]' : 'bg-white border border-[#E5E7EB] text-[#6B6555] hover:bg-[#F5F4F0]'}`}
                          >
                            Unresolved
                          </button>
                          <button
                            onClick={() => setShowLowConfidenceOnly((prev) => !prev)}
                            className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${showLowConfidenceOnly ? 'bg-[#FFF4D6] text-[#7A5A00] ring-1 ring-[#E8D9A0]' : 'bg-white border border-[#E5E7EB] text-[#6B6555] hover:bg-[#F5F4F0]'}`}
                          >
                            Low Confidence
                          </button>
                        </div>

                        {/* Separator */}
                        <div className="w-px h-7 bg-[#E5E7EB] flex-shrink-0" />

                        {/* Baseline */}
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <span className="text-[10px] font-semibold text-[#8A8470] uppercase tracking-wider">Baseline</span>
                          <select
                            value={baselineDocumentId}
                            onChange={(e) => setBaselineDocumentId(e.target.value)}
                            className="border border-[#E5E7EB] rounded-lg px-2.5 py-1.5 text-xs bg-white focus:ring-1 focus:ring-[#4A5A7B] focus:border-[#4A5A7B] outline-none max-w-[180px]"
                          >
                            <option value="">Auto</option>
                            {(tableView?.rows || []).map((row) => (
                              <option key={row.document_id} value={row.document_id}>{row.filename}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>

                    {/* Table */}
                    <div className="flex-1 overflow-auto">
                      <table className="w-full text-sm border-collapse">
                        <thead className="bg-[#FAFAF7] sticky top-0 z-10">
                          <tr>
                            <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#8A8470] sticky left-0 bg-[#FAFAF7] w-48 border-r-2 border-[#E5E7EB]">
                              <span className="flex items-center gap-1.5">
                                <FileText className="w-3 h-3" />
                                Document
                              </span>
                            </th>
                            {(tableView?.columns || []).map((col) => (
                              <th key={col.key} className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#8A8470] min-w-[220px]">{col.name}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {displayRows.map((row) => (
                            <tr key={row.document_version_id} className="border-t border-[#F0F0EC] hover:bg-[#FAFAF7]/50 transition-colors">
                              <td className="px-4 py-3 sticky left-0 bg-white text-xs font-semibold w-48 border-r-2 border-[#E5E7EB]">{row.filename}</td>
                              {(tableView?.columns || []).map((col) => {
                                const cell = row.cells[col.key];
                                const selected = selectedCell?.row.document_version_id === row.document_version_id && selectedCell?.cell.field_key === col.key;
                                return (
                                  <td
                                    key={`${row.document_version_id}_${col.key}`}
                                    className={`px-4 py-3 align-top cursor-pointer transition-colors ${selected ? 'bg-[#EFF1F5] ring-2 ring-inset ring-[#4A5A7B]' : 'hover:bg-[#FAFAF7]'}`}
                                    onClick={() => {
                                      setSelectedRowVersionId(row.document_version_id);
                                      setSelectedFieldKey(col.key);
                                    }}
                                  >
                                    <div className="text-xs text-[#1C1C1C] whitespace-pre-wrap break-words">
                                      {cell?.effective_value || '-'}
                                    </div>
                                    <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
                                      {cell?.review_overlay?.status && (
                                        <span className="px-1.5 py-0.5 rounded bg-[#F5F4F0] text-[#6B6555]">{cell.review_overlay.status}</span>
                                      )}
                                      {cell?.ai_result?.extraction_method && (
                                        <span className="px-1.5 py-0.5 rounded bg-[#E8EEF8] text-[#304A7A]">{cell.ai_result.extraction_method}</span>
                                      )}
                                      {cell?.ai_result?.verifier_status && cell.ai_result.verifier_status !== 'SKIPPED' && (
                                        <span
                                          className={`px-1.5 py-0.5 rounded ${
                                            cell.ai_result.verifier_status === 'PASS'
                                              ? 'bg-[#E4F8EC] text-[#1C6A3F]'
                                              : cell.ai_result.verifier_status === 'PARTIAL'
                                                ? 'bg-[#FFF4D6] text-[#7A5A00]'
                                                : 'bg-[#FBE4E6] text-[#8D1D2C]'
                                          }`}
                                        >
                                          {cell.ai_result.verifier_status}
                                        </span>
                                      )}
                                      {(cell?.ai_result?.confidence_score || 0) < 0.55 && (
                                        <span className="px-1.5 py-0.5 rounded bg-[#FFF4D6] text-[#7A5A00]">LOW CONF</span>
                                      )}
                                      {cell?.is_diff && (
                                        <span className="px-1.5 py-0.5 rounded bg-[#FFF4D6] text-[#7A5A00]">DIFF</span>
                                      )}
                                    </div>
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Side panels when a cell is selected */}
                  {selectedCell && (
                    <>
                      {/* Draggable Divider: Table | Review */}
                      <div
                        className="w-[6px] flex-shrink-0 cursor-col-resize group relative hover:bg-[#4A5A7B]/10 transition-colors flex items-center justify-center"
                        onMouseDown={(e) => handleDividerMouseDown(e, 'review')}
                        title="Drag to resize"
                      >
                        <div className="w-[2px] h-full bg-[#E5E7EB] group-hover:bg-[#4A5A7B] transition-colors" />
                        <div className="absolute inset-y-0 flex items-center">
                          <GripVertical className="w-3 h-3 text-[#C4BFB3] group-hover:text-[#4A5A7B] transition-colors" />
                        </div>
                      </div>

                      {/* Review & Audit Panel */}
                      <div
                        className="flex-shrink-0 flex flex-col bg-white border border-[#E5E7EB] rounded-xl overflow-hidden"
                        style={{ width: reviewPanelWidth }}
                      >
                        <div className="px-4 py-2.5 border-b border-[#E5E7EB] flex items-center justify-between bg-[#FAFAF7]">
                          <div className="min-w-0">
                            <h3 className="font-semibold text-sm">Review & Audit</h3>
                            <p className="text-[10px] text-[#8A8470] mt-0.5 truncate">{selectedCell.row.filename} &middot; {selectedCell.cell.field_key}</p>
                          </div>
                          <button
                            onClick={() => { setSelectedRowVersionId(null); setSelectedFieldKey(null); }}
                            className="p-1.5 rounded-lg hover:bg-[#E5E7EB] text-[#8A8470] hover:text-[#333] transition-colors flex-shrink-0"
                            title="Close panel"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>

                        <div className="flex-1 overflow-auto p-3 space-y-3">
                          <div className="border border-[#E5E7EB] rounded-xl p-3 bg-[#FAFAF7]">
                            <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#8A8470] mb-1.5">AI Result</div>
                            <div className="text-sm text-[#1C1C1C] leading-relaxed">{selectedCell.cell.ai_result?.value || '-'}</div>
                            <div className="text-xs text-[#6B6555] mt-1.5 leading-relaxed">{selectedCell.cell.ai_result?.evidence_summary || 'No evidence summary.'}</div>
                            <div className="mt-2 flex flex-wrap gap-1 text-[10px]">
                              {selectedCell.cell.ai_result?.extraction_method && (
                                <span className="px-2 py-0.5 rounded-full bg-[#E8EEF8] text-[#304A7A] font-medium">
                                  {selectedCell.cell.ai_result.extraction_method}
                                </span>
                              )}
                              {selectedCell.cell.ai_result?.verifier_status && selectedCell.cell.ai_result.verifier_status !== 'SKIPPED' && (
                                <span className="px-2 py-0.5 rounded-full bg-[#F5F4F0] text-[#6B6555] font-medium">
                                  verifier: {selectedCell.cell.ai_result.verifier_status}
                                </span>
                              )}
                              <span className="px-2 py-0.5 rounded-full bg-[#F5F4F0] text-[#6B6555] font-medium">
                                conf: {(selectedCell.cell.ai_result?.confidence_score || 0).toFixed(3)}
                              </span>
                            </div>
                            {selectedCell.cell.ai_result?.uncertainty_reason && (
                              <div className="text-[11px] text-[#8A3B00] mt-2 bg-[#FBE7D8] rounded-lg px-2 py-1">
                                {selectedCell.cell.ai_result.uncertainty_reason}
                              </div>
                            )}
                          </div>

                          <div className="space-y-2.5">
                            <label className="text-xs block">
                              <span className="block text-[10px] font-semibold text-[#8A8470] uppercase tracking-wider mb-1">Review Status</span>
                              <select
                                value={reviewStatus}
                                onChange={(e) => setReviewStatus(e.target.value as ReviewStatus)}
                                className="w-full border border-[#E5E7EB] rounded-lg px-3 py-1.5 text-sm focus:ring-1 focus:ring-[#4A5A7B] focus:border-[#4A5A7B] outline-none"
                              >
                                {REVIEW_STATUSES.map((status) => (
                                  <option key={status} value={status}>{status}</option>
                                ))}
                              </select>
                            </label>

                            <label className="text-xs block">
                              <span className="block text-[10px] font-semibold text-[#8A8470] uppercase tracking-wider mb-1">Manual Value</span>
                              <textarea
                                value={manualValue}
                                onChange={(e) => setManualValue(e.target.value)}
                                className="w-full border border-[#E5E7EB] rounded-lg px-3 py-1.5 text-sm min-h-[60px] focus:ring-1 focus:ring-[#4A5A7B] focus:border-[#4A5A7B] outline-none resize-y"
                              />
                            </label>

                            <div className="grid grid-cols-2 gap-2">
                              <label className="text-xs block">
                                <span className="block text-[10px] font-semibold text-[#8A8470] uppercase tracking-wider mb-1">Reviewer</span>
                                <input
                                  value={reviewer}
                                  onChange={(e) => setReviewer(e.target.value)}
                                  className="w-full border border-[#E5E7EB] rounded-lg px-3 py-1.5 text-sm focus:ring-1 focus:ring-[#4A5A7B] focus:border-[#4A5A7B] outline-none"
                                />
                              </label>
                              <label className="text-xs block">
                                <span className="block text-[10px] font-semibold text-[#8A8470] uppercase tracking-wider mb-1">Notes</span>
                                <input
                                  value={reviewNotes}
                                  onChange={(e) => setReviewNotes(e.target.value)}
                                  className="w-full border border-[#E5E7EB] rounded-lg px-3 py-1.5 text-sm focus:ring-1 focus:ring-[#4A5A7B] focus:border-[#4A5A7B] outline-none"
                                />
                              </label>
                            </div>
                          </div>

                          <button onClick={saveReview} className="w-full px-4 py-2 rounded-lg bg-[#1C1C1C] text-white text-xs font-semibold hover:bg-[#333] transition-colors">
                            Save Review Decision
                          </button>

                          <div className="border-t border-[#E5E7EB] pt-3">
                            <div className="text-[10px] font-semibold text-[#8A8470] uppercase tracking-wider mb-1.5">Annotation</div>
                            <textarea
                              value={annotationBody}
                              onChange={(e) => setAnnotationBody(e.target.value)}
                              className="w-full border border-[#E5E7EB] rounded-lg px-3 py-1.5 text-sm min-h-[50px] focus:ring-1 focus:ring-[#4A5A7B] focus:border-[#4A5A7B] outline-none resize-y"
                              placeholder="Comment tied to this field/document"
                            />
                            <button onClick={addAnnotation} className="mt-1.5 w-full px-4 py-2 rounded-lg bg-[#4A5A7B] text-white text-xs font-semibold hover:bg-[#3D4D6A] transition-colors">
                              Add Annotation
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Draggable Divider: Review | Viewer */}
                      <div
                        className="w-[6px] flex-shrink-0 cursor-col-resize group relative hover:bg-[#4A5A7B]/10 transition-colors flex items-center justify-center"
                        onMouseDown={(e) => handleDividerMouseDown(e, 'viewer')}
                        title="Drag to resize"
                      >
                        <div className="w-[2px] h-full bg-[#E5E7EB] group-hover:bg-[#4A5A7B] transition-colors" />
                        <div className="absolute inset-y-0 flex items-center">
                          <GripVertical className="w-3 h-3 text-[#C4BFB3] group-hover:text-[#4A5A7B] transition-colors" />
                        </div>
                      </div>

                      {/* Citation / Document Viewer Panel */}
                      <div
                        className="flex-shrink-0 flex flex-col bg-white border border-[#E5E7EB] rounded-xl overflow-hidden"
                        style={{ width: viewerPanelWidth }}
                      >
                        <div className="px-4 py-2.5 border-b border-[#E5E7EB] flex items-center justify-between bg-[#FAFAF7]">
                          <div className="min-w-0">
                            <h3 className="font-semibold text-sm">Document Viewer</h3>
                            <p className="text-[10px] text-[#8A8470] mt-0.5 truncate">{selectedCell.row.filename}</p>
                          </div>
                          {/* Viewer Controls */}
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <button
                              onClick={() => setViewerZoom((z) => Math.max(50, z - 15))}
                              className="p-1.5 rounded-lg hover:bg-[#E5E7EB] text-[#8A8470] hover:text-[#333] transition-colors"
                              title="Zoom Out"
                            >
                              <ZoomOut className="w-3.5 h-3.5" />
                            </button>
                            <span className="text-[10px] font-semibold text-[#8A8470] min-w-[36px] text-center tabular-nums">{viewerZoom}%</span>
                            <button
                              onClick={() => setViewerZoom((z) => Math.min(200, z + 15))}
                              className="p-1.5 rounded-lg hover:bg-[#E5E7EB] text-[#8A8470] hover:text-[#333] transition-colors"
                              title="Zoom In"
                            >
                              <ZoomIn className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setViewerZoom(100)}
                              className="p-1.5 rounded-lg hover:bg-[#E5E7EB] text-[#8A8470] hover:text-[#333] transition-colors"
                              title="Fit to Width"
                            >
                              <Maximize2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                        <div className="flex-1 overflow-auto bg-[#F5F4F0]">
                          {selectedViewerDocument ? (
                            <div
                              className="h-full"
                              style={{
                                transform: `scale(${viewerZoom / 100})`,
                                transformOrigin: 'top left',
                                width: `${10000 / viewerZoom}%`,
                                minHeight: '100%',
                                height: '100%',
                              }}
                            >
                              <DocumentViewer document={selectedViewerDocument} cell={selectedViewerCell} />
                            </div>
                          ) : (
                            <div className="h-full flex items-center justify-center text-xs text-[#8A8470]">
                              No document preview available.
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </section>
              )}

              {tab === 'evaluation' && (
                <section className="space-y-4">
                  <div className="bg-white border border-[#E5E7EB] rounded-xl p-4 space-y-3">
                    <h2 className="font-semibold">Quality Evaluation</h2>
                    <p className="text-xs text-[#8A8470]">Compare AI extraction output against human-labeled references.</p>

                    <input
                      value={groundTruthName}
                      onChange={(e) => setGroundTruthName(e.target.value)}
                      className="w-full border border-[#E5E7EB] rounded px-3 py-2 text-sm"
                      placeholder="Ground truth set name"
                    />
                    <textarea
                      value={groundTruthInput}
                      onChange={(e) => setGroundTruthInput(e.target.value)}
                      className="w-full border border-[#E5E7EB] rounded px-3 py-2 text-sm min-h-[180px] font-mono"
                      placeholder='[{"document_version_id":"dv_x","field_key":"effective_date","expected_value":"2025-01-01"}]'
                    />

                    <div className="flex gap-2">
                      <button onClick={createGroundTruth} className="px-3 py-2 rounded-pill bg-[#4A5A7B] text-white text-xs font-semibold">
                        Save Ground Truth
                      </button>
                      <button
                        onClick={runEvaluation}
                        disabled={!groundTruthSetId || !tableView?.extraction_run_id}
                        className="px-3 py-2 rounded-pill bg-[#1C1C1C] text-white text-xs font-semibold disabled:opacity-50"
                      >
                        Run Evaluation
                      </button>
                    </div>

                    <div className="text-xs text-[#6B6555]">
                      Ground Truth Set ID: {groundTruthSetId || '-'}
                      <br />
                      Extraction Run ID: {tableView?.extraction_run_id || '-'}
                      <br />
                      Evaluation Run ID: {evaluationRunId || '-'}
                    </div>
                  </div>

                  {evaluationReport && (
                    <div className="bg-white border border-[#E5E7EB] rounded-xl p-4">
                      <h3 className="font-semibold mb-3">Evaluation Report</h3>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                        <div className="bg-[#FAFAF7] rounded p-2"><strong>Accuracy:</strong> {evaluationReport.field_level_accuracy}</div>
                        <div className="bg-[#FAFAF7] rounded p-2"><strong>Coverage:</strong> {evaluationReport.coverage}</div>
                        <div className="bg-[#FAFAF7] rounded p-2"><strong>Norm Validity:</strong> {evaluationReport.normalization_validity}</div>
                        <div className="bg-[#FAFAF7] rounded p-2"><strong>F1:</strong> {evaluationReport.f1}</div>
                      </div>
                      <div className="mt-3">
                        <div className="text-xs uppercase tracking-[0.1em] text-[#8A8470] mb-1">Qualitative Notes</div>
                        <ul className="text-sm list-disc pl-5 space-y-1">
                          {(evaluationReport.qualitative_notes || []).slice(0, 12).map((note, idx) => (
                            <li key={idx}>{note}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                </section>
              )}

              {tab === 'annotations' && (
                <section className="space-y-4">
                  <div className="bg-white border border-[#E5E7EB] rounded-xl p-4">
                    <h2 className="font-semibold mb-2">Diff & Annotation Layer (Lightweight)</h2>
                    <p className="text-xs text-[#8A8470]">Annotations are non-destructive and do not modify extraction values unless review decisions are approved separately.</p>
                  </div>

                  <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-[#FAFAF7]">
                        <tr>
                          <th className="text-left px-4 py-3 text-xs uppercase tracking-[0.1em] text-[#8A8470]">Field</th>
                          <th className="text-left px-4 py-3 text-xs uppercase tracking-[0.1em] text-[#8A8470]">Document Version</th>
                          <th className="text-left px-4 py-3 text-xs uppercase tracking-[0.1em] text-[#8A8470]">Author</th>
                          <th className="text-left px-4 py-3 text-xs uppercase tracking-[0.1em] text-[#8A8470]">Approved</th>
                          <th className="text-left px-4 py-3 text-xs uppercase tracking-[0.1em] text-[#8A8470]">Comment</th>
                        </tr>
                      </thead>
                      <tbody>
                        {annotations.map((annotation) => (
                          <tr key={annotation.id} className="border-t border-[#F0F0EC]">
                            <td className="px-4 py-3">{annotation.field_key}</td>
                            <td className="px-4 py-3">{annotation.document_version_id}</td>
                            <td className="px-4 py-3">{annotation.author || '-'}</td>
                            <td className="px-4 py-3">{annotation.approved ? 'Yes' : 'No'}</td>
                            <td className="px-4 py-3">{annotation.body}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default App;
