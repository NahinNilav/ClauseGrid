import React from 'react';
import { DocumentFile, ExtractionCell } from '../../types';
import { pickPrimaryCitation } from './common';
import { HtmlCitationViewer } from './HtmlCitationViewer';
import { MarkdownFallbackViewer } from './MarkdownFallbackViewer';
import { PdfCitationViewer } from './PdfCitationViewer';

interface DocumentViewerProps {
  document: DocumentFile;
  cell?: ExtractionCell | null;
}

export const DocumentViewer: React.FC<DocumentViewerProps> = ({ document, cell }) => {
  const format = document.artifact?.format;
  const primaryCitation = pickPrimaryCitation(cell?.citations);

  if (format === 'pdf' && document.sourceContentBase64) {
    return (
      <PdfCitationViewer
        sourceContentBase64={document.sourceContentBase64}
        sourceMimeType={document.sourceMimeType}
        filename={document.name}
        cell={cell}
        pageIndex={document.artifact?.metadata?.page_index}
      />
    );
  }

  if (format === 'html' && document.artifact?.preview_html) {
    return <HtmlCitationViewer previewHtml={document.artifact.preview_html} cell={cell} />;
  }

  return (
    <MarkdownFallbackViewer
      contentBase64={document.content}
      cell={cell}
      fallbackReason={
        format === 'pdf' && !document.sourceContentBase64
          ? 'Original PDF bytes unavailable; using text preview fallback.'
          : !primaryCitation
            ? 'No citation anchor available; showing converted text.'
            : 'Structured viewer unavailable for this format; using text preview fallback.'
      }
    />
  );
};
