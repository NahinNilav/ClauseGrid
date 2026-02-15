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
  match_mode?: 'exact' | 'fuzzy' | 'char_range' | 'none' | string;
  match_confidence?: number;
  used_snippet?: string | null;
  bbox_source?: 'matched_snippet' | 'citation_bbox' | 'none' | string;
  warning_code?: string | null;
}

const decodeBase64ToBytes = (base64: string): Uint8Array => {
  const binary = atob(base64.replace(/^data:.*;base64,/, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const normalizeBbox = (bbox: number[] | null | undefined): number[] | null => {
  if (!bbox || bbox.length !== 4) return null;
  const values = bbox.map((value) => Number(value));
  if (values.some((value) => !Number.isFinite(value))) return null;
  const left = Math.min(values[0], values[2]);
  const right = Math.max(values[0], values[2]);
  const bottom = Math.min(values[1], values[3]);
  const top = Math.max(values[1], values[3]);
  if (right <= left || top <= bottom) return null;
  return [left, bottom, right, top];
};

const isUsableBbox = (bbox: number[] | null | undefined): bbox is number[] => Boolean(normalizeBbox(bbox));

const bboxToOverlayStyle = (
  bbox: number[],
  displayWidth: number,
  displayHeight: number,
  pageWidth: number,
  pageHeight: number
) => {
  const safePageWidth = Math.max(pageWidth, 1);
  const safePageHeight = Math.max(pageHeight, 1);
  const scaleX = displayWidth / safePageWidth;
  const scaleY = displayHeight / safePageHeight;

  const x0 = bbox[0] * scaleX;
  const yTop = (safePageHeight - bbox[3]) * scaleY;
  const width = (bbox[2] - bbox[0]) * scaleX;
  const height = (bbox[3] - bbox[1]) * scaleY;

  return {
    left: Math.max(0, x0),
    top: Math.max(0, yTop),
    width: Math.max(2, width),
    height: Math.max(2, height),
  };
};

const hasPlausibleArea = (bbox: number[], pageWidth: number, pageHeight: number): boolean => {
  const normalized = normalizeBbox(bbox);
  if (!normalized) return false;
  if (pageWidth <= 0 || pageHeight <= 0) return false;
  const [x0, y0, x1, y1] = normalized;
  if (x0 < -1 || y0 < -1 || x1 > pageWidth + 1 || y1 > pageHeight + 1) {
    return false;
  }
  const areaRatio = ((x1 - x0) * (y1 - y0)) / (pageWidth * pageHeight);
  return areaRatio >= 0.0001 && areaRatio <= 0.35;
};

const expandIsoDateProbes = (value: string): string[] => {
  const normalized = (value || '').trim();
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return [];
  const [, year, monthRaw, dayRaw] = match;
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const monthNames = [
    '',
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  const monthShort = [
    '',
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  if (month < 1 || month >= monthNames.length) return [];
  return [
    `${monthNames[month]} ${day}, ${year}`,
    `${monthShort[month]} ${day}, ${year}`,
    `${day} ${monthNames[month]} ${year}`,
    `${day} ${monthShort[month]} ${year}`,
  ];
};

const quoteFragments = (value: string): string[] => {
  return (value || '')
    .split(/[\n.;]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length >= 18)
    .slice(0, 4);
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
  const imageRef = useRef<HTMLImageElement>(null);
  const renderTokenRef = useRef(0);

  const primaryCitation = preferredCitation || pickPrimaryCitation(cell?.citations, cell);
  const [page, setPage] = useState<number>(primaryCitation?.page || cell?.page || 1);
  const [renderedPage, setRenderedPage] = useState<RenderedPdfPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageDisplaySize, setImageDisplaySize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  const pageKey = String(page);
  const pageMeta = pageIndex?.[pageKey] || null;

  const normalizedRenderedBbox = useMemo(() => normalizeBbox(renderedPage?.matched_bbox || null), [renderedPage?.matched_bbox]);
  const normalizedCitationBbox = useMemo(() => normalizeBbox(primaryCitation?.bbox || null), [primaryCitation?.bbox]);

  const effectiveBBox = useMemo(() => {
    if (normalizedRenderedBbox) {
      return normalizedRenderedBbox;
    }
    if (normalizedCitationBbox) {
      return normalizedCitationBbox;
    }
    return null;
  }, [normalizedCitationBbox, normalizedRenderedBbox]);

  const snippetCandidates = useMemo(() => {
    const probes = [
      (primaryCitation?.snippet || '').trim(),
      ...quoteFragments((cell?.quote || '').trim()),
      (cell?.value || '').trim(),
      ...expandIsoDateProbes((cell?.value || '').trim()),
    ];
    const deduped: string[] = [];
    probes.forEach((probe) => {
      if (!probe) return;
      if (deduped.includes(probe)) return;
      deduped.push(probe);
    });
    return deduped;
  }, [primaryCitation?.snippet, cell?.quote, cell?.value]);

  const snippetProbe = snippetCandidates[0] || '';

  const matchMode = renderedPage?.match_mode || (normalizedRenderedBbox ? 'exact' : 'none');
  const matchConfidence = typeof renderedPage?.match_confidence === 'number'
    ? renderedPage.match_confidence
    : normalizedRenderedBbox
      ? 1
      : 0;
  const bboxSource = renderedPage?.bbox_source || (normalizedRenderedBbox ? 'matched_snippet' : 'none');

  const renderedPageWidth = pageMeta?.width || renderedPage?.page_width || 0;
  const renderedPageHeight = pageMeta?.height || renderedPage?.page_height || 0;
  const displayedWidth = imageDisplaySize.width || renderedPage?.image_width || 0;
  const displayedHeight = imageDisplaySize.height || renderedPage?.image_height || 0;

  const bboxPlausible = useMemo(() => {
    if (!effectiveBBox) return false;
    return hasPlausibleArea(effectiveBBox, renderedPageWidth, renderedPageHeight);
  }, [effectiveBBox, renderedPageWidth, renderedPageHeight]);

  const canDrawBBox = Boolean(
    effectiveBBox &&
      isUsableBbox(effectiveBBox) &&
      bboxPlausible &&
      matchConfidence >= 0.55 &&
      bboxSource !== 'none'
  );

  const overlayStyle = useMemo(() => {
    if (!effectiveBBox || !canDrawBBox) return null;
    if (displayedWidth <= 0 || displayedHeight <= 0) return null;
    return bboxToOverlayStyle(
      effectiveBBox,
      displayedWidth,
      displayedHeight,
      renderedPageWidth,
      renderedPageHeight
    );
  }, [effectiveBBox, canDrawBBox, displayedWidth, displayedHeight, renderedPageWidth, renderedPageHeight]);

  useEffect(() => {
    setPage(primaryCitation?.page || cell?.page || 1);
  }, [primaryCitation?.page, cell?.page]);

  useEffect(() => {
    const imageEl = imageRef.current;
    if (!imageEl) return;

    const updateSize = () => {
      setImageDisplaySize({
        width: imageEl.clientWidth || 0,
        height: imageEl.clientHeight || 0,
      });
    };
    updateSize();

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => updateSize());
      observer.observe(imageEl);
    }

    window.addEventListener('resize', updateSize);
    return () => {
      window.removeEventListener('resize', updateSize);
      observer?.disconnect();
    };
  }, [renderedPage?.image_base64]);

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
        formData.append('snippet', snippetProbe);
        formData.append('snippet_candidates_json', JSON.stringify(snippetCandidates));
        if (typeof primaryCitation?.start_char === 'number' && Number.isFinite(primaryCitation.start_char)) {
          formData.append('citation_start_char', String(Math.max(0, Math.floor(primaryCitation.start_char))));
        }
        if (typeof primaryCitation?.end_char === 'number' && Number.isFinite(primaryCitation.end_char)) {
          formData.append('citation_end_char', String(Math.max(0, Math.floor(primaryCitation.end_char))));
        }
        if (normalizedCitationBbox) {
          formData.append('citation_bbox_json', JSON.stringify(normalizedCitationBbox));
        }

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
            match_mode: data.match_mode || 'none',
            match_confidence: typeof data.match_confidence === 'number' ? data.match_confidence : null,
            bbox_source: data.bbox_source || 'none',
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
  }, [
    sourceContentBase64,
    sourceMimeType,
    filename,
    page,
    snippetProbe,
    snippetCandidates,
    primaryCitation?.start_char,
    primaryCitation?.end_char,
    normalizedCitationBbox,
  ]);

  useEffect(() => {
    if (!scrollContainerRef.current || !renderedPage) {
      return;
    }
    const container = scrollContainerRef.current;
    container.scrollLeft = 0;

    if (!overlayStyle || !canDrawBBox) {
      container.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
      logRuntimeEvent({
        event: 'citation_scroll_fallback_used',
        stage: 'verification',
        level: 'warning',
        metadata: {
          doc_format: 'pdf',
          citation_source: primaryCitation?.source || 'pdf',
          page,
          fallback_reason: renderedPage.warning_code || 'bbox_unavailable_or_low_confidence',
          match_mode: matchMode,
          match_confidence: matchConfidence,
          bbox_source: bboxSource,
        },
      });
      return;
    }

    centerVerticalScroll(container, overlayStyle.top, overlayStyle.height);
    container.scrollLeft = 0;

    logRuntimeEvent({
      event: 'citation_scroll_applied',
      stage: 'verification',
      metadata: {
        doc_format: 'pdf',
        citation_source: primaryCitation?.source || 'pdf',
        page,
        bbox_hit: true,
        match_mode: matchMode,
        match_confidence: matchConfidence,
        bbox_source: bboxSource,
      },
    });
  }, [
    renderedPage,
    overlayStyle,
    canDrawBBox,
    page,
    primaryCitation?.source,
    matchMode,
    matchConfidence,
    bboxSource,
  ]);

  const pageCount = renderedPage?.page_count || 1;

  return (
    <div ref={scrollContainerRef} className="h-full overflow-auto p-4 md:p-6 bg-[#E5E7EB] scroll-smooth">
      <div className="w-full space-y-3">
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
            <div className="mb-2 text-xs text-[#6B6555]">
              {canDrawBBox
                ? 'Anchored citation mode: highlighting matched evidence span.'
                : 'Weak or ambiguous anchor: showing cited page without bbox highlight.'}
            </div>
            <div className="mb-2 text-[11px] text-[#8A8470]">
              match: {matchMode} · conf: {matchConfidence.toFixed(3)} · bbox_source: {bboxSource}
              {renderedPage.used_snippet ? ` · probe: ${renderedPage.used_snippet.slice(0, 80)}` : ''}
              {renderedPage.warning_code ? ` · warning: ${renderedPage.warning_code}` : ''}
            </div>
            <div className="relative inline-block">
              <img
                ref={imageRef}
                src={`data:image/png;base64,${renderedPage.image_base64}`}
                alt={`PDF page ${renderedPage.page}`}
                className="block max-w-full h-auto"
                width={renderedPage.image_width}
                height={renderedPage.image_height}
              />

              {canDrawBBox && overlayStyle && (
                <div
                  className="absolute border-[3px] border-[#C2410C] bg-[#FACC15]/35 shadow-[0_0_0_2px_rgba(251,191,36,0.35)] pointer-events-none"
                  style={{
                    left: overlayStyle.left,
                    top: overlayStyle.top,
                    width: Math.max(8, overlayStyle.width),
                    height: Math.max(8, overlayStyle.height),
                  }}
                />
              )}
            </div>

            {!canDrawBBox && (
              <div className="mt-3 text-xs text-[#8A8470]">
                {renderedPage.warning_code
                  ? `No bbox rendered (${renderedPage.warning_code}); review in page context.`
                  : 'Citation bbox unavailable or below confidence threshold; rendered page shown without box highlight.'}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
