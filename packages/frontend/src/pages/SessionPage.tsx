import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, MoreHorizontal, FolderOpen, Image, CheckCircle2, Brain, Wrench, FileText, Terminal, Search, Edit3, Globe, ListTodo, Circle, CheckCircle, Loader2, GitBranch, MessageSquare, Code2, Star, History, FolderKey, FileCode, File as FileIcon, Check, Bot } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { StreamingContent } from '@/components/chat/StreamingContent';
import { SessionControls } from '@/components/session/SessionControls';
import { FileTree } from '@/components/file-tree';
import { GitPanel } from '@/components/git-panel';
import { CheckpointsPanel } from '@/components/session/CheckpointsPanel';
import { AllowedDirectoriesDialog, DirectoryAccessPrompt } from '@/components/session/AllowedDirectoriesDialog';
import { PermissionRequestCard } from '@/components/session/PermissionRequestCard';
import { EditorPanel } from '@/components/code-editor';
import { WebPreview } from '@/components/preview';
import { AgentsEditor } from '@/components/agents-editor';
import { MemoryViewer } from '@/components/memory-viewer';
import { ToolLogPanel } from '@/components/session/ToolLogPanel';
import { CompactBoundaryCard } from '@/components/chat/CompactBoundaryCard';
import { ToolDetailDialog } from '@/components/session/ToolDetailDialog';
import { useSessionStore } from '@/stores/sessionStore';
import { useAuthStore } from '@/stores/authStore';
import { useProviderStore } from '@/stores/providerStore';
import { api } from '@/services/api';
import { socketService } from '@/services/socket';
import type { Session, Message, ApiResponse, MessageImage, MessageAttachment, CliTool, Command, CommandExecutionResult, SessionMode, PermissionAction, CLIProvider, UserSettings } from '@claude-code-webui/shared';
import { cn } from '@/lib/utils';
import { ChatInput } from '@/components/chat/ChatInput';
import { InteractiveOptions, detectOptions, isChoicePrompt } from '@/components/chat/InteractiveOptions';
import { PermissionApprovalDialog } from '@/components/chat/PermissionApprovalDialog';
import { CLI_PROVIDER_DEFAULT_MODEL, CLI_PROVIDER_ICON, CLI_PROVIDER_LABEL, toUiProvider, toCliProvider } from '@/lib/providers';
import { toast } from '@/hooks/use-toast';
import { useRalphStore } from '@/stores/ralphStore';
import { RalphActivationDialog } from '@/components/ralph/RalphActivationDialog';
import { RalphProgressPanel } from '@/components/ralph/RalphProgressPanel';

function generateId() {
  return Math.random().toString(36).substring(2, 9);
}

