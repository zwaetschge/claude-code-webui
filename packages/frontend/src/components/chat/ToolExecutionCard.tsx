import { useState, useEffect, memo } from 'react';
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
  Brain,
  Bug,
  Server,
  Shield,
  Gauge,
  BookOpen,
  Database,
  Layers,
  Rocket,
  FlaskConical,
  Palette,
  Code2,
  Smartphone,
} from 'lucide-react';
import type { ToolExecution } from '@claude-code-webui/shared';
import { ToolLoader } from './providerAnimations/ToolLoader';

interface ToolExecutionCardProps {
  execution: ToolExecution;
}

// Map subagent types to display info
const agentTypeMap: Record<string, { icon: typeof Wrench; label: string }> = {
  Explore: { icon: Search, label: 'Explorer' },
  Plan: { icon: BookOpen, label: 'Planner' },
  'general-purpose': { icon: Brain, label: 'General Agent' },
  'research-bot': { icon: Globe, label: 'Research' },
  'frontend-developer': { icon: Code2, label: 'Frontend Dev' },
  'mobile-developer': { icon: Smartphone, label: 'Mobile Dev' },
  'backend-dev': { icon: Server, label: 'Backend Dev' },
  'fullstack-dev': { icon: Layers, label: 'Fullstack Dev' },
  'api-designer': { icon: Wrench, label: 'API Designer' },
  'ui-designer': { icon: Palette, label: 'UI Designer' },
  'devops-engineer': { icon: Rocket, label: 'DevOps' },
  'database-specialist': { icon: Database, label: 'Database' },
  'git-operations': { icon: GitBranch, label: 'Git Ops' },
  'debugging-expert': { icon: Bug, label: 'Debugger' },
  'system-architect': { icon: Layers, label: 'Architect' },
  'test-engineer': { icon: FlaskConical, label: 'Test Engineer' },
  'security-auditor': { icon: Shield, label: 'Security' },
  'performance-optimizer': { icon: Gauge, label: 'Performance' },
  'release-manager': { icon: Rocket, label: 'Release' },
  'data-engineer': { icon: Database, label: 'Data Engineer' },
  'documentation-writer': { icon: BookOpen, label: 'Docs' },
  'statusline-setup': { icon: Terminal, label: 'Status Line' },
};

// Map tool names to icons and labels
export const getToolDisplay = (
  toolName: string,
  input?: unknown
): { icon: typeof Wrench; label: string; inputLabel: string } => {
  // For Task/Agent tools, extract subagent_type for better display
  if (toolName === 'Task' || toolName === 'Agent') {
    const inputObj = input as Record<string, unknown> | undefined;
    const subagentType = inputObj?.subagent_type as string | undefined;

    if (subagentType && agentTypeMap[subagentType]) {
      const agent = agentTypeMap[subagentType];
      return { icon: agent.icon, label: agent.label, inputLabel: 'Task' };
    }

    if (subagentType) {
      return { icon: Brain, label: subagentType, inputLabel: 'Task' };
    }

    return { icon: Cpu, label: 'Agent', inputLabel: 'Task' };
  }

  const toolMap: Record<string, { icon: typeof Wrench; label: string; inputLabel: string }> = {
    Write: { icon: FileText, label: 'Write', inputLabel: 'File' },
    Read: { icon: Search, label: 'Read', inputLabel: 'File' },
    Edit: { icon: Edit3, label: 'Edit', inputLabel: 'File' },
    Bash: { icon: Terminal, label: 'Bash', inputLabel: 'Command' },
    WebFetch: { icon: Globe, label: 'Fetch', inputLabel: 'URL' },
    WebSearch: { icon: Globe, label: 'Search', inputLabel: 'Query' },
    Glob: { icon: FolderSearch, label: 'Glob', inputLabel: 'Pattern' },
    Grep: { icon: Search, label: 'Grep', inputLabel: 'Pattern' },
    LS: { icon: FolderSearch, label: 'List', inputLabel: 'Path' },
    TodoWrite: { icon: CheckSquare, label: 'Todo', inputLabel: 'Tasks' },
    Git: { icon: GitBranch, label: 'Git', inputLabel: 'Command' },
  };

  return toolMap[toolName] || { icon: Wrench, label: toolName, inputLabel: 'Input' };
};

