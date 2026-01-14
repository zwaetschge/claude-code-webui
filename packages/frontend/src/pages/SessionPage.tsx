import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Square, FolderOpen, Image, CheckCircle2, Brain, Wrench, FileText, Terminal, Search, Edit3, Globe, ListTodo, Circle, CheckCircle, Loader2, ChevronRight, ChevronDown, GitBranch, MessageSquare, Code2, Star, History, FolderKey, FileCode, File as FileIcon, StickyNote, FileCode2, RotateCcw } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { StreamingContent } from '@/components/chat/StreamingContent';
import { SessionControls } from '@/components/session/SessionControls';
import { FileTree } from '@/components/file-tree';
import { GitPanel } from '@/components/git-panel';
import { CheckpointsPanel } from '@/components/session/CheckpointsPanel';
import { AllowedDirectoriesDialog, DirectoryAccessPrompt } from '@/components/session/AllowedDirectoriesDialog';
import { PermissionRequestCard } from '@/components/session/PermissionRequestCard';
import { NotificationBanner } from '@/components/session/NotificationBanner';
import { EditorPanel } from '@/components/code-editor';
import { WebPreview } from '@/components/preview';
import { MobileBottomNav, type MobileView } from '@/components/mobile';
import { Notepad } from '@/components/notepad';
import { AgentsEditor } from '@/components/agents-editor';
import { useSessionStore } from '@/stores/sessionStore';
import { useAuthStore } from '@/stores/authStore';
import { api } from '@/services/api';
import { socketService } from '@/services/socket';
import type { Session, Message, ApiResponse, MessageImage, MessageAttachment, CliTool, Command, CommandExecutionResult, SessionMode, PermissionAction } from '@claude-code-webui/shared';
import { cn } from '@/lib/utils';
import { ChatInput } from '@/components/chat/ChatInput';
import { InteractiveOptions, detectOptions, isChoicePrompt } from '@/components/chat/InteractiveOptions';
import { ToolExecutionCard } from '@/components/chat/ToolExecutionCard';
import { PermissionApprovalDialog } from '@/components/chat/PermissionApprovalDialog';
import { useDocumentSwipeGesture } from '@/hooks';

function generateId() {
  return Math.random().toString(36).substring(2, 9);
}

