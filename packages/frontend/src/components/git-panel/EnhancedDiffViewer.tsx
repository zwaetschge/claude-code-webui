import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import ReactDiffViewer, { DiffMethod } from 'react-diff-viewer-continued';
import {
  Loader2,
  Plus,
  Minus,
  FileCode,
  Columns,
  List,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { api } from '@/services/api';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { ApiResponse } from '@claude-code-webui/shared';
import { cn } from '@/lib/utils';

interface CommitDiff {
  hash: string;
  message: string;
  author: string;
  date: string;
  diff: string;
  files: Array<{
    file: string;
    additions: number;
    deletions: number;
    status: 'added' | 'modified' | 'deleted';
  }>;
  totalAdditions: number;
  totalDeletions: number;
}

interface EnhancedDiffViewerProps {
  workingDirectory: string;
  commitHash?: string;
  // For file-level diff
  file?: string;
  staged?: boolean;
  // For comparing refs
  baseRef?: string;
  headRef?: string;
  onClose?: () => void;
}

// Parse unified diff into old/new content for side-by-side view
function parseDiffToSideBySide(diff: string): { oldContent: string; newContent: string } {
  const lines = diff.split('\n');
  const oldLines: string[] = [];
  const newLines: string[] = [];
  let inDiff = false;

  for (const line of lines) {
    // Skip diff headers
    if (
      line.startsWith('diff --git') ||
      line.startsWith('index ') ||
      line.startsWith('---') ||
      line.startsWith('+++') ||
      line.startsWith('@@') ||
      line.startsWith('new file') ||
      line.startsWith('deleted file')
    ) {
      if (line.startsWith('@@')) {
        inDiff = true;
      }
      continue;
    }

    if (!inDiff) continue;

    if (line.startsWith('-')) {
      oldLines.push(line.slice(1));
    } else if (line.startsWith('+')) {
      newLines.push(line.slice(1));
    } else if (line.startsWith(' ') || line === '') {
      oldLines.push(line.startsWith(' ') ? line.slice(1) : line);
      newLines.push(line.startsWith(' ') ? line.slice(1) : line);
    }
  }

  return {
    oldContent: oldLines.join('\n'),
    newContent: newLines.join('\n'),
  };
}

// Extract file diffs from a full diff
function extractFileDiffs(diff: string): Map<string, string> {
  const fileDiffs = new Map<string, string>();
  const parts = diff.split(/(?=diff --git)/);

  for (const part of parts) {
    if (!part.trim()) continue;
    const match = part.match(/diff --git a\/.+ b\/(.+)/);
    if (match && match[1]) {
      fileDiffs.set(match[1], part);
    }
  }

  return fileDiffs;
}

export function EnhancedDiffViewer({
  workingDirectory,
  commitHash,
  file,
  staged,
  baseRef,
  headRef,
  onClose,
}: EnhancedDiffViewerProps) {
  const [viewMode, setViewMode] = useState<'unified' | 'split'>('unified');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  // Fetch commit diff
  const { data: commitDiff, isLoading: commitLoading } = useQuery({
    queryKey: ['git-commit-diff', workingDirectory, commitHash],
    queryFn: async () => {
      const params = new URLSearchParams({
        path: workingDirectory,
        hash: commitHash!,
      });
      const response = await api.get<ApiResponse<CommitDiff>>(`/api/git/commit-diff?${params}`);
      if (response.data.success && response.data.data) {
        return response.data.data;
      }
      throw new Error('Failed to fetch commit diff');
    },
    enabled: !!commitHash,
  });

  // Fetch file diff (for working directory changes)
  const { data: fileDiff, isLoading: fileLoading } = useQuery({
    queryKey: ['git-diff-file', workingDirectory, file, staged],
    queryFn: async () => {
      const params = new URLSearchParams({
        path: workingDirectory,
        file: file!,
        staged: (staged ?? false).toString(),
      });
      const response = await api.get<
        ApiResponse<{ file: string; diff: string; additions: number; deletions: number }>
      >(`/api/git/diff-file?${params}`);
      if (response.data.success && response.data.data) {
        return response.data.data;
      }
      throw new Error('Failed to fetch file diff');
    },
    enabled: !!file && !commitHash,
  });

  // Fetch compare diff
  const { data: compareDiff, isLoading: compareLoading } = useQuery({
    queryKey: ['git-compare', workingDirectory, baseRef, headRef],
    queryFn: async () => {
      const params = new URLSearchParams({
        path: workingDirectory,
        base: baseRef!,
        head: headRef!,
      });
      const response = await api.get<
        ApiResponse<{ diff: string; additions: number; deletions: number }>
      >(`/api/git/compare?${params}`);
      if (response.data.success && response.data.data) {
        return response.data.data;
      }
      throw new Error('Failed to fetch comparison');
    },
    enabled: !!baseRef && !!headRef,
  });

  const isLoading = commitLoading || fileLoading || compareLoading;

  // Get current diff content
  const currentDiff = useMemo(() => {
    if (commitDiff) return commitDiff.diff;
    if (fileDiff) return fileDiff.diff;
    if (compareDiff) return compareDiff.diff;
    return '';
  }, [commitDiff, fileDiff, compareDiff]);

  // Extract file diffs for navigation
  const fileDiffs = useMemo(() => {
    return extractFileDiffs(currentDiff);
  }, [currentDiff]);

  // Get current file list
  const files = useMemo(() => {
    if (commitDiff?.files) return commitDiff.files;
    if (fileDiff)
      return [
        {
          file: fileDiff.file,
          additions: fileDiff.additions,
          deletions: fileDiff.deletions,
          status: 'modified' as const,
        },
      ];
    return Array.from(fileDiffs.keys()).map((f) => ({
      file: f,
      additions: 0,
      deletions: 0,
      status: 'modified' as const,
    }));
  }, [commitDiff, fileDiff, fileDiffs]);

  // Get display diff (either selected file or full diff)
  const displayDiff = useMemo(() => {
    if (selectedFile && fileDiffs.has(selectedFile)) {
      return fileDiffs.get(selectedFile)!;
    }
    return currentDiff;
  }, [selectedFile, fileDiffs, currentDiff]);

  // Parse for side-by-side view
  const { oldContent, newContent } = useMemo(() => {
    return parseDiffToSideBySide(displayDiff);
  }, [displayDiff]);

  const toggleFileExpanded = (file: string) => {
    const newExpanded = new Set(expandedFiles);
    if (newExpanded.has(file)) {
      newExpanded.delete(file);
    } else {
      newExpanded.add(file);
    }
    setExpandedFiles(newExpanded);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!currentDiff) {
    return (
      <div className="text-center py-4 text-sm text-muted-foreground">No changes to display</div>
    );
  }

  // Custom styles for the diff viewer
  const diffStyles = {
    variables: {
      dark: {
        diffViewerBackground: 'hsl(var(--card))',
        diffViewerColor: 'hsl(var(--foreground))',
        addedBackground: 'rgba(34, 197, 94, 0.15)',
        addedColor: 'hsl(var(--foreground))',
        removedBackground: 'rgba(239, 68, 68, 0.15)',
        removedColor: 'hsl(var(--foreground))',
        wordAddedBackground: 'rgba(34, 197, 94, 0.4)',
        wordRemovedBackground: 'rgba(239, 68, 68, 0.4)',
        addedGutterBackground: 'rgba(34, 197, 94, 0.2)',
        removedGutterBackground: 'rgba(239, 68, 68, 0.2)',
        gutterBackground: 'hsl(var(--muted))',
        gutterBackgroundDark: 'hsl(var(--muted))',
        highlightBackground: 'rgba(139, 92, 246, 0.1)',
        highlightGutterBackground: 'rgba(139, 92, 246, 0.2)',
        codeFoldGutterBackground: 'hsl(var(--muted))',
        codeFoldBackground: 'hsl(var(--muted))',
        emptyLineBackground: 'hsl(var(--muted))',
        gutterColor: 'hsl(var(--muted-foreground))',
        addedGutterColor: 'rgb(34, 197, 94)',
        removedGutterColor: 'rgb(239, 68, 68)',
        codeFoldContentColor: 'hsl(var(--muted-foreground))',
        diffViewerTitleBackground: 'hsl(var(--muted))',
        diffViewerTitleColor: 'hsl(var(--foreground))',
        diffViewerTitleBorderColor: 'hsl(var(--border))',
      },
    },
    line: {
      padding: '4px 8px',
      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
      fontSize: '12px',
    },
    contentText: {
      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
      fontSize: '12px',
    },
    gutter: {
      padding: '0 8px',
      minWidth: '40px',
    },
  };

  return (
    <div className="flex flex-col h-full bg-card">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between p-2 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          <FileCode className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-mono truncate">
            {commitHash
              ? `Commit ${commitHash.substring(0, 7)}`
              : file
                ? file
                : `${baseRef} → ${headRef}`}
          </span>
          {commitDiff && (
            <span className="text-xs text-muted-foreground">
              {commitDiff.message.substring(0, 50)}
              {commitDiff.message.length > 50 ? '...' : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 text-xs">
            <span className="flex items-center gap-1 text-green-500">
              <Plus className="h-3 w-3" />
              {commitDiff?.totalAdditions || fileDiff?.additions || compareDiff?.additions || 0}
            </span>
            <span className="flex items-center gap-1 text-red-500">
              <Minus className="h-3 w-3" />
              {commitDiff?.totalDeletions || fileDiff?.deletions || compareDiff?.deletions || 0}
            </span>
          </div>
          <div className="flex gap-1 border rounded-md p-0.5">
            <Button
              variant={viewMode === 'unified' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-6 px-2"
              onClick={() => setViewMode('unified')}
              title="Unified view"
            >
              <List className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant={viewMode === 'split' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-6 px-2"
              onClick={() => setViewMode('split')}
              title="Side-by-side view"
            >
              <Columns className="h-3.5 w-3.5" />
            </Button>
          </div>
          {onClose && (
            <Button variant="ghost" size="sm" className="h-6 px-2" onClick={onClose}>
              Close
            </Button>
          )}
        </div>
      </div>

      {/* File list (for multi-file diffs) */}
      {files.length > 1 && (
        <div className="shrink-0 border-b">
          <ScrollArea className="max-h-32">
            <div className="p-1 space-y-0.5">
              {files.map((f) => (
                <button
                  key={f.file}
                  onClick={() => {
                    setSelectedFile(selectedFile === f.file ? null : f.file);
                    toggleFileExpanded(f.file);
                  }}
                  className={cn(
                    'w-full flex items-center gap-2 px-2 py-1 text-xs rounded hover:bg-muted/50 transition-colors',
                    selectedFile === f.file && 'bg-muted'
                  )}
                >
                  {expandedFiles.has(f.file) ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                  <FileCode className="h-3 w-3 text-muted-foreground" />
                  <span className="font-mono truncate flex-1 text-left">{f.file}</span>
                  <span className="flex items-center gap-2 shrink-0">
                    <span className="text-green-500">+{f.additions}</span>
                    <span className="text-red-500">-{f.deletions}</span>
                  </span>
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* Diff content */}
      <ScrollArea className="flex-1">
        <div className="min-w-fit">
          {viewMode === 'split' ? (
            <ReactDiffViewer
              oldValue={oldContent}
              newValue={newContent}
              splitView={true}
              useDarkTheme={true}
              styles={diffStyles}
              compareMethod={DiffMethod.WORDS}
              hideLineNumbers={false}
              showDiffOnly={false}
              extraLinesSurroundingDiff={3}
            />
          ) : (
            // Unified view - render manually for better control
            <pre className="p-2 text-xs font-mono leading-relaxed">
              {displayDiff.split('\n').map((line, index) => {
                let lineClass = 'text-muted-foreground';
                let bgClass = '';

                if (line.startsWith('@@')) {
                  lineClass = 'text-purple-400';
                  bgClass = 'bg-purple-500/5';
                } else if (line.startsWith('+++') || line.startsWith('---')) {
                  lineClass = 'text-muted-foreground font-bold';
                } else if (line.startsWith('+')) {
                  lineClass = 'text-green-400';
                  bgClass = 'bg-green-500/10';
                } else if (line.startsWith('-')) {
                  lineClass = 'text-red-400';
                  bgClass = 'bg-red-500/10';
                } else if (line.startsWith('diff --git')) {
                  lineClass = 'text-blue-400 font-bold';
                } else if (
                  line.startsWith('index ') ||
                  line.startsWith('new file') ||
                  line.startsWith('deleted file')
                ) {
                  lineClass = 'text-muted-foreground/60';
                }

                return (
                  <div key={index} className={cn('px-2 -mx-2 min-h-[1.5em]', bgClass)}>
                    <span className={lineClass}>{line || ' '}</span>
                  </div>
                );
              })}
            </pre>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

export default EnhancedDiffViewer;
