import { useState, useEffect, useCallback, useRef } from 'react';
import {
  ShieldCheck, ShieldOff, Eye, Send, Target, AlertTriangle,
  CheckCircle, XCircle, Pause, Bell, MessageSquare,
  Plus, Trash2, Activity, Bot, Clock, Zap, ChevronRight, RefreshCw,
  Settings2, RotateCcw, Cpu, Radio, ArrowRight, ArrowLeft, Search
} from 'lucide-react';
import { useSocket } from '@/hooks/useSocket';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { api } from '@/services/api';
import { cn } from '@/lib/utils';
import { useSessionStore } from '@/stores/sessionStore';
import { useRalphStore } from '@/stores/ralphStore';
import { RalphActivationDialog } from '@/components/ralph/RalphActivationDialog';
import { RalphProgressPanel } from '@/components/ralph/RalphProgressPanel';

// --- Local type definitions (matching shared types) ---
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

interface TelegramConfig {
  enabled: boolean;
  botToken: string;
  chatId: string;
  notifyOnApprove: boolean;
  notifyOnDeny: boolean;
  notifyOnPause: boolean;
  notifyOnError: boolean;
  notifyOnGoalProgress: boolean;
}

interface SessionGoal {
  id: string;
  sessionId: string;
  description: string;
  constraints?: string;
  successCriteria?: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'paused';
  progress?: number;
  notes?: string;
  createdAt: number;
  updatedAt: number;
  autoMonitor: boolean;
  maxIterations?: number;
  iterationCount: number;
  lastEvaluation?: string;
  lastEvaluationAt?: number;
  originalMessage?: string;
}

interface GoalMonitoringConfig {
  enabled: boolean;
  maxIterationsPerGoal: number;
  evaluationDelayMs: number;
  autoCreateFromSession: boolean;
}

interface WatchdogSessionState {
  sessionId: string;
  monitored: boolean;
  goals: SessionGoal[];
  lastActivity: number;
  errorCount: number;
  tokenUsage: number;
  startTime: number;
  paused: boolean;
  pauseReason?: string;
}

interface WatchdogConfig {
  enabled: boolean;
  autonomousProfile?: 'balanced' | 'aggressive';
  rules: WatchdogRule[];
  pauseOnErrorThreshold?: number;
  maxTokensPerSession?: number;
  maxRuntimeMinutes?: number;
  notifyWebhook?: string;
  logDecisions: boolean;
  telegram?: TelegramConfig;
  goalMonitoring?: GoalMonitoringConfig;
}

interface WatchdogDecision {
  id: string;
  timestamp: number;
  sessionId: string;
  toolName: string;
  action: string;
  reason: string;
  automatic: boolean;
}

interface WatchdogStatus {
  enabled: boolean;
  autonomousProfile?: 'balanced' | 'aggressive';
  activeRules: number;
  decisionsToday: number;
  lastDecision?: WatchdogDecision;
  pausedSessions: string[];
  monitoredSessions: WatchdogSessionState[];
  telegramConnected: boolean;
}

interface WatchdogCliConfig {
  enabled: boolean;
  cliProvider: string;
  model?: string;
  workingDirectory?: string;
  sessionId?: string;
  useForPermissions: boolean;
  useForChat: boolean;
  permissionTimeoutMs?: number;
}

interface CliProviderInfo {
  id: string;
  name: string;
  available: boolean;
}

interface WatchdogInterMessage {
  id: string;
  timestamp: number;
  from: 'watchdog' | 'session' | 'ralph';
  fromSessionId?: string;
  to: 'watchdog' | 'session' | 'ralph';
  toSessionId?: string;
  toRunId?: string;
  content: string;
  response?: string;
  type: 'guidance' | 'query' | 'response' | 'alert' | 'status';
}

interface SessionActivityEntry {
  sessionId: string;
  timestamp: number;
  type: 'message' | 'tool' | 'error' | 'status';
  summary: string;
}

interface ChatMsg {
  id: string;
  role: 'user' | 'watchdog';
  content: string;
  timestamp: number;
  sessionId?: string;
}

function Badge({ children, variant = 'default', className }: {
  children: React.ReactNode;
  variant?: 'default' | 'outline' | 'secondary' | 'destructive';
  className?: string;
}) {
  return (
    <span className={cn(
      "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
      variant === 'outline' && "border border-border",
      variant === 'secondary' && "bg-muted text-muted-foreground",
      variant === 'default' && "bg-primary/10 text-primary",
      variant === 'destructive' && "bg-destructive/10 text-destructive",
      className
    )}>
      {children}
    </span>
  );
}

const TOOL_NAMES = ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Task', 'TodoWrite'];

