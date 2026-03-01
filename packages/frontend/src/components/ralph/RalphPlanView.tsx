import { CheckCircle, Circle, Loader2, XCircle, SkipForward } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { RalphPlan, RalphTaskStatus } from '@claude-code-webui/shared';

interface RalphPlanViewProps {
  plan: RalphPlan;
  currentTaskIndex: number;
}

function getTaskIcon(status: RalphTaskStatus) {
  switch (status) {
    case 'completed':
      return <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />;
    case 'in_progress':
      return <Loader2 className="h-4 w-4 text-blue-500 animate-spin shrink-0" />;
    case 'failed':
      return <XCircle className="h-4 w-4 text-red-500 shrink-0" />;
    case 'skipped':
      return <SkipForward className="h-4 w-4 text-muted-foreground shrink-0" />;
    default:
      return <Circle className="h-4 w-4 text-muted-foreground shrink-0" />;
  }
}

export function RalphPlanView({ plan, currentTaskIndex }: RalphPlanViewProps) {
  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-sm font-medium">{plan.title}</h4>
        {plan.description && (
          <p className="text-xs text-muted-foreground mt-1">{plan.description}</p>
        )}
      </div>
      <ScrollArea className="h-[300px]">
        <div className="space-y-1 pr-4">
          {plan.tasks.map((task, idx) => (
            <div
              key={task.id}
              className={cn(
                'flex items-start gap-3 p-2.5 rounded-lg border transition-colors',
                idx === currentTaskIndex && task.status === 'in_progress'
                  ? 'bg-blue-500/5 border-blue-500/30'
                  : task.status === 'completed'
                    ? 'bg-green-500/5 border-green-500/20'
                    : task.status === 'failed'
                      ? 'bg-red-500/5 border-red-500/20'
                      : 'border-transparent hover:bg-muted/50'
              )}
            >
              <div className="mt-0.5">
                {getTaskIcon(task.status)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground font-mono">
                    {task.index}.
                  </span>
                  <span className={cn(
                    'text-sm font-medium truncate',
                    task.status === 'completed' && 'line-through text-muted-foreground',
                    task.status === 'skipped' && 'text-muted-foreground'
                  )}>
                    {task.title}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                  {task.description}
                </p>
                {task.lastError && (
                  <p className="text-xs text-red-500 mt-1">
                    Error: {task.lastError}
                  </p>
                )}
                {task.attempts > 1 && (
                  <span className="text-[10px] text-muted-foreground">
                    Attempt {task.attempts}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
