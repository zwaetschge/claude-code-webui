import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Search, RotateCcw } from 'lucide-react';
import type { AuditLogEntry } from '@claude-code-webui/shared';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { api } from '@/services/api';

interface AuditLogResponse {
  entries: AuditLogEntry[];
  total: number;
  limit: number;
  offset: number;
}

const PAGE_SIZE = 50;

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString();
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + '…';
}

function actionTone(action: string): string {
  if (action.startsWith('user.delete') || action.startsWith('user.suspend')) return 'text-rose-500';
  if (action.startsWith('user.update') || action.startsWith('user.role')) return 'text-amber-500';
  if (action.includes('login') || action.includes('auth')) return 'text-sky-500';
  return 'text-muted-foreground';
}

export function AdminAuditLogPage() {
  const [offset, setOffset] = useState(0);
  const [actionFilter, setActionFilter] = useState('');
  const [actorFilter, setActorFilter] = useState('');
  const [appliedAction, setAppliedAction] = useState('');
  const [appliedActor, setAppliedActor] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);

  const { data, isLoading, error, refetch, isFetching } = useQuery<AuditLogResponse>({
    queryKey: ['admin', 'audit-log', { offset, action: appliedAction, actorUserId: appliedActor }],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(offset));
      if (appliedAction) params.set('action', appliedAction);
      if (appliedActor) params.set('actorUserId', appliedActor);
      const response = await api.get<{ success: boolean; data: AuditLogResponse }>(
        `/api/admin/audit-log?${params.toString()}`
      );
      return response.data.data;
    },
  });

  const applyFilters = () => {
    setOffset(0);
    setAppliedAction(actionFilter.trim());
    setAppliedActor(actorFilter.trim());
  };

  const resetFilters = () => {
    setActionFilter('');
    setActorFilter('');
    setAppliedAction('');
    setAppliedActor('');
    setOffset(0);
  };

  const total = data?.total ?? 0;
  const entries = data?.entries ?? [];
  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;
  const pageStart = total === 0 ? 0 : offset + 1;
  const pageEnd = Math.min(offset + PAGE_SIZE, total);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[180px]">
              <label className="text-xs text-muted-foreground mb-1 block">Action</label>
              <Input
                placeholder="e.g. user.update"
                value={actionFilter}
                onChange={(e) => setActionFilter(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
              />
            </div>
            <div className="flex-1 min-w-[180px]">
              <label className="text-xs text-muted-foreground mb-1 block">Actor user ID</label>
              <Input
                placeholder="UUID"
                value={actorFilter}
                onChange={(e) => setActorFilter(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={applyFilters} size="sm" className="gap-2">
                <Search className="h-4 w-4" />
                Filter
              </Button>
              <Button onClick={resetFilters} variant="outline" size="sm" className="gap-2">
                <RotateCcw className="h-4 w-4" />
                Reset
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {error ? (
            <div className="py-10 text-center text-sm text-rose-500">
              Failed to load audit log: {(error as Error).message}
            </div>
          ) : isLoading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
          ) : entries.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No audit entries match the current filter.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2 font-medium">Timestamp</th>
                    <th className="px-4 py-2 font-medium">Actor</th>
                    <th className="px-4 py-2 font-medium">Action</th>
                    <th className="px-4 py-2 font-medium">Resource</th>
                    <th className="px-4 py-2 font-medium">IP</th>
                    <th className="px-4 py-2 font-medium">Metadata</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => {
                    const isExpanded = expanded === entry.id;
                    const hasMetadata = entry.metadata && Object.keys(entry.metadata).length > 0;
                    return (
                      <tr
                        key={entry.id}
                        className="border-b last:border-b-0 hover:bg-muted/20 transition-colors"
                      >
                        <td className="px-4 py-2.5 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                          {formatTimestamp(entry.createdAt)}
                        </td>
                        <td className="px-4 py-2.5">
                          {entry.actorEmail ? (
                            <span className="text-foreground">{entry.actorEmail}</span>
                          ) : entry.actorUserId ? (
                            <span className="font-mono text-xs text-muted-foreground">
                              {truncate(entry.actorUserId, 12)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground italic">system</span>
                          )}
                        </td>
                        <td className={`px-4 py-2.5 font-mono text-xs ${actionTone(entry.action)}`}>
                          {entry.action}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">
                          {entry.resourceType ? (
                            <span>
                              {entry.resourceType}
                              {entry.resourceId && (
                                <span className="font-mono ml-1">
                                  ({truncate(entry.resourceId, 10)})
                                </span>
                              )}
                            </span>
                          ) : (
                            <span>—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                          {entry.ip ?? '—'}
                        </td>
                        <td className="px-4 py-2.5">
                          {hasMetadata ? (
                            <button
                              type="button"
                              onClick={() => setExpanded(isExpanded ? null : entry.id)}
                              className="text-xs text-primary hover:underline"
                            >
                              {isExpanded ? 'Hide' : 'View'}
                            </button>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                          {isExpanded && hasMetadata && (
                            <pre className="mt-2 overflow-x-auto rounded-md bg-muted/40 p-2 text-[11px] leading-relaxed">
                              {JSON.stringify(entry.metadata, null, 2)}
                            </pre>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <div>
          {total > 0 ? (
            <>
              Showing <span className="tabular-nums text-foreground">{pageStart}</span>–
              <span className="tabular-nums text-foreground">{pageEnd}</span> of{' '}
              <span className="tabular-nums text-foreground">{total}</span>
            </>
          ) : (
            <span>0 entries</span>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!hasPrev || isFetching}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            className="gap-1"
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!hasNext || isFetching}
            onClick={() => setOffset(offset + PAGE_SIZE)}
            className="gap-1"
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            Refresh
          </Button>
        </div>
      </div>
    </div>
  );
}
