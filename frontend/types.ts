export interface DocumentFile {
  id: string;
  name: string;
  type: string;
  size: number;
  content: string; // Base64 string for PDF/Images, or raw text for TXT
  mimeType: string;
  sourceContentBase64?: string;
  sourceMimeType?: string;
  artifact?: ParsedArtifact;
}

export interface SourceCitation {
  source: 'pdf' | 'html' | 'txt';
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
  format: 'pdf' | 'html' | 'txt';
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
