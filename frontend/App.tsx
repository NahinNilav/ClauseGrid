import React, { useState, useRef } from 'react';
import { DataGrid } from './components/DataGrid';
import { VerificationSidebar } from './components/VerificationSidebar';
import { ChatInterface } from './components/ChatInterface';
import { AddColumnMenu } from './components/AddColumnMenu';
import { ColumnLibrary } from './components/ColumnLibrary';
import { AgenticLoadingOverlay } from './components/AgenticLoadingOverlay';
import { extractColumnData } from './services/geminiService';
import { processDocumentToMarkdown } from './services/documentProcessor';
import { createRunId, logRuntimeEvent } from './services/runtimeLogger';
import { DocumentFile, Column, ExtractionResult, SidebarMode, ColumnType, SavedProject, ColumnTemplate } from './types';
import { MessageSquare, Table, Square, FilePlus, LayoutTemplate, ChevronDown, Zap, Cpu, Brain, Trash2, Play, Download, WrapText, Loader2, Save, FolderOpen, RefreshCw, MoreHorizontal } from './components/Icons';
import { SAMPLE_COLUMNS } from './utils/sampleData';
import { saveProject, loadProject } from './utils/fileStorage';

// Available Models
const MODELS = [
  { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro', description: 'Deepest Reasoning', icon: Brain },
  { id: 'gemini-2.5-pro-preview', name: 'Gemini 2.5 Pro', description: 'Balanced', icon: Cpu },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: 'Fastest', icon: Zap },
];

