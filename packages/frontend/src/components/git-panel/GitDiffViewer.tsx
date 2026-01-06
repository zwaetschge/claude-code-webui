import { useQuery } from '@tanstack/react-query';
import { Loader2, Plus, Minus, FileCode } from 'lucide-react';
import { api } from '@/services/api';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { ApiResponse, GitFileDiff } from '@claude-code-webui/shared';
import { cn } from '@/lib/utils';

interface GitDiffViewerProps {
  workingDirectory: string;
  file: string;
  staged: boolean;
}

export function GitDiffViewer({ workingDirectory, file, staged }: GitDiffViewerProps) {
  const { data: diff, isLoading } = useQuery({
    queryKey: ['git-diff-file', workingDirectory, file, staged],
    queryFn: async () => {
      const params = new URLSearchParams({
        path: workingDirectory,
        file,
        staged: staged.toString(),
      });
      const response = await api.get<ApiResponse<GitFileDiff>>(
        `/api/git/diff-file?${params}`
      );
      if (response.data.success && response.data.data) {
        return response.data.data;
      }
      throw new Error('Failed to fetch diff');
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!diff || !diff.diff) {
    return (
      <div className="text-center py-4 text-sm text-muted-foreground">
        No changes to display
      </div>
    );
  }

  const lines = diff.diff.split('\n');

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between p-2 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          <FileCode className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-mono truncate">{file}</span>
          {staged && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-green-500/10 text-green-500">
              staged
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1 text-green-500">
            <Plus className="h-3 w-3" />
            {diff.additions}
          </span>
          <span className="flex items-center gap-1 text-red-500">
            <Minus className="h-3 w-3" />
            {diff.deletions}
          </span>
        </div>
      </div>

      {/* Diff content */}
      <ScrollArea className="flex-1">
        <pre className="p-2 text-xs font-mono leading-relaxed">
          {lines.map((line, index) => {
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
            } else if (line.startsWith('index ') || line.startsWith('new file') || line.startsWith('deleted file')) {
              lineClass = 'text-muted-foreground/60';
            }

            return (
              <div
                key={index}
                className={cn('px-2 -mx-2', bgClass)}
              >
                <span className={lineClass}>{line || ' '}</span>
              </div>
            );
          })}
        </pre>
      </ScrollArea>
    </div>
  );
}

export default GitDiffViewer;
