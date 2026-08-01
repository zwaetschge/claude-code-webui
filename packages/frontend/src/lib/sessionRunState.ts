import type {
  Session,
  SessionQueueData,
  SubagentRun,
  ToolExecution,
} from '@plum-code-webui/shared';
import type { ActivityState, AgentState } from '@/stores/sessionStore';

export type SessionRunTone = 'working' | 'live-idle' | 'idle' | 'error';

export interface LiveSessionSignals {
  activity?: ActivityState;
  activeAgent?: AgentState | null;
  agentRuns?: SubagentRun[];
  streamingContent?: string;
  tools?: ToolExecution[];
  queue?: SessionQueueData | null;
}

export interface SessionRunState {
  tone: SessionRunTone;
  label: string;
  detail: string;
  isWorking: boolean;
  isLive: boolean;
  runningTools: number;
  queueDepth: number;
}

function compactDetail(value: string | null | undefined, fallback: string): string {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  if (!normalized) return fallback;
  return normalized.length > 96 ? `${normalized.slice(0, 93)}...` : normalized;
}

function describeTool(toolName: string | null | undefined): string | undefined {
  if (!toolName) return undefined;
  const normalized = toolName.replace(/[_\s-]/g, '').toLowerCase();
  if (
    normalized.includes('bash') ||
    normalized.includes('shell') ||
    normalized.includes('command')
  ) {
    return 'Running command';
  }
  if (normalized.includes('grep') || normalized.includes('glob') || normalized.includes('search')) {
    return 'Searching files';
  }
  if (normalized.includes('read')) return 'Reading files';
  if (normalized.includes('write') || normalized.includes('edit') || normalized.includes('patch')) {
    return 'Editing files';
  }
  if (normalized.includes('todo')) return 'Updating tasks';
  if (normalized.includes('web')) return 'Searching the web';
  return `Using ${toolName}`;
}

export function getSessionRunState(
  session: Session,
  signals: LiveSessionSignals = {}
): SessionRunState {
  const runningTools = (signals.tools ?? []).filter((tool) => tool.status === 'started').length;
  const queueDepth = signals.queue?.depth ?? session.runtime?.queueDepth ?? 0;
  const activeSubagents = [
    ...(signals.agentRuns ?? []),
    ...(session.runtime?.subagents ?? []),
  ].filter((run) => run.status === 'started');
  const hasLiveActivity =
    signals.activity?.type === 'thinking' ||
    signals.activity?.type === 'tool' ||
    !!signals.activeAgent ||
    activeSubagents.length > 0 ||
    !!signals.streamingContent ||
    runningTools > 0 ||
    !!signals.queue?.busy;

  const isWorking = !!session.runtime?.busy || hasLiveActivity;
  const isLive = !!session.runtime?.running || session.status === 'running' || isWorking;

  if (session.status === 'error') {
    return {
      tone: 'error',
      label: 'Error',
      detail: 'Session error',
      isWorking: false,
      isLive,
      runningTools,
      queueDepth,
    };
  }

  if (isWorking) {
    const toolName = signals.activity?.type === 'tool' ? signals.activity.toolName : undefined;
    const detail = compactDetail(
      signals.activity?.message ||
        (activeSubagents.length > 1 ? `${activeSubagents.length} subagents running` : undefined) ||
        activeSubagents[0]?.description ||
        signals.activeAgent?.description ||
        describeTool(toolName) ||
        session.runtime?.activitySummary ||
        session.runtime?.currentAgentDescription ||
        describeTool(session.runtime?.currentToolName) ||
        (session.runtime?.currentAgentType
          ? `Running ${session.runtime.currentAgentType} agent`
          : undefined) ||
        (queueDepth > 0 ? `${queueDepth} queued` : undefined),
      'Agent working'
    );
    return {
      tone: 'working',
      label: 'Working',
      detail,
      isWorking: true,
      isLive: true,
      runningTools,
      queueDepth,
    };
  }

  if (isLive) {
    return {
      tone: 'live-idle',
      label: 'Live idle',
      detail: 'Session process is ready',
      isWorking: false,
      isLive: true,
      runningTools,
      queueDepth,
    };
  }

  return {
    tone: 'idle',
    label: 'Idle',
    detail: 'No active agent process',
    isWorking: false,
    isLive: false,
    runningTools,
    queueDepth,
  };
}