// Extract the main input value for preview
const getInputPreview = (toolName: string, input: unknown): string => {
  if (!input) return '';
  if (typeof input === 'string') return input;

  const inputObj = input as Record<string, unknown>;

  switch (toolName) {
    case 'Bash':
      return String(inputObj.command || inputObj.description || '');
    case 'Read':
    case 'Write':
    case 'Edit':
      return String(inputObj.file_path || '');
    case 'Glob':
    case 'Grep':
      return String(inputObj.pattern || '');
    case 'WebFetch':
      return String(inputObj.url || '');
    case 'WebSearch':
      return String(inputObj.query || '');
    case 'Task':
    case 'Agent':
      return String(inputObj.description || inputObj.prompt || '');
    default:
      return JSON.stringify(input).substring(0, 100);
  }
};

// Format full input for expanded view
const formatInput = (toolName: string, input: unknown): { label: string; value: string }[] => {
  if (!input) return [];
  if (typeof input === 'string') return [{ label: 'Input', value: input }];

  const inputObj = input as Record<string, unknown>;
  const result: { label: string; value: string }[] = [];

  switch (toolName) {
    case 'Bash':
      if (inputObj.command) result.push({ label: 'Command', value: String(inputObj.command) });
      if (inputObj.description)
        result.push({ label: 'Description', value: String(inputObj.description) });
      if (inputObj.timeout) result.push({ label: 'Timeout', value: `${inputObj.timeout}ms` });
      break;
    case 'Read':
      if (inputObj.file_path) result.push({ label: 'File', value: String(inputObj.file_path) });
      if (inputObj.offset) result.push({ label: 'Offset', value: String(inputObj.offset) });
      if (inputObj.limit) result.push({ label: 'Limit', value: String(inputObj.limit) });
      break;
    case 'Write':
      if (inputObj.file_path) result.push({ label: 'File', value: String(inputObj.file_path) });
      if (inputObj.content)
        result.push({
          label: 'Content',
          value:
            String(inputObj.content).substring(0, 500) +
            (String(inputObj.content).length > 500 ? '...' : ''),
        });
      break;
    case 'Edit':
      if (inputObj.file_path) result.push({ label: 'File', value: String(inputObj.file_path) });
      if (inputObj.old_string) result.push({ label: 'Find', value: String(inputObj.old_string) });
      if (inputObj.new_string)
        result.push({ label: 'Replace', value: String(inputObj.new_string) });
      break;
    case 'Glob':
      if (inputObj.pattern) result.push({ label: 'Pattern', value: String(inputObj.pattern) });
      if (inputObj.path) result.push({ label: 'Path', value: String(inputObj.path) });
      break;
    case 'Grep':
      if (inputObj.pattern) result.push({ label: 'Pattern', value: String(inputObj.pattern) });
      if (inputObj.path) result.push({ label: 'Path', value: String(inputObj.path) });
      if (inputObj.glob) result.push({ label: 'Glob', value: String(inputObj.glob) });
      break;
    case 'WebFetch':
      if (inputObj.url) result.push({ label: 'URL', value: String(inputObj.url) });
      if (inputObj.prompt) result.push({ label: 'Prompt', value: String(inputObj.prompt) });
      break;
    case 'WebSearch':
      if (inputObj.query) result.push({ label: 'Query', value: String(inputObj.query) });
      break;
    case 'Task':
    case 'Agent':
      if (inputObj.description)
        result.push({ label: 'Description', value: String(inputObj.description) });
      if (inputObj.prompt)
        result.push({
          label: 'Prompt',
          value:
            String(inputObj.prompt).substring(0, 500) +
            (String(inputObj.prompt).length > 500 ? '...' : ''),
        });
      if (inputObj.subagent_type)
        result.push({ label: 'Agent Type', value: String(inputObj.subagent_type) });
      break;
    default:
      result.push({ label: 'Input', value: JSON.stringify(input, null, 2) });
  }

  return result;
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function LiveDuration({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(Date.now() - startedAt);

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Date.now() - startedAt);
    }, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  return (
    <span className="text-[10px] font-mono text-blue-400 tabular-nums ml-1">
      {formatDuration(elapsed)}
    </span>
  );
}

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

