import React, { useCallback } from 'react';
import { Upload, FileText, FlaskConical } from './Icons';
import { DocumentFile } from '../types';

interface DocumentUploadProps {
  onUpload: (files: DocumentFile[]) => void;
  onLoadSample?: () => void;
}

export const DocumentUpload: React.FC<DocumentUploadProps> = ({ onUpload, onLoadSample }) => {
  
  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      const fileList: File[] = Array.from(event.target.files);
      const processedFiles: DocumentFile[] = [];

      for (const file of fileList) {
        const content = await readFileAsBase64(file);
        processedFiles.push({
          id: Math.random().toString(36).substring(2, 9),
          name: file.name,
          type: file.type,
          size: file.size,
          content: content, // Base64 string (without data: prefix for easier handling if needed, but here we keep pure base64)
          mimeType: file.type || 'text/plain'
        });
      }
      onUpload(processedFiles);
    }
  };

  const readFileAsBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Remove data URL prefix (e.g., "data:application/pdf;base64,")
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  return (
    <div className="p-6 w-full max-w-2xl mx-auto">
      <div className="border-2 border-dashed border-[#DDD9D0] rounded-xl p-14 text-center hover:bg-[#FAFAF7] transition-colors relative group bg-white shadow-card">
        <input 
          type="file" 
          multiple 
          accept=".pdf,.txt,.md,.json" 
          onChange={handleFileChange}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
        />
        <div className="flex flex-col items-center justify-center space-y-4 text-[#8A8470] group-hover:text-[#4A5A7B] transition-colors">
          <div className="bg-[#EFF1F5] p-5 rounded-full group-hover:bg-[#D8DCE5] transition-colors duration-300">
            <Upload className="w-10 h-10 text-[#4A5A7B]" />
          </div>
          <div className="space-y-1">
            <p className="font-bold text-xl text-[#1C1C1C] font-serif">Drag & drop contracts here</p>
            <p className="text-sm text-[#A8A291]">Supports PDF, TXT, DOCX</p>
          </div>
        </div>
      </div>

      {onLoadSample && (
        <div className="mt-10 flex flex-col items-center">
          <div className="relative w-full flex items-center gap-4 mb-6">
            <div className="h-px bg-[#E5E7EB] flex-1"></div>
            <span className="text-[10px] font-bold text-[#A8A291] uppercase tracking-[0.15em]">Or try sample data</span>
            <div className="h-px bg-[#E5E7EB] flex-1"></div>
          </div>
          
          <button 
            onClick={onLoadSample}
            className="group flex items-center gap-3 px-6 py-3.5 bg-white border border-[#E5E7EB] hover:border-[#4A5A7B] hover:bg-[#EFF1F5] rounded-xl shadow-card hover:shadow-card-hover transition-all duration-300"
          >
              <div className="p-2 bg-[#F5F4F0] group-hover:bg-[#D8DCE5] rounded-lg transition-colors">
              <FlaskConical className="w-5 h-5 text-[#8A8470] group-hover:text-[#4A5A7B]" />
            </div>
            <div className="text-left">
              <p className="text-sm font-semibold text-[#1C1C1C]">Load PE Side Letter Dataset</p>
              <p className="text-xs text-[#A8A291] group-hover:text-[#4A5A7B]">Includes 10 docs & 4 extraction columns</p>
            </div>
          </button>
        </div>
      )}
    </div>
  );
};