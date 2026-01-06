import { useState, useCallback, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Search,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  FolderTree,
  Loader2,
  X,
  List,
  LayoutList,
  Table2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { api } from '@/services/api';
import { FileIcon } from './file-icons';
import type { FileInfo, ApiResponse, DirectoryContents } from '@claude-code-webui/shared';

interface FileTreeProps {
  workingDirectory: string;
  selectedFile: string | null;
  onFileSelect: (path: string) => void;
  onFileOpen?: (path: string, content: string) => void;
  className?: string;
}

interface TreeState {
  expanded: Record<string, boolean>;
  loading: Record<string, boolean>;
  children: Record<string, FileInfo[]>;
}

type ViewMode = 'simple' | 'compact' | 'detailed';

// Format file size
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Format date
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } else if (days === 1) {
    return 'Yesterday';
  } else if (days < 7) {
    return `${days}d ago`;
  } else {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
}

// Directories to exclude from tree
const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '__pycache__',
  '.cache',
  'coverage',
  '.turbo',
]);

export function FileTree({
  workingDirectory,
  selectedFile,
  onFileSelect,
  onFileOpen,
  className,
}: FileTreeProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('simple');
  const [treeState, setTreeState] = useState<TreeState>({
    expanded: { [workingDirectory]: true },
    loading: {},
    children: {},
  });

  // Cycle through view modes
  const cycleViewMode = useCallback(() => {
    setViewMode(prev => {
      if (prev === 'simple') return 'compact';
      if (prev === 'compact') return 'detailed';
      return 'simple';
    });
  }, []);

  // Fetch root directory contents
  const { data: rootFiles, isLoading: rootLoading, refetch } = useQuery({
    queryKey: ['files', workingDirectory],
    queryFn: async () => {
      const response = await api.get<ApiResponse<DirectoryContents>>(
        `/api/files?path=${encodeURIComponent(workingDirectory)}`
      );
      if (response.data.success && response.data.data) {
        return response.data.data.files.filter(f => !EXCLUDED_DIRS.has(f.name));
      }
      return [];
    },
    staleTime: 30000, // Cache for 30 seconds
  });

  // Update children when root files change
  useEffect(() => {
    if (rootFiles) {
      setTreeState(prev => ({
        ...prev,
        children: { ...prev.children, [workingDirectory]: rootFiles },
      }));
    }
  }, [rootFiles, workingDirectory]);

  // Load directory contents
  const loadDirectory = useCallback(async (path: string) => {
    if (treeState.loading[path] || treeState.children[path]) {
      return;
    }

    setTreeState(prev => ({
      ...prev,
      loading: { ...prev.loading, [path]: true },
    }));

    try {
      const response = await api.get<ApiResponse<DirectoryContents>>(
        `/api/files?path=${encodeURIComponent(path)}`
      );
      if (response.data.success && response.data.data) {
        const files = response.data.data.files.filter(f => !EXCLUDED_DIRS.has(f.name));
        setTreeState(prev => ({
          ...prev,
          loading: { ...prev.loading, [path]: false },
          children: { ...prev.children, [path]: files },
        }));
      }
    } catch (error) {
      console.error('Failed to load directory:', error);
      setTreeState(prev => ({
        ...prev,
        loading: { ...prev.loading, [path]: false },
      }));
    }
  }, [treeState.loading, treeState.children]);

  // Toggle directory expansion
  const toggleExpand = useCallback((path: string, isDirectory: boolean) => {
    if (!isDirectory) return;

    setTreeState(prev => {
      const isExpanded = !prev.expanded[path];
      return {
        ...prev,
        expanded: { ...prev.expanded, [path]: isExpanded },
      };
    });

    // Load contents if expanding and not loaded
    if (!treeState.expanded[path] && !treeState.children[path]) {
      loadDirectory(path);
    }
  }, [treeState.expanded, treeState.children, loadDirectory]);

  // Handle file selection
  const handleSelect = useCallback((path: string) => {
    onFileSelect(path);
  }, [onFileSelect]);

  // Handle file open (double-click)
  const handleOpen = useCallback(async (file: FileInfo) => {
    if (file.type === 'directory' || !onFileOpen) return;

    try {
      const response = await api.get<ApiResponse<{ content: string }>>(
        `/api/files/content?path=${encodeURIComponent(file.path)}`
      );
      if (response.data.success && response.data.data) {
        onFileOpen(file.path, response.data.data.content);
      }
    } catch (error) {
      console.error('Failed to read file:', error);
    }
  }, [onFileOpen]);

  // Filter files based on search query
  const filterFiles = useCallback((files: FileInfo[], query: string): FileInfo[] => {
    if (!query) return files;

    const lowerQuery = query.toLowerCase();
    return files.filter(file => {
      const nameMatch = file.name.toLowerCase().includes(lowerQuery);
      if (nameMatch) return true;

      // If directory, check if any children match
      if (file.type === 'directory') {
        const children = treeState.children[file.path];
        if (children) {
          return filterFiles(children, query).length > 0;
        }
      }
      return false;
    });
  }, [treeState.children]);

  // Render tree node
  const renderNode = useCallback((file: FileInfo, depth: number): React.ReactNode => {
    const isDirectory = file.type === 'directory';
    const isExpanded = treeState.expanded[file.path];
    const isLoading = treeState.loading[file.path];
    const children = treeState.children[file.path];
    const isSelected = selectedFile === file.path;
    const paddingLeft = depth * 16 + 8;

    // Filter children if search query exists
    const filteredChildren = children ? filterFiles(children, searchQuery) : [];

    // Auto-expand directories with matching children during search
    const shouldAutoExpand = searchQuery && isDirectory && filteredChildren.length > 0;
    if (shouldAutoExpand && !isExpanded && !treeState.loading[file.path]) {
      // Trigger expansion in next tick to avoid state update during render
      setTimeout(() => toggleExpand(file.path, true), 0);
    }

    return (
      <div key={file.path}>
        <div
          role="treeitem"
          tabIndex={0}
          aria-expanded={isDirectory ? isExpanded : undefined}
          aria-selected={isSelected}
          className={cn(
            'flex items-center gap-1.5 py-1 px-2 cursor-pointer rounded-sm transition-colors',
            'hover:bg-muted/50 focus:outline-none focus:ring-1 focus:ring-primary/50',
            isSelected && 'bg-primary/10 text-primary'
          )}
          style={{ paddingLeft }}
          onClick={(e) => {
            e.stopPropagation();
            if (isDirectory) {
              toggleExpand(file.path, true);
            }
            handleSelect(file.path);
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (!isDirectory) {
              handleOpen(file);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              if (isDirectory) {
                toggleExpand(file.path, true);
              } else {
                handleOpen(file);
              }
            } else if (e.key === 'ArrowRight' && isDirectory && !isExpanded) {
              toggleExpand(file.path, true);
            } else if (e.key === 'ArrowLeft' && isDirectory && isExpanded) {
              toggleExpand(file.path, true);
            }
          }}
        >
          {/* Expand/Collapse indicator */}
          <span className="w-4 h-4 flex items-center justify-center shrink-0">
            {isDirectory ? (
              isLoading ? (
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              ) : isExpanded ? (
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-3 w-3 text-muted-foreground" />
              )
            ) : null}
          </span>

          {/* File/Folder icon */}
          <FileIcon
            filename={file.name}
            isDirectory={isDirectory}
            isOpen={isExpanded}
            className="h-4 w-4 shrink-0"
          />

          {/* Filename with search highlight and metadata */}
          <div className="flex-1 min-w-0 flex items-center gap-2">
            <span className="text-sm truncate">
              {searchQuery ? highlightMatch(file.name, searchQuery) : file.name}
            </span>
            {/* Compact mode: show size for files */}
            {viewMode === 'compact' && !isDirectory && file.size > 0 && (
              <span className="text-[10px] text-muted-foreground shrink-0">
                {formatFileSize(file.size)}
              </span>
            )}
            {/* Detailed mode: show size and date */}
            {viewMode === 'detailed' && (
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground shrink-0 ml-auto">
                {!isDirectory && file.size > 0 && (
                  <span className="w-14 text-right">{formatFileSize(file.size)}</span>
                )}
                {file.modifiedAt && (
                  <span className="w-16 text-right">{formatDate(file.modifiedAt)}</span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Children */}
        {isDirectory && isExpanded && (
          <div role="group">
            {isLoading ? (
              <div className="flex items-center gap-2 py-2 text-muted-foreground" style={{ paddingLeft: paddingLeft + 24 }}>
                <Loader2 className="h-3 w-3 animate-spin" />
                <span className="text-xs">Loading...</span>
              </div>
            ) : filteredChildren.length > 0 ? (
              filteredChildren
                .sort((a, b) => {
                  // Directories first, then alphabetically
                  if (a.type === 'directory' && b.type !== 'directory') return -1;
                  if (a.type !== 'directory' && b.type === 'directory') return 1;
                  return a.name.localeCompare(b.name);
                })
                .map(child => renderNode(child, depth + 1))
            ) : null}
          </div>
        )}
      </div>
    );
  }, [treeState, selectedFile, searchQuery, viewMode, filterFiles, toggleExpand, handleSelect, handleOpen]);

  // Sort and filter root files
  const displayFiles = useMemo(() => {
    const files = rootFiles || [];
    const filtered = filterFiles(files, searchQuery);
    return filtered.sort((a, b) => {
      if (a.type === 'directory' && b.type !== 'directory') return -1;
      if (a.type !== 'directory' && b.type === 'directory') return 1;
      return a.name.localeCompare(b.name);
    });
  }, [rootFiles, searchQuery, filterFiles]);

  return (
    <div className={cn('flex flex-col h-full bg-card', className)}>
      {/* Header */}
      <div className="shrink-0 p-2 border-b space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <FolderTree className="h-4 w-4" />
            <span>Files</span>
          </div>
          <div className="flex items-center gap-1">
            {/* View mode toggle */}
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={cycleViewMode}
              title={`View: ${viewMode.charAt(0).toUpperCase() + viewMode.slice(1)}`}
            >
              {viewMode === 'simple' && <List className="h-3.5 w-3.5" />}
              {viewMode === 'compact' && <LayoutList className="h-3.5 w-3.5" />}
              {viewMode === 'detailed' && <Table2 className="h-3.5 w-3.5" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => refetch()}
              disabled={rootLoading}
            >
              <RefreshCw className={cn('h-3.5 w-3.5', rootLoading && 'animate-spin')} />
            </Button>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search files..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-7 pl-7 pr-7 text-sm"
          />
          {searchQuery && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-0.5 top-1/2 -translate-y-1/2 h-6 w-6"
              onClick={() => setSearchQuery('')}
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      {/* Tree */}
      <ScrollArea className="flex-1">
        <div role="tree" className="py-1">
          {rootLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : displayFiles.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              {searchQuery ? 'No matching files' : 'No files found'}
            </div>
          ) : (
            displayFiles.map(file => renderNode(file, 0))
          )}
        </div>
      </ScrollArea>

      {/* Footer with path */}
      <div className="shrink-0 px-2 py-1.5 border-t">
        <p className="text-[10px] text-muted-foreground truncate" title={workingDirectory}>
          {workingDirectory}
        </p>
      </div>
    </div>
  );
}

// Helper function to highlight search matches
function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text;

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const index = lowerText.indexOf(lowerQuery);

  if (index === -1) return text;

  return (
    <>
      {text.slice(0, index)}
      <span className="bg-yellow-500/30 text-yellow-200 rounded px-0.5">
        {text.slice(index, index + query.length)}
      </span>
      {text.slice(index + query.length)}
    </>
  );
}

export default FileTree;
