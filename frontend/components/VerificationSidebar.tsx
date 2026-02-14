import React from 'react';
import { X, FileText } from './Icons';
import { ExtractionCell, DocumentFile, Column } from '../types';
import { DocumentViewer } from './document-viewers';

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
  onExpand,
}) => {
  const primaryCitation = cell?.citations?.[0];

  const handleCitationClick = () => {
    onExpand(true);
  };

  const renderAnswerPanel = () => (
    <div className="flex flex-col h-full bg-white">
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

      {cell && column ? (
        <div className="p-6 flex-1 overflow-y-auto">
          <div className="flex items-center justify-between mb-6">
            <span className="text-[10px] font-bold text-[#8A8470] uppercase tracking-[0.12em] bg-[#F5F4F0] px-2.5 py-1 rounded-pill">
              {column.name}
            </span>
            <span
              className={`text-[10px] px-2.5 py-1 rounded-pill font-bold border ${
                cell.confidence === 'High'
                  ? 'bg-[#EFF1F5] text-[#4A5A7B] border-[#D8DCE5]'
                  : cell.confidence === 'Medium'
                    ? 'bg-[#F5F4F0] text-[#8A8470] border-[#E5E7EB]'
                    : 'bg-red-50 text-red-700 border-red-200'
              }`}
            >
              {cell.confidence} Confidence
            </span>
          </div>

          <div className="mb-8">
            <div className="text-lg text-black leading-relaxed font-medium">{cell.value}</div>
          </div>

          <div className="space-y-4">
            <div>
              <h4 className="text-[10px] font-bold text-[#A8A291] uppercase tracking-[0.12em] mb-2">AI Reasoning</h4>
              <div className="p-4 bg-[#FAFAF7] rounded-xl border border-[#E5E7EB]">
                <p className="text-sm text-[#6B6555] leading-relaxed inline">{cell.reasoning}</p>

                {(cell.citations?.length || cell.quote || cell.value) && (
                  <button
                    onClick={handleCitationClick}
                    className="inline-flex items-center justify-center ml-1.5 align-middle px-1.5 py-0.5 bg-[#EFF1F5] hover:bg-[#D8DCE5] text-[#4A5A7B] text-[10px] font-bold rounded cursor-pointer border border-[#D8DCE5] hover:border-[#4A5A7B] transition-all transform active:scale-95"
                    title="View in Document"
                  >
                    {primaryCitation?.page ? `p.${primaryCitation.page}` : cell.page ? `p.${cell.page}` : 'Src'}
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

  const renderDocumentPanel = () => {
    if (!document) return null;
    return (
      <div className="h-full flex flex-col bg-[#F5F4F0] overflow-hidden">
        <div className="flex-1 bg-[#E5E7EB] relative flex flex-col min-h-0">
          <DocumentViewer document={document} cell={cell} />
        </div>
      </div>
    );
  };

  if (!document) return null;

  return (
    <div className="h-full w-full flex">
      <div className={`${isExpanded ? 'w-[400px]' : 'w-full'} flex-shrink-0 transition-all duration-300 z-20`}>
        {renderAnswerPanel()}
      </div>

      {isExpanded && (
        <div className="flex-1 animate-in slide-in-from-right duration-300 min-w-0">{renderDocumentPanel()}</div>
      )}
    </div>
  );
};
