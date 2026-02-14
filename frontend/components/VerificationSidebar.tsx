import React, { useEffect, useState, useRef } from 'react';
import { X, FileText, AlertCircle } from './Icons';
import { ExtractionCell, DocumentFile, Column } from '../types';

interface VerificationSidebarProps {
  cell?: ExtractionCell | null;
  document: DocumentFile | null;
  column?: Column | null;
  onClose: () => void;
  onVerify?: () => void;
  isExpanded: boolean;
  onExpand: (expanded: boolean) => void;
}

export const VerificationSidebar: React.FC<VerificationSidebarProps> = ({
  cell,
  document,
  column,
  onClose,
  isExpanded,
  onExpand
}) => {
  const [decodedContent, setDecodedContent] = useState<string>('');
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    if (document) {
        // Decode Base64 content (which is now always Markdown/Text from App.tsx)
        try {
            const cleanContent = document.content.replace(/^data:.*;base64,/, '');
            const binaryString = atob(cleanContent);
            try {
                // Handle UTF-8 characters properly
                const decoded = decodeURIComponent(escape(binaryString));
                setDecodedContent(decoded);
            } catch (e) {
                // Fallback for simple ASCII or already decoded parts
                setDecodedContent(binaryString);
            }
        } catch (e) {
            console.error("Decoding error", e);
            setDecodedContent("Unable to display document content.");
        }
    }
  }, [document]);

  // Auto-scroll to highlighted text when expanded or cell changes
  useEffect(() => {
    if (isExpanded && cell?.quote) {
        // Small timeout to ensure DOM is rendered
        const timer = setTimeout(() => {
            if (scrollContainerRef.current) {
                const mark = scrollContainerRef.current.querySelector('mark');
                if (mark) {
                    mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }
        }, 300);
        return () => clearTimeout(timer);
    }
  }, [isExpanded, cell, decodedContent]);

  const handleCitationClick = () => {
    onExpand(true);
    // Scroll handled by useEffect
  };

  // Helper to render text with highlight (HTML/TXT)
  const renderHighlightedContent = () => {
    if (!cell || !cell.quote || !decodedContent) {
        return <div className="whitespace-pre-wrap text-sm leading-relaxed text-[#333333]">{decodedContent}</div>;
    }

    const quote = cell.quote.trim();
    if (!quote) return <div className="whitespace-pre-wrap text-sm leading-relaxed text-[#333333]">{decodedContent}</div>;

    // Robust Fuzzy Matcher
    // 1. Escape regex characters in the quote
    const escapedQuote = quote.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    // 2. Replace whitespace with a flexible pattern that matches:
    //    - spaces
    //    - newlines
    //    - common markdown characters that might appear in source but not quote (like **, _, #)
    const loosePattern = escapedQuote.replace(/\s+/g, '[\\s\\W]*');
    
    // 3. Create regex with capturing group to split and keep delimiters
    const looseQuoteRegex = new RegExp(`(${loosePattern})`, 'gi');

    const parts = decodedContent.split(looseQuoteRegex);

    if (parts.length === 1) {
        return (
            <div className="relative">
                <div className="bg-[#F5F4F0] border border-[#E5E7EB] rounded-lg p-2 mb-4 text-xs text-[#8A8470] flex items-center gap-2 sticky top-0 z-10">
                    <AlertCircle className="w-3 h-3" />
                    Exact quote not found. Showing full text.
                </div>
                <div className="whitespace-pre-wrap text-sm leading-relaxed text-[#333333]">{decodedContent}</div>
            </div>
        );
    }

    return (
        <div className="whitespace-pre-wrap text-sm leading-relaxed text-[#333333]">
            {parts.map((part, i) => {
                // Check if this part matches the loose pattern
                // Since we split by capturing group, matches will be at odd indices (1, 3, 5...)
                // IF the first part is empty (match at start), then matches are 1, 3...
                // IF the first part is text, matches are 1, 3...
                // Basically, split(regexWithCapture) returns [pre, match, post]
                const isMatch = looseQuoteRegex.test(part);
                // Reset regex lastIndex because test() advances it if global
                looseQuoteRegex.lastIndex = 0; 

                if (isMatch) {
                    return (
                        <mark key={i} className="bg-[#D8DCE5] text-black px-0.5 rounded-sm border-b-2 border-[#8B97AD] font-medium">
                            {part}
                        </mark>
                    );
                }
                return <React.Fragment key={i}>{part}</React.Fragment>;
            })}
        </div>
    );
  };

  const renderAnswerPanel = () => (
    <div className="flex flex-col h-full bg-white">
         {/* Header */}
        <div className="px-6 py-4 border-b border-[#E5E7EB] flex items-center justify-between bg-white z-10">
            <div className="flex items-center gap-3">
                <div className="p-2 bg-[#EFF1F5] rounded-lg text-[#4A5A7B]">
                    <FileText className="w-5 h-5" />
                </div>
                <div className="flex flex-col">
                    <span className="text-[10px] uppercase tracking-[0.12em] font-bold text-[#A8A291]">
                        {cell ? 'Analyst Review' : 'Document Preview'}
                    </span>
                    <span className="text-sm font-semibold text-black truncate max-w-[200px]" title={document?.name}>
                        {document?.name}
                    </span>
                </div>
            </div>
            <div className="flex items-center gap-2">
                <button onClick={onClose} className="p-2 hover:bg-[#F5F4F0] rounded-lg text-[#C4BFB3] hover:text-[#333333] transition-colors">
                <X className="w-5 h-5" />
                </button>
            </div>
        </div>

        {/* Body */}
        {cell && column ? (
            <div className="p-6 flex-1 overflow-y-auto">
                <div className="flex items-center justify-between mb-6">
                    <span className="text-[10px] font-bold text-[#8A8470] uppercase tracking-[0.12em] bg-[#F5F4F0] px-2.5 py-1 rounded-pill">
                        {column.name}
                    </span>
                    <span className={`text-[10px] px-2.5 py-1 rounded-pill font-bold border ${
                        cell.confidence === 'High' ? 'bg-[#EFF1F5] text-[#4A5A7B] border-[#D8DCE5]' :
                        cell.confidence === 'Medium' ? 'bg-[#F5F4F0] text-[#8A8470] border-[#E5E7EB]' :
                        'bg-red-50 text-red-700 border-red-200'
                    }`}>
                        {cell.confidence} Confidence
                    </span>
                </div>

                <div className="mb-8">
                     <div className="text-lg text-black leading-relaxed font-medium">
                        {cell.value}
                    </div>
                </div>
                
                <div className="space-y-4">
                    <div>
                        <h4 className="text-[10px] font-bold text-[#A8A291] uppercase tracking-[0.12em] mb-2">AI Reasoning</h4>
                        <div className="p-4 bg-[#FAFAF7] rounded-xl border border-[#E5E7EB]">
                            <p className="text-sm text-[#6B6555] leading-relaxed inline">
                                {cell.reasoning}
                            </p>
                            
                            {/* Inline Citation Chip */}
                            {cell.quote && (
                                <button 
                                    onClick={handleCitationClick}
                                    className="inline-flex items-center justify-center ml-1.5 align-middle px-1.5 py-0.5 bg-[#EFF1F5] hover:bg-[#D8DCE5] text-[#4A5A7B] text-[10px] font-bold rounded cursor-pointer border border-[#D8DCE5] hover:border-[#4A5A7B] transition-all transform active:scale-95"
                                    title="View in Document"
                                >
                                    {cell.page ? `p.${cell.page}` : 'Src'}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        ) : (
            <div className="p-6 flex flex-col items-center justify-center flex-1 text-center">
                 <FileText className="w-12 h-12 text-[#DDD9D0] mb-4" />
                 <p className="text-sm text-[#8A8470]">Document Preview Mode</p>
                 {!isExpanded && (
                     <button onClick={() => onExpand(true)} className="mt-4 text-[#4A5A7B] text-xs font-bold hover:underline">
                        Open Document Viewer
                     </button>
                 )}
            </div>
        )}
    </div>
  );

  const renderDocumentPanel = () => (
      <div className="h-full flex flex-col bg-[#F5F4F0] overflow-hidden">
          <div className="flex-1 bg-[#E5E7EB] relative flex flex-col min-h-0">
                <div 
                    ref={scrollContainerRef}
                    className="flex-1 overflow-y-auto p-8 md:p-12 scroll-smooth"
                >
                    <div className="max-w-[800px] w-full bg-white shadow-card min-h-[800px] p-8 md:p-12 relative mx-auto text-left rounded-xl">
                        {renderHighlightedContent()}
                    </div>
                </div>
          </div>
      </div>
  );

  if (!document) return null;

  return (
    <div className="h-full w-full flex">
        {/* Left Panel (Analyst) - Always Visible */}
        <div className={`${isExpanded ? 'w-[400px]' : 'w-full'} flex-shrink-0 transition-all duration-300 z-20`}>
             {renderAnswerPanel()}
        </div>

        {/* Right Panel (Document) - Conditionally Visible */}
        {isExpanded && (
            <div className="flex-1 animate-in slide-in-from-right duration-300 min-w-0">
                {renderDocumentPanel()}
            </div>
        )}
    </div>
  );
};