export function SessionPage() {
  const { id } = useParams<{ id: string }>();
  const [isSending, setIsSending] = useState(false);
  const [sessionMode, setSessionMode] = useState<SessionMode>('auto-accept');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const lastMessageIdRef = useRef<string | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const { messages, streamingContent, activity, activeAgent, todos, generatedImages, toolExecutions, permissionRequests, pendingPermissions, setMessages, clearStreamingContent, selectedFile, setSelectedFile, openFile: openFileInStore, openFiles, setActiveSession } = useSessionStore();
  const [showSavedIndicator, setShowSavedIndicator] = useState(false);
  const [selectedCliTool, setSelectedCliTool] = useState<string | null>(null);
  const [isExecutingTool, _setIsExecutingTool] = useState(false);
  const cliToolAbortRef = useRef<AbortController | null>(null);
  const [showAllowedDirsDialog, setShowAllowedDirsDialog] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [selectedToolDetail, setSelectedToolDetail] = useState<typeof currentToolExecutions[0] | null>(null);
  const loadedModeForSessionRef = useRef<string | null>(null);

  const { usage, addMessage } = useSessionStore();
  const { uiProvider, setProvider } = useProviderStore();
  const ralphRun = useRalphStore((s) => id ? s.getRunBySession(id) : null);
  const loadRalphRuns = useRalphStore((s) => s.loadRuns);

  useEffect(() => {
    loadRalphRuns();
  }, [loadRalphRuns]);
  const sessionModeStorageKey = useMemo(() => (id ? `sessionMode:${id}` : null), [id]);

  const handleChatScroll = useCallback(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    const threshold = 80;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    setIsAtBottom(atBottom);
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = chatScrollRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      setIsAtBottom(true);
      return;
    }
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    setIsAtBottom(true);
  }, [setIsAtBottom]);

  // Fetch available CLI tools
  const { data: cliTools } = useQuery({
    queryKey: ['cli-tools'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<CliTool[]>>('/api/cli-tools');
      return (response.data.data || []).filter(t => t.enabled);
    },
  });

  interface CLIProviderInfo {
    id: CLIProvider;
    name: string;
    icon: string;
    available: boolean;
    models?: string[];
    modelLabels?: Record<string, string>;
  }
  const { data: cliProviders } = useQuery({
    queryKey: ['cli-providers'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<CLIProviderInfo[]>>('/api/cli-providers');
      return response.data.data || [];
    },
  });

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<UserSettings>>('/api/settings');
      return response.data.data;
    },
  });

  const updateSettingsMutation = useMutation({
    mutationFn: async (data: Partial<UserSettings>) => {
      const response = await api.put<ApiResponse<UserSettings>>('/api/settings', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Memoized selected tool name for placeholder
  const selectedToolName = useMemo(() => {
    if (!selectedCliTool || !cliTools) return null;
    return cliTools.find(t => t.id === selectedCliTool)?.name;
  }, [selectedCliTool, cliTools]);

  const sessionMessages = messages[id || ''] || [];
  const currentStreamingContent = streamingContent[id || ''] || '';
  const currentActivity = activity[id || ''] || { type: 'idle' as const };
  const currentUsage = usage[id || ''];
  const currentTodos = todos[id || ''] || [];
  const currentActiveAgent = activeAgent[id || ''];
  const currentGeneratedImages = generatedImages[id || ''] || [];
  const currentToolExecutions = toolExecutions[id || ''] || [];
  // Support both legacy and hooks-based permission requests
  const currentPermissionRequest = permissionRequests[id || ''] || null;
  const currentPendingPermission = pendingPermissions[id || ''] || null;
  const [mainView, setMainView] = useState<'chat' | 'editor' | 'preview'>('chat');
  const [configTab, setConfigTab] = useState<'memories' | 'agents'>('memories');
  const currentSelectedFile = selectedFile[id || ''];
  const currentOpenFiles = openFiles[id || ''] || [];
  const hasOpenFiles = currentOpenFiles.length > 0;
  const isActive = currentActivity.type === 'thinking' || !!currentActiveAgent;

  useEffect(() => {
    if (!isActive) return;
    const intervalId = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [isActive]);

  // Combine messages and generated images into a single timeline
  // Tool executions are NOT added to timeline - they're shown inline with activity indicator
  type TimelineItem =
    | { type: 'message'; data: Message; timestamp: number }
    | { type: 'image'; data: typeof currentGeneratedImages[0]; timestamp: number };

  const timeline = useMemo<TimelineItem[]>(() => [
    ...sessionMessages.map(msg => ({
      type: 'message' as const,
      data: msg,
      timestamp: new Date(msg.createdAt).getTime(),
    })),
    ...currentGeneratedImages.map(img => ({
      type: 'image' as const,
      data: img,
      timestamp: img.timestamp,
    })),
  ].map((item, _sortIdx) => ({ ...item, _sortIdx })).sort((a, b) => a.timestamp - b.timestamp || a._sortIdx - b._sortIdx).map(({ _sortIdx, ...rest }) => rest as TimelineItem), [sessionMessages, currentGeneratedImages]);

  // Get recent tool executions for showing during activity (last 5 completed or in-progress)
  const recentTools = useMemo(() =>
    currentToolExecutions
      .filter(t => t.status === 'started' || t.status === 'completed')
      .slice(-5),
    [currentToolExecutions]
  );

  // Helper to get tool icon and name - memoized to prevent re-creation on every render
  const getToolDisplay = useCallback((toolName: string) => {
    const toolMap: Record<string, { icon: typeof Wrench; label: string }> = {
      // Claude tools
      'Write': { icon: FileText, label: 'Writing file' },
      'Read': { icon: Search, label: 'Reading file' },
      'Edit': { icon: Edit3, label: 'Editing file' },
      'Bash': { icon: Terminal, label: 'Running command' },
      'Glob': { icon: Search, label: 'Searching files' },
      'Grep': { icon: Search, label: 'Searching code' },
      'WebFetch': { icon: Globe, label: 'Fetching webpage' },
      'WebSearch': { icon: Globe, label: 'Searching web' },
      'Task': { icon: Brain, label: 'Starting agent' },
      // Kimi / Codex / generic tool names
      'read_file': { icon: Search, label: 'Reading file' },
      'read_many_files': { icon: Search, label: 'Reading files' },
      'write_file': { icon: FileText, label: 'Writing file' },
      'replace': { icon: Edit3, label: 'Editing file' },
      'run_shell_command': { icon: Terminal, label: 'Running command' },
      'shell': { icon: Terminal, label: 'Running command' },
      'glob': { icon: Search, label: 'Searching files' },
      'grep_search': { icon: Search, label: 'Searching code' },
      'list_directory': { icon: Search, label: 'Listing directory' },
      'TodoWrite': { icon: FileText, label: 'Updating tasks' },
      'TodoRead': { icon: Search, label: 'Reading tasks' },
    };
    return toolMap[toolName] || { icon: Wrench, label: toolName };
  }, []);

  // Helper to get agent display name - memoized
  const getAgentDisplay = useCallback((agentType: string) => {
    const agentMap: Record<string, string> = {
      'Explore': 'Explorer',
      'Plan': 'Planner',
      'general-purpose': 'General',
      'claude-code-guide': 'Documentation',
      'research-bot': 'Research',
      'frontend-developer': 'Frontend Dev',
      'mobile-developer': 'Mobile Dev',
      'backend-dev': 'Backend Dev',
      'fullstack-dev': 'Fullstack Dev',
      'api-designer': 'API Designer',
      'ui-designer': 'UI Designer',
      // New agent types
      'devops': 'DevOps',
      'devops-engineer': 'DevOps',
      'database': 'Database',
      'database-specialist': 'Database',
      'git-ops': 'Git Ops',
      'git-operations': 'Git Ops',
      'debugger': 'Debugger',
      'debugging-expert': 'Debugger',
      'architect': 'Architect',
      'system-architect': 'Architect',
    };
    return agentMap[agentType] || agentType;
  }, []);

  const getAgentDescription = useCallback((agentType: string) => {
    const descriptions: Record<string, string> = {
      'Explore': 'Exploring project',
      'Plan': 'Drafting a plan',
      'general-purpose': 'Handling general tasks',
      'claude-code-guide': 'Checking docs',
      'research-bot': 'Researching',
      'frontend-developer': 'Working on UI',
      'mobile-developer': 'Working on mobile',
      'backend-dev': 'Working on backend',
      'fullstack-dev': 'Working across stack',
      'api-designer': 'Designing API',
      'ui-designer': 'Designing UI',
      'devops': 'Handling infra',
      'devops-engineer': 'Handling infra',
      'database': 'Working on database',
      'database-specialist': 'Working on database',
      'git-ops': 'Managing git tasks',
      'git-operations': 'Managing git tasks',
      'debugger': 'Debugging',
      'debugging-expert': 'Debugging',
      'architect': 'Designing architecture',
      'system-architect': 'Designing architecture',
    };
    return descriptions[agentType] || `Running ${agentType} agent`;
  }, []);

  const formatElapsed = useCallback((ms: number) => {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
  }, []);

  const allowedSessionModes: SessionMode[] = useMemo(
    () => ['planning', 'auto-accept', 'manual', 'danger', 'orchestration'],
    []
  );

  const getStoredSessionMode = useCallback((key: string) => {
    try {
      const stored = window.localStorage.getItem(key);
      if (stored && allowedSessionModes.includes(stored as SessionMode)) {
        return stored as SessionMode;
      }
    } catch {
      // Ignore storage errors (private mode, blocked, etc.)
    }
    return null;
  }, [allowedSessionModes]);

  // Fetch session details
  const { data: session, isLoading: sessionLoading } = useQuery({
    queryKey: ['session', id],
    queryFn: async () => {
      const response = await api.get<ApiResponse<Session>>(`/api/sessions/${id}`);
      if (response.data.success && response.data.data) {
        return response.data.data;
      }
      return null;
    },
    enabled: !!id,
  });

  useEffect(() => {
    if (!id || !session) {
      return;
    }
    if (sessionModeStorageKey && loadedModeForSessionRef.current !== id) {
      const storedMode = getStoredSessionMode(sessionModeStorageKey);
      if (storedMode) {
        setSessionMode(storedMode);
        socketService.setSessionMode(id, storedMode);
      }
      loadedModeForSessionRef.current = id;
    }
    if (session.cliProvider === 'glm' && sessionModeStorageKey) {
      const storedMode = getStoredSessionMode(sessionModeStorageKey);
      if (!storedMode && sessionMode === 'auto-accept') {
        setSessionMode('planning');
        socketService.setSessionMode(id, 'planning');
        try {
          window.localStorage.setItem(sessionModeStorageKey, 'planning');
        } catch {
          // Ignore storage errors
        }
      }
    }
  }, [id, session, sessionMode, sessionModeStorageKey, getStoredSessionMode]);

  const sessionProvider = session?.cliProvider ?? toCliProvider(uiProvider);
  const providerLabel = CLI_PROVIDER_LABEL[sessionProvider];
  const resolvedDefaultModel = settings?.cliProviderModels?.[sessionProvider] || CLI_PROVIDER_DEFAULT_MODEL[sessionProvider];
  const defaultModelLabel = resolvedDefaultModel;
  const selectedModel = settings?.cliProviderModels?.[sessionProvider] || '';
  const modelSelectValue = selectedModel || '__default__';
  const currentProviderInfo = cliProviders?.find((provider) => provider.id === sessionProvider);
  const modelLabels = useMemo(() => {
    return currentProviderInfo?.modelLabels || {};
  }, [currentProviderInfo]);
  const modelOptions = useMemo(() => {
    const options = new Set<string>();
    const providerModels = currentProviderInfo?.models || [];
    for (const model of providerModels) {
      options.add(model);
    }
    if (selectedModel) {
      options.add(selectedModel);
    }
    const defaultModel = CLI_PROVIDER_DEFAULT_MODEL[sessionProvider];
    if (defaultModel) {
      options.add(defaultModel);
    }
    return Array.from(options);
  }, [currentProviderInfo, sessionProvider, selectedModel]);
  const selectedReasoning = settings?.cliProviderReasoning?.[sessionProvider] || '';
  const reasoningSelectValue = selectedReasoning || '__default__';
  const reasoningOptions = useMemo(() => ([
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'extra_high', label: 'Extra High' },
  ]), []);
  const quickPrompts = useMemo(() => ([
    { label: 'Plan', value: 'Plan the approach and outline the steps.' },
    { label: 'Debug', value: 'Find the root cause and propose a fix.' },
    { label: 'Refactor', value: 'Refactor for clarity and safer defaults.' },
    { label: 'Tests', value: 'Add or update tests for this change.' },
    { label: 'Explain', value: 'Explain the code and key decisions.' },
  ]), []);
  // Fetch messages
  const { isLoading: messagesLoading } = useQuery({
    queryKey: ['messages', id],
    queryFn: async () => {
      const response = await api.get<ApiResponse<Message[]>>(`/api/sessions/${id}/messages`);
      if (response.data.success && response.data.data) {
        setMessages(id!, response.data.data);
        return response.data.data;
      }
      return [];
    },
    enabled: !!id,
  });

  // Fetch available commands
  const { data: commands } = useQuery({
    queryKey: ['commands', session?.workingDirectory],
    queryFn: async () => {
      const response = await api.get<ApiResponse<Command[]>>(
        `/api/commands?projectPath=${encodeURIComponent(session?.workingDirectory || '')}`
      );
      return response.data.data || [];
    },
    enabled: !!session,
  });


  const queryClient = useQueryClient();

  // Star/unstar session mutation
  const starMutation = useMutation({
    mutationFn: async () => {
      const response = await api.patch<ApiResponse<{ starred: boolean }>>(`/api/sessions/${id}/star`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session', id] });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });

  const providerMutation = useMutation({
    mutationFn: async (provider: CLIProvider) => {
      const response = await api.patch<ApiResponse<Session>>(`/api/sessions/${id}/provider`, {
        cliProvider: provider,
      });
      return response.data;
    },
    onSuccess: (data) => {
      if (data.success && data.data && id) {
        queryClient.setQueryData(['session', id], data.data);
        useSessionStore.getState().updateSession(id, data.data);
        queryClient.invalidateQueries({ queryKey: ['sessions'] });
        if (session?.status === 'running') {
          socketService.restartSession(id);
        }
        toast({
          title: 'Provider switched',
          description: 'Session restarted with the new provider. Resend the last prompt if needed.',
        });
      }
    },
  });

  // Connect to socket and subscribe to session (with reconnect support)
  useEffect(() => {
    if (!id) return;

    socketService.connect();
    // Use reconnect instead of subscribe to get buffered messages if session is running
    socketService.reconnectToSession(id);

    return () => {
      socketService.unsubscribeFromSession(id);
    };
  }, [id, sessionModeStorageKey]);

  // Handle tab visibility changes - reconnect with timestamp when tab becomes visible
  useEffect(() => {
    if (!id) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('[TAB] Tab became visible, reconnecting to session...');
        const lastTimestamp = useSessionStore.getState().lastMessageTimestamp[id];
        socketService.reconnectToSession(id, lastTimestamp);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [id]);

  // Handle Escape key to interrupt session (like CLI Ctrl+C)
  useEffect(() => {
    if (!id) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Only trigger on Escape when Claude is active and not typing in an input
      if (e.key === 'Escape' && isActive) {
        const target = e.target as HTMLElement;
        const isTyping = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

        // If typing, let first Escape blur the input, second Escape interrupts
        if (isTyping && document.activeElement === target) {
          return; // Let the input handle the first Escape
        }

        e.preventDefault();
        console.log('[INTERRUPT] Escape pressed, interrupting session...');
        socketService.interruptSession(id);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [id, isActive]);

  useEffect(() => {
    if (!id) return;
    setActiveSession(id);
    return () => setActiveSession(null);
  }, [id, setActiveSession]);

  useEffect(() => {
    if (!id) return;
    const unsubscribe = socketService.onModeChange((data) => {
      if (data.sessionId !== id) return;
      setSessionMode(data.mode);
      if (sessionModeStorageKey) {
        try {
          window.localStorage.setItem(sessionModeStorageKey, data.mode);
        } catch {
          // Ignore storage errors
        }
      }
    });
    return unsubscribe;
  }, [id, sessionModeStorageKey]);

  // Scroll to bottom when new messages arrive if the user hasn't scrolled up
  useEffect(() => {
    if (!isAtBottom) return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [sessionMessages, currentStreamingContent, isAtBottom]);

  useEffect(() => {
    if (!session?.cliProvider) {
      return;
    }
    const nextUiProvider = toUiProvider(session.cliProvider);
    if (nextUiProvider !== uiProvider) {
      setProvider(nextUiProvider);
    }
  }, [session?.cliProvider, setProvider, uiProvider]);

  // Show a brief indicator when an assistant message is persisted
  useEffect(() => {
    if (!id || sessionMessages.length === 0) {
      lastMessageIdRef.current = null;
      return;
    }

    const lastMessage = sessionMessages[sessionMessages.length - 1];
    if (!lastMessage) return;

    const previousId = lastMessageIdRef.current;
    lastMessageIdRef.current = lastMessage.id;

    if (previousId && lastMessage.id !== previousId && lastMessage.role === 'assistant') {
      setShowSavedIndicator(true);
    }
  }, [id, sessionMessages]);

  useEffect(() => {
    if (!showSavedIndicator) return;
    const timeout = window.setTimeout(() => {
      setShowSavedIndicator(false);
    }, 2000);
    return () => window.clearTimeout(timeout);
  }, [showSavedIndicator]);

  // Callbacks for ChatInput
  const handleSendMessage = useCallback((message: string) => {
    if (!id) return;
    socketService.sendMessage(id, message);
    clearStreamingContent(id);
  }, [id, clearStreamingContent]);

  const handleSendMessageWithFiles = useCallback(async (message: string, files: File[]) => {
    if (!id) return;
    setIsSending(true);
    try {
      await socketService.sendMessageWithFiles(id, message, files);
      clearStreamingContent(id);
    } finally {
      setIsSending(false);
    }
  }, [id, clearStreamingContent]);

  const handleCommandExecute = useCallback(async (input: string) => {
    if (!id) return;
    try {
      const response = await api.post<ApiResponse<CommandExecutionResult>>('/api/commands/execute', {
        input,
        projectPath: session?.workingDirectory,
        sessionId: id,
        currentModel: resolvedDefaultModel || CLI_PROVIDER_DEFAULT_MODEL[sessionProvider],
        usage: currentUsage ? {
          inputTokens: currentUsage.inputTokens,
          outputTokens: currentUsage.outputTokens,
          cost: currentUsage.totalCostUsd,
        } : undefined,
      });

      const result = response.data.data;
      if (result) {
        if (result.action === 'clear') {
          setMessages(id, []);
        } else if (result.action === 'send_message' && result.response) {
          socketService.sendMessage(id, result.response);
        } else if (result.response) {
          addMessage(id, {
            id: generateId(),
            sessionId: id,
            role: 'assistant',
            content: result.response,
            createdAt: new Date().toISOString(),
          });
        }
        if (!result.success && result.error) {
          addMessage(id, {
            id: generateId(),
            sessionId: id,
            role: 'assistant',
            content: `⚠️ ${result.error}`,
            createdAt: new Date().toISOString(),
          });
        }
      }
    } catch (error) {
      console.error('Command execution failed:', error);
    }
  }, [id, session?.workingDirectory, currentUsage, setMessages, addMessage]);

  const handleInterrupt = () => {
    if (!id) return;
    socketService.interruptSession(id);
  };

  const handleRestart = () => {
    if (!id) return;
    socketService.restartSession(id);
  };

  const applyModelSelection = (value: string) => {
    if (!sessionProvider) return;
    const current = settings?.cliProviderModels?.[sessionProvider] || '';
    const nextValue = value === '__default__' ? '' : value.trim();
    if (nextValue === current) return;

    const next: Partial<Record<CLIProvider, string>> = {
      ...(settings?.cliProviderModels || {}),
    };
    if (nextValue) {
      next[sessionProvider] = nextValue;
    } else {
      delete next[sessionProvider];
    }

    updateSettingsMutation.mutate(
      { cliProviderModels: next },
      {
        onSuccess: () => {
          toast({
            title: 'Model updated',
            description: session?.status === 'running'
              ? 'Restarting session to apply the new model.'
              : 'Restart the session to apply the new model.',
          });
          if (session?.status === 'running') {
            handleRestart();
          }
        },
      }
    );
  };

  const applyReasoningSelection = (value: string) => {
    if (sessionProvider !== 'codex') return;
    const current = settings?.cliProviderReasoning?.[sessionProvider] || '';
    const nextValue = value === '__default__'
      ? ''
      : value.trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (nextValue === current) return;

    const next: Partial<Record<CLIProvider, string>> = {
      ...(settings?.cliProviderReasoning || {}),
    };
    if (nextValue) {
      next[sessionProvider] = nextValue;
    } else {
      delete next[sessionProvider];
    }

    updateSettingsMutation.mutate(
      { cliProviderReasoning: next },
      {
        onSuccess: () => {
          toast({
            title: 'Reasoning updated',
            description: session?.status === 'running'
              ? 'Restarting session to apply the new reasoning level.'
              : 'Restart the session to apply the new reasoning level.',
          });
          if (session?.status === 'running') {
            handleRestart();
          }
        },
      }
    );
  };

  const handleModeChange = useCallback((newMode: SessionMode) => {
    setSessionMode(newMode);
    if (id) {
      socketService.setSessionMode(id, newMode);
    }
    if (sessionModeStorageKey) {
      try {
        window.localStorage.setItem(sessionModeStorageKey, newMode);
      } catch {
        // Ignore storage errors
      }
    }
  }, [id]);

  // Handler for hooks-based permission response
  const handlePermissionResponse = useCallback(async (action: PermissionAction, pattern?: string) => {
    if (!id || !currentPendingPermission) return;
    try {
      await socketService.respondToPermission(
        id,
        currentPendingPermission.requestId,
        action,
        pattern
      );
    } catch (error) {
      console.error('Failed to respond to permission request:', error);
    }
  }, [id, currentPendingPermission]);

  const handleCancelCliTool = () => {
    if (cliToolAbortRef.current) {
      cliToolAbortRef.current.abort();
    }
  };

  if (sessionLoading || messagesLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="loader" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Session not found</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 relative overflow-hidden">

      {/* Session Header */}
      <div className="shrink-0 sticky top-0 z-20 pb-1 pt-1 mb-2 border-b bg-background/95 backdrop-blur space-y-1">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold flex items-center gap-1.5">
              <button
                onClick={() => starMutation.mutate()}
                disabled={starMutation.isPending}
                className="hover:scale-110 transition-transform"
                title={session.starred ? 'Unstar session' : 'Star session'}
              >
                <Star
                  className={cn(
                    'h-4 w-4 transition-colors',
                    session.starred
                      ? 'text-amber-500 fill-amber-500'
                      : 'text-muted-foreground hover:text-amber-400'
                  )}
                />
              </button>
              <span className="truncate max-w-[120px] sm:max-w-none">{session.name}</span>
              <span
                className="ui-pill text-[10px] hidden sm:inline-flex"
                title={`Using ${CLI_PROVIDER_LABEL[sessionProvider]}`}
              >
                <span className="font-semibold">
                  {CLI_PROVIDER_ICON[sessionProvider] || ''}
                </span>
                <span>{CLI_PROVIDER_LABEL[sessionProvider]}</span>
              </span>
              <span
                className={cn(
                  'inline-block h-2 w-2 rounded-full',
                  session.status === 'running' && 'bg-primary animate-pulse',
                  session.status === 'stopped' && 'bg-gray-400',
                  session.status === 'error' && 'bg-red-500'
                )}
              />
            </h2>
          </div>
          <div className="flex gap-1.5 items-center shrink-0">
            {/* CLI Tool selector - visible in header */}
            {cliTools && cliTools.length > 0 && (
              <div className="relative shrink-0">
                <select
                  value={selectedCliTool || ''}
                  onChange={(e) => setSelectedCliTool(e.target.value || null)}
                  className={cn(
                    "h-7 px-2 rounded-md border text-xs font-medium transition-all cursor-pointer",
                    "focus:outline-none focus:ring-2 focus:ring-ring",
                    selectedCliTool
                      ? "bg-muted border-border text-foreground"
                      : "bg-background border-input text-muted-foreground hover:bg-muted"
                  )}
                >
                  <option value="">{CLI_PROVIDER_LABEL[sessionProvider]}</option>
                  {cliTools.map((tool) => (
                    <option key={tool.id} value={tool.id}>
                      {tool.name}
                    </option>
                  ))}
                </select>
                {selectedCliTool && (
                  <div className="absolute -top-1 -right-1 w-2 h-2 bg-primary rounded-full animate-pulse" />
                )}
              </div>
            )}

            {/* Mode selector - moved to header */}
            <SessionControls
              mode={sessionMode}
              onModeChange={handleModeChange}
              usage={currentUsage}
              defaultModel={defaultModelLabel}
            />

            {/* Provider selector */}
            {cliProviders && cliProviders.length > 0 && session && (
              <>
                <div className="hidden sm:block">
                  <Select value={modelSelectValue} onValueChange={applyModelSelection}>
                    <SelectTrigger className="h-7 w-[140px] text-xs">
                      <SelectValue placeholder={modelLabels[resolvedDefaultModel] || resolvedDefaultModel || 'Model'} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__default__">
                        <span className="flex items-center gap-2">
                          <span>Default</span>
                          <span className="text-[10px] text-muted-foreground">
                            {modelLabels[resolvedDefaultModel] || resolvedDefaultModel}
                          </span>
                        </span>
                      </SelectItem>
                      {modelOptions.map((model) => (
                        <SelectItem key={model} value={model}>
                          <span className="flex items-center gap-2">
                            <span>{modelLabels[model] || model}</span>
                            {modelLabels[model] && (
                              <span className="text-[10px] text-muted-foreground font-mono">
                                {model}
                              </span>
                            )}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {sessionProvider === 'codex' && (
                  <div className="hidden sm:block">
                    <Select value={reasoningSelectValue} onValueChange={applyReasoningSelection}>
                      <SelectTrigger className="h-7 w-[120px] text-xs">
                        <SelectValue placeholder="Reasoning" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__default__">Default</SelectItem>
                        {reasoningOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-7 w-7 sm:hidden"
                      title={`Provider: ${CLI_PROVIDER_LABEL[sessionProvider]}`}
                    >
                      <span className="text-xs font-semibold">
                        {CLI_PROVIDER_ICON[sessionProvider] || ''}
                      </span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Session
                    </DropdownMenuLabel>
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger className="text-xs">
                        Model
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="w-56 max-h-64 overflow-auto">
                        <DropdownMenuItem
                          className="flex items-center gap-2 cursor-pointer"
                          onClick={() => applyModelSelection('__default__')}
                        >
                          <span className="flex-1">Default</span>
                          <span className="text-[10px] text-muted-foreground">
                            {modelLabels[resolvedDefaultModel] || resolvedDefaultModel}
                          </span>
                          {modelSelectValue === '__default__' && (
                            <Check className="h-4 w-4 text-primary" />
                          )}
                        </DropdownMenuItem>
                        {modelOptions.map((model) => (
                          <DropdownMenuItem
                            key={model}
                            className="flex items-center gap-2 cursor-pointer"
                            onClick={() => applyModelSelection(model)}
                          >
                            <span className="flex-1 text-xs">{modelLabels[model] || model}</span>
                            {modelLabels[model] && (
                              <span className="text-[10px] text-muted-foreground font-mono">{model}</span>
                            )}
                            {modelSelectValue === model && (
                              <Check className="h-4 w-4 text-primary" />
                            )}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    {sessionProvider === 'codex' && (
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger className="text-xs">
                          Reasoning
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="w-48">
                          <DropdownMenuItem
                            className="flex items-center gap-2 cursor-pointer"
                            onClick={() => applyReasoningSelection('__default__')}
                          >
                            <span className="flex-1">Default</span>
                            {reasoningSelectValue === '__default__' && (
                              <Check className="h-4 w-4 text-primary" />
                            )}
                          </DropdownMenuItem>
                          {reasoningOptions.map((option) => (
                            <DropdownMenuItem
                              key={option.value}
                              className="flex items-center gap-2 cursor-pointer"
                              onClick={() => applyReasoningSelection(option.value)}
                            >
                              <span className="flex-1">{option.label}</span>
                              {reasoningSelectValue === option.value && (
                                <Check className="h-4 w-4 text-primary" />
                              )}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Provider
                    </DropdownMenuLabel>
                    {cliProviders.map((provider) => (
                      <DropdownMenuItem
                        key={provider.id}
                        className="flex items-center gap-2 cursor-pointer"
                        disabled={!provider.available}
                        onClick={() => providerMutation.mutate(provider.id)}
                      >
                        <span className="text-xs font-semibold">
                          {CLI_PROVIDER_ICON[provider.id] || provider.name.slice(0, 1).toUpperCase()}
                        </span>
                        <span className="flex-1">{provider.name}</span>
                        {!provider.available && (
                          <span className="text-[10px] text-muted-foreground">(not installed)</span>
                        )}
                        {session.cliProvider === provider.id && (
                          <Check className="h-4 w-4 text-primary" />
                        )}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <div className="hidden sm:block">
                  <Select
                    value={session.cliProvider}
                    onValueChange={(value) => providerMutation.mutate(value as CLIProvider)}
                  >
                    <SelectTrigger className="h-7 w-[120px] text-xs">
                      <SelectValue placeholder="Provider" />
                    </SelectTrigger>
                    <SelectContent>
                      {cliProviders.map((provider) => (
                        <SelectItem
                          key={provider.id}
                          value={provider.id}
                          disabled={!provider.available}
                        >
                          <span className="flex items-center gap-2">
                            <span className="text-xs font-semibold">
                              {CLI_PROVIDER_ICON[provider.id] || provider.name.slice(0, 1).toUpperCase()}
                            </span>
                            <span>{provider.name}</span>
                            {!provider.available && (
                              <span className="text-[10px] text-muted-foreground">(not installed)</span>
                            )}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="h-7 w-7" title="More actions">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={() => setShowAllowedDirsDialog(true)}>
                  Manage directories
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {session.status === 'running' && (
                  <DropdownMenuItem onClick={handleInterrupt}>
                    Interrupt session
                  </DropdownMenuItem>
                )}
                {isExecutingTool && (
                  <DropdownMenuItem onClick={handleCancelCliTool}>
                    Cancel active tool
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={handleRestart}>
                  Restart session
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

          </div>
        </div>

        {/* Panels Bar - Files, Tasks, Git, etc. as dropdowns */}
        <div className="flex items-center gap-1 overflow-x-auto sm:overflow-visible sm:flex-wrap pb-1 sm:pb-0 -mx-1 px-1 scrollbar-none">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 gap-1.5 text-xs"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Files</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[calc(100vw-2rem)] sm:w-80 max-h-[50vh] sm:max-h-[60vh] overflow-auto p-0">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/30">
                <FolderOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-xs text-muted-foreground truncate flex-1" title={session.workingDirectory}>
                  {session.workingDirectory}
                </span>
                <button
                  onClick={() => setShowAllowedDirsDialog(true)}
                  className="p-1 rounded hover:bg-muted transition-colors shrink-0"
                  title="Manage allowed directories"
                >
                  <FolderKey className="h-3.5 w-3.5 text-primary" />
                </button>
              </div>
              <FileTree
                workingDirectory={session.workingDirectory}
                selectedFile={currentSelectedFile || null}
                onFileSelect={(path) => id && setSelectedFile(id, path)}
                onFileOpen={(path, content) => id && openFileInStore(id, path, content)}
                className="h-[40vh] sm:h-[50vh]"
              />
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 gap-1.5 text-xs relative"
              >
                <ListTodo className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Tasks</span>
                {currentTodos.filter(t => t.status !== 'completed').length > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 text-[10px] rounded-full bg-primary text-primary-foreground flex items-center justify-center">
                    {currentTodos.filter(t => t.status !== 'completed').length}
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[calc(100vw-2rem)] sm:w-80 max-h-[50vh] sm:max-h-[60vh] overflow-auto">
              {currentTodos.length === 0 ? (
                <div className="text-center py-4 text-sm text-muted-foreground">
                  No tasks
                </div>
              ) : (
                <div className="p-2 space-y-2">
                  {currentTodos.map((todo, index) => (
                    <div
                      key={index}
                      className={cn(
                        "flex items-start gap-2 p-2 rounded-lg text-xs transition-colors border border-border/60 bg-muted/40",
                        todo.status === 'completed' && "text-muted-foreground",
                        todo.status === 'in_progress' && "border-primary/40"
                      )}
                    >
                      <div className="shrink-0 mt-0.5">
                        {todo.status === 'completed' && <CheckCircle className="h-4 w-4 text-muted-foreground" />}
                        {todo.status === 'in_progress' && <Loader2 className="h-4 w-4 text-primary animate-spin" />}
                        {todo.status === 'pending' && <Circle className="h-4 w-4 text-muted-foreground" />}
                      </div>
                      <p className={cn(
                        "flex-1 leading-snug",
                        todo.status === 'completed' && "line-through",
                        todo.status === 'in_progress' && "font-medium text-foreground"
                      )}>
                        {todo.status === 'in_progress' && todo.activeForm ? todo.activeForm : todo.content}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 gap-1.5 text-xs"
              >
                <GitBranch className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Git</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[calc(100vw-2rem)] sm:w-80 max-h-[50vh] sm:max-h-[60vh] overflow-auto p-0">
              <GitPanel workingDirectory={session.workingDirectory} className="h-[40vh] sm:h-[50vh]" />
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 gap-1.5 text-xs"
              >
                <History className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Saves</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[calc(100vw-2rem)] sm:w-80 max-h-[50vh] sm:max-h-[60vh] overflow-auto p-0">
              <CheckpointsPanel
                sessionId={id!}
                className="h-[40vh] sm:h-[50vh]"
                onRestore={() => {
                  queryClient.invalidateQueries({ queryKey: ['messages', id] });
                }}
              />
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 gap-1.5 text-xs"
              >
                <Brain className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Config</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[calc(100vw-2rem)] sm:w-[480px] max-h-[50vh] sm:max-h-[60vh] overflow-auto p-0">
              <div className="flex flex-col h-[40vh] sm:h-[50vh]">
                <div className="flex border-b bg-muted/30">
                  <button
                    onClick={() => setConfigTab('memories')}
                    className={configTab === 'memories'
                      ? 'flex-1 px-3 py-1.5 text-xs font-medium border-b-2 border-primary text-foreground'
                      : 'flex-1 px-3 py-1.5 text-xs font-medium border-b-2 border-transparent text-muted-foreground hover:text-foreground'
                    }
                  >
                    Memories
                  </button>
                  <button
                    onClick={() => setConfigTab('agents')}
                    className={configTab === 'agents'
                      ? 'flex-1 px-3 py-1.5 text-xs font-medium border-b-2 border-primary text-foreground'
                      : 'flex-1 px-3 py-1.5 text-xs font-medium border-b-2 border-transparent text-muted-foreground hover:text-foreground'
                    }
                  >
                    Agents
                  </button>
                </div>
                {configTab === 'memories' ? (
                  <MemoryViewer
                    workingDirectory={session.workingDirectory}
                    className="flex-1 overflow-auto"
                  />
                ) : (
                  <AgentsEditor
                    workingDirectory={session.workingDirectory}
                    className="flex-1 overflow-auto"
                  />
                )}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 gap-1.5 text-xs relative"
              >
                <Wrench className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Tools</span>
                {recentTools.filter(t => t.status === 'started').length > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 text-[10px] rounded-full bg-primary text-primary-foreground flex items-center justify-center">
                    {recentTools.filter(t => t.status === 'started').length}
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[calc(100vw-2rem)] sm:w-96 max-h-[50vh] sm:max-h-[60vh] overflow-auto p-0">
              <ToolLogPanel
                executions={currentToolExecutions}
                className="h-[40vh] sm:h-[50vh]"
              />
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Ralph Tab */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 gap-1.5 text-xs relative"
              >
                <Bot className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Ralph</span>
                {ralphRun && ['planning', 'executing'].includes(ralphRun.status) && (
                  <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                )}
                {ralphRun?.status === 'paused' && (
                  <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-amber-500" />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[calc(100vw-2rem)] sm:w-96 max-h-[50vh] sm:max-h-[60vh] overflow-auto p-0">
              <div className="p-3">
                {id && ralphRun ? (
                  <RalphProgressPanel sessionId={id} />
                ) : id ? (
                  <RalphActivationDialog sessionId={id} trigger={
                    <Button variant="outline" size="sm" className="w-full gap-2">
                      <Bot className="h-4 w-4" />
                      Start Ralph
                    </Button>
                  } />
                ) : (
                  <div className="text-center py-4 text-sm text-muted-foreground">
                    No session
                  </div>
                )}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Spacer pushes view toggle to right */}
          <div className="flex-1" />

          {/* View Toggle */}
          <div className="flex gap-0.5 bg-muted rounded-md p-0.5 shrink-0">
            <button
              onClick={() => setMainView('chat')}
              className={mainView === 'chat'
                ? 'flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-background text-foreground shadow-sm'
                : 'flex items-center gap-1 px-2 py-0.5 text-xs rounded text-muted-foreground hover:text-foreground'
              }
              title="Chat"
            >
              <MessageSquare className="h-3 w-3" />
              <span className="hidden sm:inline">Chat</span>
            </button>
            {hasOpenFiles && (
              <button
                onClick={() => setMainView('editor')}
                className={mainView === 'editor'
                  ? 'flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-background text-foreground shadow-sm'
                  : 'flex items-center gap-1 px-2 py-0.5 text-xs rounded text-muted-foreground hover:text-foreground'
                }
                title="Editor"
              >
                <Code2 className="h-3 w-3" />
                <span className="hidden sm:inline">Editor</span>
              </button>
            )}
            <button
              onClick={() => setMainView('preview')}
              className={mainView === 'preview'
                ? 'flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-background text-foreground shadow-sm'
                : 'flex items-center gap-1 px-2 py-0.5 text-xs rounded text-muted-foreground hover:text-foreground'
              }
              title="Preview"
            >
              <Globe className="h-3 w-3" />
              <span className="hidden sm:inline">Preview</span>
            </button>
          </div>
        </div>

      </div>

      {/* Main content area */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {/* Main Content - Chat or Editor */}
        <div
          ref={chatScrollRef}
          onScroll={handleChatScroll}
          className={cn(
            "flex-1 min-h-0 overflow-y-auto",
            mainView === 'chat' && "space-y-4 pb-4"
          )}
        >
        {mainView === 'editor' ? (
          <EditorPanel sessionId={id || ''} />
        ) : mainView === 'preview' ? (
          <WebPreview className="h-full" />
        ) : (
          <>
        {timeline.length === 0 && !currentStreamingContent && (
          <div className="flex items-center justify-center h-full text-center">
            <div>
              <div className="p-4 rounded-full bg-muted/50 mb-4 mx-auto w-fit">
                <Image className="h-8 w-8 text-muted-foreground/50" />
              </div>
              <p className="text-muted-foreground mb-1">Start a conversation</p>
              <p className="text-xs text-muted-foreground/70">
                Type a message or paste/drop an image
              </p>
            </div>
          </div>
        )}

        {/* Unified timeline: messages and generated images sorted by timestamp */}
        {timeline.map((item, index) => {
          if (item.type === 'message') {
            const message = item.data;
            // Render compact boundary cards specially
            if (message.id?.startsWith("compact-")) {
              return <CompactBoundaryCard key={message.id} content={message.content} />;
            }
            return (
              <div
                key={message.id}
                className={cn('flex animate-fade-in', message.role === 'user' ? 'justify-end' : 'justify-start')}
              >
                <Card
                  className={cn(
                    'max-w-[95%] sm:max-w-[85%] md:max-w-[80%] p-3 sm:p-4',
                    message.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-card border'
                  )}
                >
                  {/* File attachments for user messages */}
                  {((message.images && message.images.length > 0) || (message.attachments && message.attachments.length > 0)) && (
                    <div className="flex flex-wrap gap-2 mb-3">
                      {/* Legacy images support - skip if attachments exist */}
                      {(!message.attachments || message.attachments.length === 0) && message.images?.map((img: MessageImage, imgIndex: number) => {
                        const token = useAuthStore.getState().token || '';
                        const imageUrl = `/api/sessions/${id}/images/${img.filename}?token=${encodeURIComponent(token)}`;
                        return (
                          <img
                            key={`img-${imgIndex}`}
                            src={imageUrl}
                            alt={`Attachment ${imgIndex + 1}`}
                            className="max-h-32 max-w-48 rounded-lg border border-primary-foreground/20 object-cover cursor-pointer hover:opacity-90 transition-opacity"
                            onClick={() => window.open(imageUrl, '_blank')}
                          />
                        );
                      })}
                      {/* New attachments support */}
                      {message.attachments?.map((att: MessageAttachment, attIndex: number) => {
                        const token = useAuthStore.getState().token || '';
                        const attachmentUrl = att.filename && att.path
                          ? `/api/sessions/${id}/attachments/${att.filename}?token=${encodeURIComponent(token)}`
                          : null;

                        if (att.type === 'image' && attachmentUrl) {
                          return (
                            <img
                              key={`att-${attIndex}`}
                              src={attachmentUrl}
                              alt={att.filename}
                              className="max-h-32 max-w-48 rounded-lg border border-primary-foreground/20 object-cover cursor-pointer hover:opacity-90 transition-opacity"
                              onClick={() => window.open(attachmentUrl, '_blank')}
                            />
                          );
                        }

                        // Non-image attachments (text, pdf, document)
                        const AttachmentIcon = att.type === 'text' ? FileCode : att.type === 'pdf' ? FileText : FileIcon;
                        return (
                          <div
                            key={`att-${attIndex}`}
                            className={cn(
                              "flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer hover:opacity-90 transition-opacity",
                              message.role === 'user'
                                ? "border-primary-foreground/20 bg-primary-foreground/10"
                                : "border-border bg-muted"
                            )}
                            onClick={() => attachmentUrl && window.open(attachmentUrl, '_blank')}
                            title={att.filename}
                          >
                            <AttachmentIcon className={cn("h-5 w-5", att.type === 'pdf' && "text-red-500")} />
                            <span className="text-xs truncate max-w-32">{att.filename}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div className={cn(
                    'prose prose-sm max-w-none',
                    message.role === 'user' ? 'prose-invert' : 'dark:prose-invert'
                  )}>
                    <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{message.content}</ReactMarkdown>
                  </div>
                  {/* Interactive options for assistant messages with choices */}
                  {message.role === 'assistant' && isChoicePrompt(message.content) && (() => {
                    const options = detectOptions(message.content);
                    return options ? (
                      <InteractiveOptions
                        options={options}
                        onSelect={(selected) => {
                          if (id) {
                            socketService.sendMessage(id, selected);
                          }
                        }}
                        disabled={session.status === 'error'}
                      />
                    ) : null;
                  })()}
                  {/* Directory access request detection */}
                  {message.role === 'assistant' && id && (
                    <DirectoryAccessPrompt
                      message={message.content}
                      sessionId={id}
                      onAccessGranted={() => {
                        queryClient.invalidateQueries({ queryKey: ['session', id] });
                      }}
                    />
                  )}
                </Card>
              </div>
            );
          } else {
            // Generated Image
            const img = item.data;
            return (
              <div key={`gen-img-${img.timestamp}-${index}`} className="flex justify-start animate-fade-in">
                <Card className="max-w-[95%] sm:max-w-[85%] md:max-w-[80%] p-3 sm:p-4 bg-muted/40 border-border/60">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="p-1.5 rounded-full bg-muted/60">
                      <Image className="h-4 w-4 text-primary" />
                    </div>
                    <span className="text-sm font-medium text-foreground">
                      Generated Image (Gemini)
                    </span>
                  </div>
                  {img.imageBase64 && (
                    <img
                      src={`data:${img.mimeType};base64,${img.imageBase64}`}
                      alt={img.prompt}
                      className="max-w-full rounded-lg border border-border/60 cursor-pointer hover:opacity-90 transition-opacity mb-3"
                      onClick={() => {
                        const link = document.createElement('a');
                        link.href = `data:${img.mimeType};base64,${img.imageBase64}`;
                        link.download = `gemini-image-${img.timestamp}.png`;
                        link.click();
                      }}
                    />
                  )}
                  <p className="text-xs text-muted-foreground italic">"{img.prompt}"</p>
                </Card>
              </div>
            );
          }
        })}

        {/* Activity indicator with recent tool history */}
        {(currentActivity.type === 'thinking' || currentActivity.type === 'tool' || currentActiveAgent) && !currentStreamingContent && (
          <div className="flex justify-start animate-fade-in">
            <Card className="border p-3 sm:p-4 max-w-[95%] sm:max-w-[85%] md:max-w-[80%] bg-muted/40 border-border/60">
              <div className="space-y-3">
                {/* Current activity */}
                <div className="flex items-center gap-3">
                  {/* Active Agent indicator - highest priority */}
                  {currentActiveAgent ? (
                    <>
                      <div className="relative">
                        <Brain className="h-5 w-5 text-primary" />
                        <span className="absolute -top-1 -right-1 w-2 h-2 bg-primary rounded-full animate-ping" />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-foreground">
                          Agent: {getAgentDisplay(currentActiveAgent.agentType)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {currentActiveAgent.description || getAgentDescription(currentActiveAgent.agentType)}
                          {currentActiveAgent.startedAt ? ` (${formatElapsed(now - currentActiveAgent.startedAt)})` : ''}
                        </span>
                      </div>
                    </>
                  ) : currentActivity.type === 'thinking' ? (
                    <>
                      <Brain className="h-5 w-5 text-primary animate-pulse" />
                      <div className="flex flex-col">
                        <span className="text-sm font-medium">{providerLabel} is thinking...</span>
                        <span className="text-xs text-muted-foreground">
                          {currentActivity.message
                            ? `• ${currentActivity.message}${currentActivity.messageStartedAt ? ` (${formatElapsed(now - currentActivity.messageStartedAt)})` : ''}`
                            : 'Analyzing request'}
                        </span>
                      </div>
                    </>
                  ) : currentActivity.type === 'tool' && currentActivity.toolName ? (
                    <>
                      {(() => {
                        const { icon: ToolIcon, label } = getToolDisplay(currentActivity.toolName);
                        return (
                          <>
                            <div className="relative">
                              <ToolIcon className="h-5 w-5 text-primary" />
                              <span className="absolute -top-1 -right-1 w-2 h-2 bg-primary rounded-full animate-ping" />
                            </div>
                            <div className="flex flex-col">
                              <span className="text-sm font-medium text-foreground">{label}</span>
                            </div>
                          </>
                        );
                      })()}
                    </>
                  ) : (
                    <>
                      <div className="flex gap-1">
                        <span className="w-2 h-2 bg-current rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-2 h-2 bg-current rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-2 h-2 bg-current rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                      <span className="text-sm text-muted-foreground">Working...</span>
                    </>
                  )}
                </div>

                {/* Recent completed tools (compact list) */}
                {recentTools.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-2 border-t border-border/50">
                    {recentTools.map((tool, idx) => {
                      const { icon: ToolIcon, label } = getToolDisplay(tool.toolName);
                      const isRunning = tool.status === 'started';
                      return (
                        <button
                          key={`${tool.toolId}-${idx}`}
                          onClick={() => setSelectedToolDetail(tool)}
                          className="ui-pill ui-pill-subtle text-xs hover:bg-muted/70 transition-colors cursor-pointer"
                        >
                          <span className={cn('h-1.5 w-1.5 rounded-full', isRunning ? 'bg-primary' : 'bg-foreground/40')} />
                          <ToolIcon className="h-3 w-3" />
                          <span className="truncate max-w-24">{label}</span>
                          {isRunning && <Loader2 className="h-3 w-3 animate-spin" />}
                          {tool.status === 'completed' && <CheckCircle className="h-3 w-3 text-muted-foreground" />}
                        </button>
                      );
                    })}
                    {currentToolExecutions.length > 5 && (
                      <span className="text-xs text-muted-foreground px-2 py-0.5">
                        +{currentToolExecutions.length - 5} more
                      </span>
                    )}
                  </div>
                )}
              </div>
            </Card>
          </div>
        )}

        {/* Streaming content */}
        {currentStreamingContent && (
          <div className="flex justify-start animate-fade-in">
            <StreamingContent
              content={currentStreamingContent}
              onResponse={(response) => {
                if (id) {
                  // Use sendInput for interactive prompts (raw input without saving to DB)
                  socketService.sendInput(id, response);
                  // Clear streaming content after responding to prompt
                  clearStreamingContent(id);
                }
              }}
            />
          </div>
        )}

        {/* Legacy permission request card (denials-based flow) */}
        {currentPermissionRequest && id && (
          <div className="flex justify-start animate-fade-in">
            <PermissionRequestCard
              sessionId={id}
              denials={currentPermissionRequest.denials}
              originalMessage={currentPermissionRequest.originalMessage}
              className="max-w-[80%]"
            />
          </div>
        )}

        {!isAtBottom && mainView === 'chat' && (
          <div className="sticky bottom-4 flex justify-center pointer-events-none">
            <button
              type="button"
              onClick={scrollToBottom}
              className="pointer-events-auto ui-pill ui-pill-subtle hover:bg-muted/70"
            >
              <ArrowDown className="h-3 w-3" />
              Jump to latest
            </button>
          </div>
        )}

        <div ref={messagesEndRef} />
          </>
        )}
        </div>
      </div>

      {/* Input - Sticky at bottom */}
      <div className="shrink-0 sticky bottom-0 z-40 bg-background pt-2 pb-2">
        {showSavedIndicator && (
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground animate-fade-in pb-2">
            <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
            <span>Response saved</span>
          </div>
        )}
        <ChatInput
          sessionId={id || ''}
          onSendMessage={handleSendMessage}
          onSendMessageWithFiles={handleSendMessageWithFiles}
          onCommandExecute={handleCommandExecute}
          onInterrupt={handleInterrupt}
          commands={commands}
          selectedToolName={selectedToolName}
          selectedCliTool={selectedCliTool}
          quickPrompts={quickPrompts}
          disabled={session.status === 'error'}
          isSending={isSending}
          isExecutingTool={isExecutingTool}
          isActive={isActive}
        />
      </div>

      {/* Permission Approval Dialog (hooks-based flow) */}
      {currentPendingPermission && (
        <PermissionApprovalDialog
          permission={currentPendingPermission}
          onRespond={handlePermissionResponse}
        />
      )}

      {/* Allowed Directories Dialog */}
      <AllowedDirectoriesDialog
        sessionId={id || ''}
        open={showAllowedDirsDialog}
        onOpenChange={setShowAllowedDirsDialog}
        onDirectoriesChanged={() => {
          // Invalidate session query to get updated allowed directories
          queryClient.invalidateQueries({ queryKey: ['session', id] });
        }}
      />

      {/* Tool Detail Dialog */}
      <ToolDetailDialog
        tool={selectedToolDetail}
        open={!!selectedToolDetail}
        onOpenChange={(open) => !open && setSelectedToolDetail(null)}
      />
    </div>
  );
}