function RalphTab({ selectedSessionId }: { selectedSessionId: string | null }) {
  const runs = useRalphStore((s) => s.runs);
  const loadRuns = useRalphStore((s) => s.loadRuns);
  const runList = Object.values(runs);

  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">
          {runList.length} run{runList.length !== 1 ? 's' : ''}
        </p>
        <RalphActivationDialog
          sessionId={selectedSessionId || undefined}
          trigger={
            <Button size="sm"><Plus className="h-4 w-4 mr-1" />New Run</Button>
          }
        />
      </div>
      <ScrollArea className="h-[380px]">
        <div className="space-y-3 pr-4">
          {runList.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Bot className="h-12 w-12 mx-auto opacity-50 mb-4" />
              <p>No Ralph runs yet</p>
              <p className="text-xs mt-1">Start an autonomous development loop</p>
            </div>
          ) : (
            runList.map((run) => (
              <RalphProgressPanel key={run.id} sessionId={run.sessionId} />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

export function WatchdogPage() {
  const { sessions } = useSessionStore();
  const [config, setConfig] = useState<WatchdogConfig | null>(null);
  const [status, setStatus] = useState<WatchdogStatus | null>(null);
  const [decisions, setDecisions] = useState<WatchdogDecision[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [showAddGoal, setShowAddGoal] = useState(false);
  const [showAddRule, setShowAddRule] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  const [newGoal, setNewGoal] = useState<{
    description: string;
    constraints: string;
    successCriteria: string;
    priority: 'low' | 'medium' | 'high' | 'critical';
  }>({
    description: '',
    constraints: '',
    successCriteria: '',
    priority: 'medium',
  });

  const [newRule, setNewRule] = useState<Partial<WatchdogRule>>({
    name: '',
    enabled: true,
    priority: 50,
    condition: { type: 'tool_match', toolName: 'Bash' },
    action: { type: 'approve' },
  });

  const [telegramConfig, setTelegramConfig] = useState<TelegramConfig>({
    enabled: false,
    botToken: '',
    chatId: '',
    notifyOnApprove: false,
    notifyOnDeny: true,
    notifyOnPause: true,
    notifyOnError: true,
    notifyOnGoalProgress: true,
  });

  const [cliConfig, setCliConfig] = useState<WatchdogCliConfig>({
    enabled: false,
    cliProvider: 'claude',
    useForPermissions: false,
    useForChat: false,
    permissionTimeoutMs: 30000,
  });
  const [cliProviders, setCliProviders] = useState<CliProviderInfo[]>([]);
  const [cliModels, setCliModels] = useState<string[]>([]);
  const [cliSaving, setCliSaving] = useState(false);
  const [cliRestarting, setCliRestarting] = useState(false);

  // Inter-instance communication state
  const [interMessages, setInterMessages] = useState<WatchdogInterMessage[]>([]);
  const [activityEntries, setActivityEntries] = useState<SessionActivityEntry[]>([]);
  const [sendToSessionMsg, setSendToSessionMsg] = useState('');
  const [sendingToSession, setSendingToSession] = useState(false);
  const [sendToRalphRunId, setSendToRalphRunId] = useState('');
  const [sendToRalphMsg, setSendToRalphMsg] = useState('');
  const [sendingToRalph, setSendingToRalph] = useState(false);
  const [assessingSession, setAssessingSession] = useState(false);
  const [assessmentResult, setAssessmentResult] = useState<string | null>(null);

  // Goal monitoring state
  const [togglingMonitor, setTogglingMonitor] = useState<string | null>(null);
  const [instructionInput, setInstructionInput] = useState('');
  const [sendingInstruction, setSendingInstruction] = useState(false);
  const [goalMonitoringConfig, setGoalMonitoringConfig] = useState<GoalMonitoringConfig>({
    enabled: false,
    maxIterationsPerGoal: 20,
    evaluationDelayMs: 3000,
    autoCreateFromSession: false,
  });

  const { socket } = useSocket();

  const fetchData = useCallback(async () => {
    try {
      const [configRes, statusRes, decisionsRes, cliRes] = await Promise.all([
        api.get<WatchdogConfig>('/api/watchdog/config'),
        api.get<WatchdogStatus>('/api/watchdog/status'),
        api.get<WatchdogDecision[]>('/api/watchdog/decisions?limit=100'),
        api.get<WatchdogCliConfig>('/api/watchdog/cli'),
      ]);
      setConfig(configRes.data);
      setStatus(statusRes.data);
      setDecisions(decisionsRes.data);
      setCliConfig(cliRes.data);
      if (configRes.data.telegram) {
        setTelegramConfig(configRes.data.telegram);
      }
      if (configRes.data.goalMonitoring) {
        setGoalMonitoringConfig(configRes.data.goalMonitoring);
      }
    } catch (err) {
      console.error('Failed to fetch watchdog data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchCliProviders = useCallback(async () => {
    try {
      const res = await api.get<CliProviderInfo[]>('/api/cli-providers/available');
      setCliProviders(res.data);
    } catch (err) {
      console.error('Failed to fetch CLI providers:', err);
    }
  }, []);

  const fetchCliModels = useCallback(async (providerId: string) => {
    try {
      const res = await api.get<{ models: string[] }>('/api/cli-providers/' + providerId + '/models');
      setCliModels(res.data.models || []);
    } catch {
      setCliModels([]);
    }
  }, []);

  useEffect(() => {
    fetchData();
    fetchCliProviders();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [fetchData, fetchCliProviders]);

  useEffect(() => {
    if (cliConfig.cliProvider) {
      fetchCliModels(cliConfig.cliProvider);
    }
  }, [cliConfig.cliProvider, fetchCliModels]);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages]);

  const toggleWatchdog = async () => {
    if (!config) return;
    try {
      const newEnabled = !config.enabled;
      await api.post('/api/watchdog/toggle', { enabled: newEnabled });
      setConfig({ ...config, enabled: newEnabled });
    } catch (err) {
      console.error('Failed to toggle watchdog:', err);
    }
  };

  const updateAutonomousProfile = async (profile: 'balanced' | 'aggressive') => {
    if (!config) return;
    try {
      await api.post('/api/watchdog/profile', { profile });
      setConfig({ ...config, autonomousProfile: profile });
      if (status) {
        setStatus({ ...status, autonomousProfile: profile });
      }
    } catch (err) {
      console.error('Failed to update watchdog profile:', err);
    }
  };

  const toggleSessionMonitoring = async (sessionId: string, monitored: boolean) => {
    try {
      await api.post('/api/watchdog/session/' + sessionId + '/monitor', { monitored });
      fetchData();
    } catch (err) {
      console.error('Failed to toggle session monitoring:', err);
    }
  };

  const addGoal = async () => {
    if (!selectedSessionId || !newGoal.description) return;
    try {
      await api.post('/api/watchdog/session/' + selectedSessionId + '/goals', {
        ...newGoal,
        status: 'pending',
      });
      setShowAddGoal(false);
      setNewGoal({ description: '', constraints: '', successCriteria: '', priority: 'medium' });
      fetchData();
    } catch (err) {
      console.error('Failed to add goal:', err);
    }
  };

  const updateGoalStatus = async (goalId: string, newStatus: SessionGoal['status']) => {
    if (!selectedSessionId) return;
    try {
      await api.put('/api/watchdog/session/' + selectedSessionId + '/goals/' + goalId, { status: newStatus });
      fetchData();
    } catch (err) {
      console.error('Failed to update goal:', err);
    }
  };

  const deleteGoal = async (goalId: string) => {
    if (!selectedSessionId) return;
    try {
      await api.delete('/api/watchdog/session/' + selectedSessionId + '/goals/' + goalId);
      fetchData();
    } catch (err) {
      console.error('Failed to delete goal:', err);
    }
  };

  const addRule = async () => {
    if (!newRule.name) return;
    try {
      const rule: WatchdogRule = {
        id: 'custom-' + Date.now(),
        name: newRule.name,
        enabled: newRule.enabled ?? true,
        priority: newRule.priority ?? 50,
        condition: newRule.condition as WatchdogCondition,
        action: newRule.action as WatchdogAction,
      };
      await api.post('/api/watchdog/rules', { rule });
      setShowAddRule(false);
      setNewRule({ name: '', enabled: true, priority: 50, condition: { type: 'tool_match', toolName: 'Bash' }, action: { type: 'approve' } });
      fetchData();
    } catch (err) {
      console.error('Failed to add rule:', err);
    }
  };

  const toggleRule = async (ruleId: string, enabled: boolean) => {
    try {
      await api.post('/api/watchdog/rules/' + ruleId + '/toggle', { enabled });
      fetchData();
    } catch (err) {
      console.error('Failed to toggle rule:', err);
    }
  };

  const deleteRule = async (ruleId: string) => {
    try {
      await api.delete('/api/watchdog/rules/' + ruleId);
      fetchData();
    } catch (err) {
      console.error('Failed to delete rule:', err);
    }
  };

  const saveTelegramConfig = async () => {
    try {
      await api.put('/api/watchdog/telegram', telegramConfig);
      fetchData();
    } catch (err) {
      console.error('Failed to save Telegram config:', err);
    }
  };

  const testTelegram = async () => {
    try {
      await api.post('/api/watchdog/telegram/test');
    } catch (err) {
      console.error('Failed to test Telegram:', err);
    }
  };

  const saveCliConfig = async () => {
    setCliSaving(true);
    try {
      await api.put('/api/watchdog/cli', cliConfig);
      fetchData();
    } catch (err) {
      console.error('Failed to save CLI config:', err);
    } finally {
      setCliSaving(false);
    }
  };

  const restartCli = async () => {
    setCliRestarting(true);
    try {
      await api.post('/api/watchdog/cli/restart');
    } catch (err) {
      console.error('Failed to restart CLI:', err);
    } finally {
      setCliRestarting(false);
    }
  };

  const toggleGoalMonitor = async (goalId: string, autoMonitor: boolean) => {
    if (!selectedSessionId) return;
    setTogglingMonitor(goalId);
    try {
      await api.post('/api/watchdog/session/' + selectedSessionId + '/goals/' + goalId + '/monitor', { autoMonitor });
      fetchData();
    } catch (err) {
      console.error('Failed to toggle goal monitoring:', err);
    } finally {
      setTogglingMonitor(null);
    }
  };

  const sendInstruction = async () => {
    if (!selectedSessionId || !instructionInput.trim()) return;
    setSendingInstruction(true);
    try {
      await api.post('/api/watchdog/session/' + selectedSessionId + '/instruct', {
        message: instructionInput,
        createGoal: true,
      });
      setInstructionInput('');
      fetchData();
    } catch (err) {
      console.error('Failed to send instruction:', err);
    } finally {
      setSendingInstruction(false);
    }
  };

  const saveGoalMonitoringConfig = async () => {
    try {
      await api.put('/api/watchdog/goal-monitoring', goalMonitoringConfig);
      fetchData();
    } catch (err) {
      console.error('Failed to save goal monitoring config:', err);
    }
  };

  const fetchInterMessages = useCallback(async () => {
    try {
      const res = await api.get<WatchdogInterMessage[]>('/api/watchdog/inter-messages?limit=50');
      setInterMessages(res.data);
    } catch {
      // Endpoint may not be available yet
    }
  }, []);

  const fetchActivity = useCallback(async () => {
    try {
      const res = await api.get<SessionActivityEntry[]>('/api/watchdog/activity');
      setActivityEntries(res.data);
    } catch {
      // Endpoint may not be available yet
    }
  }, []);

  // Fetch inter-messages and activity on mount and periodically
  useEffect(() => {
    fetchInterMessages();
    fetchActivity();
    const interval = setInterval(() => {
      fetchInterMessages();
      fetchActivity();
    }, 15000);
    return () => clearInterval(interval);
  }, [fetchInterMessages, fetchActivity]);

  // Listen for real-time inter-instance messages via socket
  useEffect(() => {
    if (!socket) return;
    const handler = (data: WatchdogInterMessage) => {
      setInterMessages(prev => {
        // Avoid duplicates
        if (prev.some(m => m.id === data.id)) return prev;
        return [data, ...prev].slice(0, 100);
      });
    };
    socket.on('watchdog:inter_message' as never, handler as never);
    return () => {
      socket.off('watchdog:inter_message' as never, handler as never);
    };
  }, [socket]);

  const sendToSession = async () => {
    if (!selectedSessionId || !sendToSessionMsg.trim()) return;
    setSendingToSession(true);
    try {
      const res = await api.post<{ success: boolean; response?: string }>('/api/watchdog/send-to-session', {
        sessionId: selectedSessionId,
        message: sendToSessionMsg,
      });
      const interMsg: WatchdogInterMessage = {
        id: 'local-' + Date.now(),
        timestamp: Date.now(),
        from: 'watchdog',
        to: 'session',
        toSessionId: selectedSessionId,
        content: sendToSessionMsg,
        response: res.data.response,
        type: 'guidance',
      };
      setInterMessages(prev => [interMsg, ...prev]);
      setSendToSessionMsg('');
    } catch (err) {
      console.error('Failed to send to session:', err);
    } finally {
      setSendingToSession(false);
    }
  };

  const sendToRalph = async () => {
    if (!sendToRalphRunId || !sendToRalphMsg.trim()) return;
    setSendingToRalph(true);
    try {
      const res = await api.post<{ success: boolean; response?: string }>('/api/watchdog/send-to-ralph', {
        runId: sendToRalphRunId,
        message: sendToRalphMsg,
      });
      const interMsg: WatchdogInterMessage = {
        id: 'local-' + Date.now(),
        timestamp: Date.now(),
        from: 'watchdog',
        to: 'ralph',
        toRunId: sendToRalphRunId,
        content: sendToRalphMsg,
        response: res.data.response,
        type: 'guidance',
      };
      setInterMessages(prev => [interMsg, ...prev]);
      setSendToRalphMsg('');
    } catch (err) {
      console.error('Failed to send to Ralph:', err);
    } finally {
      setSendingToRalph(false);
    }
  };

  const assessSession = async () => {
    if (!selectedSessionId) return;
    setAssessingSession(true);
    setAssessmentResult(null);
    try {
      const res = await api.post<{ success: boolean; assessment?: string }>('/api/watchdog/assess/' + selectedSessionId);
      setAssessmentResult(res.data.assessment || 'No assessment available');
    } catch (err) {
      console.error('Failed to assess session:', err);
      setAssessmentResult('Assessment failed');
    } finally {
      setAssessingSession(false);
    }
  };

  const sendChatMessage = async () => {
    if (!chatInput.trim()) return;
    const userMsg: ChatMsg = {
      id: 'msg-' + Date.now(),
      role: 'user',
      content: chatInput,
      timestamp: Date.now(),
      sessionId: selectedSessionId || undefined,
    };
    setChatMessages(prev => [...prev, userMsg]);
    setChatInput('');
    try {
      const response = await api.post<{ message: string; goals?: SessionGoal[] }>('/api/watchdog/chat', {
        message: chatInput,
        sessionId: selectedSessionId,
        context: {
          sessions: sessions.map(s => ({ id: s.id, name: s.name, status: s.status })),
          monitoredSessions: status?.monitoredSessions || [],
        },
      });
      const botMsg: ChatMsg = {
        id: 'msg-' + Date.now() + '-resp',
        role: 'watchdog',
        content: response.data.message,
        timestamp: Date.now(),
        sessionId: selectedSessionId || undefined,
      };
      setChatMessages(prev => [...prev, botMsg]);
      if (response.data.goals) {
        fetchData();
      }
    } catch (err) {
      const errMsg: ChatMsg = {
        id: 'msg-' + Date.now() + '-err',
        role: 'watchdog',
        content: 'Sorry, I could not process your message. The chat endpoint may not be configured yet.',
        timestamp: Date.now(),
      };
      setChatMessages(prev => [...prev, errMsg]);
    }
  };

  const selectedSession = sessions.find(s => s.id === selectedSessionId);
  const selectedSessionState = status?.monitoredSessions?.find(s => s.sessionId === selectedSessionId) || null;

  const getActionIcon = (action: string) => {
    switch (action) {
      case 'approve': return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'deny': return <XCircle className="h-4 w-4 text-red-500" />;
      case 'pause': return <Pause className="h-4 w-4 text-amber-500" />;
      case 'notify': return <Bell className="h-4 w-4 text-blue-500" />;
      default: return <Activity className="h-4 w-4" />;
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'critical': return 'text-red-500 bg-red-500/10';
      case 'high': return 'text-orange-500 bg-orange-500/10';
      case 'medium': return 'text-yellow-500 bg-yellow-500/10';
      case 'low': return 'text-blue-500 bg-blue-500/10';
      default: return 'text-muted-foreground bg-muted';
    }
  };

  const getStatusColor = (st: string) => {
    switch (st) {
      case 'completed': return 'text-green-500';
      case 'in_progress': return 'text-blue-500';
      case 'failed': return 'text-red-500';
      case 'paused': return 'text-amber-500';
      default: return 'text-muted-foreground';
    }
  };

  const getInterSourceIcon = (source: string) => {
    switch (source) {
      case 'watchdog': return <ShieldCheck className="h-3.5 w-3.5 text-green-500" />;
      case 'session': return <MessageSquare className="h-3.5 w-3.5 text-blue-500" />;
      case 'ralph': return <Bot className="h-3.5 w-3.5 text-purple-500" />;
      default: return <Radio className="h-3.5 w-3.5" />;
    }
  };

  const getInterTypeColor = (type: string) => {
    switch (type) {
      case 'guidance': return 'bg-blue-500/10 text-blue-500';
      case 'query': return 'bg-amber-500/10 text-amber-500';
      case 'response': return 'bg-green-500/10 text-green-500';
      case 'alert': return 'bg-red-500/10 text-red-500';
      case 'status': return 'bg-muted text-muted-foreground';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  const getActivityTypeIcon = (type: string) => {
    switch (type) {
      case 'message': return <MessageSquare className="h-3.5 w-3.5 text-blue-400" />;
      case 'tool': return <Zap className="h-3.5 w-3.5 text-amber-400" />;
      case 'error': return <AlertTriangle className="h-3.5 w-3.5 text-red-400" />;
      case 'status': return <Activity className="h-3.5 w-3.5 text-muted-foreground" />;
      default: return <Activity className="h-3.5 w-3.5" />;
    }
  };

  const ralphRuns = Object.values(useRalphStore((s) => s.runs));

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          <span className="text-sm text-muted-foreground">Loading Watchdog...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="container max-w-7xl py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {config?.enabled ? (
            <ShieldCheck className="h-8 w-8 text-green-500" />
          ) : (
            <ShieldOff className="h-8 w-8 text-muted-foreground" />
          )}
          <div>
            <h1 className="text-2xl font-bold">Watchdog</h1>
            <p className="text-sm text-muted-foreground">
              Autonomous session monitoring &amp; permission handling
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Label className="text-sm">Profile</Label>
            <Select
              value={config?.autonomousProfile || status?.autonomousProfile || 'balanced'}
              onValueChange={(value) => updateAutonomousProfile(value as 'balanced' | 'aggressive')}
            >
              <SelectTrigger className="w-[140px] h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="balanced">Balanced</SelectItem>
                <SelectItem value="aggressive">Aggressive</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="wd-toggle" className="text-sm">
              {config?.enabled ? 'Active' : 'Inactive'}
            </Label>
            <Switch id="wd-toggle" checked={config?.enabled ?? false} onCheckedChange={toggleWatchdog} />
          </div>
          <Button variant="outline" size="sm" onClick={fetchData}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10"><Eye className="h-5 w-5 text-blue-500" /></div>
              <div>
                <p className="text-2xl font-bold">{status?.monitoredSessions?.length || 0}</p>
                <p className="text-xs text-muted-foreground">Monitored</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/10"><Zap className="h-5 w-5 text-green-500" /></div>
              <div>
                <p className="text-2xl font-bold">{status?.activeRules || 0}</p>
                <p className="text-xs text-muted-foreground">Rules</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-500/10"><Activity className="h-5 w-5 text-purple-500" /></div>
              <div>
                <p className="text-2xl font-bold">{status?.decisionsToday || 0}</p>
                <p className="text-xs text-muted-foreground">Decisions</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className={cn("p-2 rounded-lg", status?.telegramConnected ? "bg-green-500/10" : "bg-muted")}>
                <Bell className={cn("h-5 w-5", status?.telegramConnected ? "text-green-500" : "text-muted-foreground")} />
              </div>
              <div>
                <p className="text-2xl font-bold">{status?.telegramConnected ? 'Connected' : 'Offline'}</p>
                <p className="text-xs text-muted-foreground">Telegram</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Session List */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              Sessions
            </CardTitle>
            <CardDescription>Select sessions to monitor</CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[400px]">
              <div className="space-y-2">
                {sessions.map((session) => {
                  const sessionState = status?.monitoredSessions?.find(s => s.sessionId === session.id);
                  const isMonitored = sessionState?.monitored ?? false;
                  const isSelected = selectedSessionId === session.id;
                  return (
                    <div
                      key={session.id}
                      className={cn(
                        "flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors",
                        isSelected ? "bg-primary/5 border-primary/30" : "hover:bg-muted/50",
                        isMonitored && !isSelected && "border-green-500/30"
                      )}
                      onClick={() => setSelectedSessionId(session.id)}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="relative">
                          <MessageSquare className="h-4 w-4 text-muted-foreground" />
                          {isMonitored && (
                            <div className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-green-500" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{session.name}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {session.workingDirectory.split('/').pop()}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {sessionState?.goals && sessionState.goals.length > 0 && (
                          <Badge variant="outline" className="text-xs">
                            {sessionState.goals.length} goals
                          </Badge>
                        )}
                        <Switch
                          checked={isMonitored}
                          onCheckedChange={(checked) => toggleSessionMonitoring(session.id, checked)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                    </div>
                  );
                })}
                {sessions.length === 0 && (
                  <p className="text-center text-sm text-muted-foreground py-8">No sessions available</p>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Main Content */}
        <Card className="lg:col-span-2">
          <Tabs defaultValue="chat" className="h-full">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <TabsList>
                  <TabsTrigger value="chat" className="gap-2"><Bot className="h-4 w-4" />Chat</TabsTrigger>
                  <TabsTrigger value="goals" className="gap-2"><Target className="h-4 w-4" />Goals</TabsTrigger>
                  <TabsTrigger value="rules" className="gap-2"><Zap className="h-4 w-4" />Rules</TabsTrigger>
                  <TabsTrigger value="telegram" className="gap-2"><Bell className="h-4 w-4" />Telegram</TabsTrigger>
                  <TabsTrigger value="log" className="gap-2"><Clock className="h-4 w-4" />Log</TabsTrigger>
                  <TabsTrigger value="ralph" className="gap-2"><Bot className="h-4 w-4" />Ralph</TabsTrigger>
                  <TabsTrigger value="comms" className="gap-2"><Radio className="h-4 w-4" />Comms</TabsTrigger>
                  <TabsTrigger value="settings" className="gap-2"><Settings2 className="h-4 w-4" />Settings</TabsTrigger>
                </TabsList>
                {selectedSession && <Badge variant="outline">{selectedSession.name}</Badge>}
              </div>
            </CardHeader>

            <CardContent className="pt-0">
              {/* ===== CHAT TAB ===== */}
              <TabsContent value="chat" className="mt-0 h-[450px] flex flex-col">
                <div className="flex-1 flex flex-col">
                  <ScrollArea className="flex-1 pr-4" ref={chatScrollRef}>
                    <div className="space-y-4 pb-4">
                      {chatMessages.length === 0 ? (
                        <div className="text-center py-12">
                          <Bot className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                          <p className="text-muted-foreground">
                            Chat with the Watchdog to define goals and discuss session objectives
                          </p>
                          <p className="text-xs text-muted-foreground mt-2">
                            {selectedSession
                              ? 'Currently discussing: ' + selectedSession.name
                              : 'Select a session or discuss global settings'}
                          </p>
                        </div>
                      ) : (
                        chatMessages.map((msg) => (
                          <div
                            key={msg.id}
                            className={cn("flex gap-3", msg.role === 'user' ? "justify-end" : "justify-start")}
                          >
                            {msg.role === 'watchdog' && (
                              <div className="shrink-0 h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                                <Bot className="h-4 w-4 text-primary" />
                              </div>
                            )}
                            <div className={cn(
                              "max-w-[80%] rounded-lg px-4 py-2",
                              msg.role === 'user' ? "bg-primary text-primary-foreground" : "bg-muted"
                            )}>
                              <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                              <p className="text-[10px] opacity-50 mt-1">
                                {new Date(msg.timestamp).toLocaleTimeString()}
                              </p>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </ScrollArea>
                  <Separator className="my-3" />
                  {/* Instruction input for sending goals to session */}
                  {selectedSessionId && (
                    <div className="mb-2 flex gap-2">
                      <Input
                        placeholder={'Instruct session: "Implement X..." (creates goal + monitors)'}
                        value={instructionInput}
                        onChange={(e) => setInstructionInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            sendInstruction();
                          }
                        }}
                        className="border-green-500/30 focus-visible:ring-green-500/30"
                      />
                      <Button
                        onClick={sendInstruction}
                        disabled={!instructionInput.trim() || sendingInstruction}
                        variant="default"
                        className="shrink-0"
                      >
                        <Target className="h-4 w-4 mr-1" />
                        {sendingInstruction ? '...' : 'Instruct'}
                      </Button>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Input
                      placeholder={selectedSession
                        ? 'Discuss goals for ' + selectedSession.name + '...'
                        : 'Ask the Watchdog anything...'}
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          sendChatMessage();
                        }
                      }}
                    />
                    <Button onClick={sendChatMessage} disabled={!chatInput.trim()}>
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </TabsContent>

              {/* ===== GOALS TAB ===== */}
              <TabsContent value="goals" className="mt-0 h-[450px]">
                {selectedSessionId ? (
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <p className="text-sm text-muted-foreground">
                        Goals for {selectedSession?.name}
                      </p>
                      <Dialog open={showAddGoal} onOpenChange={setShowAddGoal}>
                        <DialogTrigger asChild>
                          <Button size="sm"><Plus className="h-4 w-4 mr-1" />Add Goal</Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Add Session Goal</DialogTitle>
                            <DialogDescription>Define what the Watchdog should help achieve</DialogDescription>
                          </DialogHeader>
                          <div className="space-y-4 py-4">
                            <div className="space-y-2">
                              <Label>Goal Description</Label>
                              <Textarea
                                value={newGoal.description}
                                onChange={(e) => setNewGoal({ ...newGoal, description: e.target.value })}
                                placeholder="What should be accomplished?"
                                rows={3}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>Constraints (optional)</Label>
                              <Textarea
                                value={newGoal.constraints}
                                onChange={(e) => setNewGoal({ ...newGoal, constraints: e.target.value })}
                                placeholder="What should NOT happen?"
                                rows={2}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>Success Criteria (optional)</Label>
                              <Textarea
                                value={newGoal.successCriteria}
                                onChange={(e) => setNewGoal({ ...newGoal, successCriteria: e.target.value })}
                                placeholder="How to know when done?"
                                rows={2}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>Priority</Label>
                              <Select
                                value={newGoal.priority}
                                onValueChange={(v) => setNewGoal({ ...newGoal, priority: v as 'low' | 'medium' | 'high' | 'critical' })}
                              >
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="low">Low</SelectItem>
                                  <SelectItem value="medium">Medium</SelectItem>
                                  <SelectItem value="high">High</SelectItem>
                                  <SelectItem value="critical">Critical</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                          <DialogFooter>
                            <Button variant="outline" onClick={() => setShowAddGoal(false)}>Cancel</Button>
                            <Button onClick={addGoal} disabled={!newGoal.description}>Add Goal</Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    </div>
                    <ScrollArea className="h-[380px]">
                      <div className="space-y-3">
                        {selectedSessionState?.goals?.map((goal) => (
                          <div key={goal.id} className={cn(
                            "p-4 rounded-lg border bg-card space-y-3",
                            goal.autoMonitor && (goal.status === 'in_progress' || goal.status === 'pending') && "border-green-500/40"
                          )}>
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  {goal.autoMonitor && (goal.status === 'in_progress' || goal.status === 'pending') && (
                                    <span className="relative flex h-2.5 w-2.5">
                                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
                                    </span>
                                  )}
                                  <Badge className={getPriorityColor(goal.priority)}>{goal.priority}</Badge>
                                  <span className={cn("text-sm font-medium", getStatusColor(goal.status))}>
                                    {goal.status.replace('_', ' ')}
                                  </span>
                                  {goal.autoMonitor && (
                                    <Badge variant="outline" className="text-[10px] border-green-500/30 text-green-500">
                                      <Eye className="h-2.5 w-2.5 mr-0.5" />monitoring
                                    </Badge>
                                  )}
                                </div>
                                <p className="text-sm">{goal.description}</p>
                                {goal.constraints && (
                                  <p className="text-xs text-muted-foreground mt-1">
                                    <AlertTriangle className="inline h-3 w-3 mr-1" />
                                    {goal.constraints}
                                  </p>
                                )}
                              </div>
                              <div className="flex items-center gap-1">
                                <Button
                                  variant={goal.autoMonitor ? "default" : "outline"}
                                  size="sm"
                                  className="h-8 text-xs"
                                  disabled={togglingMonitor === goal.id || goal.status === 'completed' || goal.status === 'failed'}
                                  onClick={() => toggleGoalMonitor(goal.id, !goal.autoMonitor)}
                                >
                                  <Eye className="h-3 w-3 mr-1" />
                                  {togglingMonitor === goal.id ? '...' : goal.autoMonitor ? 'Stop' : 'Monitor'}
                                </Button>
                                <Select
                                  value={goal.status}
                                  onValueChange={(v) => updateGoalStatus(goal.id, v as SessionGoal['status'])}
                                >
                                  <SelectTrigger className="h-8 w-[120px]"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="pending">Pending</SelectItem>
                                    <SelectItem value="in_progress">In Progress</SelectItem>
                                    <SelectItem value="completed">Completed</SelectItem>
                                    <SelectItem value="failed">Failed</SelectItem>
                                    <SelectItem value="paused">Paused</SelectItem>
                                  </SelectContent>
                                </Select>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => deleteGoal(goal.id)}>
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                            {/* Iteration counter */}
                            {goal.autoMonitor && (
                              <div className="flex items-center gap-3 text-xs">
                                <div className="flex items-center gap-1.5 text-muted-foreground">
                                  <RotateCcw className="h-3 w-3" />
                                  <span>Iterations: {goal.iterationCount}/{goal.maxIterations || 20}</span>
                                </div>
                                {goal.iterationCount > 0 && goal.maxIterations && (
                                  <Progress value={(goal.iterationCount / goal.maxIterations) * 100} className="h-1 flex-1 max-w-[120px]" />
                                )}
                              </div>
                            )}
                            {goal.progress !== undefined && (
                              <div className="space-y-1">
                                <div className="flex justify-between text-xs">
                                  <span>Progress</span>
                                  <span>{goal.progress}%</span>
                                </div>
                                <Progress value={goal.progress} className="h-1.5" />
                              </div>
                            )}
                            {/* Last evaluation */}
                            {goal.lastEvaluation && (
                              <div className="text-xs bg-muted/50 p-2 rounded space-y-1">
                                <div className="flex items-center justify-between">
                                  <span className="font-medium flex items-center gap-1">
                                    <Bot className="h-3 w-3" />Last Evaluation
                                  </span>
                                  {goal.lastEvaluationAt && (
                                    <span className="text-muted-foreground">
                                      {new Date(goal.lastEvaluationAt).toLocaleTimeString()}
                                    </span>
                                  )}
                                </div>
                                <p className="text-muted-foreground whitespace-pre-wrap">{goal.lastEvaluation}</p>
                              </div>
                            )}
                            {goal.notes && !goal.lastEvaluation && (
                              <p className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">
                                <Bot className="inline h-3 w-3 mr-1" />{goal.notes}
                              </p>
                            )}
                          </div>
                        ))}
                        {(!selectedSessionState?.goals || selectedSessionState.goals.length === 0) && (
                          <div className="text-center py-12 text-muted-foreground">
                            <Target className="h-12 w-12 mx-auto opacity-50 mb-4" />
                            <p>No goals defined for this session</p>
                            <p className="text-xs mt-1">Add a goal or chat with the Watchdog</p>
                          </div>
                        )}
                      </div>
                    </ScrollArea>
                  </div>
                ) : (
                  <div className="h-full flex items-center justify-center text-muted-foreground">
                    <div className="text-center">
                      <ChevronRight className="h-12 w-12 mx-auto opacity-50 mb-4" />
                      <p>Select a session to manage goals</p>
                    </div>
                  </div>
                )}
              </TabsContent>

              {/* ===== RULES TAB ===== */}
              <TabsContent value="rules" className="mt-0 h-[450px]">
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <p className="text-sm text-muted-foreground">
                      {config?.rules.filter(r => r.enabled).length || 0} active rules
                    </p>
                    <Dialog open={showAddRule} onOpenChange={setShowAddRule}>
                      <DialogTrigger asChild>
                        <Button size="sm"><Plus className="h-4 w-4 mr-1" />Add Rule</Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Add Watchdog Rule</DialogTitle>
                          <DialogDescription>Create a rule to automatically handle permission requests</DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                          <div className="space-y-2">
                            <Label>Rule Name</Label>
                            <Input value={newRule.name || ''} onChange={(e) => setNewRule({ ...newRule, name: e.target.value })} placeholder="e.g., Auto-approve npm install" />
                          </div>
                          <div className="space-y-2">
                            <Label>Condition</Label>
                            <Select
                              value={(newRule.condition as WatchdogCondition)?.type || 'tool_match'}
                              onValueChange={(value) => {
                                const t = value as WatchdogCondition['type'];
                                if (t === 'tool_match') setNewRule({ ...newRule, condition: { type: t, toolName: 'Bash' } });
                                else if (t === 'tool_any') setNewRule({ ...newRule, condition: { type: t } });
                                else if (t === 'error_count') setNewRule({ ...newRule, condition: { type: t, threshold: 5, windowMinutes: 10 } });
                                else if (t === 'always') setNewRule({ ...newRule, condition: { type: t } });
                              }}
                            >
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="tool_match">Match tool</SelectItem>
                                <SelectItem value="tool_any">Any tool</SelectItem>
                                <SelectItem value="error_count">Error threshold</SelectItem>
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
                                  onValueChange={(v) => setNewRule({ ...newRule, condition: { ...(newRule.condition as { type: 'tool_match'; toolName: string }), toolName: v } })}
                                >
                                  <SelectTrigger><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    {TOOL_NAMES.map((tool) => (<SelectItem key={tool} value={tool}>{tool}</SelectItem>))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-2">
                                <Label>Pattern (optional)</Label>
                                <Input
                                  value={(newRule.condition as { pattern?: string })?.pattern || ''}
                                  onChange={(e) => setNewRule({ ...newRule, condition: { ...(newRule.condition as { type: 'tool_match'; toolName: string }), pattern: e.target.value || undefined } })}
                                  placeholder="e.g., git:* or npm install:*"
                                />
                              </div>
                            </>
                          )}
                          <div className="space-y-2">
                            <Label>Action</Label>
                            <Select
                              value={(newRule.action as WatchdogAction)?.type || 'approve'}
                              onValueChange={(value) => {
                                const t = value as WatchdogAction['type'];
                                if (t === 'approve') setNewRule({ ...newRule, action: { type: t } });
                                else if (t === 'deny') setNewRule({ ...newRule, action: { type: t, reason: 'Blocked by watchdog' } });
                                else if (t === 'pause') setNewRule({ ...newRule, action: { type: t, reason: 'Session paused' } });
                                else if (t === 'notify') setNewRule({ ...newRule, action: { type: t } });
                              }}
                            >
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="approve">Approve</SelectItem>
                                <SelectItem value="deny">Deny</SelectItem>
                                <SelectItem value="pause">Pause</SelectItem>
                                <SelectItem value="notify">Notify</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label>Priority (lower = higher)</Label>
                            <Input type="number" value={newRule.priority || 50} onChange={(e) => setNewRule({ ...newRule, priority: parseInt(e.target.value, 10) })} min={1} max={100} />
                          </div>
                        </div>
                        <DialogFooter>
                          <Button variant="outline" onClick={() => setShowAddRule(false)}>Cancel</Button>
                          <Button onClick={addRule} disabled={!newRule.name}>Add Rule</Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </div>
                  <ScrollArea className="h-[380px]">
                    <div className="space-y-2">
                      {config?.rules.map((rule) => (
                        <div key={rule.id} className={cn('flex items-center justify-between p-3 rounded-lg border', rule.enabled ? 'bg-card' : 'bg-muted/50 opacity-60')}>
                          <div className="flex items-center gap-3">
                            {getActionIcon(rule.action.type)}
                            <div>
                              <p className="text-sm font-medium">{rule.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {rule.condition.type === 'tool_match'
                                  ? (rule.condition as { toolName: string }).toolName + ((rule.condition as { pattern?: string }).pattern ? '(' + (rule.condition as { pattern?: string }).pattern + ')' : '')
                                  : rule.condition.type
                                }
                                {' -> '}{rule.action.type}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">P{rule.priority}</Badge>
                            <Switch checked={rule.enabled} onCheckedChange={(c) => toggleRule(rule.id, c)} />
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => deleteRule(rule.id)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              </TabsContent>

              {/* ===== TELEGRAM TAB ===== */}
              <TabsContent value="telegram" className="mt-0 h-[450px]">
                <ScrollArea className="h-full">
                  <div className="space-y-6 pr-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-lg font-medium">Telegram Integration</h3>
                        <p className="text-sm text-muted-foreground">Get notified about session activity</p>
                      </div>
                      <Switch checked={telegramConfig.enabled} onCheckedChange={(c) => setTelegramConfig({ ...telegramConfig, enabled: c })} />
                    </div>
                    <Separator />
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label>Bot Token</Label>
                        <Input type="password" value={telegramConfig.botToken} onChange={(e) => setTelegramConfig({ ...telegramConfig, botToken: e.target.value })} placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz" />
                        <p className="text-xs text-muted-foreground">Create a bot via @BotFather on Telegram</p>
                      </div>
                      <div className="space-y-2">
                        <Label>Chat ID</Label>
                        <Input value={telegramConfig.chatId} onChange={(e) => setTelegramConfig({ ...telegramConfig, chatId: e.target.value })} placeholder="123456789" />
                        <p className="text-xs text-muted-foreground">Use @userinfobot to get your Chat ID</p>
                      </div>
                      <Separator />
                      <h4 className="text-sm font-medium">Notifications</h4>
                      <div className="space-y-3">
                        {([
                          ['notifyOnApprove', 'Auto-approve events'],
                          ['notifyOnDeny', 'Deny events'],
                          ['notifyOnPause', 'Session paused'],
                          ['notifyOnError', 'Errors'],
                          ['notifyOnGoalProgress', 'Goal progress'],
                        ] as const).map(([key, label]) => (
                          <div key={key} className="flex items-center justify-between">
                            <Label className="font-normal">{label}</Label>
                            <Switch checked={telegramConfig[key]} onCheckedChange={(c) => setTelegramConfig({ ...telegramConfig, [key]: c })} />
                          </div>
                        ))}
                      </div>
                      <Separator />
                      <div className="flex gap-2">
                        <Button onClick={saveTelegramConfig} className="flex-1">Save Configuration</Button>
                        <Button variant="outline" onClick={testTelegram} disabled={!telegramConfig.botToken || !telegramConfig.chatId}>Test</Button>
                      </div>
                    </div>
                  </div>
                </ScrollArea>
              </TabsContent>

              {/* ===== LOG TAB ===== */}
              <TabsContent value="log" className="mt-0 h-[450px]">
                <ScrollArea className="h-full">
                  <div className="space-y-2 pr-4">
                    {decisions.map((decision) => (
                      <div key={decision.id} className="flex items-start gap-3 p-3 rounded-lg border bg-card">
                        {getActionIcon(decision.action)}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-medium">{decision.toolName}</p>
                            <Badge variant={decision.automatic ? 'secondary' : 'outline'} className="text-xs">
                              {decision.automatic ? 'Auto' : 'Manual'}
                            </Badge>
                            <Badge variant="outline" className="text-xs">{decision.action}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground truncate mt-1">{decision.reason}</p>
                          <p className="text-xs text-muted-foreground">{new Date(decision.timestamp).toLocaleString()}</p>
                        </div>
                      </div>
                    ))}
                    {decisions.length === 0 && (
                      <div className="text-center py-12 text-muted-foreground">
                        <Activity className="h-12 w-12 mx-auto opacity-50 mb-4" />
                        <p>No decisions recorded</p>
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>

              {/* ===== RALPH TAB ===== */}
              <TabsContent value="ralph" className="mt-0 h-[450px]">
                <RalphTab selectedSessionId={selectedSessionId} />
              </TabsContent>

              {/* ===== COMMS TAB ===== */}
              <TabsContent value="comms" className="mt-0 h-[450px]">
                <div className="flex flex-col h-full gap-3">
                  {/* Actions bar */}
                  <div className="flex gap-2 flex-wrap">
                    {selectedSessionId && (
                      <>
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button size="sm" variant="outline">
                              <Send className="h-3.5 w-3.5 mr-1.5" />Send to Session
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>Send Guidance to Session</DialogTitle>
                              <DialogDescription>
                                The Watchdog will inject a message into {selectedSession?.name || selectedSessionId}
                              </DialogDescription>
                            </DialogHeader>
                            <div className="space-y-4 py-4">
                              <Textarea
                                value={sendToSessionMsg}
                                onChange={(e) => setSendToSessionMsg(e.target.value)}
                                placeholder="Instructions or guidance for the session..."
                                rows={4}
                              />
                            </div>
                            <DialogFooter>
                              <Button
                                onClick={sendToSession}
                                disabled={sendingToSession || !sendToSessionMsg.trim()}
                              >
                                {sendingToSession ? 'Sending...' : 'Send'}
                              </Button>
                            </DialogFooter>
                          </DialogContent>
                        </Dialog>

                        <Button
                          size="sm"
                          variant="outline"
                          onClick={assessSession}
                          disabled={assessingSession}
                        >
                          <Search className="h-3.5 w-3.5 mr-1.5" />
                          {assessingSession ? 'Assessing...' : 'Assess Session'}
                        </Button>
                      </>
                    )}

                    {ralphRuns.length > 0 && (
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button size="sm" variant="outline">
                            <Bot className="h-3.5 w-3.5 mr-1.5" />Guide Ralph
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Send Guidance to Ralph</DialogTitle>
                            <DialogDescription>Inject guidance into an active Ralph run</DialogDescription>
                          </DialogHeader>
                          <div className="space-y-4 py-4">
                            <div className="space-y-2">
                              <Label>Ralph Run</Label>
                              <Select
                                value={sendToRalphRunId}
                                onValueChange={setSendToRalphRunId}
                              >
                                <SelectTrigger><SelectValue placeholder="Select a run" /></SelectTrigger>
                                <SelectContent>
                                  {ralphRuns.map((run) => (
                                    <SelectItem key={run.id} value={run.id}>
                                      {run.idea?.substring(0, 40) || run.id} ({run.status})
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <Textarea
                              value={sendToRalphMsg}
                              onChange={(e) => setSendToRalphMsg(e.target.value)}
                              placeholder="Guidance for Ralph..."
                              rows={4}
                            />
                          </div>
                          <DialogFooter>
                            <Button
                              onClick={sendToRalph}
                              disabled={sendingToRalph || !sendToRalphRunId || !sendToRalphMsg.trim()}
                            >
                              {sendingToRalph ? 'Sending...' : 'Send'}
                            </Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    )}

                    <Button size="sm" variant="ghost" onClick={() => { fetchInterMessages(); fetchActivity(); }}>
                      <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  {/* Assessment result */}
                  {assessmentResult && (
                    <div className="p-3 rounded-lg border bg-primary/5 text-sm">
                      <div className="flex items-center gap-2 mb-1 text-xs font-medium text-primary">
                        <Search className="h-3.5 w-3.5" />Assessment Result
                      </div>
                      <p className="whitespace-pre-wrap text-muted-foreground">{assessmentResult}</p>
                    </div>
                  )}

                  {/* Inter-instance message log */}
                  <ScrollArea className="flex-1">
                    <div className="space-y-2 pr-4">
                      {interMessages.length === 0 && activityEntries.length === 0 ? (
                        <div className="text-center py-12 text-muted-foreground">
                          <Radio className="h-12 w-12 mx-auto opacity-50 mb-4" />
                          <p>No inter-instance communications yet</p>
                          <p className="text-xs mt-1">Messages between Watchdog, Sessions, and Ralph appear here</p>
                        </div>
                      ) : (
                        <>
                          {/* Inter-instance messages */}
                          {interMessages.map((msg) => (
                            <div key={msg.id} className="p-3 rounded-lg border bg-card">
                              <div className="flex items-center gap-2 mb-1.5">
                                <div className="flex items-center gap-1">
                                  {getInterSourceIcon(msg.from)}
                                  <span className="text-xs font-medium capitalize">{msg.from}</span>
                                  {msg.fromSessionId && (
                                    <span className="text-[10px] text-muted-foreground">{msg.fromSessionId.substring(0, 8)}</span>
                                  )}
                                </div>
                                <ArrowRight className="h-3 w-3 text-muted-foreground" />
                                <div className="flex items-center gap-1">
                                  {getInterSourceIcon(msg.to)}
                                  <span className="text-xs font-medium capitalize">{msg.to}</span>
                                  {msg.toSessionId && (
                                    <span className="text-[10px] text-muted-foreground">{msg.toSessionId.substring(0, 8)}</span>
                                  )}
                                  {msg.toRunId && (
                                    <span className="text-[10px] text-muted-foreground">run:{msg.toRunId.substring(0, 8)}</span>
                                  )}
                                </div>
                                <Badge className={cn('ml-auto', getInterTypeColor(msg.type))}>{msg.type}</Badge>
                              </div>
                              <p className="text-sm">{msg.content}</p>
                              {msg.response && (
                                <div className="mt-2 pl-3 border-l-2 border-primary/30">
                                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground mb-0.5">
                                    <ArrowLeft className="h-3 w-3" />Response
                                  </div>
                                  <p className="text-sm text-muted-foreground">{msg.response}</p>
                                </div>
                              )}
                              <p className="text-[10px] text-muted-foreground mt-1.5">
                                {new Date(msg.timestamp).toLocaleString()}
                              </p>
                            </div>
                          ))}

                          {/* Activity entries (if any and no inter-messages dominate) */}
                          {activityEntries.length > 0 && (
                            <>
                              <Separator className="my-2" />
                              <p className="text-xs font-medium text-muted-foreground px-1">Session Activity</p>
                              {activityEntries.slice(0, 30).map((entry, i) => (
                                <div key={`activity-${i}`} className="flex items-start gap-2 p-2 rounded border bg-muted/30 text-sm">
                                  {getActivityTypeIcon(entry.type)}
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs truncate">{entry.summary}</p>
                                    <p className="text-[10px] text-muted-foreground">
                                      {sessions.find(s => s.id === entry.sessionId)?.name || entry.sessionId.substring(0, 8)}
                                      {' · '}{new Date(entry.timestamp).toLocaleTimeString()}
                                    </p>
                                  </div>
                                </div>
                              ))}
                            </>
                          )}
                        </>
                      )}
                    </div>
                  </ScrollArea>
                </div>
              </TabsContent>

              {/* ===== SETTINGS TAB ===== */}
              <TabsContent value="settings" className="mt-0 h-[450px]">
                <ScrollArea className="h-full">
                  <div className="space-y-6 pr-4">
                    {/* CLI Backend Section */}
                    <div>
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <Cpu className="h-5 w-5 text-primary" />
                          <div>
                            <h3 className="text-lg font-medium">CLI Backend</h3>
                            <p className="text-sm text-muted-foreground">Use a Claude Code CLI for AI-powered decisions</p>
                          </div>
                        </div>
                        <Switch
                          checked={cliConfig.enabled}
                          onCheckedChange={(c) => setCliConfig({ ...cliConfig, enabled: c })}
                        />
                      </div>
                      <Separator className="mb-4" />

                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label>CLI Provider</Label>
                          <Select
                            value={cliConfig.cliProvider}
                            onValueChange={(v) => {
                              setCliConfig({ ...cliConfig, cliProvider: v, model: undefined });
                              fetchCliModels(v);
                            }}
                          >
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {cliProviders.length > 0 ? (
                                cliProviders.map((p) => (
                                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                                ))
                              ) : (
                                <SelectItem value="claude">Claude</SelectItem>
                              )}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <Label>Model (optional)</Label>
                          {cliModels.length > 0 ? (
                            <Select
                              value={cliConfig.model || ''}
                              onValueChange={(v) => setCliConfig({ ...cliConfig, model: v || undefined })}
                            >
                              <SelectTrigger><SelectValue placeholder="Default model" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="">Default</SelectItem>
                                {cliModels.map((m) => (
                                  <SelectItem key={m} value={m}>{m}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Input
                              value={cliConfig.model || ''}
                              onChange={(e) => setCliConfig({ ...cliConfig, model: e.target.value || undefined })}
                              placeholder="e.g. claude-sonnet-4-5-20250929"
                            />
                          )}
                        </div>

                        <Separator />

                        <div className="flex items-center justify-between">
                          <div>
                            <Label className="font-normal">Use for permission decisions</Label>
                            <p className="text-xs text-muted-foreground">Consult CLI when rules are undecided</p>
                          </div>
                          <Switch
                            checked={cliConfig.useForPermissions}
                            onCheckedChange={(c) => setCliConfig({ ...cliConfig, useForPermissions: c })}
                          />
                        </div>

                        <div className="flex items-center justify-between">
                          <div>
                            <Label className="font-normal">Use for chat responses</Label>
                            <p className="text-xs text-muted-foreground">AI-powered chat instead of pattern matching</p>
                          </div>
                          <Switch
                            checked={cliConfig.useForChat}
                            onCheckedChange={(c) => setCliConfig({ ...cliConfig, useForChat: c })}
                          />
                        </div>

                        <div className="space-y-2">
                          <Label>Permission Timeout (ms)</Label>
                          <Input
                            type="number"
                            value={cliConfig.permissionTimeoutMs || 30000}
                            onChange={(e) => setCliConfig({ ...cliConfig, permissionTimeoutMs: parseInt(e.target.value, 10) || 30000 })}
                            min={5000}
                            max={120000}
                          />
                          <p className="text-xs text-muted-foreground">Timeout for CLI permission evaluation (default: 30s)</p>
                        </div>

                        <Separator />

                        <div className="flex gap-2">
                          <Button onClick={saveCliConfig} disabled={cliSaving} className="flex-1">
                            {cliSaving ? 'Saving...' : 'Save CLI Config'}
                          </Button>
                          <Button
                            variant="outline"
                            onClick={restartCli}
                            disabled={cliRestarting || !cliConfig.enabled}
                          >
                            <RotateCcw className={cn("h-4 w-4 mr-2", cliRestarting && "animate-spin")} />
                            {cliRestarting ? 'Restarting...' : 'Restart'}
                          </Button>
                        </div>

                        {!cliConfig.enabled && (
                          <p className="text-xs text-muted-foreground text-center">
                            Enable the CLI backend to use AI-powered permission decisions and chat.
                            The Watchdog will continue using static rules when CLI is disabled.
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Goal Monitoring Section */}
                    <div>
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <Target className="h-5 w-5 text-primary" />
                          <div>
                            <h3 className="text-lg font-medium">Goal Monitoring</h3>
                            <p className="text-sm text-muted-foreground">Active monitoring loop for session goals</p>
                          </div>
                        </div>
                        <Switch
                          checked={goalMonitoringConfig.enabled}
                          onCheckedChange={(c) => setGoalMonitoringConfig({ ...goalMonitoringConfig, enabled: c })}
                        />
                      </div>
                      <Separator className="mb-4" />

                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <Label className="font-normal">Auto-detect goals from session messages</Label>
                            <p className="text-xs text-muted-foreground">Watchdog CLI analyzes user messages in monitored sessions to detect new goals</p>
                          </div>
                          <Switch
                            checked={goalMonitoringConfig.autoCreateFromSession}
                            onCheckedChange={(c) => setGoalMonitoringConfig({ ...goalMonitoringConfig, autoCreateFromSession: c })}
                          />
                        </div>

                        <div className="space-y-2">
                          <Label>Max iterations per goal</Label>
                          <Input
                            type="number"
                            value={goalMonitoringConfig.maxIterationsPerGoal}
                            onChange={(e) => setGoalMonitoringConfig({ ...goalMonitoringConfig, maxIterationsPerGoal: parseInt(e.target.value, 10) || 20 })}
                            min={1}
                            max={100}
                          />
                          <p className="text-xs text-muted-foreground">Safety limit to prevent infinite loops (default: 20)</p>
                        </div>

                        <div className="space-y-2">
                          <Label>Evaluation delay (ms)</Label>
                          <Input
                            type="number"
                            value={goalMonitoringConfig.evaluationDelayMs}
                            onChange={(e) => setGoalMonitoringConfig({ ...goalMonitoringConfig, evaluationDelayMs: parseInt(e.target.value, 10) || 3000 })}
                            min={1000}
                            max={30000}
                            step={1000}
                          />
                          <p className="text-xs text-muted-foreground">Wait time after session turn completes before evaluating (default: 3000ms)</p>
                        </div>

                        <Separator />

                        <Button onClick={saveGoalMonitoringConfig} className="w-full">
                          Save Goal Monitoring Config
                        </Button>

                        {!cliConfig.enabled && goalMonitoringConfig.enabled && (
                          <p className="text-xs text-amber-500 text-center">
                            <AlertTriangle className="inline h-3 w-3 mr-1" />
                            Goal monitoring requires the CLI backend to be enabled for AI-powered evaluations.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </ScrollArea>
              </TabsContent>
            </CardContent>
          </Tabs>
        </Card>
      </div>
    </div>
  );
}

export default WatchdogPage;
