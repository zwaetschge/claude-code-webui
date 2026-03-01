import {
  Play, Pause, Square, AlertTriangle, CheckCircle, Loader2, Bot, Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { useRalphStore } from '@/stores/ralphStore';
import { socketService } from '@/services/socket';
import { RalphPlanView } from './RalphPlanView';
import type { RalphStatus } from '@claude-code-webui/shared';

interface RalphProgressPanelProps {
  sessionId: string;
}

function getStatusBadge(status: RalphStatus) {
  switch (status) {
    case 'planning':
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-500 bg-blue-500/10 px-2 py-0.5 rounded-full">
          <Loader2 className="h-3 w-3 animate-spin" /> Planning
        </span>
      );
    case 'executing':
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-green-500 bg-green-500/10 px-2 py-0.5 rounded-full">
          <Zap className="h-3 w-3" /> Executing
        </span>
      );
    case 'paused':
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-full">
          <Pause className="h-3 w-3" /> Paused
        </span>
      );
    case 'completed':
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-green-500 bg-green-500/10 px-2 py-0.5 rounded-full">
          <CheckCircle className="h-3 w-3" /> Completed
        </span>
      );
    case 'failed':
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-red-500 bg-red-500/10 px-2 py-0.5 rounded-full">
          <AlertTriangle className="h-3 w-3" /> Failed
        </span>
      );
    case 'stopped':
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
          <Square className="h-3 w-3" /> Stopped
        </span>
      );
    default:
      return null;
  }
}

export function RalphProgressPanel({ sessionId }: RalphProgressPanelProps) {
  const run = useRalphStore((s) => s.getRunBySession(sessionId));

  if (!run) return null;

  const handlePause = () => {
    socketService.emit('ralph:pause', { runId: run.id });
  };

  const handleResume = () => {
    socketService.emit('ralph:resume', { runId: run.id });
  };

  const handleStop = () => {
    socketService.emit('ralph:stop', { runId: run.id });
  };

  const isActive = ['planning', 'executing'].includes(run.status);
  const isPaused = run.status === 'paused';
  const isDone = ['completed', 'failed', 'stopped'].includes(run.status);

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Bot className="h-4 w-4" />
            Ralph Wiggum
          </CardTitle>
          {getStatusBadge(run.status)}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Idea */}
        <p className="text-xs text-muted-foreground line-clamp-2">
          {run.idea}
        </p>

        {/* Progress Bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span>
              {run.progress.completedTasks}/{run.progress.totalTasks} Tasks
            </span>
            <span>{run.progress.percentComplete}%</span>
          </div>
          <Progress value={run.progress.percentComplete} className="h-2" />
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="text-center p-1.5 rounded bg-muted/50">
            <p className="font-medium">{run.progress.totalIterations}</p>
            <p className="text-muted-foreground">Iterations</p>
          </div>
          <div className="text-center p-1.5 rounded bg-muted/50">
            <p className="font-medium">{run.progress.failedTasks}</p>
            <p className="text-muted-foreground">Failed</p>
          </div>
          <div className="text-center p-1.5 rounded bg-muted/50">
            <p className="font-medium">
              {run.costTracking.totalCostUsd > 0
                ? `$${run.costTracking.totalCostUsd.toFixed(2)}`
                : '-'}
            </p>
            <p className="text-muted-foreground">Cost</p>
          </div>
        </div>

        {/* Circuit Breaker Warning */}
        {run.circuitBreaker.triggered && (
          <div className="flex items-start gap-2 p-2 rounded bg-amber-500/10 border border-amber-500/20">
            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <div className="text-xs">
              <p className="font-medium text-amber-500">Circuit Breaker</p>
              <p className="text-muted-foreground">{run.circuitBreaker.triggerReason}</p>
            </div>
          </div>
        )}

        {/* Last Error */}
        {run.lastError && !run.circuitBreaker.triggered && (
          <div className="text-xs text-red-500 p-2 rounded bg-red-500/10 border border-red-500/20">
            {run.lastError}
          </div>
        )}

        {/* Plan View */}
        {run.plan && (
          <RalphPlanView
            plan={run.plan}
            currentTaskIndex={run.progress.currentTaskIndex}
          />
        )}

        {/* Controls */}
        <div className="flex gap-2">
          {isActive && (
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={handlePause}
            >
              <Pause className="h-3 w-3 mr-1" /> Pause
            </Button>
          )}
          {isPaused && (
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={handleResume}
            >
              <Play className="h-3 w-3 mr-1" /> Resume
            </Button>
          )}
          {(isActive || isPaused) && (
            <Button
              variant="outline"
              size="sm"
              className={cn('flex-1', 'text-destructive hover:text-destructive')}
              onClick={handleStop}
            >
              <Square className="h-3 w-3 mr-1" /> Stop
            </Button>
          )}
          {isDone && run.exitReason && (
            <p className="text-xs text-muted-foreground w-full text-center">
              {run.exitReason}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
