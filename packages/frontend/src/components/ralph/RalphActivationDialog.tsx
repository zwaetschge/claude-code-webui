import { useState } from 'react';
import { Bot, Play, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { socketService } from '@/services/socket';
import { useSessionStore } from '@/stores/sessionStore';
import type { RalphConfig } from '@claude-code-webui/shared';

interface RalphActivationDialogProps {
  /** Pre-selected session ID, or undefined for new session */
  sessionId?: string;
  trigger?: React.ReactNode;
}

export function RalphActivationDialog({ sessionId, trigger }: RalphActivationDialogProps) {
  const [open, setOpen] = useState(false);
  const [idea, setIdea] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string>(sessionId || '__new__');
  const { sessions } = useSessionStore();

  const [config, setConfig] = useState<Partial<RalphConfig>>({
    maxIterationsPerTask: 10,
    maxTotalIterations: 50,
    iterationDelayMs: 2000,
    noProgressThreshold: 3,
    sameErrorThreshold: 2,
    dangerMode: true,
    notifyOnCompletion: true,
    notifyOnPause: true,
  });

  const handleStart = () => {
    if (!idea.trim()) return;

    const payload: { sessionId?: string; idea: string; config?: Record<string, unknown> } = {
      idea: idea.trim(),
      config: config as Record<string, unknown>,
    };

    if (selectedSessionId !== '__new__') {
      payload.sessionId = selectedSessionId;
    }

    socketService.emit('ralph:start', payload);
    setOpen(false);
    setIdea('');
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm" className="gap-2">
            <Bot className="h-4 w-4" />
            Ralph
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" />
            Ralph Wiggum - Autonomous Loop
          </DialogTitle>
          <DialogDescription>
            Describe your idea. Ralph will create a plan and execute it autonomously.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Idea Input */}
          <div className="space-y-2">
            <Label>Project Idea</Label>
            <Textarea
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              placeholder="Describe what you want to build or achieve..."
              rows={4}
              autoFocus
            />
          </div>

          {/* Session Selection */}
          {!sessionId && (
            <div className="space-y-2">
              <Label>Session</Label>
              <Select value={selectedSessionId} onValueChange={setSelectedSessionId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select session" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__new__">New Session</SelectItem>
                  {sessions.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Advanced Settings Toggle */}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-xs text-muted-foreground"
            >
              <Settings2 className="h-3 w-3 mr-1" />
              {showAdvanced ? 'Hide' : 'Show'} Advanced Settings
            </Button>
          </div>

          {/* Advanced Settings */}
          {showAdvanced && (
            <div className="space-y-3 p-3 rounded-lg border bg-muted/30">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Max Iterations/Task</Label>
                  <Input
                    type="number"
                    value={config.maxIterationsPerTask}
                    onChange={(e) => setConfig({ ...config, maxIterationsPerTask: parseInt(e.target.value, 10) })}
                    min={1}
                    max={50}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Max Total Iterations</Label>
                  <Input
                    type="number"
                    value={config.maxTotalIterations}
                    onChange={(e) => setConfig({ ...config, maxTotalIterations: parseInt(e.target.value, 10) })}
                    min={1}
                    max={200}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Delay (ms)</Label>
                  <Input
                    type="number"
                    value={config.iterationDelayMs}
                    onChange={(e) => setConfig({ ...config, iterationDelayMs: parseInt(e.target.value, 10) })}
                    min={500}
                    max={30000}
                    step={500}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">No-Progress Threshold</Label>
                  <Input
                    type="number"
                    value={config.noProgressThreshold}
                    onChange={(e) => setConfig({ ...config, noProgressThreshold: parseInt(e.target.value, 10) })}
                    min={1}
                    max={10}
                  />
                </div>
              </div>

              <Separator />

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-normal">Danger Mode (skip permissions)</Label>
                  <Switch
                    checked={config.dangerMode}
                    onCheckedChange={(c) => setConfig({ ...config, dangerMode: c })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-normal">Notify on Completion</Label>
                  <Switch
                    checked={config.notifyOnCompletion}
                    onCheckedChange={(c) => setConfig({ ...config, notifyOnCompletion: c })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-normal">Notify on Pause</Label>
                  <Switch
                    checked={config.notifyOnPause}
                    onCheckedChange={(c) => setConfig({ ...config, notifyOnPause: c })}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleStart} disabled={!idea.trim()}>
            <Play className="h-4 w-4 mr-1" />
            Start Ralph
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
