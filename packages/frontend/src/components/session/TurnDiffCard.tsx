import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, FileDiff } from 'lucide-react';
import { api } from '@/services/api';
import { cn } from '@/lib/utils';

interface TurnDiffSummary {
  id: string;
  turnId: string | null;
  filesChanged: number;
  insertions: number;
  deletions: number;
  summary: string | null;
  createdAt: string;
}

interface TurnDiffDetail extends TurnDiffSummary {
  diff: string;
}

/**
 * "What did this turn change on disk?" — the working-tree diff the backend
 * captured when the turn ended. Collapsed it is a one-line stat; expanding it
 * fetches the full patch on demand so long diffs never load with the thread.
 */
export function TurnDiffCard({ diff }: { diff: TurnDiffSummary }) {
  const [open, setOpen] = useState(false);

  const { data: detail, isLoading } = useQuery({
    queryKey: ['turn-diff', diff.id],
    queryFn: async () => {
      const response = await api.get<{ success: boolean; data: TurnDiffDetail }>(
        `/api/workspace/turn-diffs/${diff.id}`
      );
      return response.data.data;
    },
    enabled: open,
    staleTime: Infinity,
  });

  return (
    <div className="turn-diff-card rounded-lg border border-border/60 bg-muted/20 text-xs">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-foreground/5"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <FileDiff className="h-3.5 w-3.5 text-primary" />
        <span className="font-medium">Changes</span>
        <span className="text-muted-foreground">
          {diff.summary || `${diff.filesChanged} files`}
        </span>
        <span className="ml-auto flex gap-2 font-mono">
          {diff.insertions > 0 && <span className="text-emerald-500">+{diff.insertions}</span>}
          {diff.deletions > 0 && <span className="text-red-500">-{diff.deletions}</span>}
        </span>
      </button>

      {open && (
        <div className="border-t border-border/60 px-3 py-2">
          {isLoading && <div className="text-muted-foreground">Loading diff…</div>}
          {detail && (
            <pre className="max-h-80 overflow-auto whitespace-pre font-mono text-[11px] leading-relaxed">
              {detail.diff.split('\n').map((line, index) => (
                <div
                  key={index}
                  className={cn(
                    line.startsWith('+') && !line.startsWith('+++') && 'text-emerald-500',
                    line.startsWith('-') && !line.startsWith('---') && 'text-red-500',
                    line.startsWith('@@') && 'text-sky-400'
                  )}
                >
                  {line}
                </div>
              ))}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

/** All diffs recorded for a session, newest first. Used by the Git panel. */
export function useSessionTurnDiffs(sessionId: string | undefined) {
  return useQuery({
    queryKey: ['turn-diffs', sessionId],
    queryFn: async () => {
      const response = await api.get<{ success: boolean; data: TurnDiffSummary[] }>(
        `/api/workspace/sessions/${sessionId}/turn-diffs`
      );
      return response.data.data;
    },
    enabled: !!sessionId,
    refetchInterval: 30_000,
  });
}