export function SessionPage() {
  const { id } = useParams<{ id: string }>();
  const [isSending, setIsSending] = useState(false);
  const [sessionMode, setSessionMode] = useState<SessionMode>('auto-accept');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastMessageIdRef = useRef<string | null>(null);
  const { messages, streamingContent, activity, activeAgent, todos, generatedImages, toolExecutions, permissionRequests, pendingPermissions, setMessages, clearStreamingContent, selectedFile, setSelectedFile, openFile: openFileInStore, openFiles } = useSessionStore();
  const [showSavedIndicator, setShowSavedIndicator] = useState(false);
  const [selectedCliTool, setSelectedCliTool] = useState<string | null>(null);
  const [isExecutingTool, _setIsExecutingTool] = useState(false);
  const cliToolAbortRef = useRef<AbortController | null>(null);
  const [mobileView, setMobileView] = useState<MobileView>('chat');
  const [showAllowedDirsDialog, setShowAllowedDirsDialog] = useState(false);

  const { usage, addMessage } = useSessionStore();

  // Mobile swipe gesture navigation
  const mobileViewOrder = useMemo((): MobileView[] => {
    const views: MobileView[] = ['files', 'chat', 'git'];
    return views;
  }, []);

  const handleSwipeLeft = useCallback(() => {
    // Only work on mobile (screen width < 768px)
    if (window.innerWidth >= 768) return;

    const currentIndex = mobileViewOrder.indexOf(mobileView);
    const nextView = mobileViewOrder[currentIndex + 1];
    if (currentIndex < mobileViewOrder.length - 1 && nextView) {
      setMobileView(nextView);
    }
  }, [mobileView, mobileViewOrder]);

  const handleSwipeRight = useCallback(() => {
    // Only work on mobile (screen width < 768px)
    if (window.innerWidth >= 768) return;

    const currentIndex = mobileViewOrder.indexOf(mobileView);
    const prevView = mobileViewOrder[currentIndex - 1];
    if (currentIndex > 0 && prevView) {
      setMobileView(prevView);
    }
  }, [mobileView, mobileViewOrder]);

  // Set up edge swipe gestures for mobile navigation
  useDocumentSwipeGesture({
    onSwipeLeft: handleSwipeLeft,
    onSwipeRight: handleSwipeRight,
    threshold: 50,
    velocityThreshold: 0.25,
    enabled: true,
  });

  // Fetch available CLI tools
  const { data: cliTools } = useQuery({
    queryKey: ['cli-tools'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<CliTool[]>>('/api/cli-tools');
      return (response.data.data || []).filter(t => t.enabled);
    },
  });

  // Memoized selected tool name for placeholder
  const selectedToolName = useMemo(() => {
    if (!selectedCliTool || !cliTools) return null;
    return cliTools.find(t => t.id === selectedCliTool)?.name;
  }, [selectedCliTool, cliTools]);

  // Fetch usage limits
  const { data: usageLimits } = useQuery({
    queryKey: ['usage-limits'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<{
        rateLimitTier: string;
        fiveHour: { utilization: number; resetsAt: string | null } | null;
        sevenDay: { utilization: number; resetsAt: string | null } | null;
        sevenDaySonnet: { utilization: number; resetsAt: string | null } | null;
      }>>('/api/usage/limits');
      if (response.data.success && response.data.data) {
        const data = response.data.data;
        return {
          session: {
            percentUsed: Math.round(data.fiveHour?.utilization ?? 0),
            resetsAt: data.fiveHour?.resetsAt ? new Date(data.fiveHour.resetsAt) : undefined,
          },
          weeklyAll: {
            percentUsed: Math.round(data.sevenDay?.utilization ?? 0),
            resetsAt: data.sevenDay?.resetsAt ? new Date(data.sevenDay.resetsAt) : undefined,
          },
          weeklySonnet: {
            percentUsed: Math.round(data.sevenDaySonnet?.utilization ?? 0),
            resetsAt: data.sevenDaySonnet?.resetsAt ? new Date(data.sevenDaySonnet.resetsAt) : undefined,
          },
        };
      }
      return null;
    },
    refetchInterval: 60000, // Refresh every minute
    retry: false, // Don't retry on error (Cloudflare may block)
    refetchOnWindowFocus: false,
  });

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
  const [showTodos, setShowTodos] = useState(true);
  const [rightPanelTab, setRightPanelTab] = useState<'files' | 'todos' | 'git' | 'checkpoints' | 'notes' | 'agents'>('files');
  const [mainView, setMainView] = useState<'chat' | 'editor' | 'preview'>('chat');
  const currentSelectedFile = selectedFile[id || ''];
  const currentOpenFiles = openFiles[id || ''] || [];
  const hasOpenFiles = currentOpenFiles.length > 0;

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
  ].sort((a, b) => a.timestamp - b.timestamp), [sessionMessages, currentGeneratedImages]);

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
      'Write': { icon: FileText, label: 'Writing file' },
      'Read': { icon: Search, label: 'Reading file' },
      'Edit': { icon: Edit3, label: 'Editing file' },
      'Bash': { icon: Terminal, label: 'Running command' },
      'Glob': { icon: Search, label: 'Searching files' },
      'Grep': { icon: Search, label: 'Searching code' },
      'WebFetch': { icon: Globe, label: 'Fetching webpage' },
      'WebSearch': { icon: Globe, label: 'Searching web' },
      'Task': { icon: Brain, label: 'Starting agent' },
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

  // Connect to socket and subscribe to session (with reconnect support)
  useEffect(() => {
    if (!id) return;

    socketService.connect();
    // Use reconnect instead of subscribe to get buffered messages if session is running
    socketService.reconnectToSession(id);

    return () => {
      socketService.unsubscribeFromSession(id);
    };
  }, [id]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [sessionMessages, currentStreamingContent]);

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

  // Sync mobile view with right panel tab
  useEffect(() => {
    if (mobileView === 'git') {
      setRightPanelTab('git');
      setShowTodos(true);
    } else if (mobileView === 'todos') {
      setRightPanelTab('todos');
      setShowTodos(true);
    } else if (mobileView === 'editor') {
      setMainView('editor');
    } else if (mobileView === 'chat') {
      setMainView('chat');
    }
  }, [mobileView]);

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
        currentModel: 'claude-sonnet-4-20250514',
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

  const handleModeChange = useCallback((newMode: SessionMode) => {
    setSessionMode(newMode);
    if (id) {
      socketService.setSessionMode(id, newMode);
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
    <div className="flex flex-col h-full min-h-0 relative">

      {/* Session Header */}
      <div className="shrink-0 pb-4 border-b mb-4 space-y-3 overflow-visible">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              <button
                onClick={() => starMutation.mutate()}
                disabled={starMutation.isPending}
                className="hover:scale-110 transition-transform"
                title={session.starred ? 'Unstar session' : 'Star session'}
              >
                <Star
                  className={cn(
                    'h-5 w-5 transition-colors',
                    session.starred
                      ? 'text-amber-500 fill-amber-500'
                      : 'text-muted-foreground hover:text-amber-400'
                  )}
                />
              </button>
              {session.name}
              <span
                className={cn(
                  'inline-block h-2.5 w-2.5 rounded-full',
                  session.status === 'running' && 'bg-green-500 animate-pulse',
                  session.status === 'stopped' && 'bg-gray-400',
                  session.status === 'error' && 'bg-red-500'
                )}
              />
            </h2>
            <div className="text-sm text-muted-foreground flex items-center gap-1.5">
              <FolderOpen className="h-3.5 w-3.5" />
              <span className="truncate max-w-[200px] md:max-w-none">{session.workingDirectory}</span>
              <button
                onClick={() => setShowAllowedDirsDialog(true)}
                className="ml-1 p-1 rounded hover:bg-muted transition-colors"
                title="Manage allowed directories"
              >
                <FolderKey className="h-3.5 w-3.5 text-primary" />
              </button>
            </div>
          </div>
          <div className="flex gap-2 items-center">
            {/* CLI Tool selector - visible in header */}
            {cliTools && cliTools.length > 0 && (
              <div className="relative shrink-0">
                <select
                  value={selectedCliTool || ''}
                  onChange={(e) => setSelectedCliTool(e.target.value || null)}
                  className={cn(
                    "h-9 px-2 md:px-3 rounded-lg border text-xs md:text-sm font-medium transition-all cursor-pointer",
                    "focus:outline-none focus:ring-2 focus:ring-ring",
                    selectedCliTool
                      ? "bg-orange-500/10 border-orange-500/50 text-orange-600 dark:text-orange-400"
                      : "bg-background border-input text-muted-foreground hover:bg-muted"
                  )}
                >
                  <option value="">Claude</option>
                  {cliTools.map((tool) => (
                    <option key={tool.id} value={tool.id}>
                      {tool.name}
                    </option>
                  ))}
                </select>
                {selectedCliTool && (
                  <div className="absolute -top-1 -right-1 w-2 h-2 bg-orange-500 rounded-full animate-pulse" />
                )}
              </div>
            )}

            {/* Notification toggle */}
            <NotificationBanner />

            {session.status === 'running' && (
              <Button variant="outline" onClick={handleInterrupt} className="gap-2 h-9">
                <Square className="h-4 w-4" />
                <span className="hidden sm:inline">Interrupt</span>
              </Button>
            )}
            <Button variant="outline" onClick={handleRestart} className="gap-2 h-9" title="Restart Claude session">
              <RotateCcw className="h-4 w-4" />
              <span className="hidden sm:inline">Restart</span>
            </Button>
            {isExecutingTool && (
              <Button variant="outline" onClick={handleCancelCliTool} className="gap-2 h-9 border-orange-500/50 text-orange-600 hover:bg-orange-500/10">
                <Square className="h-4 w-4" />
                <span className="hidden sm:inline">Cancel</span>
              </Button>
            )}

            {/* View Toggle */}
            <div className="flex gap-1 bg-muted rounded-lg p-0.5">
              <button
                onClick={() => setMainView('chat')}
                className={cn(
                  "flex items-center gap-1.5 px-2 py-1 text-xs rounded-md transition-colors",
                  mainView === 'chat'
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <MessageSquare className="h-3.5 w-3.5" />
                Chat
              </button>
              {hasOpenFiles && (
                <button
                  onClick={() => setMainView('editor')}
                  className={cn(
                    "flex items-center gap-1.5 px-2 py-1 text-xs rounded-md transition-colors",
                    mainView === 'editor'
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Code2 className="h-3.5 w-3.5" />
                  Editor
                  <span className="px-1 py-0.5 text-[10px] rounded-full bg-muted">
                    {currentOpenFiles.length}
                  </span>
                </button>
              )}
              <button
                onClick={() => setMainView('preview')}
                className={cn(
                  "flex items-center gap-1.5 px-2 py-1 text-xs rounded-md transition-colors",
                  mainView === 'preview'
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Globe className="h-3.5 w-3.5" />
                Preview
              </button>
            </div>
          </div>
        </div>

        {/* Controls Bar */}
        <SessionControls
          mode={sessionMode}
          onModeChange={handleModeChange}
          usage={currentUsage}
          sessionLimit={usageLimits?.session}
          weeklyAllModels={usageLimits?.weeklyAll}
          weeklySonnet={usageLimits?.weeklySonnet}
        />
      </div>

      {/* Main content area with sidebar */}
      <div className="flex-1 min-h-0 flex gap-4">
        {/* Main Content - Chat or Editor (hidden on mobile for files/git/todos views) */}
        <div className={cn(
          "flex-1 min-h-0",
          mainView === 'chat' && "overflow-auto space-y-4 pb-4",
          showTodos && "pr-4",
          // Mobile: hide for files, git, todos views
          (mobileView === 'files' || mobileView === 'git' || mobileView === 'todos') && "hidden md:block"
        )}>
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
            return (
              <div
                key={message.id}
                className={cn('flex animate-fade-in', message.role === 'user' ? 'justify-end' : 'justify-start')}
              >
                <Card
                  className={cn(
                    'max-w-[80%] p-4',
                    message.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-card border'
                  )}
                >
                  {/* File attachments for user messages */}
                  {((message.images && message.images.length > 0) || (message.attachments && message.attachments.length > 0)) && (
                    <div className="flex flex-wrap gap-2 mb-3">
                      {/* Legacy images support */}
                      {message.images?.map((img: MessageImage, imgIndex: number) => {
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
                <Card className="max-w-[80%] p-4 bg-gradient-to-br from-purple-500/10 to-blue-500/10 border-purple-500/30">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="p-1.5 rounded-full bg-purple-500/20">
                      <Image className="h-4 w-4 text-purple-500" />
                    </div>
                    <span className="text-sm font-medium text-purple-600 dark:text-purple-400">
                      Generated Image (Gemini)
                    </span>
                  </div>
                  {img.imageBase64 && (
                    <img
                      src={`data:${img.mimeType};base64,${img.imageBase64}`}
                      alt={img.prompt}
                      className="max-w-full rounded-lg border border-purple-500/20 cursor-pointer hover:opacity-90 transition-opacity mb-3"
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
            <Card className={cn(
              "border p-4 max-w-[80%]",
              currentActiveAgent ? "bg-purple-500/10 border-purple-500/30" :
              currentActivity.type === 'tool' ? "bg-blue-500/10 border-blue-500/30" : "bg-card"
            )}>
              <div className="space-y-3">
                {/* Current activity */}
                <div className="flex items-center gap-3">
                  {/* Active Agent indicator - highest priority */}
                  {currentActiveAgent ? (
                    <>
                      <div className="relative">
                        <Brain className="h-5 w-5 text-purple-500" />
                        <span className="absolute -top-1 -right-1 w-2 h-2 bg-purple-500 rounded-full animate-ping" />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-purple-600 dark:text-purple-400">
                          Agent: {getAgentDisplay(currentActiveAgent.agentType)}
                        </span>
                        {currentActiveAgent.description && (
                          <span className="text-xs text-muted-foreground">{currentActiveAgent.description}</span>
                        )}
                      </div>
                    </>
                  ) : currentActivity.type === 'thinking' ? (
                    <>
                      <Brain className="h-5 w-5 text-amber-500 animate-pulse" />
                      <div className="flex flex-col">
                        <span className="text-sm font-medium">Claude is thinking...</span>
                        <span className="text-xs text-muted-foreground">Analyzing request</span>
                      </div>
                    </>
                  ) : currentActivity.type === 'tool' && currentActivity.toolName ? (
                    <>
                      {(() => {
                        const { icon: ToolIcon, label } = getToolDisplay(currentActivity.toolName);
                        return (
                          <>
                            <div className="relative">
                              <ToolIcon className="h-5 w-5 text-blue-500" />
                              <span className="absolute -top-1 -right-1 w-2 h-2 bg-blue-500 rounded-full animate-ping" />
                            </div>
                            <div className="flex flex-col">
                              <span className="text-sm font-medium text-blue-600 dark:text-blue-400">{label}</span>
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
                        <div
                          key={`${tool.toolId}-${idx}`}
                          className={cn(
                            "flex items-center gap-1 px-2 py-0.5 rounded-full text-xs",
                            isRunning
                              ? "bg-blue-500/20 text-blue-600 dark:text-blue-400"
                              : "bg-muted/50 text-muted-foreground"
                          )}
                        >
                          <ToolIcon className="h-3 w-3" />
                          <span className="truncate max-w-24">{label}</span>
                          {isRunning && <Loader2 className="h-3 w-3 animate-spin" />}
                          {tool.status === 'completed' && <CheckCircle className="h-3 w-3 text-green-500" />}
                        </div>
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

        <div ref={messagesEndRef} />
          </>
        )}
        </div>

        {/* Right Sidebar - Todos & Git (hidden on mobile unless mobileView is 'git' or 'todos') */}
        <div className={cn(
          "shrink-0 transition-all duration-200",
          showTodos ? "w-80" : "w-10",
          // Mobile: hide unless mobileView is 'git' or 'todos'
          (mobileView !== 'git' && mobileView !== 'todos') && "hidden md:block",
          (mobileView === 'git' || mobileView === 'todos') && "md:block w-full md:w-80"
        )}>
          <Card className="h-full flex flex-col bg-card/50 backdrop-blur-sm border-x border-t rounded-b-none">
            {/* Sidebar Header with Tabs */}
            <div className="shrink-0 p-2 border-b">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setShowTodos(!showTodos)}
                  className="p-1 hover:bg-muted rounded-sm transition-colors shrink-0"
                >
                  {showTodos ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>

                {showTodos && (
                  <div className="flex gap-0.5 flex-1 bg-muted rounded-lg p-0.5 min-w-0">
                    <button
                      onClick={() => setRightPanelTab('files')}
                      className={cn(
                        "flex items-center justify-center gap-1 px-2 py-1 text-xs rounded-md transition-colors flex-1 min-w-0",
                        rightPanelTab === 'files'
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                      title="Files"
                    >
                      <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">Files</span>
                    </button>
                    <button
                      onClick={() => setRightPanelTab('todos')}
                      className={cn(
                        "flex items-center justify-center gap-1 px-2 py-1 text-xs rounded-md transition-colors flex-1 min-w-0 relative",
                        rightPanelTab === 'todos'
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                      title="Tasks"
                    >
                      <ListTodo className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">Tasks</span>
                      {currentTodos.filter(t => t.status !== 'completed').length > 0 && (
                        <span className="absolute -top-1 -right-1 w-4 h-4 text-[10px] rounded-full bg-primary text-primary-foreground flex items-center justify-center">
                          {currentTodos.filter(t => t.status !== 'completed').length}
                        </span>
                      )}
                    </button>
                    <button
                      onClick={() => setRightPanelTab('git')}
                      className={cn(
                        "flex items-center justify-center gap-1 px-2 py-1 text-xs rounded-md transition-colors flex-1 min-w-0",
                        rightPanelTab === 'git'
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                      title="Git"
                    >
                      <GitBranch className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">Git</span>
                    </button>
                    <button
                      onClick={() => setRightPanelTab('checkpoints')}
                      className={cn(
                        "flex items-center justify-center gap-1 px-2 py-1 text-xs rounded-md transition-colors flex-1 min-w-0",
                        rightPanelTab === 'checkpoints'
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                      title="Checkpoints"
                    >
                      <History className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">Saves</span>
                    </button>
                    <button
                      onClick={() => setRightPanelTab('notes')}
                      className={cn(
                        "flex items-center justify-center gap-1 px-2 py-1 text-xs rounded-md transition-colors flex-1 min-w-0",
                        rightPanelTab === 'notes'
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                      title="Notes"
                    >
                      <StickyNote className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">Notes</span>
                    </button>
                    <button
                      onClick={() => setRightPanelTab('agents')}
                      className={cn(
                        "flex items-center justify-center gap-1 px-2 py-1 text-xs rounded-md transition-colors flex-1 min-w-0",
                        rightPanelTab === 'agents'
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                      title="AGENTS.md"
                    >
                      <FileCode2 className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">Agents</span>
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Content */}
            {showTodos && (
              <div className="flex-1 min-h-0 overflow-hidden">
                {rightPanelTab === 'files' ? (
                  <FileTree
                    workingDirectory={session.workingDirectory}
                    selectedFile={currentSelectedFile || null}
                    onFileSelect={(path) => id && setSelectedFile(id, path)}
                    onFileOpen={(path, content) => id && openFileInStore(id, path, content)}
                    className="h-full"
                  />
                ) : rightPanelTab === 'todos' ? (
                  <div className="p-2 space-y-2 overflow-auto h-full">
                    {currentTodos.length === 0 ? (
                      <div className="text-center py-4 text-sm text-muted-foreground">
                        No tasks
                      </div>
                    ) : (
                      currentTodos.map((todo, index) => (
                        <div
                          key={index}
                          className={cn(
                            "flex items-start gap-2 p-2 rounded-lg text-xs transition-colors",
                            todo.status === 'completed' && "bg-green-500/10 text-muted-foreground",
                            todo.status === 'in_progress' && "bg-blue-500/10 border border-blue-500/30",
                            todo.status === 'pending' && "bg-muted/50"
                          )}
                        >
                          {/* Status Icon */}
                          <div className="shrink-0 mt-0.5">
                            {todo.status === 'completed' && (
                              <CheckCircle className="h-4 w-4 text-green-500" />
                            )}
                            {todo.status === 'in_progress' && (
                              <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
                            )}
                            {todo.status === 'pending' && (
                              <Circle className="h-4 w-4 text-muted-foreground" />
                            )}
                          </div>

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <p className={cn(
                              "leading-snug",
                              todo.status === 'completed' && "line-through",
                              todo.status === 'in_progress' && "font-medium text-blue-600 dark:text-blue-400"
                            )}>
                              {todo.status === 'in_progress' && todo.activeForm ? todo.activeForm : todo.content}
                            </p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                ) : rightPanelTab === 'git' ? (
                  <GitPanel workingDirectory={session.workingDirectory} className="h-full" />
                ) : rightPanelTab === 'checkpoints' ? (
                  <CheckpointsPanel
                    sessionId={id!}
                    className="h-full"
                    onRestore={() => {
                      // Refetch messages after restore
                      queryClient.invalidateQueries({ queryKey: ['messages', id] });
                    }}
                  />
                ) : rightPanelTab === 'notes' ? (
                  <Notepad
                    sessionId={id}
                    onSendToChat={(content) => {
                      handleSendMessage(content);
                    }}
                    className="h-full"
                  />
                ) : rightPanelTab === 'agents' ? (
                  <AgentsEditor
                    workingDirectory={session.workingDirectory}
                    className="h-full"
                  />
                ) : null}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Input */}
      {showSavedIndicator && (
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground animate-fade-in pt-2">
          <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
          <span>Response saved</span>
        </div>
      )}
      <ChatInput
        sessionId={id || ''}
        onSendMessage={handleSendMessage}
        onSendMessageWithFiles={handleSendMessageWithFiles}
        onCommandExecute={handleCommandExecute}
        commands={commands}
        selectedToolName={selectedToolName}
        selectedCliTool={selectedCliTool}
        disabled={session.status === 'error'}
        isSending={isSending}
        isExecutingTool={isExecutingTool}
      />

      {/* Permission Approval Dialog (hooks-based flow) */}
      {currentPendingPermission && (
        <PermissionApprovalDialog
          permission={currentPendingPermission}
          onRespond={handlePermissionResponse}
        />
      )}

      {/* Mobile Bottom Navigation */}
      <MobileBottomNav
        activeView={mobileView}
        onViewChange={setMobileView}
        hasOpenFiles={hasOpenFiles}
        hasTodos={showTodos}
        changesCount={0}
        todosCount={currentTodos.length}
      />

      {/* Mobile padding for bottom nav */}
      <div className="md:hidden h-14" />

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
    </div>
  );
}
