import { useState, useEffect } from 'react';
import {
  FileText,
  Search,
  Edit3,
  Terminal,
  Globe,
  FolderSearch,
  Cpu,
  Wrench,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronDown,
  ChevronRight,
  Clock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ToolExecution } from '@plum-code-webui/shared';
import { ScrollArea } from '@/components/ui/scroll-area';

interface ToolLogPanelProps {
  executions: ToolExecution[];
  className?: string;
}

const FILTER_CATEGORIES = [
  { key: 'all', label: 'All' },
  { key: 'read', label: 'Read', tools: ['Read', 'Glob', 'Grep', 'LS'] },
  { key: 'write', label: 'Write', tools: ['Write', 'Edit'] },
  { key: 'bash', label: 'Bash', tools: ['Bash'] },
  { key: 'web', label: 'Web', tools: ['WebFetch', 'WebSearch'] },
  { key: 'agent', label: 'Agent', tools: ['Task'] },
] as const;

function getToolIcon(toolName: string) {
  const map: Record<string, typeof Wrench> = {
    Write: FileText,
    Read: Search,
    Edit: Edit3,
    Bash: Terminal,
    WebFetch: Globe,
    WebSearch: Globe,
    Glob: FolderSearch,
    Grep: Search,
    LS: FolderSearch,
    Task: Cpu,
  };
  return map[toolName] || Wrench;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function LiveTimer({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(Date.now() - startedAt);

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Date.now() - startedAt);
    }, 100);
    return () => clearInterval(interval);
  }, [startedAt]);

  return (
    <span className="text-[10px] font-mono text-blue-400 tabular-nums">
      {formatDuration(elapsed)}
    </span>
  );
}

function getInputPreview(toolName: string, input: unknown): string {
  if (!input) return '';
  if (typeof input === 'string') return input;
  const obj = input as Record<string, unknown>;
  switch (toolName) {
    case 'Bash':
      return String(obj.command || obj.description || '');
    case 'Read':
    case 'Write':
    case 'Edit':
      return String(obj.file_path || '');
    case 'Glob':
    case 'Grep':
      return String(obj.pattern || '');
    case 'WebFetch':
      return String(obj.url || '');
    case 'WebSearch':
      return String(obj.query || '');
    case 'Task':
      return String(obj.description || obj.prompt || '');
    default:
      return JSON.stringify(input).substring(0, 80);
  }
}

