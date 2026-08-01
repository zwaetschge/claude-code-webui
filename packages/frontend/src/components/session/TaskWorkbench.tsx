import { Brain, ListTodo, MessageSquare, RotateCcw, Sparkles, Square } from 'lucide-react';
import type { TodoItem } from '../../stores/sessionStore';
import { cn } from '../../lib/utils';
import type { TaskWorkbenchState } from './taskWorkbenchState';

interface TaskWorkbenchHeaderProps {
  sessionName: string;
  state: TaskWorkbenchState;
  queuedDepth: number;
  contextUsedPercent?: number;
  canInterruptActiveRun: boolean;
  onOpenRun: () => void;
  onOpenTasks: () => void;
  onInterrupt: () => void;
  onRestart: () => void;
}

export function TaskWorkbenchHeader({
  sessionName,
  state,
  queuedDepth,
  contextUsedPercent,
  canInterruptActiveRun,
  onOpenRun,
  onOpenTasks,
  onInterrupt,
  onRestart,
}: TaskWorkbenchHeaderProps) {
  return (
    <div className="task-workbench-topbar-inner">
      <div className="task-workbench-heading">
        <span className={cn('task-workbench-status-dot', `is-${state.headerTone}`)} />
        <div className="task-workbench-titleblock">
          <span className="task-workbench-eyebrow">Task mode</span>
          <h1>{sessionName}</h1>
        </div>
      </div>

      <div className="task-workbench-state" title={state.headerDetail}>
        <span className="task-workbench-state-label">{state.headerStatusLabel}</span>
        <strong>{state.headerDetail}</strong>
      </div>

      <div className="task-workbench-metrics" aria-label="Task status">
        <span>
          <ListTodo className="h-3.5 w-3.5" />
          {state.progressLabel}
        </span>
        {queuedDepth > 0 && (
          <span>
            <MessageSquare className="h-3.5 w-3.5" />
            {queuedDepth} queued
          </span>
        )}
        {contextUsedPercent !== undefined && (
          <span>
            <Brain className="h-3.5 w-3.5" />
            {Math.round(contextUsedPercent)}%
          </span>
        )}
      </div>

      <div className="task-workbench-actions">
        <button
          type="button"
          className="task-workbench-action"
          onClick={onOpenRun}
          title="Open run view"
        >
          <Sparkles className="h-3.5 w-3.5" />
          <span>Run</span>
        </button>
        <button
          type="button"
          className="task-workbench-action"
          onClick={onOpenTasks}
          title="Open goal and tasks"
        >
          <ListTodo className="h-3.5 w-3.5" />
          <span>Tasks</span>
        </button>
        <button
          type="button"
          className={cn('task-workbench-action', canInterruptActiveRun && 'is-danger')}
          onClick={canInterruptActiveRun ? onInterrupt : onRestart}
          title={canInterruptActiveRun ? 'Stop active run' : 'Restart session'}
        >
          {canInterruptActiveRun ? (
            <Square className="h-3.5 w-3.5" />
          ) : (
            <RotateCcw className="h-3.5 w-3.5" />
          )}
          <span>{canInterruptActiveRun ? 'Stop' : 'Restart'}</span>
        </button>
      </div>
    </div>
  );
}

interface TodoFloatingStripProps {
  todo: TodoItem | undefined;
  pendingTasksCount: number;
  mode: 'desktop' | 'mobile';
  onOpenTasks: () => void;
}

export function TodoFloatingStrip({
  todo,
  pendingTasksCount,
  mode,
  onOpenTasks,
}: TodoFloatingStripProps) {
  if (!todo || pendingTasksCount === 0) return null;

  return (
    <button
      type="button"
      className={cn('todo-floating-strip', mode === 'desktop' ? 'hidden md:flex' : 'md:hidden')}
      onClick={onOpenTasks}
    >
      <span className={cn('todo-floating-dot', todo.status === 'in_progress' && 'is-running')} />
      <span className="truncate">
        {todo.status === 'in_progress' && todo.activeForm ? todo.activeForm : todo.content}
      </span>
      <span className="todo-floating-count">{pendingTasksCount}</span>
    </button>
  );
}