export const ToolExecutionCard = memo(function ToolExecutionCard({
  execution,
}: ToolExecutionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const { icon: Icon, label } = getToolDisplay(execution.toolName, execution.input);

  const hasInput = execution.input;
  const hasOutput = execution.result || execution.error;
  const isExpandable = hasInput || hasOutput;
  const isClickable = isExpandable && execution.status !== 'started';

  // Get preview text for collapsed view
  const preview = getInputPreview(execution.toolName, execution.input);
  const formattedInput = formatInput(execution.toolName, execution.input);

  // Truncate preview for display
  const truncatedPreview = preview.length > 80 ? preview.substring(0, 80) + '...' : preview;

  // Duration
  const duration = execution.completedAt ? execution.completedAt - execution.timestamp : null;
  const isRunning = execution.status === 'started';

  // Subagent runs (Task/Agent tools) get distinct styling so that nested agent
  // activity is obvious at a glance in the message timeline.
  const isSubagent = execution.toolName === 'Task' || execution.toolName === 'Agent';

  const containerClass = isSubagent
    ? `flex flex-col gap-1 px-3 py-2 rounded-lg text-xs border-l-2 border border-primary/40 border-l-primary bg-primary/5 ${
        isRunning ? 'shadow-[0_0_0_1px_hsl(var(--primary)/0.15)]' : ''
      }`
    : 'flex flex-col gap-1 px-3 py-2 bg-muted/30 rounded-lg text-xs border border-border/50';

  return (
    <div className={containerClass}>
      {/* Header row */}
      <div
        className={`flex items-center gap-2 ${isClickable ? 'cursor-pointer hover:opacity-80' : ''}`}
        onClick={() => isClickable && setExpanded(!expanded)}
      >
        {isRunning ? (
          <span
            className={`flex items-center justify-center w-6 h-6 flex-shrink-0 ${isSubagent ? 'text-primary' : 'text-primary'}`}
          >
            <ToolLoader toolName={execution.toolName} size={24} />
          </span>
        ) : isSubagent ? (
          <Icon className="h-4 w-4 text-primary flex-shrink-0" />
        ) : (
          <Icon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        )}
        <span className={`font-medium ${isSubagent ? 'text-primary' : 'text-foreground'}`}>
          {label}
        </span>
        {isSubagent && (
          <span className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider text-primary bg-primary/10 border border-primary/30 rounded px-1.5 py-0.5 flex-shrink-0">
            Subagent
          </span>
        )}
        {truncatedPreview && (
          <code className="text-muted-foreground truncate flex-1 font-mono text-xs bg-muted/50 px-1 rounded">
            {truncatedPreview}
          </code>
        )}
        {/* Duration badge */}
        {isRunning ? (
          <LiveDuration startedAt={execution.timestamp} />
        ) : duration != null ? (
          <span
            className={`text-[10px] font-mono tabular-nums ml-1 ${duration > 5000 ? 'text-amber-400' : 'text-muted-foreground'}`}
          >
            {formatDuration(duration)}
          </span>
        ) : null}
        {isExpandable && (
          <>
            {expanded ? (
              <ChevronDown className="h-3 w-3 text-muted-foreground flex-shrink-0" />
            ) : (
              <ChevronRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
            )}
          </>
        )}
        <StatusIcon status={execution.status} />
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="mt-2 space-y-2 pl-6">
          {/* Input details */}
          {formattedInput.length > 0 && (
            <div className="space-y-1">
              {formattedInput.map((item, idx) => (
                <div key={idx} className="flex flex-col gap-0.5">
                  <span className="text-muted-foreground text-[10px] uppercase tracking-wide">
                    {item.label}
                  </span>
                  <pre className="p-2 bg-muted/50 rounded text-xs overflow-auto max-h-40 whitespace-pre-wrap break-all text-foreground font-mono">
                    {item.value}
                  </pre>
                </div>
              ))}
            </div>
          )}

          {/* Output/Result */}
          {execution.result && (
            <div className="flex flex-col gap-0.5">
              <span className="text-muted-foreground text-[10px] uppercase tracking-wide">
                Output
              </span>
              <pre className="p-2 bg-muted/50 rounded text-xs overflow-auto max-h-60 whitespace-pre-wrap break-all text-foreground font-mono">
                {execution.result}
              </pre>
            </div>
          )}

          {/* Error */}
          {execution.error && (
            <div className="flex flex-col gap-0.5">
              <span className="text-red-400 text-[10px] uppercase tracking-wide">Error</span>
              <pre className="p-2 bg-red-500/10 rounded text-xs overflow-auto max-h-40 whitespace-pre-wrap break-all text-red-400 font-mono">
                {execution.error}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
