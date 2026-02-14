import React, { useEffect, useMemo, useRef } from 'react';
import { ExtractionCell, SourceCitation } from '../../types';
import { pickPrimaryCitation } from './common';
import { logRuntimeEvent } from '../../services/runtimeLogger';

interface HtmlCitationViewerProps {
  previewHtml: string;
  cell?: ExtractionCell | null;
  primaryCitation?: SourceCitation | null;
}

const STYLE_ID = 'citation-viewer-style';

const sanitizeHtml = (html: string): string => {
  const parser = new DOMParser();
  const parsed = parser.parseFromString(html, 'text/html');

  parsed.querySelectorAll('script,style,iframe,object,embed,link[rel="import"]').forEach((node) => node.remove());

  parsed.querySelectorAll('*').forEach((element) => {
    for (const attr of Array.from(element.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith('on')) {
        element.removeAttribute(attr.name);
        continue;
      }
      if ((name === 'href' || name === 'src') && value.startsWith('javascript:')) {
        element.removeAttribute(attr.name);
      }
    }
  });

  return parsed.documentElement.outerHTML;
};

const unwrapNode = (node: HTMLElement): void => {
  const parent = node.parentNode;
  if (!parent) return;
  while (node.firstChild) {
    parent.insertBefore(node.firstChild, node);
  }
  parent.removeChild(node);
  parent.normalize();
};

const highlightRangeInElement = (
  doc: Document,
  element: Element,
  startChar: number,
  endChar: number
): HTMLElement | null => {
  if (startChar < 0 || endChar <= startChar) return null;

  const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  let cursor = 0;
  let startNode: Text | null = null;
  let endNode: Text | null = null;
  let startOffset = 0;
  let endOffset = 0;

  while (current) {
    const textNode = current as Text;
    const len = textNode.textContent?.length || 0;
    const nodeStart = cursor;
    const nodeEnd = cursor + len;

    if (!startNode && startChar >= nodeStart && startChar <= nodeEnd) {
      startNode = textNode;
      startOffset = Math.max(0, startChar - nodeStart);
    }

    if (!endNode && endChar >= nodeStart && endChar <= nodeEnd) {
      endNode = textNode;
      endOffset = Math.max(0, endChar - nodeStart);
      break;
    }

    cursor = nodeEnd;
    current = walker.nextNode();
  }

  if (!startNode || !endNode) {
    return null;
  }

  try {
    const range = doc.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);

    const mark = doc.createElement('mark');
    mark.setAttribute('data-citation-highlight', '1');
    mark.className = 'citation-inline-highlight';

    const extracted = range.extractContents();
    mark.appendChild(extracted);
    range.insertNode(mark);
    return mark;
  } catch {
    return null;
  }
};

export const HtmlCitationViewer: React.FC<HtmlCitationViewerProps> = ({ previewHtml, cell, primaryCitation: preferredCitation }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const renderTokenRef = useRef(0);
  const primaryCitation = preferredCitation || pickPrimaryCitation(cell?.citations);

  const srcDoc = useMemo(() => sanitizeHtml(previewHtml), [previewHtml]);

  useEffect(() => {
    renderTokenRef.current += 1;
    const token = renderTokenRef.current;

    const applyHighlight = () => {
      if (token !== renderTokenRef.current) return;
      const iframe = iframeRef.current;
      const doc = iframe?.contentDocument;
      const win = iframe?.contentWindow;
      if (!doc || !win) return;

      const existingStyle = doc.getElementById(STYLE_ID);
      if (!existingStyle) {
        const style = doc.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
          html, body {
            width: 100% !important;
            max-width: none !important;
            margin: 0 !important;
            padding: 20px !important;
            box-sizing: border-box !important;
          }
          body > * {
            max-width: none !important;
            margin-left: 0 !important;
            margin-right: 0 !important;
          }
          .citation-block-highlight {
            background: rgba(216, 220, 229, 0.65);
            outline: 2px solid #8B97AD;
          }
          .citation-inline-highlight {
            background: rgba(216, 220, 229, 0.9);
            border-bottom: 2px solid #8B97AD;
          }
        `;
        doc.head.appendChild(style);
      }

      doc.querySelectorAll('.citation-block-highlight').forEach((node) => node.classList.remove('citation-block-highlight'));
      doc.querySelectorAll('mark[data-citation-highlight="1"]').forEach((node) => unwrapNode(node as HTMLElement));

      if (!primaryCitation) {
        return;
      }

      let targetNode: HTMLElement | null = null;
      let fallbackReason: string | null = null;

      if (primaryCitation.selector) {
        try {
          targetNode = doc.querySelector(primaryCitation.selector) as HTMLElement | null;
        } catch {
          targetNode = null;
        }
      }

      if (!targetNode && primaryCitation.snippet) {
        const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
        let current = walker.nextNode();
        const probe = primaryCitation.snippet.toLowerCase();
        while (current) {
          const text = (current.textContent || '').toLowerCase();
          if (probe && text.includes(probe)) {
            targetNode = (current.parentElement || doc.body) as HTMLElement;
            break;
          }
          current = walker.nextNode();
        }
        if (!targetNode) {
          fallbackReason = 'snippet_not_found';
        }
      }

      if (!targetNode) {
        logRuntimeEvent({
          event: 'citation_target_missing',
          stage: 'verification',
          level: 'warning',
          metadata: {
            doc_format: 'html',
            citation_source: primaryCitation.source,
            selector: primaryCitation.selector || '',
            fallback_reason: fallbackReason || 'selector_not_found',
          },
        });
        return;
      }

      let scrollAnchor: HTMLElement = targetNode;
      if (
        typeof primaryCitation.start_char === 'number' &&
        typeof primaryCitation.end_char === 'number'
      ) {
        const rangeMark = highlightRangeInElement(
          doc,
          targetNode,
          primaryCitation.start_char,
          primaryCitation.end_char
        );
        if (rangeMark) {
          scrollAnchor = rangeMark;
        } else {
          targetNode.classList.add('citation-block-highlight');
        }
      } else {
        targetNode.classList.add('citation-block-highlight');
      }

      const rect = scrollAnchor.getBoundingClientRect();
      const targetY = win.scrollY + rect.top;
      win.scrollTo({
        top: Math.max(0, targetY - win.innerHeight / 2 + rect.height / 2),
        left: 0,
        behavior: 'smooth',
      });

      logRuntimeEvent({
        event: 'citation_scroll_applied',
        stage: 'verification',
        metadata: {
          doc_format: 'html',
          citation_source: primaryCitation.source,
          selector_hit: Boolean(primaryCitation.selector),
        },
      });
    };

    const timer = setTimeout(applyHighlight, 120);
    return () => clearTimeout(timer);
  }, [srcDoc, primaryCitation?.selector, primaryCitation?.snippet, primaryCitation?.start_char, primaryCitation?.end_char]);

  return (
    <div className="h-full overflow-hidden bg-[#E5E7EB] p-4 md:p-6">
      <div className="w-full h-full bg-white rounded-xl shadow-card overflow-hidden">
        <iframe
          ref={iframeRef}
          title="HTML Citation Viewer"
          srcDoc={srcDoc}
          className="w-full h-full border-0"
          sandbox="allow-same-origin"
        />
      </div>
    </div>
  );
};
