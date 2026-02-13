import { SavedProject, ColumnLibrary, ColumnTemplate } from '../types';

// ============================================
// Project Save/Load Functions
// ============================================

export const saveProject = async (project: SavedProject): Promise<boolean> => {
  const jsonString = JSON.stringify(project, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const filename = `${project.name.replace(/\s+/g, '_').toLowerCase()}.tabular-project.json`;

  // Always use the download fallback - it's more reliable across browsers
  // The File System Access API has issues with Safari and some security contexts
  try {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    return true;
  } catch (err: any) {
    console.error('Save project error:', err);
    throw new Error(`Failed to save: ${err.message}`);
  }
};

export const loadProject = async (): Promise<SavedProject | null> => {
  // Always use file input - it's more reliable across browsers
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      
      try {
        const text = await file.text();
        const project = JSON.parse(text) as SavedProject;
        
        if (!validateProject(project)) {
          throw new Error('Invalid project file structure');
        }
        
        resolve(project);
      } catch (err: any) {
        console.error('Load project error:', err);
        reject(new Error(`Failed to load: ${err.message}`));
      }
    };
    
    // Handle cancel - use a timeout since oncancel isn't reliable
    const handleFocus = () => {
      setTimeout(() => {
        if (!input.files?.length) {
          resolve(null);
        }
        window.removeEventListener('focus', handleFocus);
      }, 300);
    };
    window.addEventListener('focus', handleFocus);
    
    input.click();
  });
};

const validateProject = (project: any): project is SavedProject => {
  return (
    project &&
    typeof project.version === 'number' &&
    typeof project.name === 'string' &&
    Array.isArray(project.columns) &&
    Array.isArray(project.documents) &&
    typeof project.results === 'object'
  );
};

// ============================================
// Column Library Save/Load Functions
// ============================================

const LIBRARY_STORAGE_KEY = 'tabular-review-column-library';

export const saveColumnLibrary = async (library: ColumnLibrary, toFile: boolean = false): Promise<boolean> => {
  // Always save to localStorage as backup
  localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(library));
  
  if (toFile) {
    const jsonString = JSON.stringify(library, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });

    if (isFileSystemAccessSupported()) {
      try {
        const handle = await window.showSaveFilePicker!({
          suggestedName: 'column-library.json',
          types: [{
            description: 'Column Library',
            accept: { 'application/json': ['.json'] }
          }]
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return true;
      } catch (err: any) {
        if (err.name === 'AbortError') {
          return false;
        }
        throw err;
      }
    } else {
      // Fallback: download
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'column-library.json';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      return true;
    }
  }
  
  return true;
};

export const loadColumnLibrary = (): ColumnLibrary => {
  // Load from localStorage
  const stored = localStorage.getItem(LIBRARY_STORAGE_KEY);
  if (stored) {
    try {
      const library = JSON.parse(stored) as ColumnLibrary;
      if (validateLibrary(library)) {
        return library;
      }
    } catch {
      // Invalid JSON, return empty
    }
  }
  
  return { version: 1, templates: [] };
};

export const importColumnLibrary = async (): Promise<ColumnLibrary | null> => {
  if (isFileSystemAccessSupported()) {
    try {
      const [handle] = await window.showOpenFilePicker!({
        types: [{
          description: 'Column Library',
          accept: { 'application/json': ['.json'] }
        }]
      });
      const file = await handle.getFile();
      const text = await file.text();
      const library = JSON.parse(text) as ColumnLibrary;
      
      if (!validateLibrary(library)) {
        throw new Error('Invalid library file structure');
      }
      
      // Merge with existing library
      const existing = loadColumnLibrary();
      const merged = mergeLibraries(existing, library);
      await saveColumnLibrary(merged);
      
      return merged;
    } catch (err: any) {
      if (err.name === 'AbortError') {
        return null;
      }
      throw err;
    }
  } else {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) {
          resolve(null);
          return;
        }
        
        try {
          const text = await file.text();
          const library = JSON.parse(text) as ColumnLibrary;
          
          if (!validateLibrary(library)) {
            throw new Error('Invalid library file structure');
          }
          
          const existing = loadColumnLibrary();
          const merged = mergeLibraries(existing, library);
          await saveColumnLibrary(merged);
          
          resolve(merged);
        } catch (err) {
          reject(err);
        }
      };
      
      input.oncancel = () => resolve(null);
      input.click();
    });
  }
};

const validateLibrary = (library: any): library is ColumnLibrary => {
  return (
    library &&
    typeof library.version === 'number' &&
    Array.isArray(library.templates)
  );
};

const mergeLibraries = (existing: ColumnLibrary, imported: ColumnLibrary): ColumnLibrary => {
  const existingIds = new Set(existing.templates.map(t => t.id));
  const newTemplates = imported.templates.filter(t => !existingIds.has(t.id));
  
  return {
    version: 1,
    templates: [...existing.templates, ...newTemplates]
  };
};

// ============================================
// Column Template Helpers
// ============================================

export const addTemplateToLibrary = (template: Omit<ColumnTemplate, 'id' | 'createdAt'>): ColumnTemplate => {
  const library = loadColumnLibrary();
  const newTemplate: ColumnTemplate = {
    ...template,
    id: `tpl_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    createdAt: new Date().toISOString()
  };
  
  library.templates.push(newTemplate);
  saveColumnLibrary(library);
  
  return newTemplate;
};

export const removeTemplateFromLibrary = (templateId: string): void => {
  const library = loadColumnLibrary();
  library.templates = library.templates.filter(t => t.id !== templateId);
  saveColumnLibrary(library);
};

export const updateTemplateInLibrary = (templateId: string, updates: Partial<Omit<ColumnTemplate, 'id' | 'createdAt'>>): void => {
  const library = loadColumnLibrary();
  const index = library.templates.findIndex(t => t.id === templateId);
  if (index !== -1) {
    library.templates[index] = { ...library.templates[index], ...updates };
    saveColumnLibrary(library);
  }
};

export const getTemplateCategories = (): string[] => {
  const library = loadColumnLibrary();
  const categories = new Set<string>();
  library.templates.forEach(t => {
    if (t.category) {
      categories.add(t.category);
    }
  });
  return Array.from(categories).sort();
};
