import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ExtractionCell, SourceCitation } from '../../types';
import { centerVerticalScroll, pickPrimaryCitation } from './common';
import { logRuntimeEvent } from '../../services/runtimeLogger';

interface PdfCitationViewerProps {
  sourceContentBase64: string;
  sourceMimeType?: string;
  filename: string;
  cell?: ExtractionCell | null;
  primaryCitation?: SourceCitation | null;
  pageIndex?: Record<string, { width: number; height: number }>;
}

interface RenderedPdfPage {
  page: number;
  page_count: number;
  page_width: number;
  page_height: number;
  image_width: number;
  image_height: number;
  image_base64: string;
  matched_bbox?: number[] | null;
}

const decodeBase64ToBytes = (base64: string): Uint8Array => {
  const binary = atob(base64.replace(/^data:.*;base64,/, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const bboxToOverlayStyle = (
  bbox: number[],
  imageWidth: number,
  imageHeight: number,
  pageWidth: number,
  pageHeight: number
) => {
  const scaleX = imageWidth / pageWidth;
  const scaleY = imageHeight / pageHeight;

  const x0 = bbox[0] * scaleX;
  const yTop = (pageHeight - bbox[3]) * scaleY;
  const width = (bbox[2] - bbox[0]) * scaleX;
  const height = (bbox[3] - bbox[1]) * scaleY;

  return {
    left: Math.max(0, x0),
    top: Math.max(0, yTop),
    width: Math.max(2, width),
    height: Math.max(2, height),
  };
};

const isUsableBbox = (bbox: number[] | null | undefined): bbox is number[] => {
  return Boolean(
    bbox &&
      bbox.length === 4 &&
      Number.isFinite(bbox[0]) &&
      Number.isFinite(bbox[1]) &&
      Number.isFinite(bbox[2]) &&
      Number.isFinite(bbox[3]) &&
      bbox[2] > bbox[0] &&
      bbox[3] > bbox[1]
  );
};

export const PdfCitationViewer: React.FC<PdfCitationViewerProps> = ({
  sourceContentBase64,
  sourceMimeType,
  filename,
  cell,
  primaryCitation: preferredCitation,
  pageIndex,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const renderTokenRef = useRef(0);

  const primaryCitation = preferredCitation || pickPrimaryCitation(cell?.citations);
  const [page, setPage] = useState<number>(primaryCitation?.page || cell?.page || 1);
  const [renderedPage, setRenderedPage] = useState<RenderedPdfPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pageKey = String(page);
  const pageMeta = pageIndex?.[pageKey] || null;

  const effectiveBBox = useMemo(() => {
    if (isUsableBbox(renderedPage?.matched_bbox || null)) {
      return renderedPage?.matched_bbox || null;
    }
    if (isUsableBbox(primaryCitation?.bbox || null)) {
      return primaryCitation?.bbox || null;
    }
    return null;
  }, [primaryCitation?.bbox, renderedPage?.matched_bbox]);

  useEffect(() => {
    setPage(primaryCitation?.page || cell?.page || 1);
  }, [primaryCitation?.page, cell?.page]);

  useEffect(() => {
    renderTokenRef.current += 1;
    const token = renderTokenRef.current;

    const renderPage = async () => {
      setLoading(true);
      setError(null);
      try {
        const formData = new FormData();
        const bytes = decodeBase64ToBytes(sourceContentBase64);
        const blob = new Blob([bytes], { type: sourceMimeType || 'application/pdf' });
        formData.append('file', blob, filename || 'document.pdf');
        formData.append('page', String(page));
        formData.append('scale', '1.8');
        formData.append('snippet', primaryCitation?.snippet || cell?.quote || cell?.value || '');

        const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000';
        const response = await fetch(`${apiUrl}/render-pdf-page`, {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          throw new Error(`render-pdf-page failed with ${response.status}`);
        }

        const data = (await response.json()) as RenderedPdfPage;
        if (token !== renderTokenRef.current) {
          return;
        }

        setRenderedPage(data);
        setLoading(false);

        logRuntimeEvent({
          event: 'citation_target_resolved',
          stage: 'verification',
          metadata: {
            doc_format: 'pdf',
            citation_source: primaryCitation?.source || 'pdf',
            page,
            bbox_hit: isUsableBbox(primaryCitation?.bbox || null),
            matched_bbox_hit: Boolean(data.matched_bbox?.length === 4),
          },
        });
      } catch (err) {
        if (token !== renderTokenRef.current) {
          return;
        }
        setLoading(false);
        setRenderedPage(null);
        setError(err instanceof Error ? err.message : 'Failed to render PDF page');
        logRuntimeEvent({
          event: 'citation_target_missing',
          stage: 'verification',
          level: 'warning',
          metadata: {
            doc_format: 'pdf',
            citation_source: primaryCitation?.source || 'pdf',
            page,
            fallback_reason: 'pdf_render_failed',
          },
        });
      }
    };

    const timer = setTimeout(() => {
      void renderPage();
    }, 120);

    return () => clearTimeout(timer);
  }, [sourceContentBase64, sourceMimeType, filename, page, primaryCitation?.snippet, cell?.quote, cell?.value]);

  useEffect(() => {
    if (!scrollContainerRef.current || !renderedPage) {
      return;
    }
    const container = scrollContainerRef.current;
    container.scrollLeft = 0;

    if (!isUsableBbox(effectiveBBox)) {
      container.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
      logRuntimeEvent({
        event: 'citation_scroll_fallback_used',
        stage: 'verification',
        level: 'warning',
        metadata: {
          doc_format: 'pdf',
          citation_source: primaryCitation?.source || 'pdf',
          page,
          fallback_reason: 'bbox_unavailable',
        },
      });
      return;
    }

    const pageWidth = pageMeta?.width || renderedPage.page_width;
    const pageHeight = pageMeta?.height || renderedPage.page_height;
    const overlay = bboxToOverlayStyle(
      effectiveBBox,
      renderedPage.image_width,
      renderedPage.image_height,
      pageWidth,
      pageHeight
    );

    centerVerticalScroll(container, overlay.top, overlay.height);
    container.scrollLeft = 0;

    logRuntimeEvent({
      event: 'citation_scroll_applied',
      stage: 'verification',
      metadata: {
        doc_format: 'pdf',
        citation_source: primaryCitation?.source || 'pdf',
        page,
        bbox_hit: true,
      },
    });
  }, [renderedPage, effectiveBBox, page, pageMeta?.height, pageMeta?.width, primaryCitation?.source]);

  const pageCount = renderedPage?.page_count || 1;

  return (
    <div ref={scrollContainerRef} className="h-full overflow-auto p-8 md:p-12 bg-[#E5E7EB] scroll-smooth">
      <div className="max-w-[900px] w-full mx-auto space-y-3">
        <div className="flex items-center justify-between text-xs text-[#8A8470]">
          <span>Rendered PDF Evidence</span>
          <div className="flex items-center gap-2">
            <button
              className="px-2 py-1 rounded border border-[#DDD9D0] disabled:opacity-50"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
            >
              Prev
            </button>
            <span>{page} / {pageCount}</span>
            <button
              className="px-2 py-1 rounded border border-[#DDD9D0] disabled:opacity-50"
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              disabled={page >= pageCount || loading}
            >
              Next
            </button>
          </div>
        </div>

        {loading && (
          <div className="bg-white rounded-xl shadow-card p-6 text-sm text-[#6B6555]">
            Rendering cited PDF page...
          </div>
        )}

        {error && (
          <div className="bg-white rounded-xl shadow-card p-6 text-sm text-red-700">
            {error}
          </div>
        )}

        {!loading && renderedPage && (
          <div className="relative bg-white rounded-xl shadow-card p-4 inline-block">
            <img
              src={`data:image/png;base64,${renderedPage.image_base64}`}
              alt={`PDF page ${renderedPage.page}`}
              className="block max-w-full h-auto"
              width={renderedPage.image_width}
              height={renderedPage.image_height}
            />

            {isUsableBbox(effectiveBBox) && (() => {
              const pageWidth = pageMeta?.width || renderedPage.page_width;
              const pageHeight = pageMeta?.height || renderedPage.page_height;
              const overlay = bboxToOverlayStyle(
                effectiveBBox,
                renderedPage.image_width,
                renderedPage.image_height,
                pageWidth,
                pageHeight
              );
              return (
                <div
                  className="absolute border-[3px] border-[#C2410C] bg-[#FACC15]/35 shadow-[0_0_0_2px_rgba(251,191,36,0.35)] pointer-events-none"
                  style={{
                    left: overlay.left + 16,
                    top: overlay.top + 16,
                    width: Math.max(8, overlay.width),
                    height: Math.max(8, overlay.height),
                  }}
                />
              );
            })()}

            {!isUsableBbox(effectiveBBox) && (
              <div className="mt-3 text-xs text-[#8A8470]">
                Citation bbox unavailable on this page; rendered page shown without box highlight.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
