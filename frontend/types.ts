export interface DocumentFile {
  id: string;
  documentVersionId?: string;
  name: string;
  type: string;
  size: number;
  content: string; // Base64 string for PDF/Images, or raw text for TXT
  mimeType: string;
  sourceContentBase64?: string;
  sourceMimeType?: string;
  sourceAvailable?: boolean;
  artifact?: ParsedArtifact;
}

export interface SourceCitation {
  source: 'pdf' | 'html' | 'txt' | 'docx';
  snippet: string;
  page?: number;
  bbox?: number[];
  selector?: string;
  start_char?: number;
  end_char?: number;
}

export interface ArtifactBlock {
  id: string;
  type: string;
  text: string;
  citations: SourceCitation[];
  meta?: Record<string, unknown>;
}

export interface ParsedArtifact {
  doc_version_id: string;
  format: 'pdf' | 'html' | 'txt' | 'docx';
  mime_type?: string;
  markdown: string;
  blocks: ArtifactBlock[];
  chunks: Array<Record<string, unknown>>;
  citation_index: Record<string, SourceCitation>;
  preview_html?: string;
  metadata?: {
    parser?: string;
    dom_map_size?: number;
    worker_error?: string | null;
    page_index?: Record<string, { width: number; height: number }>;
    [key: string]: unknown;
  };
}

export type ColumnType = 'text' | 'number' | 'date' | 'boolean' | 'list';

export type ReviewStatus = 'CONFIRMED' | 'REJECTED' | 'MANUAL_UPDATED' | 'MISSING_DATA';
export type ProjectStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
export type ExtractionRunStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'CANCELED';

export interface TemplateFieldDefinition {
  key: string;
  name: string;
  type: ColumnType | string;
  prompt: string;
  required?: boolean;
}

export interface TemplateVersion {
  id: string;
  template_id: string;
  version_no: number;
  fields_json: TemplateFieldDefinition[];
  validation_policy_json?: Record<string, unknown>;
  normalization_policy_json?: Record<string, unknown>;
  created_at: string;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  status: ProjectStatus;
  created_at: string;
  updated_at: string;
}

export interface ReviewOverlay {
  id?: string;
  status: ReviewStatus;
  manual_value?: string | null;
  reviewer?: string | null;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface AIFieldExtraction {
  id?: string;
  extraction_run_id?: string;
  document_version_id: string;
  template_version_id: string;
  field_key: string;
  field_name: string;
  field_type: string;
  raw_text: string;
  value: string;
  normalized_value: string;
  normalization_valid: number | boolean;
  confidence_score: number;
  citations_json: SourceCitation[] | SourceCitation;
  evidence_summary?: string;
  fallback_reason?: 'NOT_FOUND' | 'AMBIGUOUS' | 'PARSER_ERROR' | 'MODEL_ERROR' | null;
  extraction_method?: 'deterministic' | 'llm_hybrid' | 'llm_reasoning';
  model_name?: string | null;
  retrieval_context_json?: Array<Record<string, unknown>>;
  verifier_status?: 'PASS' | 'PARTIAL' | 'FAIL' | 'SKIPPED';
  uncertainty_reason?: string | null;
}

export interface FieldCellView {
  field_key: string;
  ai_result: AIFieldExtraction | null;
  review_overlay: ReviewOverlay | null;
  effective_value: string;
  is_diff: boolean;
}

export interface ExtractionRun {
  id: string;
  project_id: string;
  template_version_id: string;
  status: ExtractionRunStatus;
  total_cells: number;
  completed_cells: number;
  failed_cells: number;
  trigger_reason?: string;
  error_message?: string | null;
  created_at: string;
  updated_at: string;
}

export interface EvaluationReport {
  total_labels: number;
  matched_labels: number;
  field_level_accuracy: number;
  coverage: number;
  normalization_validity: number;
  precision: number;
  recall: number;
  f1: number;
  qualitative_notes: string[];
}

export interface RequestTask {
  id: string;
  project_id?: string | null;
  task_type: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED';
  entity_id?: string | null;
  progress_current: number;
  progress_total: number;
  error_message?: string | null;
  payload_json?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Column {
  id: string;
  name: string;
  type: ColumnType;
  prompt: string;
  status: 'idle' | 'extracting' | 'completed' | 'error';
  width?: number;
}

export interface ExtractionCell {
  value: string;
  confidence: 'High' | 'Medium' | 'Low';
  quote: string;
  page: number;
  reasoning: string;
  citations?: SourceCitation[];
  // UI State for review workflow
  status?: 'verified' | 'needs_review' | 'edited';
}

export interface ExtractionResult {
  [docId: string]: {
    [colId: string]: ExtractionCell | null;
  };
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: number;
}

export type ViewMode = 'grid' | 'chat';
export type SidebarMode = 'none' | 'verify' | 'chat';

// Project persistence types
export interface SavedProject {
  version: 1;
  name: string;
  savedAt: string;  // ISO timestamp
  columns: Column[];
  documents: DocumentFile[];
  results: ExtractionResult;
  selectedModel: string;
}

// Column template library types
export interface ColumnTemplate {
  id: string;
  name: string;
  type: ColumnType;
  prompt: string;
  category?: string;  // e.g., "Legal", "Financial", "Dates"
  createdAt: string;
}

export interface ColumnLibrary {
  version: 1;
  templates: ColumnTemplate[];
}
