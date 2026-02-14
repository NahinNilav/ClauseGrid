import React, { useState } from 'react';
import { DocumentFile, Column, ExtractionResult, ExtractionCell } from '../types';
import { FileText, Plus, Loader2, AlertCircle, CheckCircle2, ChevronRight, MoreHorizontal, Trash2, CheckSquare, Square } from './Icons';

interface DataGridProps {
  documents: DocumentFile[];
  columns: Column[];
  results: ExtractionResult;
  onAddColumn: (triggerRect: DOMRect) => void;
  onEditColumn: (colId: string, triggerRect: DOMRect) => void;
  onColumnResize?: (colId: string, newWidth: number) => void;
  isTextWrapEnabled?: boolean;
  onCellClick: (docId: string, colId: string) => void;
  onDocClick: (docId: string) => void;
  onRemoveDoc: (docId: string) => void;
  selectedCell: { docId: string; colId: string } | null;
  onUpload?: (files: DocumentFile[]) => void;
  onDropFiles?: (files: File[]) => void;
  // Selection props for re-run feature
  selectedDocIds?: Set<string>;
  onToggleDocSelection?: (docId: string) => void;
  onToggleAllDocSelection?: () => void;
}

export const DataGrid: React.FC<DataGridProps> = ({
  documents,
  columns,
  results,
  onAddColumn,
  onEditColumn,
  onColumnResize,
  isTextWrapEnabled,
  onCellClick,
  onDocClick,
  onRemoveDoc,
  selectedCell,
  onDropFiles,
  selectedDocIds = new Set(),
  onToggleDocSelection,
  onToggleAllDocSelection
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [resizingColId, setResizingColId] = useState<string | null>(null);
  const [startX, setStartX] = useState(0);
  const [startWidth, setStartWidth] = useState(0);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files);
      if (onDropFiles) {
        onDropFiles(files);
      }
    }
  };

  const handleResizeStart = (e: React.MouseEvent, colId: string, currentWidth: number) => {
    e.preventDefault();
    e.stopPropagation();
    setResizingColId(colId);
    setStartX(e.clientX);
    setStartWidth(currentWidth);
    
    const handleMouseMove = (moveEvent: MouseEvent) => {
        if (onColumnResize) {
            const diff = moveEvent.clientX - e.clientX;
            const newWidth = Math.max(100, startWidth + diff); // Min width 100px
            onColumnResize(colId, newWidth);
        }
    };

    const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        setResizingColId(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };
  
  const getCellContent = (docId: string, colId: string) => {
    const cell = results[docId]?.[colId];
    
    if (columns.find(c => c.id === colId)?.status === 'extracting' && !cell) {
         return (
            <div className="flex items-center gap-2 opacity-40">
                <div className="w-4 h-1 bg-[#DDD9D0] rounded animate-pulse"></div>
                <div className="w-8 h-1 bg-[#DDD9D0] rounded animate-pulse"></div>
            </div>
         );
    }

    if (!cell) return <span className="opacity-0">-</span>;
    
    const isSelected = selectedCell?.docId === docId && selectedCell?.colId === colId;

    return (
      <div className={`flex items-center justify-between w-full h-full ${isTextWrapEnabled ? 'items-start py-1' : ''}`}>
        <span 
            className={`text-sm text-[#333333] ${isSelected ? 'font-medium text-black' : ''} ${isTextWrapEnabled ? 'whitespace-pre-wrap break-words' : 'truncate max-w-[180px]'}`} 
            title={cell.value}
        >
            {cell.value}
        </span>
        <div className={`flex items-center gap-1 ${isTextWrapEnabled ? 'mt-1' : ''}`}>
            {cell.status === 'verified' && <CheckCircle2 className="w-3 h-3 text-[#4A5A7B]" />}
            {cell.confidence === 'Low' && cell.status !== 'verified' && <AlertCircle className="w-3 h-3 text-[#C4BFB3]" />}
        </div>
      </div>
    );
  };

  return (
    <div 
        className={`flex-1 overflow-auto bg-white relative transition-all duration-200 ${isDragging ? 'bg-[#EFF1F5]/30' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
    >
      {isDragging && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#EFF1F5]/80 backdrop-blur-sm border-2 border-[#4A5A7B] border-dashed m-4 rounded-xl pointer-events-none">
            <div className="flex flex-col items-center animate-bounce">
                <Plus className="w-12 h-12 text-[#4A5A7B] mb-2" />
                <p className="text-lg font-bold text-[#333333]">Drop to add documents</p>
            </div>
        </div>
      )}

      <table className="w-full text-left border-collapse table-fixed">
        <thead className="bg-white sticky top-0 z-20">
          <tr className="border-b border-[#E5E7EB]">
            {/* Checkbox Column Header */}
            <th className="w-12 bg-white sticky left-0 z-30 px-2 py-4">
              {documents.length > 0 && onToggleAllDocSelection && (
                <button
                  onClick={onToggleAllDocSelection}
                  className="w-full h-full flex items-center justify-center text-[#C4BFB3] hover:text-black transition-colors"
                  title={selectedDocIds.size === documents.length ? "Deselect all" : "Select all for re-run"}
                >
                  {selectedDocIds.size === documents.length && documents.length > 0 ? (
                    <CheckSquare className="w-4 h-4 text-black" />
                  ) : selectedDocIds.size > 0 ? (
                    <div className="w-4 h-4 border-2 border-[#C4BFB3] rounded bg-[#E5E7EB] flex items-center justify-center">
                      <div className="w-2 h-0.5 bg-[#6B6555] rounded"></div>
                    </div>
                  ) : (
                    <Square className="w-4 h-4" />
                  )}
                </button>
              )}
            </th>
            
            {/* Document Name Header */}
            <th className="py-4 px-5 font-medium text-[10px] text-[#8A8470] uppercase tracking-[0.12em] w-64 bg-white sticky left-12 z-30">
              Document
            </th>

            {columns.map((col) => (
              <th 
                key={col.id} 
                className="py-4 px-5 font-medium text-[10px] text-[#8A8470] uppercase tracking-[0.12em] group relative hover:bg-[#FAFAF7] transition-colors"
                style={{ width: col.width || 240 }}
              >
                <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                        <span className="flex items-center gap-2">
                            {col.name}
                            {col.status === 'extracting' && <Loader2 className="w-3 h-3 animate-spin text-[#4A5A7B]" />}
                        </span>
                    </div>
                    <button 
                        onClick={(e) => {
                            e.stopPropagation();
                            onEditColumn(col.id, e.currentTarget.getBoundingClientRect());
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 hover:bg-[#E5E7EB] rounded text-[#C4BFB3] transition-opacity"
                    >
                        <MoreHorizontal className="w-3 h-3" />
                    </button>
                </div>
                {/* Resize Handle */}
                <div 
                    className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[#4A5A7B] group-hover:bg-[#DDD9D0] transition-colors z-20"
                    onMouseDown={(e) => handleResizeStart(e, col.id, col.width || 240)}
                />
              </th>
            ))}
            <th className="py-4 px-2 w-16">
                <button 
                    onClick={(e) => onAddColumn(e.currentTarget.getBoundingClientRect())}
                    className="w-full h-full flex items-center justify-center text-[#C4BFB3] hover:text-[#4A5A7B] hover:bg-[#EFF1F5] rounded-lg transition-all"
                    title="Add Column"
                >
                    <Plus className="w-4 h-4" />
                </button>
            </th>
            {/* Fill remaining header space */}
             <th></th>
          </tr>
        </thead>
        <tbody className="text-sm text-[#333333]">
          {documents.map((doc, index) => {
            const isDocSelected = selectedDocIds.has(doc.id);
            return (
            <tr key={doc.id} className={`group hover:bg-[#F5F4F0]/60 transition-colors border-b border-[rgba(0,0,0,0.05)] ${isDocSelected ? 'bg-[#EFF1F5]/40' : ''}`}>
              {/* Checkbox Column Body */}
              <td className={`text-center sticky left-0 z-10 px-2 py-5 ${isDocSelected ? 'bg-[#EFF1F5]/50' : 'bg-white group-hover:bg-[#F5F4F0]/60'}`}>
                {onToggleDocSelection && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleDocSelection(doc.id);
                    }}
                    className="w-full h-full flex items-center justify-center text-[#C4BFB3] hover:text-black transition-colors"
                    title={isDocSelected ? "Deselect for re-run" : "Select for re-run"}
                  >
                    {isDocSelected ? (
                      <CheckSquare className="w-4 h-4 text-[#4A5A7B]" />
                    ) : (
                      <Square className="w-4 h-4" />
                    )}
                  </button>
                )}
              </td>
              
              {/* Document Name Body */}
              <td 
                className="px-5 py-5 font-medium text-black bg-white group-hover:bg-[#F5F4F0]/60 transition-colors sticky left-12 z-10 w-64 truncate cursor-pointer hover:text-[#4A5A7B] relative"
                onClick={() => onDocClick(doc.id)}
                title="Click to preview document"
              >
                <div className="flex items-center gap-3 group/docname">
                    <div className={`p-1.5 rounded-lg ${results[doc.id] ? 'bg-[#EFF1F5] text-[#4A5A7B]' : 'bg-[#F5F4F0] text-[#A8A291]'}`}>
                        <FileText className="w-3.5 h-3.5" />
                    </div>
                    <div className="flex-1 truncate pr-6">
                        <span title={doc.name} className="text-sm">{doc.name}</span>
                        <div className="text-[10px] text-[#A8A291] font-normal mt-0.5">{doc.size > 1024 ? `${(doc.size/1024).toFixed(0)} KB` : `${doc.size} B`}</div>
                    </div>

                    {/* Delete Button */}
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            if (window.confirm(`Are you sure you want to remove ${doc.name}?`)) {
                                onRemoveDoc(doc.id);
                            }
                        }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 bg-white hover:bg-red-50 text-[#C4BFB3] hover:text-red-600 rounded-lg shadow-sm opacity-0 group-hover:opacity-100 transition-all border border-[#E5E7EB] z-20"
                        title="Remove Document"
                    >
                        <Trash2 className="w-3.5 h-3.5" />
                    </button>
                </div>
              </td>
              {columns.map((col) => {
                const isSelected = selectedCell?.docId === doc.id && selectedCell?.colId === col.id;
                return (
                    <td 
                    key={`${doc.id}-${col.id}`} 
                    className={`px-5 py-5 cursor-pointer transition-colors ${isTextWrapEnabled ? 'align-top' : 'h-16'}
                        ${isSelected ? 'bg-[#EFF1F5] ring-inset ring-2 ring-[#4A5A7B] z-10' : 'hover:bg-[#FAFAF7]'}
                    `}
                    onClick={() => onCellClick(doc.id, col.id)}
                    style={{ width: col.width || 240 }}
                    >
                    {getCellContent(doc.id, col.id)}
                    </td>
                );
              })}
              <td></td>
              <td></td>
            </tr>
          )})}
           {/* Empty State / Ghost Rows to keep grid structure */}
           {Array.from({ length: Math.max(5, 20 - documents.length) }).map((_, i) => (
            <tr key={`empty-${i}`} className="border-b border-[rgba(0,0,0,0.03)]">
                <td className="h-16 sticky left-0 z-10 bg-white"></td>
                <td className="sticky left-12 z-10 bg-white"></td>
                {columns.map(c => <td key={c.id} className="" style={{ width: c.width || 240 }}></td>)}
                <td></td>
                <td></td>
            </tr>
           ))}
        </tbody>
      </table>
    </div>
  );
};