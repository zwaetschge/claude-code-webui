import * as React from 'react';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useOrchestrationStore } from '@/stores/orchestrationStore';
import { useSocket } from '@/hooks/useSocket';
import type { CLIProvider, WorkerState, OrchestrationTask, OrchestrationPhase } from '@claude-code-webui/shared';
import {
  Play,
  Square,
  Settings,
  ChevronDown,
  ChevronUp,
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  Cpu,
  Activity,
} from 'lucide-react';

interface OrchestrationPanelProps {
  sessionId: string;
  className?: string;
}

// Provider icons and colors
const providerConfig: Record<CLIProvider, { icon: string; color: string; name: string }> = {
  claude: { icon: '🟠', color: 'text-orange-500', name: 'Claude' },
  codex: { icon: '🟢', color: 'text-green-500', name: 'Codex' },
  gemini: { icon: '🔵', color: 'text-blue-500', name: 'Gemini' },
  glm: { icon: '🔷', color: 'text-cyan-500', name: 'Z.AI' },
  kimi: { icon: '🌑', color: 'text-gray-400', name: 'Kimi' },
  multi: { icon: '🎭', color: 'text-purple-500', name: 'Multi' },
};

// Status badge component
function StatusBadge({ status }: { status: WorkerState['status'] }) {
  const config = {
    idle: { color: 'bg-gray-500', label: 'Idle' },
    starting: { color: 'bg-yellow-500', label: 'Starting' },
    busy: { color: 'bg-green-500 animate-pulse', label: 'Working' },
    error: { color: 'bg-red-500', label: 'Error' },
    stopped: { color: 'bg-gray-400', label: 'Stopped' },
  };

  const { color, label } = config[status] || config.idle;

  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className={cn('w-2 h-2 rounded-full', color)} />
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

// Task status icon
function TaskStatusIcon({ status }: { status: OrchestrationTask['status'] }) {
  switch (status) {
    case 'pending':
      return <Clock className="w-4 h-4 text-gray-400" />;
    case 'delegated':
      return <Activity className="w-4 h-4 text-yellow-500" />;
    case 'running':
      return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
    case 'completed':
      return <CheckCircle className="w-4 h-4 text-green-500" />;
    case 'failed':
      return <XCircle className="w-4 h-4 text-red-500" />;
    case 'cancelled':
      return <AlertCircle className="w-4 h-4 text-gray-500" />;
    default:
      return null;
  }
}

// Phase indicator
function PhaseIndicator({ phase, message }: { phase: OrchestrationPhase; message?: string }) {
  const phaseConfig: Record<OrchestrationPhase, { label: string; color: string }> = {
    idle: { label: 'Bereit', color: 'text-gray-500' },
    analyzing: { label: 'Analysiert', color: 'text-yellow-500' },
    delegating: { label: 'Delegiert', color: 'text-blue-500' },
    executing: { label: 'Ausführung', color: 'text-green-500' },
    synthesizing: { label: 'Synthese', color: 'text-purple-500' },
    completed: { label: 'Fertig', color: 'text-green-600' },
    error: { label: 'Fehler', color: 'text-red-500' },
  };

  const config = phaseConfig[phase] || phaseConfig.idle;

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className={cn('font-medium', config.color)}>{config.label}</span>
      {message && <span className="text-muted-foreground">- {message}</span>}
    </div>
  );
}

