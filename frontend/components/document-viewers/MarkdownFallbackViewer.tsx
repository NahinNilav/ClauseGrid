import React, { useEffect, useMemo, useRef } from 'react';
import { ExtractionCell, SourceCitation } from '../../types';
import { centerVerticalScroll, decodeBase64Utf8 } from './common';
import { logRuntimeEvent } from '../../services/runtimeLogger';

interface MarkdownFallbackViewerProps {
  contentBase64: string;
  cell?: ExtractionCell | null;
  primaryCitation?: SourceCitation | null;
  fallbackReason?: string;
}

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

const quoteFragments = (quote: string): string[] => {
  return (quote || '')
    .split(/[\n.;]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 18)
    .slice(0, 4);
};

const findPageSectionBounds = (content: string, page?: number): { start: number; end: number } | null => {
  if (!content || !page) return null;
  const headerRegex = new RegExp(`^##\\s*Page\\s+${page}\\b`, 'im');
  const startMatch = headerRegex.exec(content);
  if (!startMatch || startMatch.index < 0) return null;
  const start = startMatch.index;
  const tail = content.slice(start + 1);
  const nextHeader = /\n##\s*Page\s+\d+\b/i.exec(tail);
  if (!nextHeader || nextHeader.index < 0) {
    return { start, end: content.length };
  }
  return { start, end: start + 1 + nextHeader.index };
};

const findProbeMatchRange = (
  content: string,
  probe: string,
  bounds?: { start: number; end: number } | null
): { start: number; end: number } | null => {
  const normalizedProbe = (probe || '').trim();
  if (!normalizedProbe) return null;
  const pattern = escapeRegex(normalizedProbe).replace(/\s+/g, '[\\s\\W]*');
  const regex = new RegExp(pattern, 'i');
  if (bounds) {
    const scoped = content.slice(bounds.start, bounds.end);
    const scopedMatch = regex.exec(scoped);
    if (scopedMatch && scopedMatch.index >= 0) {
      return {
        start: bounds.start + scopedMatch.index,
        end: bounds.start + scopedMatch.index + scopedMatch[0].length,
      };
    }
  }
  const fullMatch = regex.exec(content);
  if (!fullMatch || fullMatch.index < 0) return null;
  return {
    start: fullMatch.index,
    end: fullMatch.index + fullMatch[0].length,
  };
};

export const MarkdownFallbackViewer: React.FC<MarkdownFallbackViewerProps> = ({
  contentBase64,
  cell,
  primaryCitation,
  fallbackReason,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const renderTokenRef = useRef(0);

  const decodedContent = useMemo(() => decodeBase64Utf8(contentBase64), [contentBase64]);
  const citationSnippets = useMemo(
    () =>
      (cell?.citations || [])
        .slice(0, 3)
        .map((citation) => (citation?.snippet || '').trim())
        .filter(Boolean),
    [cell?.citations]
  );
  const dateProbes = useMemo(() => expandIsoDateProbes((cell?.value || '').trim()), [cell?.value]);
  const quoteProbeFragments = useMemo(() => quoteFragments((cell?.quote || '').trim()), [cell?.quote]);
  const probes = useMemo(
    () =>
      [
        cell?.quote?.trim() || '',
        ...quoteProbeFragments,
        ...dateProbes,
        cell?.value?.trim() || '',
        ...citationSnippets,
      ]
        .map((probe) => probe.trim())
        .filter(Boolean),
    [cell?.quote, quoteProbeFragments, dateProbes, cell?.value, citationSnippets]
  );
  const highlightTarget = probes[0] || '';

  const highlightedMatch = useMemo(() => {
    if (!decodedContent || !highlightTarget) {
      return { hasMatch: false, start: 0, end: 0 };
    }
    const preferredPage = primaryCitation?.page || cell?.citations?.[0]?.page;
    const pageBounds = findPageSectionBounds(decodedContent, preferredPage);

    for (const probe of probes) {
      const range = findProbeMatchRange(decodedContent, probe, pageBounds);
      if (range) {
        return { hasMatch: true, start: range.start, end: range.end };
      }
    }

    return { hasMatch: false, start: 0, end: 0 };
  }, [decodedContent, highlightTarget, probes, primaryCitation?.page, cell?.citations]);

  useEffect(() => {
    renderTokenRef.current += 1;
    const token = renderTokenRef.current;
    if (!highlightedMatch.hasMatch || !scrollContainerRef.current) {
      return;
    }

    const timer = setTimeout(() => {
      if (token !== renderTokenRef.current || !scrollContainerRef.current) {
        return;
      }
      const firstMark = scrollContainerRef.current.querySelector('mark[data-citation-primary="1"]') as HTMLElement | null;
      if (!firstMark) {
        return;
      }
      const containerRect = scrollContainerRef.current.getBoundingClientRect();
      const markRect = firstMark.getBoundingClientRect();
      const targetTop = scrollContainerRef.current.scrollTop + (markRect.top - containerRect.top);
      centerVerticalScroll(scrollContainerRef.current, targetTop, markRect.height);
      logRuntimeEvent({
        event: 'citation_scroll_applied',
        stage: 'verification',
        metadata: {
          doc_format: 'fallback_markdown',
          citation_source: cell?.citations?.[0]?.source || 'unknown',
        },
      });
    }, 120);

    return () => clearTimeout(timer);
  }, [highlightedMatch.hasMatch, cell?.citations]);

  return (
    <div ref={scrollContainerRef} className="h-full overflow-auto p-4 md:p-6 scroll-smooth">
      <div className="w-full bg-white shadow-card min-h-[800px] p-6 md:p-8 relative text-left rounded-xl whitespace-pre-wrap text-sm leading-relaxed text-[#333333]">
        {fallbackReason && (
          <div className="bg-[#F5F4F0] border border-[#E5E7EB] rounded-lg p-2 mb-4 text-xs text-[#8A8470]">
            {fallbackReason}
          </div>
        )}
        <div className="bg-[#FFF4D6] border border-[#E5E7EB] rounded-lg p-2 mb-4 text-xs text-[#7A5A00]">
          Heuristic highlight mode: matching extracted text in converted preview.
        </div>
        {!highlightedMatch.hasMatch && highlightTarget && (
          <div className="bg-[#F5F4F0] border border-[#E5E7EB] rounded-lg p-2 mb-4 text-xs text-[#8A8470]">
            Exact citation match not found in preview text.
          </div>
        )}
        {!highlightedMatch.hasMatch && decodedContent}
        {highlightedMatch.hasMatch && (
          <>
            {decodedContent.slice(0, highlightedMatch.start)}
            <mark
              data-citation-primary="1"
              className="bg-[#D8DCE5] text-black px-0.5 rounded-sm border-b-2 border-[#8B97AD] font-medium"
            >
              {decodedContent.slice(highlightedMatch.start, highlightedMatch.end)}
            </mark>
            {decodedContent.slice(highlightedMatch.end)}
          </>
        )}
      </div>
    </div>
  );
};