const App: React.FC = () => {
  // State
  const [documents, setDocuments] = useState<DocumentFile[]>([]);
  const [projectName, setProjectName] = useState('Untitled Project');
  const [isEditingProjectName, setIsEditingProjectName] = useState(false);

  // Start with empty columns for a clean slate
  const [columns, setColumns] = useState<Column[]>([]);
  const [results, setResults] = useState<ExtractionResult>({});
  
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('none');
  const [selectedCell, setSelectedCell] = useState<{ docId: string; colId: string } | null>(null);
  const [previewDocId, setPreviewDocId] = useState<string | null>(null);
  
  // Verification Sidebar Expansion State
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(false);
  
  // Model State
  const [selectedModel, setSelectedModel] = useState<string>(MODELS[0].id);
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);

  // Add/Edit Column Menu State
  const [addColumnAnchor, setAddColumnAnchor] = useState<DOMRect | null>(null);
  const [editingColumnId, setEditingColumnId] = useState<string | null>(null);
  
  // Column Library State
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);

  // Extraction Control
  const [isProcessing, setIsProcessing] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [processingProgress, setProcessingProgress] = useState<{ current: number; total: number } | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Text Wrap State
  const [isTextWrapEnabled, setIsTextWrapEnabled] = useState(false);

  // Workflows Menu State
  const [isWorkflowsMenuOpen, setIsWorkflowsMenuOpen] = useState(false);

  // Document Selection State (for re-run)
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set());

  const toBase64 = (buffer: ArrayBuffer): string => {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  };

  // Handlers
  
  // Project Save/Load Handlers
  const handleSaveProject = async () => {
    const project: SavedProject = {
      version: 1,
      name: projectName,
      savedAt: new Date().toISOString(),
      columns: columns,
      documents: documents,
      results: results,
      selectedModel: selectedModel
    };
    
    try {
      const success = await saveProject(project);
      if (success) {
        // Brief visual feedback could be added here
      }
    } catch (error) {
      console.error('Failed to save project:', error);
      alert('Failed to save project. Please try again.');
    }
  };

  const handleLoadProject = async () => {
    // Warn if there's unsaved work
    const hasWork = documents.length > 0 || columns.length > 0 || Object.keys(results).length > 0;
    if (hasWork && !window.confirm('Loading a project will replace your current work. Continue?')) {
      return;
    }
    
    try {
      const project = await loadProject();
      if (project) {
        setProjectName(project.name);
        setColumns(project.columns);
        setDocuments(project.documents);
        setResults(project.results);
        if (project.selectedModel) {
          setSelectedModel(project.selectedModel);
        }
        // Reset UI state
        setSidebarMode('none');
        setSelectedCell(null);
        setPreviewDocId(null);
        setSelectedDocIds(new Set());
      }
    } catch (error) {
      console.error('Failed to load project:', error);
      alert('Failed to load project. The file may be corrupted or invalid.');
    }
  };
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      const fileList: File[] = Array.from(event.target.files);
      processUploadedFiles(fileList);
      // Reset input
      event.target.value = '';
    }
  };

  const processUploadedFiles = async (fileList: File[]) => {
    const uploadRunId = createRunId('upload');
    const uploadStartedAt = performance.now();

    logRuntimeEvent({
      event: 'upload_batch_started',
      stage: 'upload',
      runId: uploadRunId,
      metadata: {
        file_count: fileList.length,
        file_names: fileList.map((file) => file.name),
      },
    });

    setIsConverting(true);
    setProcessingProgress({ current: 0, total: fileList.length });
    try {
        const processedFiles: DocumentFile[] = [];

        for (let i = 0; i < fileList.length; i++) {
          const file = fileList[i];
          const sourceArrayBuffer = await file.arrayBuffer();
          const sourceContentBase64 = toBase64(sourceArrayBuffer);
          
          // Use local deterministic processor (markitdown style)
          const processedDoc = await processDocumentToMarkdown(file);
          const markdownContent = processedDoc.markdown;
          
          // Encode to Base64 to match our storage format (mimicking the sample data structure)
          // This keeps the rest of the app (which expects base64 strings for "content") happy
          const contentBase64 = btoa(unescape(encodeURIComponent(markdownContent)));

          processedFiles.push({
            id: Math.random().toString(36).substring(2, 9),
            name: file.name,
            type: file.type,
            size: file.size,
            content: contentBase64,
            mimeType: 'text/markdown', // Force to markdown so the viewer treats it as text
            sourceContentBase64,
            sourceMimeType: file.type || processedDoc.artifact?.mime_type || 'application/octet-stream',
            artifact: processedDoc.artifact,
          });

          // Update progress AFTER file is processed
          setProcessingProgress({ current: i + 1, total: fileList.length });

          logRuntimeEvent({
            event: 'upload_document_ready',
            stage: 'upload',
            runId: uploadRunId,
            metadata: {
              file_name: file.name,
              file_size_bytes: file.size,
              artifact_format: processedDoc.artifact?.format || 'none',
              citation_count: Object.keys(processedDoc.artifact?.citation_index || {}).length,
            },
          });
        }

        setDocuments(prev => [...prev, ...processedFiles]);
        logRuntimeEvent({
          event: 'upload_batch_completed',
          stage: 'upload',
          runId: uploadRunId,
          metadata: {
            processed_count: processedFiles.length,
            duration_ms: Math.round(performance.now() - uploadStartedAt),
          },
        });
    } catch (error) {
        console.error("Failed to process files:", error);
        logRuntimeEvent({
          event: 'upload_batch_failed',
          level: 'error',
          stage: 'upload',
          runId: uploadRunId,
          message: error instanceof Error ? error.message : 'Unknown upload error',
          metadata: {
            duration_ms: Math.round(performance.now() - uploadStartedAt),
          },
        });
        alert("Error processing some files. Please check if they are valid PDF or DOCX documents.");
    } finally {
        // Small delay to ensure the completion animation plays
        setTimeout(() => {
          setIsConverting(false);
          setProcessingProgress(null);
        }, 800);
    }
  };

  const handleLoadSample = () => {
    const sampleCols = SAMPLE_COLUMNS;

    // setDocuments([]); // Keep existing documents
    setColumns(sampleCols);
    setResults({}); // Reset results as columns have changed
    setSidebarMode('none');
    setProjectName('PE Side Letters Review');
    setPreviewDocId(null);
    setSelectedCell(null);
  };

  const handleClearAll = () => {
    // Only confirm if actual analysis work (results) exists.
    // If just documents are loaded, clear immediately for better UX.
    const hasWork = Object.keys(results).length > 0;
    
    if (hasWork && !window.confirm("Are you sure you want to clear the project? Analysis results will be lost.")) {
      return;
    }

    // Abort processing
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setIsProcessing(false);

    // Reset State completely
    setDocuments([]);
    setColumns([]);
    setResults({});
    setSidebarMode('none');
    setSelectedCell(null);
    setPreviewDocId(null);
    setProjectName('Untitled Project');
    setAddColumnAnchor(null);
    setEditingColumnId(null);

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleRemoveDoc = (docId: string) => {
    setDocuments(prev => prev.filter(d => d.id !== docId));
    setResults(prev => {
      const next = { ...prev };
      delete next[docId];
      return next;
    });
    if (selectedCell?.docId === docId) {
      setSidebarMode('none');
      setSelectedCell(null);
    }
    if (previewDocId === docId) {
      setPreviewDocId(null);
      setSidebarMode('none');
    }
  };

  const handleSaveColumn = (colDef: { name: string; type: ColumnType; prompt: string }) => {
    if (editingColumnId) {
      // Update existing column
      setColumns(prev => prev.map(c => c.id === editingColumnId ? { ...c, ...colDef } : c));
      setEditingColumnId(null);
    } else {
      // Create new column
      const newCol: Column = {
        id: `col_${Date.now()}`,
        name: colDef.name,
        type: colDef.type,
        prompt: colDef.prompt,
        status: 'idle',
        width: 250 // Default width
      };
      setColumns(prev => [...prev, newCol]);
    }
    setAddColumnAnchor(null);
  };
  
  const handleDeleteColumn = () => {
    if (editingColumnId) {
        setColumns(prev => prev.filter(c => c.id !== editingColumnId));
        // Clean up results for this column
        setResults(prev => {
            const next = { ...prev };
            Object.keys(next).forEach(docId => {
                if (next[docId] && next[docId][editingColumnId]) {
                    // We create a copy of the doc results to avoid mutation
                    const docResults = { ...next[docId] };
                    delete docResults[editingColumnId];
                    next[docId] = docResults;
                }
            });
            return next;
        });
        
        if (selectedCell?.colId === editingColumnId) {
            setSelectedCell(null);
            setSidebarMode('none');
        }
        
        setEditingColumnId(null);
        setAddColumnAnchor(null);
    }
  };

  const handleEditColumn = (colId: string, rect: DOMRect) => {
    setEditingColumnId(colId);
    setAddColumnAnchor(rect);
  };
  
  const handleColumnResize = (colId: string, newWidth: number) => {
    setColumns(prev => prev.map(c => c.id === colId ? { ...c, width: newWidth } : c));
  };

  const handleCloseMenu = () => {
    setAddColumnAnchor(null);
    setEditingColumnId(null);
  };

  const handleSelectTemplate = (template: ColumnTemplate) => {
    // Create a new column from the template
    const newCol: Column = {
      id: `col_${Date.now()}`,
      name: template.name,
      type: template.type,
      prompt: template.prompt,
      status: 'idle',
      width: 250
    };
    setColumns(prev => [...prev, newCol]);
    setIsLibraryOpen(false);
  };

  const handleOpenLibrary = () => {
    setAddColumnAnchor(null);
    setIsLibraryOpen(true);
  };

  const handleStopExtraction = () => {
    if (abortControllerRef.current) {
      logRuntimeEvent({
        event: 'analysis_stop_requested',
        stage: 'analysis',
        message: 'User requested to stop extraction',
      });
      abortControllerRef.current.abort();
      setIsProcessing(false);
    }
  };

  const handleRunAnalysis = () => {
    if (documents.length === 0 || columns.length === 0) return;
    processExtraction(documents, columns);
  };

  const handleRerunSelected = () => {
    if (selectedDocIds.size === 0 || columns.length === 0) return;
    
    // Get selected documents
    const selectedDocs = documents.filter(d => selectedDocIds.has(d.id));
    
    // Clear existing results for selected documents
    setResults(prev => {
      const next = { ...prev };
      selectedDocIds.forEach(docId => {
        delete next[docId];
      });
      return next;
    });
    
    // Run extraction on selected documents
    processExtraction(selectedDocs, columns, true);
  };

  const handleToggleDocSelection = (docId: string) => {
    setSelectedDocIds(prev => {
      const next = new Set(prev);
      if (next.has(docId)) {
        next.delete(docId);
      } else {
        next.add(docId);
      }
      return next;
    });
  };

  const handleToggleAllDocSelection = () => {
    if (selectedDocIds.size === documents.length) {
      // Deselect all
      setSelectedDocIds(new Set());
    } else {
      // Select all
      setSelectedDocIds(new Set(documents.map(d => d.id)));
    }
  };

  const handleExportCSV = () => {
    if (documents.length === 0) return;

    // Headers
    const headerRow = ['Document Name', ...columns.map(c => c.name)];
    
    // Rows
    const rows = documents.map(doc => {
      const rowData = [doc.name];
      columns.forEach(col => {
        const cell = results[doc.id]?.[col.id];
        // Escape double quotes with two double quotes
        const val = cell ? cell.value.replace(/"/g, '""') : "";
        rowData.push(`"${val}"`);
      });
      return rowData.join(",");
    });

    const csvContent = [headerRow.join(","), ...rows].join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `${projectName.replace(/\s+/g, '_').toLowerCase()}_export.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const processExtraction = async (docsToProcess: DocumentFile[], colsToProcess: Column[], forceOverwrite: boolean = false) => {
    const analysisRunId = createRunId(forceOverwrite ? 'rerun' : 'analysis');
    const analysisStartedAt = performance.now();

    // Cancel any previous run
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      logRuntimeEvent({
        event: 'analysis_previous_run_aborted',
        stage: 'analysis',
        runId: analysisRunId,
      });
    }
    
    // Start new run
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsProcessing(true);

    try {
      logRuntimeEvent({
        event: 'analysis_started',
        stage: 'analysis',
        runId: analysisRunId,
        metadata: {
          model_id: selectedModel,
          document_count: docsToProcess.length,
          column_count: colsToProcess.length,
          overwrite_existing: forceOverwrite,
        },
      });

      // Mark all target columns as extracting initially
      setColumns(prev => prev.map(c => colsToProcess.some(target => target.id === c.id) ? { ...c, status: 'extracting' } : c));

      // 1. Flatten all tasks: Create a list of {doc, col} pairs for every cell that needs processing
      const tasks: { doc: DocumentFile; col: Column }[] = [];
      
      for (const doc of docsToProcess) {
          for (const col of colsToProcess) {
             // Only add task if result doesn't exist or forceOverwrite is true
             if (forceOverwrite || !results[doc.id]?.[col.id]) {
                 tasks.push({ doc, col });
             }
          }
      }

      const totalPossibleCells = docsToProcess.length * colsToProcess.length;
      const skippedCells = totalPossibleCells - tasks.length;
      let successCount = 0;
      let failureCount = 0;

      logRuntimeEvent({
        event: 'analysis_task_queue_built',
        stage: 'analysis',
        runId: analysisRunId,
        metadata: {
          total_possible_cells: totalPossibleCells,
          queued_tasks: tasks.length,
          skipped_existing_cells: skippedCells,
        },
      });

      // 2. Process EVERYTHING concurrently (Simultaneous)
      // Removed batching logic as requested to maximize speed
      const promises = tasks.map(async ({ doc, col }) => {
          if (controller.signal.aborted) return;

          logRuntimeEvent({
            event: 'column_extraction_started',
            stage: 'analysis',
            runId: analysisRunId,
            metadata: {
              document_id: doc.id,
              document_name: doc.name,
              column_id: col.id,
              column_name: col.name,
              column_type: col.type,
            },
          });

          try {
              const data = await extractColumnData(doc, col, selectedModel);
              if (controller.signal.aborted) return;

              setResults(prev => ({
                  ...prev,
                  [doc.id]: {
                      ...(prev[doc.id] || {}),
                      [col.id]: data
                  }
              }));
              successCount += 1;

              logRuntimeEvent({
                event: 'column_extraction_completed',
                stage: 'analysis',
                runId: analysisRunId,
                metadata: {
                  document_id: doc.id,
                  document_name: doc.name,
                  column_id: col.id,
                  column_name: col.name,
                  confidence: data.confidence,
                  value_chars: data.value.length,
                },
              });
          } catch (e) {
              failureCount += 1;
              console.error(`Failed to extract ${col.name} for ${doc.name}`, e);
              logRuntimeEvent({
                event: 'column_extraction_failed',
                level: 'error',
                stage: 'analysis',
                runId: analysisRunId,
                message: e instanceof Error ? e.message : 'Unknown extraction error',
                metadata: {
                  document_id: doc.id,
                  document_name: doc.name,
                  column_id: col.id,
                  column_name: col.name,
                },
              });
          }
      });

      await Promise.all(promises);

      // Mark all columns as completed if finished successfully without abort
      if (!controller.signal.aborted) {
          setColumns(prev => prev.map(c => colsToProcess.some(target => target.id === c.id) ? { ...c, status: 'completed' } : c));

          logRuntimeEvent({
            event: 'analysis_completed',
            stage: 'analysis',
            runId: analysisRunId,
            metadata: {
              model_id: selectedModel,
              queued_tasks: tasks.length,
              successful_cells: successCount,
              failed_cells: failureCount,
              skipped_existing_cells: skippedCells,
              duration_ms: Math.round(performance.now() - analysisStartedAt),
            },
          });
      } else {
          logRuntimeEvent({
            event: 'analysis_aborted',
            level: 'warning',
            stage: 'analysis',
            runId: analysisRunId,
            metadata: {
              queued_tasks: tasks.length,
              successful_cells: successCount,
              failed_cells: failureCount,
              duration_ms: Math.round(performance.now() - analysisStartedAt),
            },
          });
      }

    } finally {
      // If we are still the active controller (cleanup)
      if (abortControllerRef.current === controller) {
        setIsProcessing(false);
        abortControllerRef.current = null;
        
        // Reset extracting status if stopped early (aborted)
        setColumns(prev => prev.map(c => c.status === 'extracting' ? { ...c, status: 'idle' } : c));
      }
    }
  };

  const handleCellClick = (docId: string, colId: string) => {
    const cell = results[docId]?.[colId];
    if (cell) {
      setSelectedCell({ docId, colId });
      setPreviewDocId(null);
      setSidebarMode('verify');
      setIsSidebarExpanded(false); // Reset to narrow "Answer Only" view
    }
  };

  const handleDocumentClick = (docId: string) => {
    setSelectedCell(null);
    setPreviewDocId(docId);
    setSidebarMode('verify');
    setIsSidebarExpanded(true); // Document preview should be wide
  };

  const handleVerifyCell = () => {
    if (!selectedCell) return;
    const { docId, colId } = selectedCell;
    
    setResults(prev => ({
      ...prev,
      [docId]: {
        ...prev[docId],
        [colId]: {
          ...prev[docId][colId]!,
          status: 'verified'
        }
      }
    }));
  };

  const toggleChat = () => {
    if (sidebarMode === 'chat') {
      setSidebarMode('none');
    } else {
      setSidebarMode('chat');
      setSelectedCell(null);
      setPreviewDocId(null);
      setIsSidebarExpanded(false); // Chat usually is standard width
    }
  };

  // Render Helpers
  const getSidebarData = () => {
    // Priority 1: Selected Cell (Inspecting result)
    if (selectedCell) {
      return {
        cell: results[selectedCell.docId]?.[selectedCell.colId] || null,
        document: documents.find(d => d.id === selectedCell.docId) || null,
        column: columns.find(c => c.id === selectedCell.colId) || null
      };
    }
    // Priority 2: Previewed Document (Reading mode)
    if (previewDocId) {
      return {
        cell: null,
        document: documents.find(d => d.id === previewDocId) || null,
        column: null
      };
    }
    return null;
  };

  const sidebarData = getSidebarData();
  const currentModel = MODELS.find(m => m.id === selectedModel) || MODELS[0];

  // Calculate Sidebar Width
  const getSidebarWidthClass = () => {
      if (sidebarMode === 'none') return 'w-0 translate-x-10 opacity-0 overflow-hidden';
      
      // Chat is fixed width
      if (sidebarMode === 'chat') return 'w-[400px] translate-x-0';
      
      // Verify Mode depends on expansion
      if (isSidebarExpanded) return 'w-[900px] translate-x-0'; // Wide Inspector
      return 'w-[400px] translate-x-0'; // Narrow Analyst
  };

  return (
    <div className="flex h-screen bg-[#F5F4F0] text-black font-sans">
      {/* Hidden File Input */}
      <input 
        type="file" 
        ref={fileInputRef}
        onChange={handleFileUpload}
        multiple
        className="hidden"
        accept=".pdf,.htm,.html,.txt,.md,.json,.docx"
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="relative z-50 bg-[#F5F4F0] h-16 flex items-center justify-between px-6">
          <div className="flex items-center gap-5 min-w-0">
            <h1 className="text-xl font-bold text-black tracking-tight whitespace-nowrap font-serif">Makebell </h1>
            <div className="h-5 w-px bg-[#DDD9D0] flex-shrink-0"></div>
            {isEditingProjectName ? (
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                onBlur={() => setIsEditingProjectName(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') setIsEditingProjectName(false);
                }}
                className="text-sm font-medium text-black border-b border-black outline-none bg-transparent min-w-[150px]"
                autoFocus
              />
            ) : (
              <p 
                className="text-sm text-[#1C1C1C] font-medium cursor-text hover:text-black px-2 py-1 rounded-md hover:bg-[#E5E7EB] transition-all select-none truncate max-w-[200px] sm:max-w-[300px]"
                onDoubleClick={() => setIsEditingProjectName(true)}
                title="Double click to rename"
              >
                {projectName}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
             {/* Chat Button - Borderless text+icon */}
             <button 
                onClick={toggleChat}
                className={`flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-pill transition-all active:scale-[0.97] ${
                  sidebarMode === 'chat' 
                  ? 'bg-[#EFF1F5] text-[#4A5A7B]' 
                  : 'text-[#333333] hover:bg-[#E5E7EB]'
                }`}
                title="AI Analyst"
             >
                <MessageSquare className="w-3.5 h-3.5" />
                Chat
             </button>

             {/* Workflows Dropdown - Consolidates Save, Load, Export, Clear, Wrap, Load Sample */}
             <div className="relative">
               <button 
                  onClick={() => setIsWorkflowsMenuOpen(!isWorkflowsMenuOpen)}
                  className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-[#333333] hover:bg-[#E5E7EB] rounded-pill transition-all active:scale-[0.97]"
               >
                  <MoreHorizontal className="w-3.5 h-3.5" />
                  Workflows
               </button>
               {isWorkflowsMenuOpen && (
                 <>
                   <div className="fixed inset-0 z-40" onClick={() => setIsWorkflowsMenuOpen(false)}></div>
                   <div className="absolute right-0 top-full mt-2 w-52 bg-white rounded-xl shadow-elevated border border-[#E5E7EB] py-1.5 z-50">
                     <button onClick={() => { handleSaveProject(); setIsWorkflowsMenuOpen(false); }} disabled={documents.length === 0 && columns.length === 0} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-[#333333] hover:bg-[#F5F4F0] transition-colors disabled:opacity-40">
                       <Save className="w-4 h-4 text-[#8A8470]" /> Save Project
                     </button>
                     <button onClick={() => { handleLoadProject(); setIsWorkflowsMenuOpen(false); }} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-[#333333] hover:bg-[#F5F4F0] transition-colors">
                       <FolderOpen className="w-4 h-4 text-[#8A8470]" /> Load Project
                     </button>
                     <button onClick={() => { handleExportCSV(); setIsWorkflowsMenuOpen(false); }} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-[#333333] hover:bg-[#F5F4F0] transition-colors">
                       <Download className="w-4 h-4 text-[#8A8470]" /> Export CSV
                     </button>
                     <div className="h-px bg-[#E5E7EB] my-1.5 mx-3"></div>
                     <button onClick={() => { handleLoadSample(); setIsWorkflowsMenuOpen(false); }} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-[#333333] hover:bg-[#F5F4F0] transition-colors">
                       <LayoutTemplate className="w-4 h-4 text-[#8A8470]" /> Load Sample
                     </button>
                     <button onClick={() => { setIsTextWrapEnabled(!isTextWrapEnabled); setIsWorkflowsMenuOpen(false); }} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-[#333333] hover:bg-[#F5F4F0] transition-colors">
                       <WrapText className="w-4 h-4 text-[#8A8470]" /> {isTextWrapEnabled ? 'Unwrap Text' : 'Wrap Text'}
                     </button>
                     <div className="h-px bg-[#E5E7EB] my-1.5 mx-3"></div>
                     <button onClick={() => { handleClearAll(); setIsWorkflowsMenuOpen(false); }} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors">
                       <Trash2 className="w-4 h-4" /> Clear Project
                     </button>
                   </div>
                 </>
               )}
             </div>

             {/* Add Document Button - Borderless */}
             <button 
                onClick={() => !isConverting && fileInputRef.current?.click()}
                disabled={isConverting}
                className={`flex items-center gap-2 px-3 py-2 text-xs font-semibold text-[#333333] hover:bg-[#E5E7EB] rounded-pill transition-all active:scale-[0.97] ${isConverting ? 'opacity-70 cursor-wait' : ''}`}
                title="Add Documents"
             >
                {isConverting ? (
                    <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-[#4A5A7B]" />
                        <span>Converting...</span>
                    </>
                ) : (
                    <>
                        <FilePlus className="w-3.5 h-3.5" />
                        <span>Add Document</span>
                    </>
                )}
             </button>

             <div className="h-5 w-px bg-[#DDD9D0] mx-1"></div>

             {/* Model Selector - Minimal sand pill */}
             <div className="relative">
                <button 
                onClick={() => !isProcessing && setIsModelMenuOpen(!isModelMenuOpen)}
                disabled={isProcessing}
                className={`flex items-center gap-2 px-3 py-2 bg-[#E5E7EB] text-[#333333] rounded-pill border border-[#DDD9D0] transition-all ${!isProcessing ? 'hover:bg-[#DDD9D0] active:scale-[0.97]' : 'opacity-60 cursor-not-allowed'}`}
                >
                  <div className="flex items-center gap-2">
                    <currentModel.icon className="w-3.5 h-3.5 text-[#6B6555]" />
                    <span className="text-xs font-semibold">{currentModel.name}</span>
                  </div>
                  <ChevronDown className="w-3 h-3 opacity-50" />
                </button>
                
                {isModelMenuOpen && (
                  <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsModelMenuOpen(false)}></div>
                  <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-xl shadow-elevated border border-[#E5E7EB] p-1.5 z-50">
                    {MODELS.map(model => (
                      <button
                        key={model.id}
                        onClick={() => {
                          setSelectedModel(model.id);
                          setIsModelMenuOpen(false);
                        }}
                        className={`w-full text-left px-3 py-2.5 rounded-lg flex items-center gap-3 transition-colors ${
                          selectedModel === model.id ? 'bg-[#F5F4F0] text-[#1C1C1C]' : 'hover:bg-[#FAFAF7] text-[#333333]'
                        }`}
                      >
                        <div className={`p-1.5 rounded-md ${selectedModel === model.id ? 'bg-white shadow-sm border border-[#E5E7EB]' : 'bg-[#F5F4F0]'}`}>
                          <model.icon className="w-4 h-4 text-[#6B6555]" />
                        </div>
                        <div>
                          <div className="text-xs font-bold">{model.name}</div>
                          <div className="text-[10px] text-[#8A8470]">{model.description}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                  </>
                )}
              </div>

             {/* Run / Stop Button - Black pill CTA with sage hover */}
             {isProcessing ? (
                <button 
                  onClick={handleStopExtraction}
                  className="flex items-center gap-2 px-5 py-2 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 text-xs font-semibold rounded-pill transition-all active:scale-[0.97]"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  Stop
                </button>
             ) : selectedDocIds.size > 0 ? (
                <button 
                  onClick={handleRerunSelected}
                  disabled={columns.length === 0}
                  className="flex items-center gap-2 px-5 py-2 bg-[#1C1C1C] hover:bg-[#333333] text-white text-xs font-bold rounded-pill transition-all active:scale-[0.97] shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Re-run analysis on selected documents"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Re-run ({selectedDocIds.size})
                </button>
             ) : (
                <button 
                  onClick={handleRunAnalysis}
                  disabled={documents.length === 0 || columns.length === 0}
                  className="flex items-center gap-2 px-5 py-2 bg-[#1C1C1C] hover:bg-[#333333] text-white text-xs font-bold rounded-pill transition-all active:scale-[0.97] shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="w-1.5 h-1.5 bg-[#D8DCE5] rounded-full"></div>
                  Run Analysis
                </button>
             )}
          </div>
        </header>

        {/* Workspace */}
        <main className="flex-1 flex overflow-hidden relative p-4 pt-2">
          {/* Conversion Overlay */}
          {isConverting && (
            <AgenticLoadingOverlay 
              processingComplete={processingProgress?.current === processingProgress?.total}
              currentFile={processingProgress?.current || 0}
              totalFiles={processingProgress?.total || 0}
            />
          )}

          <div className="flex-1 flex flex-col min-w-0 bg-white rounded-xl shadow-card overflow-hidden">
             <DataGrid 
                documents={documents} 
                columns={columns} 
                results={results}
                onAddColumn={(rect) => setAddColumnAnchor(rect)}
                onEditColumn={handleEditColumn}
                onColumnResize={handleColumnResize}
                onCellClick={handleCellClick}
                onDocClick={handleDocumentClick}
                onRemoveDoc={handleRemoveDoc}
                selectedCell={selectedCell}
                isTextWrapEnabled={isTextWrapEnabled}
                onDropFiles={(files) => processUploadedFiles(files)}
                selectedDocIds={selectedDocIds}
                onToggleDocSelection={handleToggleDocSelection}
                onToggleAllDocSelection={handleToggleAllDocSelection}
             />
          </div>

          {/* Add/Edit Column Menu */}
          {addColumnAnchor && (
            <AddColumnMenu 
              triggerRect={addColumnAnchor}
              onClose={handleCloseMenu}
              onSave={handleSaveColumn}
              onDelete={handleDeleteColumn}
              modelId={selectedModel}
              initialData={editingColumnId ? columns.find(c => c.id === editingColumnId) : undefined}
              onOpenLibrary={handleOpenLibrary}
            />
          )}

          {/* Column Library Modal */}
          <ColumnLibrary
            isOpen={isLibraryOpen}
            onClose={() => setIsLibraryOpen(false)}
            onSelectTemplate={handleSelectTemplate}
          />

          {/* Right Sidebar Container (Animated Width) */}
          <div 
            className={`transition-all duration-300 ease-in-out bg-white shadow-card z-30 relative ml-3 rounded-xl overflow-hidden ${getSidebarWidthClass()}`}
          >
            <div className="w-full h-full absolute right-0 top-0 flex flex-col">
                {sidebarMode === 'verify' && sidebarData && (
                    <VerificationSidebar 
                        cell={sidebarData.cell}
                        document={sidebarData.document}
                        column={sidebarData.column}
                        onClose={() => { setSidebarMode('none'); setSelectedCell(null); setPreviewDocId(null); }}
                        onVerify={handleVerifyCell}
                        isExpanded={isSidebarExpanded}
                        onExpand={setIsSidebarExpanded}
                    />
                )}
                {sidebarMode === 'chat' && (
                    <ChatInterface 
                        documents={documents}
                        columns={columns}
                        results={results}
                        onClose={() => setSidebarMode('none')}
                        modelId={selectedModel}
                    />
                )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default App;
