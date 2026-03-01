import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GitCommit as GitCommitIcon, Loader2, Clock, User, ChevronLeft } from 'lucide-react';
import { api } from '@/services/api';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { EnhancedDiffViewer } from './EnhancedDiffViewer';
import type { ApiResponse, GitCommit } from '@claude-code-webui/shared';
import { cn } from '@/lib/utils';

interface GitHistoryProps {
  workingDirectory: string;
  limit?: number;
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function GitHistory({ workingDirectory, limit = 20 }: GitHistoryProps) {
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null);

  const { data: commits, isLoading } = useQuery({
    queryKey: ['git-log', workingDirectory, limit],
    queryFn: async () => {
      const params = new URLSearchParams({
        path: workingDirectory,
        limit: limit.toString(),
      });
      const response = await api.get<ApiResponse<GitCommit[]>>(
        `/api/git/log?${params}`
      );
      if (response.data.success && response.data.data) {
        return response.data.data;
      }
      return [];
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!commits || commits.length === 0) {
    return (
      <div className="text-center py-4 text-sm text-muted-foreground">
        No commits yet
      </div>
    );
  }

  // Show diff viewer when a commit is selected
  if (selectedCommit) {
    return (
      <div className="flex flex-col h-full">
        <div className="shrink-0 p-2 border-b">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={() => setSelectedCommit(null)}
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back to History
          </Button>
        </div>
        <div className="flex-1 min-h-0">
          <EnhancedDiffViewer
            workingDirectory={workingDirectory}
            commitHash={selectedCommit}
            onClose={() => setSelectedCommit(null)}
          />
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="space-y-1 p-1">
        {commits.map((commit, index) => (
          <div
            key={commit.hash}
            onClick={() => setSelectedCommit(commit.hash)}
            className={cn(
              'relative p-2 rounded-lg border bg-card hover:bg-muted/30 transition-colors cursor-pointer',
              index === 0 && 'border-primary/50'
            )}
          >
            {/* Timeline connector */}
            {index < commits.length - 1 && (
              <div className="absolute left-[18px] top-10 bottom-0 w-0.5 bg-border" />
            )}

            <div className="flex items-start gap-3">
              {/* Commit icon */}
              <div
                className={cn(
                  'shrink-0 p-1.5 rounded-full',
                  index === 0 ? 'bg-primary/10' : 'bg-muted'
                )}
              >
                <GitCommitIcon
                  className={cn(
                    'h-3 w-3',
                    index === 0 ? 'text-primary' : 'text-muted-foreground'
                  )}
                />
              </div>

              {/* Commit info */}
              <div className="flex-1 min-w-0">
                {/* Message */}
                <p className="text-sm font-medium leading-tight line-clamp-2">
                  {commit.message}
                </p>

                {/* Meta */}
                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                  <span className="font-mono text-primary/70">{commit.shortHash}</span>
                  <span className="flex items-center gap-1">
                    <User className="h-3 w-3" />
                    {commit.author}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatRelativeTime(commit.date)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

export default GitHistory;
