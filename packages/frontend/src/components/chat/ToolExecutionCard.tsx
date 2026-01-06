import { useState } from 'react';
import {
  FileText,
  Search,
  Edit3,
  Terminal,
  Globe,
  FolderSearch,
  GitBranch,
  CheckSquare,
  Cpu,
  Wrench,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Loader2,
} from 'lucide-react';
import type { ToolExecution } from '@claude-code-webui/shared';

interface ToolExecutionCardProps {
  execution: ToolExecution;
}

// Map tool names to icons and labels
const getToolDisplay = (toolName: string): { icon: typeof Wrench; label: string } => {
  const toolMap: Record<string, { icon: typeof Wrench; label: string }> = {
    'Write': { icon: FileText, label: 'Writing file' },
    'Read': { icon: Search, label: 'Reading file' },
    'Edit': { icon: Edit3, label: 'Editing file' },
    'Bash': { icon: Terminal, label: 'Running command' },
    'WebFetch': { icon: Globe, label: 'Fetching web' },
    'WebSearch': { icon: Globe, label: 'Searching web' },
    'Glob': { icon: FolderSearch, label: 'Searching files' },
    'Grep': { icon: Search, label: 'Searching content' },
    'LS': { icon: FolderSearch, label: 'Listing directory' },
    'Task': { icon: Cpu, label: 'Agent' },
    'TodoWrite': { icon: CheckSquare, label: 'Tasks' },
    'Git': { icon: GitBranch, label: 'Git' },
  };

  return toolMap[toolName] || { icon: Wrench, label: toolName };
};

// Status icon component
const StatusIcon = ({ status }: { status: 'started' | 'completed' | 'error' }) => {
  switch (status) {
    case 'started':
      return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
    case 'completed':
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case 'error':
      return <XCircle className="h-4 w-4 text-red-500" />;
  }
};

export function ToolExecutionCard({ execution }: ToolExecutionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const { icon: Icon, label } = getToolDisplay(execution.toolName);

  const hasOutput = execution.result || execution.error;
  const isClickable = hasOutput && execution.status !== 'started';

  // Truncate long output for preview
  const getPreview = (text: string | undefined) => {
    if (!text) return '';
    const lines = text.split('\n');
    if (lines.length > 1) {
      return `${lines[0]}... (${lines.length} lines)`;
    }
    if (text.length > 60) {
      return text.substring(0, 60) + '...';
    }
    return text;
  };

  return (
    <div className="flex flex-col gap-1 px-3 py-2 bg-muted/30 rounded-lg text-xs border border-border/50">
      {/* Header row */}
      <div
        className={`flex items-center gap-2 ${isClickable ? 'cursor-pointer hover:opacity-80' : ''}`}
        onClick={() => isClickable && setExpanded(!expanded)}
      >
        <Icon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        <span className="font-medium text-foreground flex-1 truncate">{label}</span>
        {hasOutput && (
          <>
            {expanded ? (
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
            )}
          </>
        )}
        <StatusIcon status={execution.status} />
      </div>

      {/* Preview when collapsed */}
      {!expanded && hasOutput && (
        <div className="text-muted-foreground truncate pl-6">
          {getPreview(execution.result || execution.error)}
        </div>
      )}

      {/* Expanded output */}
      {expanded && (
        <div className="mt-1 pl-6">
          {execution.result && (
            <pre className="p-2 bg-muted/50 rounded text-xs overflow-auto max-h-60 whitespace-pre-wrap break-all text-foreground">
              {execution.result}
            </pre>
          )}
          {execution.error && (
            <pre className="p-2 bg-red-500/10 rounded text-xs overflow-auto max-h-40 whitespace-pre-wrap break-all text-red-500">
              {execution.error}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
