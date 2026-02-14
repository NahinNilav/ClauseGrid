import React, { useEffect, useMemo, useRef } from 'react';
import { ExtractionCell } from '../../types';
import { centerVerticalScroll, decodeBase64Utf8 } from './common';
import { logRuntimeEvent } from '../../services/runtimeLogger';

interface MarkdownFallbackViewerProps {
  contentBase64: string;
  cell?: ExtractionCell | null;
  fallbackReason?: string;
}

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const MarkdownFallbackViewer: React.FC<MarkdownFallbackViewerProps> = ({
  contentBase64,
  cell,
  fallbackReason,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const renderTokenRef = useRef(0);

  const decodedContent = useMemo(() => decodeBase64Utf8(contentBase64), [contentBase64]);
  const highlightTarget = (cell?.citations?.[0]?.snippet || cell?.quote || cell?.value || '').trim();

  const highlightedParts = useMemo(() => {
    if (!decodedContent || !highlightTarget) {
      return { parts: [decodedContent], hasMatch: false, matcher: null as RegExp | null };
    }

    const probes = [
      highlightTarget,
      highlightTarget.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim(),
      cell?.value?.trim() || '',
      cell?.quote?.trim() || '',
    ].filter(Boolean);

    for (const probe of probes) {
      const regex = new RegExp(`(${escapeRegex(probe).replace(/\s+/g, '[\\s\\W]*')})`, 'gi');
      const parts = decodedContent.split(regex);
      if (parts.length > 1) {
        return { parts, hasMatch: true, matcher: regex };
      }
    }

    return { parts: [decodedContent], hasMatch: false, matcher: null as RegExp | null };
  }, [decodedContent, highlightTarget, cell?.quote, cell?.value]);

  useEffect(() => {
    renderTokenRef.current += 1;
    const token = renderTokenRef.current;
    if (!highlightedParts.hasMatch || !scrollContainerRef.current) {
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
  }, [highlightedParts.hasMatch, cell?.citations]);

  return (
    <div ref={scrollContainerRef} className="h-full overflow-auto p-4 md:p-6 scroll-smooth">
      <div className="w-full bg-white shadow-card min-h-[800px] p-6 md:p-8 relative text-left rounded-xl whitespace-pre-wrap text-sm leading-relaxed text-[#333333]">
        {fallbackReason && (
          <div className="bg-[#F5F4F0] border border-[#E5E7EB] rounded-lg p-2 mb-4 text-xs text-[#8A8470]">
            {fallbackReason}
          </div>
        )}
        {!highlightedParts.hasMatch && highlightTarget && (
          <div className="bg-[#F5F4F0] border border-[#E5E7EB] rounded-lg p-2 mb-4 text-xs text-[#8A8470]">
            Exact citation match not found in preview text.
          </div>
        )}
        {highlightedParts.parts.map((part, idx) => {
          const isMatch = highlightedParts.matcher ? highlightedParts.matcher.test(part) : false;
          if (highlightedParts.matcher) {
            highlightedParts.matcher.lastIndex = 0;
          }

          if (!isMatch) {
            return <React.Fragment key={idx}>{part}</React.Fragment>;
          }

          return (
            <mark
              key={idx}
              data-citation-primary="1"
              className="bg-[#D8DCE5] text-black px-0.5 rounded-sm border-b-2 border-[#8B97AD] font-medium"
            >
              {part}
            </mark>
          );
        })}
      </div>
    </div>
  );
};
