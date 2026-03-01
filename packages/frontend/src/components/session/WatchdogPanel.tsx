import { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, ShieldOff, Pause, Plus, Trash2, Activity, CheckCircle, XCircle, Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/services/api';
import { cn } from '@/lib/utils';

interface WatchdogRule {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  condition: WatchdogCondition;
  action: WatchdogAction;
}

type WatchdogCondition =
  | { type: 'tool_match'; toolName: string; pattern?: string }
  | { type: 'tool_any' }
  | { type: 'error_count'; threshold: number; windowMinutes: number }
  | { type: 'token_usage'; threshold: number }
  | { type: 'time_elapsed'; minutes: number }
  | { type: 'always' };

type WatchdogAction =
  | { type: 'approve'; savePattern?: 'project' | 'global' }
  | { type: 'deny'; reason?: string }
  | { type: 'pause'; reason?: string }
  | { type: 'notify'; webhook?: string; message?: string };

interface WatchdogConfig {
  enabled: boolean;
  sessionId?: string;
  rules: WatchdogRule[];
  pauseOnErrorThreshold?: number;
  maxTokensPerSession?: number;
  maxRuntimeMinutes?: number;
  notifyWebhook?: string;
  logDecisions: boolean;
}

interface WatchdogDecision {
  id: string;
  timestamp: number;
  sessionId: string;
  requestId?: string;
  toolName: string;
  rule?: WatchdogRule;
  action: string;
  reason: string;
  automatic: boolean;
}

interface WatchdogStatus {
  enabled: boolean;
  activeRules: number;
  decisionsToday: number;
  lastDecision?: WatchdogDecision;
  pausedSessions: string[];
}

interface WatchdogPanelProps {
  sessionId?: string;
  onStatusChange?: (enabled: boolean) => void;
}

// Simple Badge component since we don't have one
function Badge({ children, variant = 'default', className }: { children: React.ReactNode; variant?: 'default' | 'outline' | 'secondary'; className?: string }) {
  return (
    <span className={cn(
      "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
      variant === 'outline' && "border border-border",
      variant === 'secondary' && "bg-muted text-muted-foreground",
      variant === 'default' && "bg-primary/10 text-primary",
      className
    )}>
      {children}
    </span>
  );
}

const TOOL_NAMES = ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Task', 'TodoWrite'];

export function WatchdogPanel({ sessionId, onStatusChange }: WatchdogPanelProps) {
  const [config, setConfig] = useState<WatchdogConfig | null>(null);
  const [status, setStatus] = useState<WatchdogStatus | null>(null);
  const [decisions, setDecisions] = useState<WatchdogDecision[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddRule, setShowAddRule] = useState(false);

  // New rule form state
  const [newRule, setNewRule] = useState<Partial<WatchdogRule>>({
    name: '',
    enabled: true,
    priority: 50,
    condition: { type: 'tool_match', toolName: 'Bash' },
    action: { type: 'approve' },
  });

  const fetchData = useCallback(async () => {
    try {
      const [configRes, statusRes, decisionsRes] = await Promise.all([
        sessionId
          ? api.get<WatchdogConfig>(`/api/watchdog/session/${sessionId}/config`)
          : api.get<WatchdogConfig>('/api/watchdog/config'),
        api.get<WatchdogStatus>('/api/watchdog/status'),
        sessionId
          ? api.get<WatchdogDecision[]>(`/api/watchdog/session/${sessionId}/decisions?limit=50`)
          : api.get<WatchdogDecision[]>('/api/watchdog/decisions?limit=50'),
      ]);

      setConfig(configRes.data);
      setStatus(statusRes.data);
      setDecisions(decisionsRes.data);
    } catch (err) {
      console.error('Failed to fetch watchdog data:', err);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchData();
    // Refresh every 30 seconds
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const toggleWatchdog = async () => {
    if (!config) return;

    try {
      const newEnabled = !config.enabled;
      if (sessionId) {
        await api.put(`/api/watchdog/session/${sessionId}/config`, {
          ...config,
          enabled: newEnabled,
        });
      } else {
        await api.post('/api/watchdog/toggle', { enabled: newEnabled });
      }
      setConfig({ ...config, enabled: newEnabled });
      onStatusChange?.(newEnabled);
    } catch (err) {
      console.error('Failed to toggle watchdog:', err);
    }
  };

  const toggleRule = async (ruleId: string, enabled: boolean) => {
    try {
      await api.post(`/api/watchdog/rules/${ruleId}/toggle`, {
        enabled,
        sessionId,
      });
      fetchData();
    } catch (err) {
      console.error('Failed to toggle rule:', err);
    }
  };

  const deleteRule = async (ruleId: string) => {
    try {
      await api.delete(`/api/watchdog/rules/${ruleId}${sessionId ? `?sessionId=${sessionId}` : ''}`);
      fetchData();
    } catch (err) {
      console.error('Failed to delete rule:', err);
    }
  };

  const addRule = async () => {
    if (!newRule.name) return;

    try {
      const rule: WatchdogRule = {
        id: `custom-${Date.now()}`,
        name: newRule.name,
        enabled: newRule.enabled ?? true,
        priority: newRule.priority ?? 50,
        condition: newRule.condition as WatchdogCondition,
        action: newRule.action as WatchdogAction,
      };

      await api.post('/api/watchdog/rules', { rule, sessionId });
      setShowAddRule(false);
      setNewRule({
        name: '',
        enabled: true,
        priority: 50,
        condition: { type: 'tool_match', toolName: 'Bash' },
        action: { type: 'approve' },
      });
      fetchData();
    } catch (err) {
      console.error('Failed to add rule:', err);
    }
  };

  const getActionIcon = (action: string) => {
    switch (action) {
      case 'approve':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'deny':
        return <XCircle className="h-4 w-4 text-red-500" />;
      case 'pause':
        return <Pause className="h-4 w-4 text-amber-500" />;
      case 'notify':
        return <Bell className="h-4 w-4 text-blue-500" />;
      default:
        return <Activity className="h-4 w-4" />;
    }
  };

  const getConditionDescription = (condition: WatchdogCondition): string => {
    switch (condition.type) {
      case 'tool_match':
        return condition.pattern
          ? `${condition.toolName}(${condition.pattern})`
          : condition.toolName;
      case 'tool_any':
        return 'Any tool';
      case 'error_count':
        return `${condition.threshold} errors in ${condition.windowMinutes} min`;
      case 'token_usage':
        return `${condition.threshold.toLocaleString()} tokens`;
      case 'time_elapsed':
        return `After ${condition.minutes} min`;
      case 'always':
        return 'Always';
      default:
        return 'Unknown';
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Loading watchdog...
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {config?.enabled ? (
              <ShieldCheck className="h-5 w-5 text-green-500" />
            ) : (
              <ShieldOff className="h-5 w-5 text-muted-foreground" />
            )}
            <CardTitle className="text-lg">Watchdog</CardTitle>
            {sessionId && (
              <Badge variant="outline" className="text-xs">
                Session
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="watchdog-toggle" className="text-sm text-muted-foreground">
              {config?.enabled ? 'Active' : 'Inactive'}
            </Label>
            <Switch
              id="watchdog-toggle"
              checked={config?.enabled ?? false}
              onCheckedChange={toggleWatchdog}
            />
          </div>
        </div>
        <CardDescription>
          Automatic permission handling when you're away
        </CardDescription>
      </CardHeader>

      <CardContent>
        <Tabs defaultValue="rules" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="rules">Rules</TabsTrigger>
            <TabsTrigger value="decisions">
              Decisions
              {status?.decisionsToday ? (
                <Badge variant="secondary" className="ml-1.5 text-xs">
                  {status.decisionsToday}
                </Badge>
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="rules" className="mt-4 space-y-3">
            <div className="flex justify-between items-center">
              <p className="text-sm text-muted-foreground">
                {config?.rules.filter(r => r.enabled).length || 0} active rules
              </p>
              <Dialog open={showAddRule} onOpenChange={setShowAddRule}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="outline">
                    <Plus className="h-4 w-4 mr-1" />
                    Add Rule
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Add Watchdog Rule</DialogTitle>
                    <DialogDescription>
                      Create a rule to automatically handle permission requests
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label>Rule Name</Label>
                      <Input
                        value={newRule.name || ''}
                        onChange={(e) => setNewRule({ ...newRule, name: e.target.value })}
                        placeholder="e.g., Auto-approve npm install"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Condition Type</Label>
                      <Select
                        value={(newRule.condition as WatchdogCondition)?.type || 'tool_match'}
                        onValueChange={(value) => {
                          const type = value as WatchdogCondition['type'];
                          if (type === 'tool_match') {
                            setNewRule({ ...newRule, condition: { type, toolName: 'Bash' } });
                          } else if (type === 'tool_any') {
                            setNewRule({ ...newRule, condition: { type } });
                          } else if (type === 'error_count') {
                            setNewRule({ ...newRule, condition: { type, threshold: 5, windowMinutes: 10 } });
                          } else if (type === 'always') {
                            setNewRule({ ...newRule, condition: { type } });
                          }
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="tool_match">Match specific tool</SelectItem>
                          <SelectItem value="tool_any">Any tool</SelectItem>
                          <SelectItem value="error_count">Error count threshold</SelectItem>
                          <SelectItem value="always">Always</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {(newRule.condition as WatchdogCondition)?.type === 'tool_match' && (
                      <>
                        <div className="space-y-2">
                          <Label>Tool</Label>
                          <Select
                            value={(newRule.condition as { toolName: string })?.toolName || 'Bash'}
                            onValueChange={(value) =>
                              setNewRule({
                                ...newRule,
                                condition: { ...(newRule.condition as { type: 'tool_match'; toolName: string }), toolName: value },
                              })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {TOOL_NAMES.map((tool) => (
                                <SelectItem key={tool} value={tool}>
                                  {tool}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>Pattern (optional)</Label>
                          <Input
                            value={(newRule.condition as { pattern?: string })?.pattern || ''}
                            onChange={(e) =>
                              setNewRule({
                                ...newRule,
                                condition: { ...(newRule.condition as { type: 'tool_match'; toolName: string }), pattern: e.target.value || undefined },
                              })
                            }
                            placeholder="e.g., git:* or npm install:*"
                          />
                          <p className="text-xs text-muted-foreground">
                            Use prefix:* for wildcard matching
                          </p>
                        </div>
                      </>
                    )}

                    <div className="space-y-2">
                      <Label>Action</Label>
                      <Select
                        value={(newRule.action as WatchdogAction)?.type || 'approve'}
                        onValueChange={(value) => {
                          const type = value as WatchdogAction['type'];
                          if (type === 'approve') {
                            setNewRule({ ...newRule, action: { type } });
                          } else if (type === 'deny') {
                            setNewRule({ ...newRule, action: { type, reason: 'Blocked by watchdog' } });
                          } else if (type === 'pause') {
                            setNewRule({ ...newRule, action: { type, reason: 'Session paused' } });
                          } else if (type === 'notify') {
                            setNewRule({ ...newRule, action: { type } });
                          }
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="approve">Approve</SelectItem>
                          <SelectItem value="deny">Deny</SelectItem>
                          <SelectItem value="pause">Pause Session</SelectItem>
                          <SelectItem value="notify">Notify Only</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Priority (lower = higher priority)</Label>
                      <Input
                        type="number"
                        value={newRule.priority || 50}
                        onChange={(e) => setNewRule({ ...newRule, priority: parseInt(e.target.value, 10) })}
                        min={1}
                        max={100}
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setShowAddRule(false)}>
                      Cancel
                    </Button>
                    <Button onClick={addRule} disabled={!newRule.name}>
                      Add Rule
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>

            <ScrollArea className="h-[300px]">
              <div className="space-y-2">
                {config?.rules.map((rule) => (
                  <div
                    key={rule.id}
                    className={cn(
                      'flex items-center justify-between p-3 rounded-lg border',
                      rule.enabled ? 'bg-card' : 'bg-muted/50 opacity-60'
                    )}
                  >
                    <div className="flex items-center gap-3">
                      {getActionIcon(rule.action.type)}
                      <div>
                        <p className="text-sm font-medium">{rule.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {getConditionDescription(rule.condition)} → {rule.action.type}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={rule.enabled}
                        onCheckedChange={(checked) => toggleRule(rule.id, checked)}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => deleteRule(rule.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
                {(!config?.rules || config.rules.length === 0) && (
                  <p className="text-center text-sm text-muted-foreground py-8">
                    No rules configured
                  </p>
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="decisions" className="mt-4">
            <ScrollArea className="h-[300px]">
              <div className="space-y-2">
                {decisions.map((decision) => (
                  <div
                    key={decision.id}
                    className="flex items-start gap-3 p-3 rounded-lg border bg-card"
                  >
                    {getActionIcon(decision.action)}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">{decision.toolName}</p>
                        <Badge variant="outline" className="text-xs">
                          {decision.action}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {decision.reason}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(decision.timestamp).toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                ))}
                {decisions.length === 0 && (
                  <p className="text-center text-sm text-muted-foreground py-8">
                    No decisions recorded
                  </p>
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="settings" className="mt-4 space-y-4">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Log all decisions</Label>
                  <p className="text-xs text-muted-foreground">
                    Record all watchdog decisions for review
                  </p>
                </div>
                <Switch
                  checked={config?.logDecisions ?? true}
                  onCheckedChange={(checked) => {
                    if (config) {
                      setConfig({ ...config, logDecisions: checked });
                    }
                  }}
                />
              </div>

              <div className="space-y-2">
                <Label>Pause after N consecutive errors</Label>
                <Input
                  type="number"
                  value={config?.pauseOnErrorThreshold || ''}
                  onChange={(e) => {
                    if (config) {
                      setConfig({
                        ...config,
                        pauseOnErrorThreshold: e.target.value ? parseInt(e.target.value, 10) : undefined,
                      });
                    }
                  }}
                  placeholder="e.g., 5"
                />
              </div>

              <div className="space-y-2">
                <Label>Webhook URL for notifications</Label>
                <Input
                  value={config?.notifyWebhook || ''}
                  onChange={(e) => {
                    if (config) {
                      setConfig({ ...config, notifyWebhook: e.target.value || undefined });
                    }
                  }}
                  placeholder="https://..."
                />
              </div>
            </div>

            {status?.pausedSessions && status.pausedSessions.length > 0 && (
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <div className="flex items-center gap-2 text-amber-500">
                  <Pause className="h-4 w-4" />
                  <p className="text-sm font-medium">
                    {status.pausedSessions.length} session(s) paused
                  </p>
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