// Worker card component
function WorkerCard({
  worker,
  isSelected,
  onClick,
  onInterrupt,
}: {
  worker: WorkerState;
  isSelected: boolean;
  onClick: () => void;
  onInterrupt: () => void;
}) {
  const config = providerConfig[worker.provider];

  return (
    <div
      onClick={onClick}
      className={cn(
        'p-3 rounded-lg border cursor-pointer transition-colors',
        isSelected
          ? 'border-primary bg-primary/5'
          : 'border-border hover:border-primary/50 hover:bg-muted/50'
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">{config.icon}</span>
          <span className="font-medium text-sm">{config.name}</span>
        </div>
        <StatusBadge status={worker.status} />
      </div>

      {worker.currentTask && (
        <p className="text-xs text-muted-foreground truncate mt-1">{worker.currentTask}</p>
      )}

      {worker.status === 'busy' && (
        <Button
          size="sm"
          variant="ghost"
          className="w-full mt-2 h-7 text-xs"
          onClick={(e) => {
            e.stopPropagation();
            onInterrupt();
          }}
        >
          <Square className="w-3 h-3 mr-1" />
          Stoppen
        </Button>
      )}
    </div>
  );
}

// Task list item
function TaskItem({
  task,
  onCancel,
}: {
  task: OrchestrationTask;
  onCancel: () => void;
}) {
  const duration = task.completedAt && task.createdAt
    ? Math.round((new Date(task.completedAt).getTime() - new Date(task.createdAt).getTime()) / 1000)
    : null;

  return (
    <div className="flex items-start gap-3 p-2 rounded hover:bg-muted/50">
      <TaskStatusIcon status={task.status} />
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate">{task.description}</p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="capitalize">{task.status}</span>
          {duration && <span>• {duration}s</span>}
        </div>
      </div>
      {(task.status === 'pending' || task.status === 'running') && (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 w-6 p-0"
          onClick={onCancel}
        >
          <XCircle className="w-4 h-4" />
        </Button>
      )}
    </div>
  );
}

export function OrchestrationPanel({ sessionId, className }: OrchestrationPanelProps) {
  const { socket } = useSocket();
  const [expanded, setExpanded] = React.useState(true);
  const [showConfig, setShowConfig] = React.useState(false);

  const {
    states,
    configs,
    selectedWorkerId,
    setSelectedWorker,
    getWorkers,
    getTasks,
    isOrchestrating,
  } = useOrchestrationStore();

  const state = states[sessionId];
  const config = configs[sessionId];
  const workers = getWorkers(sessionId);
  const tasks = getTasks(sessionId);
  const orchestrating = isOrchestrating(sessionId);
  const selectedWorker = selectedWorkerId[sessionId] || null;

  const handleStart = () => {
    socket?.emit('orchestration:start', { sessionId });
  };

  const handleStop = () => {
    socket?.emit('orchestration:stop', { sessionId });
  };

  const handleInterruptWorker = (workerId: string) => {
    socket?.emit('orchestration:interrupt_worker', { sessionId, workerId });
  };

  const handleCancelTask = (taskId: string) => {
    socket?.emit('orchestration:cancel_task', { sessionId, taskId });
  };

  const handleToggleWorker = (provider: CLIProvider, enabled: boolean) => {
    if (!config) return;
    const updatedWorkers = config.workers.map((w) =>
      w.provider === provider ? { ...w, enabled } : w
    );
    socket?.emit('orchestration:configure', {
      sessionId,
      config: { workers: updatedWorkers },
    });
  };

  // Group tasks by status
  const activeTasks = tasks.filter((t) => t.status === 'running' || t.status === 'delegated');
  const pendingTasks = tasks.filter((t) => t.status === 'pending');
  const completedTasks = tasks.filter((t) => t.status === 'completed' || t.status === 'failed');

  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardHeader className="p-4 pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cpu className="w-5 h-5 text-primary" />
            <CardTitle className="text-base">Orchestration</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            {orchestrating ? (
              <Button size="sm" variant="destructive" onClick={handleStop}>
                <Square className="w-4 h-4 mr-1" />
                Stoppen
              </Button>
            ) : (
              <Button size="sm" variant="default" onClick={handleStart}>
                <Play className="w-4 h-4 mr-1" />
                Starten
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowConfig(!showConfig)}
            >
              <Settings className="w-4 h-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </Button>
          </div>
        </div>

        {state && (
          <PhaseIndicator phase={state.currentPhase} message={state.phaseMessage} />
        )}
      </CardHeader>

      {expanded && (
        <CardContent className="p-4 pt-2">
          {/* Configuration panel */}
          {showConfig && config && (
            <div className="mb-4 p-3 rounded-lg bg-muted/50 space-y-3">
              <h4 className="text-sm font-medium">Worker-Konfiguration</h4>
              {config.workers.map((workerConfig) => (
                <div key={workerConfig.provider} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span>{providerConfig[workerConfig.provider].icon}</span>
                    <span className="text-sm">{providerConfig[workerConfig.provider].name}</span>
                    {workerConfig.specialization && (
                      <span className="text-xs text-muted-foreground">
                        ({workerConfig.specialization})
                      </span>
                    )}
                  </div>
                  <Switch
                    checked={workerConfig.enabled}
                    onCheckedChange={(enabled) =>
                      handleToggleWorker(workerConfig.provider, enabled)
                    }
                  />
                </div>
              ))}

              <div className="flex items-center justify-between pt-2 border-t">
                <span className="text-sm">Automatisches Routing</span>
                <Switch
                  checked={config.taskRouting === 'auto'}
                  onCheckedChange={(auto) =>
                    socket?.emit('orchestration:configure', {
                      sessionId,
                      config: { taskRouting: auto ? 'auto' : 'manual' },
                    })
                  }
                />
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm">Parallele Ausführung</span>
                <Switch
                  checked={config.parallelExecution}
                  onCheckedChange={(parallel) =>
                    socket?.emit('orchestration:configure', {
                      sessionId,
                      config: { parallelExecution: parallel },
                    })
                  }
                />
              </div>
            </div>
          )}

          {/* Workers grid */}
          <div className="mb-4">
            <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
              <Activity className="w-4 h-4" />
              Workers ({workers.length})
            </h4>
            <div className="grid grid-cols-3 gap-2">
              {workers.map((worker) => (
                <WorkerCard
                  key={worker.id}
                  worker={worker}
                  isSelected={selectedWorker === worker.id}
                  onClick={() => setSelectedWorker(sessionId, worker.id)}
                  onInterrupt={() => handleInterruptWorker(worker.id)}
                />
              ))}
              {workers.length === 0 && (
                <p className="col-span-3 text-sm text-muted-foreground text-center py-4">
                  Keine Worker aktiv. Starte Orchestration um Worker zu spawnen.
                </p>
              )}
            </div>
          </div>

          {/* Active tasks */}
          {activeTasks.length > 0 && (
            <div className="mb-4">
              <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Aktive Tasks ({activeTasks.length})
              </h4>
              <div className="space-y-1">
                {activeTasks.map((task) => (
                  <TaskItem
                    key={task.id}
                    task={task}
                    onCancel={() => handleCancelTask(task.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Pending tasks */}
          {pendingTasks.length > 0 && (
            <div className="mb-4">
              <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                <Clock className="w-4 h-4" />
                Wartende Tasks ({pendingTasks.length})
              </h4>
              <div className="space-y-1">
                {pendingTasks.map((task) => (
                  <TaskItem
                    key={task.id}
                    task={task}
                    onCancel={() => handleCancelTask(task.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Completed tasks (collapsed by default) */}
          {completedTasks.length > 0 && (
            <details className="group">
              <summary className="text-sm font-medium mb-2 flex items-center gap-2 cursor-pointer list-none">
                <CheckCircle className="w-4 h-4 text-green-500" />
                Abgeschlossene Tasks ({completedTasks.length})
                <ChevronDown className="w-4 h-4 ml-auto group-open:rotate-180 transition-transform" />
              </summary>
              <ScrollArea className="h-32">
                <div className="space-y-1">
                  {completedTasks.slice(-10).map((task) => (
                    <TaskItem
                      key={task.id}
                      task={task}
                      onCancel={() => {}}
                    />
                  ))}
                </div>
              </ScrollArea>
            </details>
          )}
        </CardContent>
      )}
    </Card>
  );
}
