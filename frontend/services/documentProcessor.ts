import { createRunId, logRuntimeEvent } from './runtimeLogger';
import { ParsedArtifact } from '../types';

export interface ProcessedDocumentPayload {
  markdown: string;
  artifact?: ParsedArtifact;
}

export const processDocumentToMarkdown = async (file: File): Promise<ProcessedDocumentPayload> => {
  const runId = createRunId('conversion');
  const startedAt = performance.now();

  logRuntimeEvent({
    event: 'document_conversion_started',
    stage: 'conversion',
    runId,
    metadata: {
      file_name: file.name,
      file_size_bytes: file.size,
      mime_type: file.type || 'unknown',
    },
  });

  try {
    const formData = new FormData();
    formData.append('file', file);

    // Send to local backend running Docling
    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000';
    const response = await fetch(`${apiUrl}/convert`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      logRuntimeEvent({
        event: 'document_conversion_failed',
        level: 'error',
        stage: 'conversion',
        runId,
        message: `Conversion request failed with status ${response.status}`,
        metadata: {
          file_name: file.name,
          status_code: response.status,
          duration_ms: Math.round(performance.now() - startedAt),
        },
      });
      throw new Error(`Conversion failed: ${response.statusText}`);
    }

    const data = await response.json();
    const markdown = data.markdown || "";
    const artifact = data.artifact as ParsedArtifact | undefined;

    logRuntimeEvent({
      event: 'document_conversion_completed',
      stage: 'conversion',
      runId,
      metadata: {
        file_name: file.name,
        duration_ms: Math.round(performance.now() - startedAt),
        markdown_chars: markdown.length,
        artifact_format: artifact?.format || 'none',
        artifact_blocks: artifact?.blocks?.length || 0,
      },
    });

    return { markdown, artifact };

  } catch (error) {
    console.error("Document Conversion failed:", error);
    logRuntimeEvent({
      event: 'document_conversion_exception',
      level: 'error',
      stage: 'conversion',
      runId,
      message: error instanceof Error ? error.message : 'Unknown conversion error',
      metadata: {
        file_name: file.name,
        duration_ms: Math.round(performance.now() - startedAt),
      },
    });
    throw new Error(`Failed to convert ${file.name}. Is the backend server running?`);
  }
};
