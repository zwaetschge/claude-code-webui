import type { SessionStatus } from '@plum-code-webui/shared';
import type { TodoItem } from '../../stores/sessionStore';

export type TaskWorkbenchTone = 'error' | 'working' | 'ready' | 'idle';

export interface ActiveTodoPresentation {
  todo: TodoItem | undefined;
  text: string | undefined;
}

export interface TaskWorkbenchStateInput {
  sessionStatus: SessionStatus;
  isActive: boolean;
  pendingTasksCount: number;
  completedTasksCount: number;
  totalTasksCount: number;
  canUseCodexGoal: boolean;
  composerSteersWhileActive: boolean;
  composerQueuesWhileActive: boolean;
  queuedDepth: number;
  activityMessage?: string;
  activeToolLabel?: string;
  runtimeActivityDetail?: string;
  activeAgentLabel?: string;
  activeTodoText?: string;
  lastMessage?: string | null;
  hasSelectedTool: boolean;
  selectedToolName?: string;
}

export interface TaskWorkbenchState {
  headerTone: TaskWorkbenchTone;
  headerStatusLabel: string;
  headerDetail: string;
  progressLabel: string;
  composerStatusLabel: string;
  composerStatusDetail: string;
}

export function getActiveTodoPresentation(todos: TodoItem[]): ActiveTodoPresentation {
  const todo =
    todos.find((item) => item.status === 'in_progress') ??
    todos.find((item) => item.status === 'pending');

  return {
    todo,
    text: todo?.status === 'in_progress' && todo.activeForm ? todo.activeForm : todo?.content,
  };
}

export function getTaskWorkbenchState({
  sessionStatus,
  isActive,
  pendingTasksCount,
  completedTasksCount,
  totalTasksCount,
  canUseCodexGoal,
  composerSteersWhileActive,
  composerQueuesWhileActive,
  queuedDepth,
  activityMessage,
  activeToolLabel,
  runtimeActivityDetail,
  activeAgentLabel,
  activeTodoText,
  lastMessage,
  hasSelectedTool,
  selectedToolName,
}: TaskWorkbenchStateInput): TaskWorkbenchState {
  const activeAgentDetail = activeAgentLabel ? `${activeAgentLabel} running` : undefined;

  const headerTone: TaskWorkbenchTone =
    sessionStatus === 'error'
      ? 'error'
      : isActive
        ? 'working'
        : pendingTasksCount > 0
          ? 'ready'
          : 'idle';

  const headerStatusLabel =
    sessionStatus === 'error'
      ? 'Needs attention'
      : isActive
        ? composerSteersWhileActive
          ? 'Steering'
          : 'Working'
        : pendingTasksCount > 0
          ? 'Ready'
          : 'Idle';

  const headerDetail =
    activityMessage ||
    activeToolLabel ||
    runtimeActivityDetail ||
    activeAgentDetail ||
    activeTodoText ||
    lastMessage ||
    'No active task yet';

  const progressLabel =
    totalTasksCount > 0
      ? `${completedTasksCount}/${totalTasksCount} done`
      : canUseCodexGoal
        ? 'No plan yet'
        : 'No task list';

  const composerStatusLabel = isActive
    ? composerSteersWhileActive
      ? 'Steering active run'
      : composerQueuesWhileActive
        ? queuedDepth > 0
          ? `${queuedDepth} queued`
          : 'Follow-up queue'
        : 'Run active'
    : hasSelectedTool
      ? selectedToolName || 'Tool selected'
      : '';

  const composerStatusDetail =
    activeTodoText ||
    activityMessage ||
    runtimeActivityDetail ||
    activeAgentDetail ||
    (isActive && composerQueuesWhileActive ? 'Waiting behind current run.' : undefined) ||
    (isActive && composerSteersWhileActive ? 'Updating current run.' : undefined) ||
    '';

  return {
    headerTone,
    headerStatusLabel,
    headerDetail,
    progressLabel,
    composerStatusLabel,
    composerStatusDetail,
  };
}