function ToolLogItem({ execution }: { execution: ToolExecution }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = getToolIcon(execution.toolName);
  const preview = getInputPreview(execution.toolName, execution.input);
  const truncated = preview.length > 60 ? preview.substring(0, 60) + '...' : preview;
  const duration = execution.completedAt ? execution.completedAt - execution.timestamp : null;
  const isRunning = execution.status === 'started';
  const hasDetails = execution.input || execution.result || execution.error;

  return (
    <div className="border-b border-border/30 last:border-b-0">
      <button
        onClick={() => hasDetails && setExpanded(!expanded)}
        className={cn(
          'flex items-center gap-2 w-full px-2 py-1.5 text-left text-xs',
          'hover:bg-muted/50 transition-colors',
          hasDetails && 'cursor-pointer'
        )}
      >
        {/* Status dot */}
        <span
          className={cn(
            'h-1.5 w-1.5 rounded-full shrink-0',
            execution.status === 'completed' && 'bg-green-500',
            execution.status === 'error' && 'bg-red-500',
            isRunning && 'bg-blue-500 animate-pulse'
          )}
        />

        {/* Icon */}
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />

        {/* Tool name */}
        <span className="font-medium shrink-0">{execution.toolName}</span>

        {/* Preview */}
        {truncated && (
          <code className="text-muted-foreground truncate flex-1 font-mono text-[11px]">
            {truncated}
          </code>
        )}

        {/* Duration */}
        {isRunning ? (
          <LiveTimer startedAt={execution.timestamp} />
        ) : duration != null ? (
          <span
            className={cn(
              'text-[10px] font-mono tabular-nums shrink-0',
              duration > 5000 ? 'text-amber-400' : 'text-muted-foreground'
            )}
          >
            {formatDuration(duration)}
          </span>
        ) : null}

        {/* Status icon */}
        {isRunning && <Loader2 className="h-3 w-3 text-blue-500 animate-spin shrink-0" />}
        {execution.status === 'completed' && (
          <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
        )}
        {execution.status === 'error' && <XCircle className="h-3 w-3 text-red-500 shrink-0" />}

        {/* Expand chevron */}
        {hasDetails &&
          (expanded ? (
            <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
          ))}
      </button>

      {expanded && (
        <div className="px-3 pb-2 pl-8 space-y-1.5">
          {execution.input != null &&
            (() => {
              const inputStr =
                typeof execution.input === 'string'
                  ? execution.input
                  : JSON.stringify(execution.input, null, 2);
              return (
                <pre className="text-[11px] font-mono bg-muted/50 rounded p-1.5 overflow-auto max-h-32 whitespace-pre-wrap break-all text-muted-foreground">
                  {inputStr}
                </pre>
              );
            })()}
          {execution.result && (
            <pre className="text-[11px] font-mono bg-muted/50 rounded p-1.5 overflow-auto max-h-32 whitespace-pre-wrap break-all text-foreground">
              {execution.result.substring(0, 500)}
              {execution.result.length > 500 ? '...' : ''}
            </pre>
          )}
          {execution.error && (
            <pre className="text-[11px] font-mono bg-red-500/10 rounded p-1.5 overflow-auto max-h-24 whitespace-pre-wrap break-all text-red-400">
              {execution.error}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

export function ToolLogPanel({ executions, className }: ToolLogPanelProps) {
  const [filter, setFilter] = useState<string>('all');

  const filtered =
    filter === 'all'
      ? executions
      : executions.filter((e) => {
          const category = FILTER_CATEGORIES.find((c) => c.key === filter);
          return category && 'tools' in category
            ? (category.tools as readonly string[]).includes(e.toolName)
            : false;
        });

  const counts = FILTER_CATEGORIES.map((cat) => ({
    key: cat.key,
    count:
      cat.key === 'all'
        ? executions.length
        : executions.filter((e) =>
            'tools' in cat ? (cat.tools as readonly string[]).includes(e.toolName) : false
          ).length,
  }));

  const runningCount = executions.filter((e) => e.status === 'started').length;
  const totalDuration = executions.reduce((sum, e) => {
    if (e.completedAt) return sum + (e.completedAt - e.timestamp);
    return sum;
  }, 0);

  return (
    <div className={cn('flex flex-col', className)}>
      {/* Header */}
      <div className="px-3 py-2 border-b border-border/50">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium">
            Tools ({executions.length})
            {runningCount > 0 && <span className="text-blue-400 ml-1">{runningCount} running</span>}
          </span>
          {totalDuration > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Clock className="h-3 w-3" />
              {formatDuration(totalDuration)}
            </span>
          )}
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 flex-wrap">
          {counts.map(({ key, count }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={cn(
                'px-2 py-0.5 rounded text-[10px] transition-colors',
                filter === key
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted/50 text-muted-foreground hover:bg-muted',
                count === 0 && 'opacity-40'
              )}
              disabled={count === 0}
            >
              {FILTER_CATEGORIES.find((c) => c.key === key)?.label} {count > 0 && count}
            </button>
          ))}
        </div>
      </div>

      {/* Tool list */}
      <ScrollArea className="flex-1">
        {filtered.length === 0 ? (
          <div className="text-center py-6 text-xs text-muted-foreground">
            No tools {filter !== 'all' ? 'in this category' : 'yet'}
          </div>
        ) : (
          <div>
            {[...filtered].reverse().map((execution) => (
              <ToolLogItem
                key={`${execution.toolId}-${execution.timestamp}`}
                execution={execution}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
