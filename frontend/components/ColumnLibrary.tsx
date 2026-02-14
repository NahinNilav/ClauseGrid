import React, { useState, useEffect } from 'react';
import { ColumnTemplate, ColumnType, ColumnLibrary as ColumnLibraryType } from '../types';
import { 
  X, Search, Plus, Trash2, Library, Download, Upload, 
  Hash, Calendar, Type, List, CheckSquare, FolderOpen
} from './Icons';
import { 
  loadColumnLibrary, 
  saveColumnLibrary, 
  addTemplateToLibrary, 
  removeTemplateFromLibrary,
  importColumnLibrary,
  getTemplateCategories
} from '../utils/fileStorage';

interface ColumnLibraryProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectTemplate: (template: ColumnTemplate) => void;
}

const TYPE_ICONS: Record<ColumnType, React.FC<{ className?: string }>> = {
  text: Type,
  number: Hash,
  date: Calendar,
  boolean: CheckSquare,
  list: List,
};

const TYPE_COLORS: Record<ColumnType, string> = {
  text: 'bg-[#E5E7EB] text-[#6B6555]',
  number: 'bg-[#EFF1F5] text-[#4A5A7B]',
  date: 'bg-[#F0EDE6] text-[#8A8470]',
  boolean: 'bg-[#D8DCE5] text-[#3D4A66]',
  list: 'bg-[#F5F4F0] text-[#4D4A3F]',
};

export const ColumnLibrary: React.FC<ColumnLibraryProps> = ({
  isOpen,
  onClose,
  onSelectTemplate
}) => {
  const [library, setLibrary] = useState<ColumnLibraryType>({ version: 1, templates: [] });
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [categories, setCategories] = useState<string[]>([]);

  // Load library on mount
  useEffect(() => {
    if (isOpen) {
      const loaded = loadColumnLibrary();
      setLibrary(loaded);
      setCategories(getTemplateCategories());
    }
  }, [isOpen]);

  const handleDeleteTemplate = (templateId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm('Are you sure you want to delete this template from your library?')) {
      removeTemplateFromLibrary(templateId);
      setLibrary(loadColumnLibrary());
      setCategories(getTemplateCategories());
    }
  };

  const handleExportLibrary = async () => {
    try {
      await saveColumnLibrary(library, true);
    } catch (error) {
      console.error('Failed to export library:', error);
      alert('Failed to export library.');
    }
  };

  const handleImportLibrary = async () => {
    try {
      const imported = await importColumnLibrary();
      if (imported) {
        setLibrary(imported);
        setCategories(getTemplateCategories());
      }
    } catch (error) {
      console.error('Failed to import library:', error);
      alert('Failed to import library. The file may be invalid.');
    }
  };

  const filteredTemplates = library.templates.filter(template => {
    const matchesSearch = searchQuery === '' || 
      template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      template.prompt.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === null || template.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="fixed inset-4 md:inset-10 lg:inset-20 bg-white rounded-2xl shadow-elevated z-50 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-[#E5E7EB]">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-[#EFF1F5] rounded-lg">
              <Library className="w-5 h-5 text-[#4A5A7B]" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-[#1C1C1C] font-serif">Column Library</h2>
              <p className="text-sm text-[#8A8470]">{library.templates.length} saved templates</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleImportLibrary}
              className="flex items-center gap-2 px-3 py-1.5 text-[#4A5A7B] hover:bg-[#EFF1F5] text-xs font-semibold rounded-pill transition-all"
              title="Import Library"
            >
              <Upload className="w-3.5 h-3.5" />
              Import
            </button>
            <button
              onClick={handleExportLibrary}
              className="flex items-center gap-2 px-3 py-1.5 text-[#4A5A7B] hover:bg-[#EFF1F5] text-xs font-semibold rounded-pill transition-all"
              title="Export Library"
            >
              <Download className="w-3.5 h-3.5" />
              Export
            </button>
            <button
              onClick={onClose}
              className="p-2 hover:bg-[#F5F4F0] rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-[#A8A291]" />
            </button>
          </div>
        </div>

        {/* Search and Filters */}
        <div className="p-4 border-b border-[#E5E7EB] flex gap-4">
          <div className="flex-1 relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#C4BFB3]" />
            <input
              type="text"
              placeholder="Search templates..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 border border-[#E5E7EB] rounded-lg text-sm focus:outline-none focus:ring-[3px] focus:ring-[rgba(74,90,123,0.15)] focus:border-[#4A5A7B] placeholder:text-[#9CA3AF]"
            />
          </div>
          {categories.length > 0 && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSelectedCategory(null)}
                className={`px-3 py-1.5 text-xs font-medium rounded-pill transition-colors ${
                  selectedCategory === null 
                    ? 'bg-[#1C1C1C] text-white' 
                    : 'bg-[#F5F4F0] text-[#6B6555] hover:bg-[#E5E7EB]'
                }`}
              >
                All
              </button>
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-pill transition-colors ${
                    selectedCategory === cat 
                      ? 'bg-[#1C1C1C] text-white' 
                      : 'bg-[#F5F4F0] text-[#6B6555] hover:bg-[#E5E7EB]'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Template Grid */}
        <div className="flex-1 overflow-auto p-4">
          {filteredTemplates.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="p-4 bg-[#F5F4F0] rounded-full mb-4">
                <Library className="w-8 h-8 text-[#C4BFB3]" />
              </div>
              <h3 className="text-lg font-semibold text-[#1C1C1C] mb-2 font-serif">
                {library.templates.length === 0 ? 'No templates yet' : 'No matching templates'}
              </h3>
              <p className="text-sm text-[#8A8470] max-w-sm">
                {library.templates.length === 0 
                  ? 'Save columns to your library when creating or editing them to reuse across projects.'
                  : 'Try adjusting your search or filter criteria.'
                }
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredTemplates.map(template => {
                const TypeIcon = TYPE_ICONS[template.type];
                return (
                  <div
                    key={template.id}
                    onClick={() => onSelectTemplate(template)}
                    className="group p-4 border border-[#E5E7EB] rounded-xl hover:border-[#4A5A7B] hover:shadow-card-hover transition-all cursor-pointer bg-white"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className={`p-1.5 rounded-md ${TYPE_COLORS[template.type]}`}>
                          <TypeIcon className="w-3.5 h-3.5" />
                        </div>
                        <span className="font-semibold text-[#1C1C1C]">{template.name}</span>
                      </div>
                      <button
                        onClick={(e) => handleDeleteTemplate(template.id, e)}
                        className="p-1.5 opacity-0 group-hover:opacity-100 hover:bg-red-50 text-[#C4BFB3] hover:text-red-600 rounded-md transition-all"
                        title="Delete template"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    
                    <p className="text-sm text-[#6B6555] line-clamp-2 mb-3">{template.prompt}</p>
                    
                    <div className="flex items-center justify-between">
                      {template.category && (
                        <span className="text-xs px-2 py-0.5 bg-[#F5F4F0] text-[#8A8470] rounded-pill">
                          {template.category}
                        </span>
                      )}
                      <span className="text-xs text-[#C4BFB3]">
                        {new Date(template.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[#E5E7EB] bg-[#FAFAF7] rounded-b-2xl">
          <p className="text-xs text-[#A8A291] text-center">
            Click a template to add it as a new column in your project
          </p>
        </div>
      </div>
    </>
  );
};
