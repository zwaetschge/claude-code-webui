import { useEffect, useRef, useState, useCallback, useMemo, type ReactElement } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  MoreHorizontal,
  FolderOpen,
  Image,
  CheckCircle2,
  Brain,
  Wrench,
  FileText,
  Terminal,
  Search,
  Edit3,
  Globe,
  ListTodo,
  Circle,
  CheckCircle,
  Loader2,
  MessageSquare,
  Code2,
  Star,
  FolderKey,
  X,
  Activity,
  Pencil,
  Settings,
} from 'lucide-react';
import 'katex/dist/katex.min.css';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Card } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { StreamingContent } from '@/components/chat/StreamingContent';
import { ProviderLoader } from '@/components/chat/providerAnimations/ProviderLoader';
import { ContextPopover } from '@/components/session/SessionControls';
import { SessionSettingsChip } from '@/components/session/SessionSettingsChip';
import { AllowedDirectoriesDialog } from '@/components/session/AllowedDirectoriesDialog';
import { PermissionRequestCard } from '@/components/session/PermissionRequestCard';
import { EditorPanel } from '@/components/code-editor';
import { WorkspaceFiles } from '@/components/files';
import { AgentsEditor } from '@/components/agents-editor';
import { MemoryViewer } from '@/components/memory-viewer';
import { ToolLogPanel } from '@/components/session/ToolLogPanel';
import { RunCockpit } from '@/components/session/RunCockpit';
import { RenameSessionDialog } from '@/components/session/RenameSessionDialog';
import { CompactBoundaryCard } from '@/components/chat/CompactBoundaryCard';
import { MessageBubble } from '@/components/chat/MessageBubble';
import { ToolExecutionCard } from '@/components/chat/ToolExecutionCard';
import { ToolDetailDialog } from '@/components/session/ToolDetailDialog';
import { ProviderLogo } from '@/components/branding/ProviderLogo';
import {
  useSessionStore,
  type ActivityState,
  type TodoItem,
  type GeneratedImage,
  type OpenFile,
} from '@/stores/sessionStore';
import { useProviderStore } from '@/stores/providerStore';
import { usePanelDockStore, type DockablePanel } from '@/stores/panelDockStore';
import { useShallow } from 'zustand/react/shallow';
import { api } from '@/services/api';
import { socketService } from '@/services/socket';
import type {
  Session,
  Message,
  ApiResponse,
  CliTool,
  Command,
  CommandExecutionResult,
  SessionMode,
  PermissionAction,
  CLIProvider,
  UserSettings,
  ToolExecution,
} from '@claude-code-webui/shared';
import { cn } from '@/lib/utils';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { ChatInput } from '@/components/chat/ChatInput';
import { PermissionApprovalDialog } from '@/components/chat/PermissionApprovalDialog';
import {
  CLI_PROVIDER_DEFAULT_MODEL,
  CLI_PROVIDER_LABEL,
  toUiProvider,
  toCliProvider,
  type UiProvider,
} from '@/lib/providers';
import { toast } from '@/hooks/use-toast';

function generateId() {
  return Math.random().toString(36).substring(2, 9);
}

// Stable empty references prevent selector fallbacks from triggering re-renders
const EMPTY_MESSAGES: Message[] = [];
const EMPTY_TODOS: TodoItem[] = [];
const EMPTY_IMAGES: GeneratedImage[] = [];
const EMPTY_TOOL_EXECUTIONS: ToolExecution[] = [];
const EMPTY_OPEN_FILES: OpenFile[] = [];
const IDLE_ACTIVITY: ActivityState = { type: 'idle' };
type WorkspaceSheetPanel = Exclude<DockablePanel, 'files'>;
type MobileSheetPanel = WorkspaceSheetPanel | 'settings';
const DOCKED_PANEL_KEYS: WorkspaceSheetPanel[] = ['tasks', 'config', 'tools'];
const RIGHT_RAIL_PANEL_KEYS: WorkspaceSheetPanel[] = ['tasks', 'tools'];

export function SessionPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [isSending, setIsSending] = useState(false);
  const [sessionMode, setSessionMode] = useState<SessionMode>('auto-accept');
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const lastMessageIdRef = useRef<string | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  // Floating header + input overlay: measure their heights so the scroll area
  // below gets matching top/bottom padding. Without this, content scrolls
  // completely behind the bars and the top/bottom rows are permanently hidden.
  const headerBarRef = useRef<HTMLDivElement>(null);
  const inputBarRef = useRef<HTMLDivElement>(null);
  const rootShellRef = useRef<HTMLDivElement>(null);

  // Per-session slices: shallow-compared so unrelated sessions don't trigger re-renders
  const {
    sessionMessages,
    currentStreamingContent,
    currentActivity,
    currentUsage,
    currentTodos,
    currentActiveAgent,
    currentGeneratedImages,
    currentToolExecutions,
    currentQueue,
    currentPendingPermission,
    currentOpenFiles,
  } = useSessionStore(
    useShallow((s) => {
      const sid = id ?? '';
      return {
        sessionMessages: s.messages[sid] ?? EMPTY_MESSAGES,
        currentStreamingContent: s.streamingContent[sid] ?? '',
        currentActivity: s.activity[sid] ?? IDLE_ACTIVITY,
        currentUsage: s.usage[sid],
        currentTodos: s.todos[sid] ?? EMPTY_TODOS,
        currentActiveAgent: s.activeAgent[sid] ?? null,
        currentGeneratedImages: s.generatedImages[sid] ?? EMPTY_IMAGES,
        currentToolExecutions: s.toolExecutions[sid] ?? EMPTY_TOOL_EXECUTIONS,
        currentQueue: s.queueState[sid] ?? null,
        currentPendingPermission: s.pendingPermissions[sid] ?? null,
        currentOpenFiles: s.openFiles[sid] ?? EMPTY_OPEN_FILES,
      };
    })
  );

  // Actions are stable Zustand refs — subscribing doesn't trigger re-renders
  const setMessages = useSessionStore((s) => s.setMessages);
  const addMessage = useSessionStore((s) => s.addMessage);
  const clearStreamingContent = useSessionStore((s) => s.clearStreamingContent);
  const openFileInStore = useSessionStore((s) => s.openFile);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);

  const [showSavedIndicator, setShowSavedIndicator] = useState(false);
  const [selectedCliTool, setSelectedCliTool] = useState<string | null>(null);
  const [isExecutingTool, _setIsExecutingTool] = useState(false);
  const cliToolAbortRef = useRef<AbortController | null>(null);
  const [showAllowedDirsDialog, setShowAllowedDirsDialog] = useState(false);
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [mobileSheetPanel, setMobileSheetPanel] = useState<MobileSheetPanel | null>(null);

  useEffect(() => {
    const handler = () => setShowAllowedDirsDialog(true);
    window.addEventListener('command:open-allowed-dirs', handler);
    return () => window.removeEventListener('command:open-allowed-dirs', handler);
  }, []);

  const [selectedToolDetail, setSelectedToolDetail] = useState<
    (typeof currentToolExecutions)[0] | null
  >(null);
  const loadedModeForSessionRef = useRef<string | null>(null);

  const { uiProvider, setProvider } = useProviderStore();
  const pinnedPanels = usePanelDockStore((s) => s.pinned);
  const togglePinPanel = usePanelDockStore((s) => s.togglePin);
  const setPinnedPanel = usePanelDockStore((s) => s.setPinned);
  const unpinAllPanels = usePanelDockStore((s) => s.unpinAll);
  const anyPanelPinned = DOCKED_PANEL_KEYS.some((panel) => pinnedPanels[panel]);
  const sessionModeStorageKey = useMemo(() => (id ? `sessionMode:${id}` : null), [id]);

  const scrollToBottom = useCallback(() => {
    virtuosoRef.current?.scrollToIndex({ index: 'LAST', behavior: 'smooth' });
    setIsAtBottom(true);
  }, []);

  // Sync floating header/input heights into CSS vars on the shell so the
  // scroll area can reserve matching top/bottom padding.
  useEffect(() => {
    const shell = rootShellRef.current;
    if (!shell || typeof ResizeObserver === 'undefined') return;
    const setVar = (name: string, el: HTMLElement | null) => {
      if (!el) return;
      shell.style.setProperty(name, `${el.offsetHeight}px`);
    };
    const ro = new ResizeObserver(() => {
      setVar('--chat-header-h', headerBarRef.current);
      setVar('--chat-input-h', inputBarRef.current);
    });
    if (headerBarRef.current) ro.observe(headerBarRef.current);
    if (inputBarRef.current) ro.observe(inputBarRef.current);
    // Prime the values on mount
    setVar('--chat-header-h', headerBarRef.current);
    setVar('--chat-input-h', inputBarRef.current);
    return () => ro.disconnect();
  }, []);

  // Fetch available CLI tools
  const { data: cliTools } = useQuery({
    queryKey: ['cli-tools'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<CliTool[]>>('/api/cli-tools');
      return (response.data.data || []).filter((t) => t.enabled);
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
    return cliTools.find((t) => t.id === selectedCliTool)?.name;
  }, [selectedCliTool, cliTools]);

  const [mainView, setMainView] = useState<'chat' | 'editor' | 'files'>('chat');
  const [configTab, setConfigTab] = useState<'memories' | 'agents'>('memories');
  const [runCockpitOpen, setRunCockpitOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('chat.runCockpitOpen') === '1';
  });
  const toggleRunCockpit = useCallback(() => {
    setRunCockpitOpen((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('chat.runCockpitOpen', next ? '1' : '0');
      }
      return next;
    });
  }, []);

  const closeActivityRails = useCallback(() => {
    setRunCockpitOpen(false);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('chat.runCockpitOpen', '0');
    }
  }, []);

  const openRightPanel = useCallback(
    (panel: WorkspaceSheetPanel) => {
      const openCount = DOCKED_PANEL_KEYS.filter((key) => pinnedPanels[key]).length;
      const isOnlyOpenPanel = pinnedPanels[panel] && openCount === 1;

      unpinAllPanels();
      if (!isOnlyOpenPanel) {
        setPinnedPanel(panel, true);
        closeActivityRails();
      }
    },
    [closeActivityRails, pinnedPanels, setPinnedPanel, unpinAllPanels]
  );

  const openWorkspacePanel = useCallback(
    (panel: WorkspaceSheetPanel) => {
      const isDesktop =
        typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches;
      if (isDesktop) {
        openRightPanel(panel);
      } else {
        setMobileSheetPanel(panel);
      }
    },
    [openRightPanel]
  );

  const hasOpenFiles = currentOpenFiles.length > 0;

  // Combine messages, generated images and tool executions into a single timeline
  type TimelineItem =
    | { type: 'message'; data: Message; timestamp: number }
    | { type: 'image'; data: (typeof currentGeneratedImages)[0]; timestamp: number }
    | { type: 'tool'; data: (typeof currentToolExecutions)[0]; timestamp: number };

  const timeline = useMemo<TimelineItem[]>(
    () =>
      [
        ...sessionMessages.map((msg) => ({
          type: 'message' as const,
          data: msg,
          timestamp: new Date(msg.createdAt).getTime(),
        })),
        ...currentGeneratedImages.map((img) => ({
          type: 'image' as const,
          data: img,
          timestamp: img.timestamp,
        })),
        ...currentToolExecutions.map((tool) => ({
          type: 'tool' as const,
          data: tool,
          timestamp: tool.timestamp,
        })),
      ]
        .map((item, _sortIdx) => ({ ...item, _sortIdx }))
        .sort((a, b) => a.timestamp - b.timestamp || a._sortIdx - b._sortIdx)
        .map(({ _sortIdx, ...rest }) => rest as TimelineItem),
    [sessionMessages, currentGeneratedImages, currentToolExecutions]
  );

  // Get recent tool executions for showing during activity (last 5 completed or in-progress)
  const recentTools = useMemo(
    () =>
      currentToolExecutions
        .filter((t) => t.status === 'started' || t.status === 'completed')
        .slice(-5),
    [currentToolExecutions]
  );

  // Live ref of the current timeline so Run turn jumps always read
  // fresh indices without retriggering Virtuoso's internal observers.
  const timelineRef = useRef<TimelineItem[]>([]);
  timelineRef.current = timeline;

  // Per-item flag: is this item visually part of an open assistant turn?
  // Tools and generated images are always assistant-produced, so they always
  // belong to an assistant turn (true even when they arrive before the
  // assistant's text reply, i.e. the previous neighbour in the timeline is
  // still the user's message). For messages themselves we only mark assistant
  // messages — user messages render as right-aligned tail bubbles outside the
  // rail. This keeps the continuous left rail from breaking when the model
  // calls tools first and replies in text afterwards.
  const inAssistantTurn = useMemo(() => {
    return timeline.map((item) => {
      if (item.type === 'message') {
        return (item.data as Message).role === 'assistant';
      }
      return true;
    });
  }, [timeline]);

  const jumpToMessage = useCallback((messageId: string) => {
    const idx = timelineRef.current.findIndex(
      (item) => item.type === 'message' && (item.data as { id?: string }).id === messageId
    );
    if (idx >= 0) {
      virtuosoRef.current?.scrollToIndex({ index: idx, behavior: 'smooth', align: 'start' });
    }
  }, []);

  const jumpToMessageFromRun = useCallback(
    (messageId: string) => {
      setMainView('chat');
      if (typeof window === 'undefined') {
        jumpToMessage(messageId);
        return;
      }
      window.requestAnimationFrame(() => jumpToMessage(messageId));
    },
    [jumpToMessage]
  );

  // Helper to get tool icon and name - memoized to prevent re-creation on every render
  const getToolDisplay = useCallback((toolName: string) => {
    const toolMap: Record<string, { icon: typeof Wrench; label: string }> = {
      // Claude tools
      Write: { icon: FileText, label: 'Writing file' },
      Read: { icon: Search, label: 'Reading file' },
      Edit: { icon: Edit3, label: 'Editing file' },
      Bash: { icon: Terminal, label: 'Running command' },
      Glob: { icon: Search, label: 'Searching files' },
      Grep: { icon: Search, label: 'Searching code' },
      WebFetch: { icon: Globe, label: 'Fetching webpage' },
      WebSearch: { icon: Globe, label: 'Searching web' },
      Task: { icon: Brain, label: 'Starting agent' },
      Agent: { icon: Brain, label: 'Starting agent' },
      // Codex / generic tool names
      read_file: { icon: Search, label: 'Reading file' },
      read_many_files: { icon: Search, label: 'Reading files' },
      write_file: { icon: FileText, label: 'Writing file' },
      replace: { icon: Edit3, label: 'Editing file' },
      run_shell_command: { icon: Terminal, label: 'Running command' },
      shell: { icon: Terminal, label: 'Running command' },
      glob: { icon: Search, label: 'Searching files' },
      grep_search: { icon: Search, label: 'Searching code' },
      list_directory: { icon: Search, label: 'Listing directory' },
      TodoWrite: { icon: FileText, label: 'Updating tasks' },
      TodoRead: { icon: Search, label: 'Reading tasks' },
    };
    return toolMap[toolName] || { icon: Wrench, label: toolName };
  }, []);

  // Helper to get agent display name - memoized
  const getAgentDisplay = useCallback((agentType: string) => {
    const agentMap: Record<string, string> = {
      Explore: 'Explorer',
      Plan: 'Planner',
      'general-purpose': 'General',
      'claude-code-guide': 'Documentation',
      'research-bot': 'Research',
      'frontend-developer': 'Frontend Dev',
      'mobile-developer': 'Mobile Dev',
      'backend-dev': 'Backend Dev',
      'fullstack-dev': 'Fullstack Dev',
      'api-designer': 'API Designer',
      'ui-designer': 'UI Designer',
      devops: 'DevOps',
      'devops-engineer': 'DevOps',
      database: 'Database',
      'database-specialist': 'Database',
      'git-ops': 'Git Ops',
      'git-operations': 'Git Ops',
      debugger: 'Debugger',
      'debugging-expert': 'Debugger',
      architect: 'Architect',
      'system-architect': 'Architect',
      'test-engineer': 'Test Engineer',
      'security-auditor': 'Security',
      'performance-optimizer': 'Performance',
      'release-manager': 'Release',
      'data-engineer': 'Data Engineer',
      'documentation-writer': 'Docs',
      'statusline-setup': 'Status Line',
    };
    return agentMap[agentType] || agentType;
  }, []);

  const getAgentDescription = useCallback((agentType: string) => {
    const descriptions: Record<string, string> = {
      Explore: 'Exploring project',
      Plan: 'Drafting a plan',
      'general-purpose': 'Handling general tasks',
      'claude-code-guide': 'Checking docs',
      'research-bot': 'Researching',
      'frontend-developer': 'Working on UI',
      'mobile-developer': 'Working on mobile',
      'backend-dev': 'Working on backend',
      'fullstack-dev': 'Working across stack',
      'api-designer': 'Designing API',
      'ui-designer': 'Designing UI',
      devops: 'Handling infra',
      'devops-engineer': 'Handling infra',
      database: 'Working on database',
      'database-specialist': 'Working on database',
      'git-ops': 'Managing git tasks',
      'git-operations': 'Managing git tasks',
      debugger: 'Debugging',
      'debugging-expert': 'Debugging',
      architect: 'Designing architecture',
      'system-architect': 'Designing architecture',
      'test-engineer': 'Writing tests',
      'security-auditor': 'Auditing security',
      'performance-optimizer': 'Optimizing performance',
      'release-manager': 'Managing release',
      'data-engineer': 'Working on data pipeline',
      'documentation-writer': 'Writing documentation',
      'statusline-setup': 'Configuring status line',
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

  // Refs keep a live handle on values the stable Virtuoso Footer/Header
  // closures need to read. The components object is memoized with empty deps
  // (see virtuosoComponents below) so Virtuoso keeps the same component
  // identity across parent renders — otherwise every state change would
  // remount Footer and restart every CSS/SVG animation inside it.
  const footerDepsRef = useRef<{
    id: string | undefined;
    uiProvider: UiProvider;
    providerLabel: string;
    getAgentDisplay: typeof getAgentDisplay;
    getAgentDescription: typeof getAgentDescription;
    getToolDisplay: typeof getToolDisplay;
    formatElapsed: typeof formatElapsed;
    clearStreamingContent: typeof clearStreamingContent;
  } | null>(null);

  const virtuosoComponents = useMemo(() => {
    function ChatFooter() {
      const sid = footerDepsRef.current?.id ?? '';
      const footerActivity = useSessionStore((s) => s.activity[sid] ?? IDLE_ACTIVITY);
      const footerActiveAgent = useSessionStore((s) => s.activeAgent[sid] ?? null);
      const footerStreamingContent = useSessionStore((s) => s.streamingContent[sid] ?? '');
      const footerPermissionRequest = useSessionStore((s) => s.permissionRequests[sid] ?? null);
      const [footerNow, setFooterNow] = useState(() => Date.now());
      useEffect(() => {
        const intervalId = window.setInterval(() => setFooterNow(Date.now()), 1000);
        return () => window.clearInterval(intervalId);
      }, []);
      const deps = footerDepsRef.current;
      if (!deps) {
        return <div aria-hidden style={{ height: '8px' }} />;
      }
      return (
        <div className="chat-stream pb-2">
          {/* Tool activity is rendered as a compact ToolExecutionCard inside the
              timeline (see itemContent → 'tool' branch) — it appears at the
              correct chronological position with a live spinner + duration and
              persists after completion. The footer only handles state with no
              timeline equivalent: thinking and active subagents. */}
          {(footerActivity.type === 'thinking' || footerActiveAgent) && !footerStreamingContent && (
            <div className="flex justify-start animate-fade-in">
              <Card className="border p-3 sm:p-4 bg-muted/40 border-border/60">
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    {footerActiveAgent ? (
                      <>
                        <div className="relative">
                          <Brain className="h-5 w-5 text-primary" />
                          <span className="absolute -top-1 -right-1 w-2 h-2 bg-primary rounded-full animate-ping" />
                        </div>
                        <div className="flex flex-col">
                          <span className="text-sm font-medium text-foreground">
                            Agent: {deps.getAgentDisplay(footerActiveAgent.agentType)}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {footerActiveAgent.description ||
                              deps.getAgentDescription(footerActiveAgent.agentType)}
                            {footerActiveAgent.startedAt
                              ? ` (${deps.formatElapsed(footerNow - footerActiveAgent.startedAt)})`
                              : ''}
                          </span>
                        </div>
                      </>
                    ) : footerActivity.type === 'thinking' ? (
                      <>
                        <div className="flex items-center justify-center w-12 h-12 shrink-0 text-primary">
                          <ProviderLoader provider={deps.uiProvider} size={48} />
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="text-sm font-medium">
                            {deps.providerLabel} is thinking...
                          </span>
                          {footerActivity.message && (
                            <span className="text-xs text-muted-foreground truncate">
                              {footerActivity.message}
                              {footerActivity.messageStartedAt
                                ? ` (${deps.formatElapsed(footerNow - footerActivity.messageStartedAt)})`
                                : ''}
                            </span>
                          )}
                        </div>
                      </>
                    ) : null}
                  </div>
                </div>
              </Card>
            </div>
          )}

          {footerStreamingContent && (
            <div className="turn-asst animate-fade-in">
              <div className="ai-rail">
                <div className="ai-mark" title={deps.providerLabel}>
                  <ProviderLoader provider={deps.uiProvider} size={20} />
                </div>
                <div className="ai-thread" />
              </div>
              <div className="ai-body">
                <StreamingContent
                  content={footerStreamingContent}
                  provider={deps.uiProvider}
                  providerLabel={deps.providerLabel}
                  onResponse={(response) => {
                    if (deps.id) {
                      socketService.sendInput(deps.id, response);
                      deps.clearStreamingContent(deps.id);
                    }
                  }}
                />
              </div>
            </div>
          )}

          {footerPermissionRequest && deps.id && (
            <div className="flex justify-start">
              <PermissionRequestCard
                sessionId={deps.id}
                denials={footerPermissionRequest.denials}
                originalMessage={footerPermissionRequest.originalMessage}
                providerLabel={deps.providerLabel}
              />
            </div>
          )}
        </div>
      );
    }

    function ChatHeader() {
      return <div aria-hidden style={{ height: '8px' }} />;
    }

    return { Footer: ChatFooter, Header: ChatHeader };
  }, []);

  const allowedSessionModes: SessionMode[] = useMemo(
    () => ['planning', 'auto-accept', 'manual', 'danger'],
    []
  );

  const getStoredSessionMode = useCallback(
    (key: string) => {
      try {
        const stored = window.localStorage.getItem(key);
        if (stored && allowedSessionModes.includes(stored as SessionMode)) {
          return stored as SessionMode;
        }
      } catch {
        // Ignore storage errors (private mode, blocked, etc.)
      }
      return null;
    },
    [allowedSessionModes]
  );

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

  const sessionProvider = session?.cliProvider ?? toCliProvider(uiProvider);
  const sessionUiProvider = toUiProvider(sessionProvider);
  const providerLabel = CLI_PROVIDER_LABEL[sessionProvider];
  const hasLiveRunActivity =
    currentActivity.type === 'thinking' ||
    currentActivity.type === 'tool' ||
    !!currentActiveAgent ||
    !!currentStreamingContent;
  const hasQueuedRunWork = !!currentQueue?.busy;
  const isActive = hasLiveRunActivity || hasQueuedRunWork;
  const composerQueuesWhileActive = sessionProvider === 'codex';
  const canInterruptActiveRun =
    hasLiveRunActivity || (!composerQueuesWhileActive && hasQueuedRunWork);

  useEffect(() => {
    if (!id || !session) {
      return;
    }
    if (loadedModeForSessionRef.current !== id) {
      // Prefer the DB-persisted mode so the choice follows the user across browsers;
      // fall back to legacy per-browser localStorage for sessions created before the
      // backend started persisting `mode`.
      const persistedMode =
        session.mode && allowedSessionModes.includes(session.mode as SessionMode)
          ? (session.mode as SessionMode)
          : null;
      const initialMode =
        persistedMode ??
        (sessionModeStorageKey ? getStoredSessionMode(sessionModeStorageKey) : null);
      if (initialMode) {
        setSessionMode(initialMode);
        socketService.setSessionMode(id, initialMode);
      }
      loadedModeForSessionRef.current = id;
    }
  }, [id, session, sessionModeStorageKey, getStoredSessionMode, allowedSessionModes]);

  // Keep the footer's live dependencies fresh. The stable memoized Footer
  // component reads from this ref every render, so updates here propagate
  // without changing component identity.
  footerDepsRef.current = {
    id,
    uiProvider: sessionUiProvider,
    providerLabel,
    getAgentDisplay,
    getAgentDescription,
    getToolDisplay,
    formatElapsed,
    clearStreamingContent,
  };
  const resolvedDefaultModel =
    settings?.cliProviderModels?.[sessionProvider] || CLI_PROVIDER_DEFAULT_MODEL[sessionProvider];
  const selectedModel = settings?.cliProviderModels?.[sessionProvider] || '';
  const modelSelectValue = selectedModel || '__default__';
  const currentProviderInfo = cliProviders?.find((provider) => provider.id === sessionProvider);
  const modelLabels = useMemo(() => {
    return currentProviderInfo?.modelLabels || {};
  }, [currentProviderInfo]);
  // Compact label shown next to the assistant name in each turn (template's `asst-model`).
  const asstModelLabel = (() => {
    const raw = selectedModel || resolvedDefaultModel || '';
    const labelled = modelLabels[raw];
    return (labelled || raw).toString();
  })();
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
  const reasoningOptions = useMemo(() => {
    if (sessionProvider === 'claude') {
      return [
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High' },
        { value: 'max', label: 'Max' },
      ];
    }
    if (sessionProvider === 'vibe') {
      return [
        { value: 'off', label: 'Off' },
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High' },
        { value: 'max', label: 'Max' },
      ];
    }
    if (sessionProvider === 'opencode') {
      return [
        { value: 'minimal', label: 'Minimal' },
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High' },
        { value: 'max', label: 'Max' },
      ];
    }
    return [
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' },
      { value: 'extra_high', label: 'Extra High' },
    ];
  }, [sessionProvider]);
  const quickPrompts = useMemo(
    () => [
      { heading: 'Prompts' },
      { label: 'Plan', value: 'Plan the approach and outline the steps.' },
      { label: 'Debug', value: 'Find the root cause and propose a fix.' },
      { label: 'Refactor', value: 'Refactor for clarity and safer defaults.' },
      { label: 'Tests', value: 'Add or update tests for this change.' },
      { label: 'Explain', value: 'Explain the code and key decisions.' },

      { heading: 'Session' },
      { label: 'New session', value: '/new', hint: '/new' },
      { label: 'Rename session', value: '/rename ', hint: '/rename' },
      { label: 'Reset context', value: '/reset', hint: '/reset' },
      { label: 'Resume', value: '/resume', hint: '/resume' },
      { label: 'Continue', value: '/continue', hint: '/continue' },
      { label: 'Clear screen', value: '/clear', hint: '/clear' },
      { label: 'Compact history', value: '/compact', hint: '/compact' },
      { label: 'Copy last response', value: '/copy', hint: '/copy' },
      { label: 'Export conversation', value: '/export', hint: '/export' },

      { heading: 'WebUI' },
      { label: 'Help', value: '/help', hint: '/help' },
      { label: 'Theme & settings', value: '/theme', hint: '/theme' },
      { label: 'Permissions', value: '/permissions', hint: '/permissions' },
      { label: 'Diff / Git', value: '/diff', hint: '/diff' },
      { label: 'Doctor', value: '/doctor', hint: '/doctor' },
      { label: 'Send feedback', value: '/feedback', hint: '/feedback' },

      { heading: sessionProvider === 'codex' ? 'Codex Workflows' : 'Provider Workflows' },
      { label: 'Context window', value: '/context', hint: '/context' },
      { label: 'Memory', value: '/memory', hint: '/memory' },
      { label: 'Model', value: '/model', hint: '/model' },
      { label: 'Status', value: '/status', hint: '/status' },
      { label: 'Cost', value: '/cost', hint: '/cost' },
      ...(sessionProvider === 'codex'
        ? [
            { label: 'Review changes', value: '/review', hint: '/review' },
            { label: 'Review vs branch', value: '/review --base ', hint: '/review --base' },
            { label: 'Set goal', value: '/goal ', hint: '/goal' },
            { label: 'Generate image', value: '/imagegen ', hint: '/imagegen' },
            { label: 'Feature flags', value: '/features', hint: '/features' },
            { label: 'Web search', value: '/web-search', hint: '/web-search' },
            { label: 'Subagents', value: '/subagents', hint: '/subagents' },
          ]
        : [
            { label: 'Plan mode', value: '/plan', hint: '/plan' },
            { label: 'Init project', value: '/init', hint: '/init' },
            { label: 'Review PR', value: '/review', hint: '/review' },
            { label: 'Security review', value: '/security-review', hint: '/security-review' },
          ]),
      { label: 'Agents', value: '/agents', hint: '/agents' },
      { label: 'MCP', value: '/mcp', hint: '/mcp' },
      { label: 'Hooks', value: '/hooks', hint: '/hooks' },
      { label: 'Skills', value: '/skills', hint: '/skills' },
      ...(sessionProvider === 'claude'
        ? [
            { label: 'Debug info', value: '/debug', hint: '/debug' },
            { label: 'Effort', value: '/effort', hint: '/effort' },
            { label: 'Recap', value: '/recap', hint: '/recap' },
            { label: 'BTW notes', value: '/btw ', hint: '/btw' },
            { label: 'Add directory', value: '/add-dir ', hint: '/add-dir' },
            { label: 'Claude API', value: '/claude-api', hint: '/claude-api' },
            { label: 'Simplify code', value: '/simplify', hint: '/simplify' },
            { label: 'Batch', value: '/batch', hint: '/batch' },
            { label: 'Loop', value: '/loop ', hint: '/loop' },
            { label: 'Proactive mode', value: '/proactive', hint: '/proactive' },
            {
              label: 'Fewer permission prompts',
              value: '/less-permission-prompts',
              hint: '/less-permission-prompts',
            },
          ]
        : []),
      { label: 'Usage', value: '/usage', hint: '/usage' },
      ...(sessionProvider === 'claude'
        ? [
            { label: 'Insights', value: '/insights', hint: '/insights' },
            { label: 'Stats', value: '/stats', hint: '/stats' },
            { label: 'Schedule', value: '/schedule', hint: '/schedule' },
            { label: 'Routines', value: '/routines', hint: '/routines' },
          ]
        : []),
      { label: 'Fast mode', value: '/fast', hint: '/fast' },
    ],
    [sessionProvider]
  );
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
      const response = await api.patch<ApiResponse<{ starred: boolean }>>(
        `/api/sessions/${id}/star`
      );
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
    // Use reconnect instead of subscribe to get buffered messages if session is running.
    // Pass the stored lastTimestamp so returning to a previously-visited session only
    // replays messages newer than what we've already rendered — otherwise the server
    // resends its whole buffer and Virtuoso re-mounts the entire thread.
    const lastTimestamp = useSessionStore.getState().lastMessageTimestamp[id];
    socketService.reconnectToSession(id, lastTimestamp);

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
      if (e.key === 'Escape' && canInterruptActiveRun) {
        const target = e.target as HTMLElement;
        const isTyping =
          target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

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
  }, [id, canInterruptActiveRun]);

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
  const handleSendMessage = useCallback(
    (message: string) => {
      if (!id) return;
      socketService.sendMessage(id, message);
      clearStreamingContent(id);
    },
    [id, clearStreamingContent]
  );

  const handleSendMessageWithFiles = useCallback(
    async (message: string, files: File[]) => {
      if (!id) return;
      setIsSending(true);
      try {
        await socketService.sendMessageWithFiles(id, message, files);
        clearStreamingContent(id);
      } finally {
        setIsSending(false);
      }
    },
    [id, clearStreamingContent]
  );

  const handleCommandExecute = useCallback(
    async (input: string) => {
      if (!id) return;

      const appendAssistant = (content: string) => {
        addMessage(id, {
          id: generateId(),
          sessionId: id,
          role: 'assistant',
          content,
          createdAt: new Date().toISOString(),
        });
      };

      try {
        const response = await api.post<ApiResponse<CommandExecutionResult>>(
          '/api/commands/execute',
          {
            input,
            projectPath: session?.workingDirectory,
            sessionId: id,
            currentModel: resolvedDefaultModel || CLI_PROVIDER_DEFAULT_MODEL[sessionProvider],
            provider: sessionProvider,
            usage: currentUsage
              ? {
                  inputTokens: currentUsage.inputTokens,
                  outputTokens: currentUsage.outputTokens,
                  cacheReadTokens: currentUsage.cacheReadTokens,
                  cacheCreationTokens: currentUsage.cacheCreationTokens,
                  totalTokens: currentUsage.totalTokens,
                  contextWindow: currentUsage.contextWindow,
                  contextUsedPercent: currentUsage.contextUsedPercent,
                  cost: currentUsage.totalCostUsd,
                }
              : undefined,
          }
        );

        const result = response.data.data;
        if (!result) return;

        if (!result.success && result.error) {
          appendAssistant(`⚠️ ${result.error}`);
          return;
        }

        const data = (result.data ?? {}) as Record<string, unknown>;

        switch (result.action) {
          case 'clear':
            setMessages(id, []);
            break;

          case 'send_message':
          case 'forward_to_cli':
            if (result.response) socketService.sendMessage(id, result.response);
            break;

          case 'rename_session': {
            const name = typeof data.name === 'string' ? data.name : '';
            if (!name) break;
            try {
              await api.put(`/api/sessions/${id}`, { name });
              await queryClient.invalidateQueries({ queryKey: ['session', id] });
              await queryClient.invalidateQueries({ queryKey: ['sessions'] });
              toast({ title: 'Session renamed', description: `Now called "${name}".` });
            } catch (err) {
              toast({
                title: 'Rename failed',
                description: err instanceof Error ? err.message : 'Unknown error',
                variant: 'destructive',
              });
            }
            break;
          }

          case 'copy_response': {
            const n = typeof data.n === 'number' && data.n > 0 ? data.n : 1;
            const assistantMessages = sessionMessages.filter((m) => m.role === 'assistant');
            const target = assistantMessages[assistantMessages.length - n];
            if (!target?.content) {
              toast({ title: 'Nothing to copy', description: 'No matching response found.' });
              break;
            }
            try {
              await navigator.clipboard.writeText(target.content);
              toast({
                title: 'Copied',
                description:
                  n > 1
                    ? `Response #${n} copied to clipboard.`
                    : 'Last response copied to clipboard.',
              });
            } catch {
              toast({
                title: 'Copy failed',
                description: 'Clipboard access denied by browser.',
                variant: 'destructive',
              });
            }
            break;
          }

          case 'export_conversation': {
            const filename =
              typeof data.filename === 'string' && data.filename
                ? data.filename
                : `session-${id}-${new Date().toISOString().slice(0, 10)}.txt`;
            const body = sessionMessages
              .map(
                (m) =>
                  `### ${m.role.toUpperCase()} · ${new Date(m.createdAt).toISOString()}\n\n${m.content}\n`
              )
              .join('\n---\n\n');
            const blob = new Blob([body], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
            toast({
              title: 'Exported',
              description: `Saved ${filename} (${sessionMessages.length} messages).`,
            });
            break;
          }

          case 'new_session':
            navigate('/?new=true');
            break;

          case 'resume_session':
            navigate('/');
            toast({ title: 'Session picker', description: 'Pick a session from the dashboard.' });
            break;

          case 'open_settings': {
            const tab = typeof data.tab === 'string' ? data.tab : undefined;
            navigate(tab ? `/settings?tab=${encodeURIComponent(tab)}` : '/settings');
            break;
          }

          case 'open_permissions':
            navigate('/settings?tab=security');
            break;

          case 'open_diff':
            toast({
              title: 'Git diff',
              description: 'Open the Git panel from the side dock to view uncommitted changes.',
            });
            break;

          case 'open_feedback': {
            const report = typeof data.report === 'string' ? data.report : '';
            const url = report
              ? `https://github.com/anthropics/claude-code/issues/new?title=${encodeURIComponent(report.slice(0, 80))}&body=${encodeURIComponent(report)}`
              : 'https://github.com/anthropics/claude-code/issues/new';
            window.open(url, '_blank', 'noopener,noreferrer');
            toast({ title: 'Feedback', description: 'Opening GitHub issues in a new tab.' });
            break;
          }

          case 'show_doctor': {
            const lines = [
              '**WebUI Diagnostics**',
              '',
              `- Session ID: \`${id}\``,
              `- Provider: ${sessionProvider}`,
              `- Model: ${resolvedDefaultModel || CLI_PROVIDER_DEFAULT_MODEL[sessionProvider]}`,
              sessionProvider === 'codex'
                ? `- Service tier: ${settings?.cliProviderServiceTiers?.codex === 'fast' ? 'fast' : 'standard'}`
                : null,
              `- Working directory: ${session?.workingDirectory ?? 'none'}`,
              `- Status: ${session?.status ?? 'unknown'}`,
              `- Messages: ${sessionMessages.length}`,
              currentUsage
                ? `- Usage: ${currentUsage.inputTokens.toLocaleString()} in / ${currentUsage.outputTokens.toLocaleString()} out, $${currentUsage.totalCostUsd.toFixed(4)}`
                : '- Usage: no data',
            ].filter((line): line is string => typeof line === 'string');
            appendAssistant(lines.join('\n'));
            break;
          }

          case 'toggle_fast': {
            if (sessionProvider !== 'codex') {
              if (result.response) socketService.sendMessage(id, result.response);
              break;
            }

            const isCurrentlyFast = settings?.cliProviderServiceTiers?.codex === 'fast';
            if (data.statusOnly === true) {
              appendAssistant(
                isCurrentlyFast
                  ? 'Codex fast mode is enabled. The next Codex turn uses `service_tier="fast"`.'
                  : 'Codex fast mode is disabled. The next Codex turn uses the standard service tier.'
              );
              break;
            }

            const shouldEnable =
              typeof data.enabled === 'boolean' ? data.enabled : !isCurrentlyFast;

            const nextServiceTiers: Partial<Record<CLIProvider, 'fast'>> = {
              ...(settings?.cliProviderServiceTiers || {}),
            };

            if (shouldEnable) {
              nextServiceTiers.codex = 'fast';
            } else {
              delete nextServiceTiers.codex;
            }

            updateSettingsMutation.mutate(
              {
                cliProviderServiceTiers: nextServiceTiers,
              },
              {
                onSuccess: () => {
                  toast({
                    title: shouldEnable ? 'Fast mode enabled' : 'Fast mode disabled',
                    description: shouldEnable
                      ? 'Codex will use the fast service tier without changing model or reasoning.'
                      : 'Codex will use the standard service tier.',
                  });
                  if (session?.status === 'running') {
                    socketService.restartSession(id);
                  }
                },
              }
            );
            break;
          }

          default:
            if (result.response) appendAssistant(result.response);
            break;
        }
      } catch (error) {
        console.error('Command execution failed:', error);
        appendAssistant(
          `⚠️ Command failed: ${error instanceof Error ? error.message : 'unknown error'}`
        );
      }
    },
    [
      id,
      session?.workingDirectory,
      session?.status,
      currentUsage,
      sessionMessages,
      sessionProvider,
      resolvedDefaultModel,
      settings,
      setMessages,
      addMessage,
      navigate,
      queryClient,
      updateSettingsMutation,
    ]
  );

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
            description:
              session?.status === 'running'
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
    if (!sessionProvider) return;
    const current = settings?.cliProviderReasoning?.[sessionProvider] || '';
    const nextValue =
      value === '__default__'
        ? ''
        : value
            .trim()
            .toLowerCase()
            .replace(/[\s-]+/g, '_');
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
            description:
              session?.status === 'running'
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

  const handleModeChange = useCallback(
    (newMode: SessionMode) => {
      setSessionMode(newMode);
      if (id) {
        socketService.setSessionMode(id, newMode);
        // Persist to the DB so the mode survives browser/device switches. Fire-and-forget:
        // the socket call is the authoritative runtime signal; this PATCH just updates the
        // row that subsequent loads read from. Errors are logged but don't block the UI.
        api.patch(`/api/sessions/${id}/mode`, { mode: newMode }).catch((err) => {
          console.warn('Failed to persist session mode', err);
        });
      }
      if (sessionModeStorageKey) {
        try {
          window.localStorage.setItem(sessionModeStorageKey, newMode);
        } catch {
          // Ignore storage errors
        }
      }
    },
    [id, sessionModeStorageKey]
  );

  // Handler for hooks-based permission response
  const handlePermissionResponse = useCallback(
    async (action: PermissionAction, pattern?: string) => {
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
    },
    [id, currentPendingPermission]
  );

  const handleCancelCliTool = () => {
    if (cliToolAbortRef.current) {
      cliToolAbortRef.current.abort();
    }
  };

  const pendingTasksCount = currentTodos.filter((t) => t.status !== 'completed').length;
  const runningToolsCount = recentTools.filter((t) => t.status === 'started').length;
  const queuedTurnsCount = currentQueue?.depth ?? 0;
  const runAttentionCount = queuedTurnsCount + runningToolsCount;

  const composerActions = useMemo(
    () => [
      {
        id: 'run',
        label: runCockpitOpen ? 'Hide running' : 'Running',
        icon: <Activity className="h-3.5 w-3.5" />,
        onSelect: toggleRunCockpit,
        badge: runAttentionCount,
        active: runCockpitOpen,
      },
      {
        id: 'files',
        label: 'Files',
        icon: <FolderOpen className="h-3.5 w-3.5" />,
        onSelect: () => setMainView('files'),
      },
      {
        id: 'tasks',
        label: 'Tasks',
        icon: <ListTodo className="h-3.5 w-3.5" />,
        onSelect: () => openWorkspacePanel('tasks'),
        badge: pendingTasksCount,
      },
      {
        id: 'tools',
        label: 'Tools',
        icon: <Wrench className="h-3.5 w-3.5" />,
        onSelect: () => openWorkspacePanel('tools'),
        badge: runningToolsCount,
        badgePulse: runningToolsCount > 0,
      },
      {
        id: 'config',
        label: 'Config',
        icon: <Brain className="h-3.5 w-3.5" />,
        onSelect: () => openWorkspacePanel('config'),
      },
      {
        id: 'session',
        label: 'Session settings',
        icon: <Settings className="h-3.5 w-3.5" />,
        onSelect: () => setMobileSheetPanel('settings'),
      },
    ],
    [
      openWorkspacePanel,
      pendingTasksCount,
      runAttentionCount,
      runCockpitOpen,
      runningToolsCount,
      toggleRunCockpit,
    ]
  );

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

  const tasksBody =
    currentTodos.length === 0 ? (
      <div className="text-center py-8 px-4 text-sm text-muted-foreground flex flex-col items-center gap-2">
        <div className="w-10 h-10 rounded-full bg-foreground/5 flex items-center justify-center">
          <ListTodo className="h-5 w-5 text-muted-foreground/50" />
        </div>
        <span>No active tasks</span>
      </div>
    ) : (
      <div className="p-2 space-y-1.5">
        {currentTodos.map((todo, index) => (
          <div
            key={index}
            className={cn(
              'flex items-start gap-2.5 p-2.5 rounded-lg text-xs transition-all',
              todo.status === 'completed' && 'bg-foreground/[0.02] text-muted-foreground',
              todo.status === 'in_progress' && 'bg-primary/10 border border-primary/30 shadow-sm',
              todo.status === 'pending' && 'bg-foreground/[0.03]'
            )}
          >
            <div className="shrink-0 mt-0.5">
              {todo.status === 'completed' && (
                <CheckCircle className="h-4 w-4 text-emerald-500/80" />
              )}
              {todo.status === 'in_progress' && (
                <Loader2 className="h-4 w-4 text-primary animate-spin" />
              )}
              {todo.status === 'pending' && <Circle className="h-4 w-4 text-muted-foreground/60" />}
            </div>
            <p
              className={cn(
                'flex-1 leading-relaxed',
                todo.status === 'completed' && 'line-through opacity-70',
                todo.status === 'in_progress' && 'font-medium text-foreground'
              )}
            >
              {todo.status === 'in_progress' && todo.activeForm ? todo.activeForm : todo.content}
            </p>
          </div>
        ))}
      </div>
    );

  const renderConfigBody = (heightClass: string) => (
    <div className={cn('flex flex-col', heightClass)}>
      <div className="flex gap-1 p-1.5 bg-muted/30 border-b border-border/60 shrink-0">
        <button
          onClick={() => setConfigTab('memories')}
          className={cn(
            'flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-all',
            configTab === 'memories'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-foreground/5'
          )}
        >
          Memories
        </button>
        <button
          onClick={() => setConfigTab('agents')}
          className={cn(
            'flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-all',
            configTab === 'agents'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-foreground/5'
          )}
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
  );

  const renderToolsBody = (heightClass: string) => (
    <ToolLogPanel executions={currentToolExecutions} className={heightClass} />
  );

  const panelMeta: Record<
    DockablePanel,
    { title: string; icon: ReactElement; badge?: ReactElement | null }
  > = {
    files: {
      title: 'Files',
      icon: <FolderOpen className="h-3.5 w-3.5" />,
      badge: null,
    },
    tasks: {
      title: 'Tasks',
      icon: <ListTodo className="h-3.5 w-3.5" />,
      badge:
        pendingTasksCount > 0 ? <span className="panel-badge">{pendingTasksCount}</span> : null,
    },
    config: {
      title: 'Config',
      icon: <Brain className="h-3.5 w-3.5" />,
      badge: null,
    },
    tools: {
      title: 'Tools',
      icon: <Wrench className="h-3.5 w-3.5" />,
      badge:
        runningToolsCount > 0 ? (
          <span className="panel-badge panel-badge-pulse">{runningToolsCount}</span>
        ) : null,
    },
  };

  const renderDockedPanel = (panel: WorkspaceSheetPanel) => {
    const meta = panelMeta[panel];
    let body: ReactElement;
    if (panel === 'tasks') body = <div className="h-full overflow-auto">{tasksBody}</div>;
    else if (panel === 'config') body = renderConfigBody('h-full');
    else body = renderToolsBody('h-full');

    return (
      <div
        key={panel}
        className="flex-1 min-h-0 flex flex-col border-b border-border/40 last:border-b-0 bg-background/40"
      >
        <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-foreground/5 bg-muted/30">
          <span className="text-muted-foreground shrink-0">{meta.icon}</span>
          <span className="text-xs font-medium flex-1 truncate">{meta.title}</span>
          {meta.badge}
          <button
            onClick={() => togglePinPanel(panel)}
            className="p-1 rounded-md hover:bg-foreground/10 transition-colors shrink-0 text-muted-foreground hover:text-foreground"
            title="Unpin panel"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">{body}</div>
      </div>
    );
  };

  const renderSessionSettingsChip = () => (
    <SessionSettingsChip
      mode={sessionMode}
      onModeChange={handleModeChange}
      provider={sessionProvider}
      providers={cliProviders?.map((p) => ({
        id: p.id,
        name: p.name,
        available: p.available,
      }))}
      onProviderChange={(p) => providerMutation.mutate(p)}
      modelValue={modelSelectValue}
      modelOptions={modelOptions}
      modelLabels={modelLabels}
      resolvedDefaultModel={resolvedDefaultModel}
      onModelChange={applyModelSelection}
      reasoningValue={reasoningSelectValue}
      reasoningOptions={
        ['claude', 'codex', 'opencode', 'vibe'].includes(sessionProvider)
          ? reasoningOptions
          : undefined
      }
      onReasoningChange={
        ['claude', 'codex', 'opencode', 'vibe'].includes(sessionProvider)
          ? applyReasoningSelection
          : undefined
      }
      reasoningLabel={sessionProvider === 'claude' ? 'Effort' : 'Reasoning'}
      codexFastMode={settings?.cliProviderServiceTiers?.codex === 'fast'}
      cliTools={cliTools}
      selectedCliTool={selectedCliTool}
      onCliToolChange={setSelectedCliTool}
    />
  );

  const activeTodo =
    currentTodos.find((todo) => todo.status === 'in_progress') ??
    currentTodos.find((todo) => todo.status === 'pending');

  const renderTodoStrip = (mode: 'desktop' | 'mobile') => {
    if (!activeTodo || pendingTasksCount === 0) return null;
    return (
      <button
        type="button"
        className={cn('todo-floating-strip', mode === 'desktop' ? 'hidden md:flex' : 'md:hidden')}
        onClick={() => {
          if (mode === 'desktop') openRightPanel('tasks');
          else setMobileSheetPanel('tasks');
        }}
      >
        <span
          className={cn('todo-floating-dot', activeTodo.status === 'in_progress' && 'is-running')}
        />
        <span className="truncate">
          {activeTodo.status === 'in_progress' && activeTodo.activeForm
            ? activeTodo.activeForm
            : activeTodo.content}
        </span>
        <span className="todo-floating-count">{pendingTasksCount}</span>
      </button>
    );
  };

  const renderRightRailButton = (panel: WorkspaceSheetPanel) => {
    const meta = panelMeta[panel];
    const isActive = pinnedPanels[panel];
    const badgeCount =
      panel === 'tasks' ? pendingTasksCount : panel === 'tools' ? runningToolsCount : 0;

    return (
      <button
        key={panel}
        type="button"
        className={cn('session-right-rail-button', isActive && 'is-active')}
        onClick={() => openRightPanel(panel)}
        title={isActive ? `Close ${meta.title}` : `Open ${meta.title}`}
        aria-label={isActive ? `Close ${meta.title}` : `Open ${meta.title}`}
      >
        {meta.icon}
        {badgeCount > 0 && <span className="session-right-rail-badge">{badgeCount}</span>}
      </button>
    );
  };

  const renderMobileSheetContent = () => {
    if (!mobileSheetPanel) return null;

    if (mobileSheetPanel === 'settings') {
      return (
        <div className="mobile-session-sheet-content">
          <div className="mobile-session-sheet-header">
            <Settings className="h-4 w-4 text-muted-foreground" />
            <h3>Session</h3>
          </div>
          <div className="mobile-session-sheet-body space-y-4">
            <div className="mobile-view-switch">
              <button
                type="button"
                onClick={() => {
                  setMainView('chat');
                  setMobileSheetPanel(null);
                }}
                className={cn(mainView === 'chat' && 'is-active')}
              >
                <MessageSquare className="h-4 w-4" />
                <span>Chat</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMainView('editor');
                  setMobileSheetPanel(null);
                }}
                disabled={!hasOpenFiles}
                className={cn(mainView === 'editor' && 'is-active')}
              >
                <Code2 className="h-4 w-4" />
                <span>Code</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMainView('files');
                  setMobileSheetPanel(null);
                }}
                className={cn(mainView === 'files' && 'is-active')}
              >
                <FolderOpen className="h-4 w-4" />
                <span>Files</span>
              </button>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-foreground/[0.025] p-3">
              <div className="min-w-0">
                <div className="text-xs font-medium text-foreground">Provider</div>
                <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {providerLabel}
                </div>
              </div>
              {renderSessionSettingsChip()}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setMobileSheetPanel(null);
                  setShowRenameDialog(true);
                }}
                className="mobile-sheet-command"
              >
                <Pencil className="h-4 w-4" />
                <span>Rename</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMobileSheetPanel(null);
                  setShowAllowedDirsDialog(true);
                }}
                className="mobile-sheet-command"
              >
                <FolderKey className="h-4 w-4" />
                <span>Directories</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    const meta = panelMeta[mobileSheetPanel];
    return (
      <div className="mobile-session-sheet-content">
        <div className="mobile-session-sheet-header">
          <span className="text-muted-foreground">{meta.icon}</span>
          <h3>{meta.title}</h3>
        </div>
        <div className="mobile-session-sheet-body">
          {mobileSheetPanel === 'tasks' && (
            <div className="h-[56dvh] overflow-auto">{tasksBody}</div>
          )}
          {mobileSheetPanel === 'tools' && renderToolsBody('h-[56dvh]')}
          {mobileSheetPanel === 'config' && renderConfigBody('h-[56dvh]')}
        </div>
      </div>
    );
  };

  return (
    <div ref={rootShellRef} className="flex h-full min-h-0 relative overflow-hidden">
      {/* Main column: sticky topbar + scrollable stream + sticky composer */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {/* Session Header — sticky topbar inside the main column */}
        <div ref={headerBarRef} className="chat-topbar shrink-0">
          <div className="flex-1 flex items-center gap-2 md:gap-3 min-w-0 flex-nowrap md:flex-wrap">
            {/* Title cluster */}
            <div className="hidden md:block min-w-0 flex-1 md:flex-none md:max-w-[260px] lg:max-w-[340px] xl:max-w-[400px]">
              <h2 className="text-[13px] font-semibold tracking-display flex items-center gap-1.5">
                <ProviderLogo
                  provider={sessionUiProvider}
                  className="h-5 w-5 shrink-0 object-contain"
                />
                <button
                  onClick={() => starMutation.mutate()}
                  disabled={starMutation.isPending}
                  className="hover:scale-110 active:scale-95 transition-transform shrink-0"
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
                <span className="truncate min-w-0">{session.name}</span>
                <span
                  className={cn(
                    'inline-block h-2 w-2 rounded-full shrink-0',
                    session.status === 'running' && 'bg-primary animate-pulse',
                    session.status === 'stopped' && 'bg-gray-400',
                    session.status === 'error' && 'bg-red-500'
                  )}
                />
              </h2>
              <button
                onClick={() => setShowAllowedDirsDialog(true)}
                className="mt-0.5 flex items-center gap-1 text-[10px] font-mono text-muted-foreground/70 hover:text-foreground/90 transition-colors max-w-full truncate"
                title={`Working directory: ${session.workingDirectory} — click to manage allowed directories`}
              >
                <FolderOpen className="h-2.5 w-2.5 shrink-0" />
                <span className="truncate">{session.workingDirectory}</span>
                {currentUsage && currentUsage.totalTokens > 0 && (
                  <span
                    className="ml-1 shrink-0 text-emerald-500/80 tabular-nums"
                    title={`Input: ${currentUsage.inputTokens.toLocaleString()} · Output: ${currentUsage.outputTokens.toLocaleString()} · Cache read: ${currentUsage.cacheReadTokens.toLocaleString()}`}
                  >
                    ·{' '}
                    {currentUsage.totalCostUsd < 0.01
                      ? `$${currentUsage.totalCostUsd.toFixed(4)}`
                      : `$${currentUsage.totalCostUsd.toFixed(2)}`}
                  </span>
                )}
              </button>
            </div>

            {/* Divider — subtle vertical separator */}
            <div className="hidden md:block w-px h-8 bg-border/40 shrink-0" />

            {/* Flex spacer — pushes right cluster to the edge */}
            <div className="hidden md:block flex-1" />

            {/* Right controls — View Toggle + Session Settings + Context + More */}
            <div className="chat-action-bar flex items-center gap-1.5 shrink-0 ml-auto md:ml-0">
              {/* View Toggle */}
              <div className="hidden sm:flex gap-0.5 bg-background/40 backdrop-blur-md border border-border/40 rounded-lg p-0.5 shrink-0">
                <button
                  onClick={() => setMainView('chat')}
                  className={cn(
                    'flex items-center gap-1 px-2 py-1 text-xs rounded-md transition-all',
                    mainView === 'chat'
                      ? 'bg-foreground/10 text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground hover:bg-foreground/5'
                  )}
                  title="Chat"
                >
                  <MessageSquare className="h-3 w-3" />
                  <span className="hidden lg:inline">Chat</span>
                </button>
                {hasOpenFiles && (
                  <button
                    onClick={() => setMainView('editor')}
                    className={cn(
                      'flex items-center gap-1 px-2 py-1 text-xs rounded-md transition-all',
                      mainView === 'editor'
                        ? 'bg-foreground/10 text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground hover:bg-foreground/5'
                    )}
                    title="Editor"
                  >
                    <Code2 className="h-3 w-3" />
                    <span className="hidden lg:inline">Editor</span>
                  </button>
                )}
                <button
                  onClick={() => setMainView('files')}
                  className={cn(
                    'flex items-center gap-1 px-2 py-1 text-xs rounded-md transition-all',
                    mainView === 'files'
                      ? 'bg-foreground/10 text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground hover:bg-foreground/5'
                  )}
                  title="Files"
                >
                  <FolderOpen className="h-3 w-3" />
                  <span className="hidden lg:inline">Files</span>
                </button>
              </div>

              {/* Run Cockpit */}
              <button
                onClick={toggleRunCockpit}
                className={cn(
                  'hidden sm:flex items-center gap-1 px-2 py-1.5 text-xs rounded-lg border transition-all shrink-0',
                  runCockpitOpen
                    ? 'bg-foreground/10 border-border/60 text-foreground'
                    : 'bg-background/40 border-border/40 text-muted-foreground hover:text-foreground hover:bg-foreground/5'
                )}
                title={runCockpitOpen ? 'Hide run panel' : 'Show run panel'}
              >
                <Activity className="h-3 w-3" />
                <span className="hidden lg:inline">Run</span>
                {runAttentionCount > 0 && (
                  <span className="panel-badge ml-0.5">{runAttentionCount}</span>
                )}
              </button>

              {/* Consolidated Session Settings */}
              {renderSessionSettingsChip()}

              {/* Context bar (status indicator) */}
              {currentUsage && currentUsage.contextWindow > 0 && (
                <ContextPopover usage={currentUsage} />
              )}

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" className="h-7 w-7" title="More actions">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="panel-dropdown w-48">
                  <DropdownMenuItem onClick={() => setMainView('chat')}>
                    <MessageSquare className="mr-2 h-3.5 w-3.5" />
                    Chat view
                  </DropdownMenuItem>
                  {hasOpenFiles && (
                    <DropdownMenuItem onClick={() => setMainView('editor')}>
                      <Code2 className="mr-2 h-3.5 w-3.5" />
                      Editor view
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => setMainView('files')}>
                    <FolderOpen className="mr-2 h-3.5 w-3.5" />
                    Files view
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setShowRenameDialog(true)}>
                    <Pencil className="mr-2 h-3.5 w-3.5" />
                    Rename session
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setShowAllowedDirsDialog(true)}>
                    <FolderKey className="mr-2 h-3.5 w-3.5" />
                    Manage directories
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {session.status === 'running' && (
                    <DropdownMenuItem onClick={handleInterrupt}>Interrupt session</DropdownMenuItem>
                  )}
                  {isExecutingTool && (
                    <DropdownMenuItem onClick={handleCancelCliTool}>
                      Cancel active tool
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={handleRestart}>Restart session</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>

        {/* Main Content - Chat or Editor */}
        <div
          className={cn(
            'flex-1 min-h-0 overflow-y-auto',
            mainView === 'chat' && 'chat-scroll-fade'
          )}
        >
          {mainView === 'editor' ? (
            <EditorPanel sessionId={id || ''} />
          ) : mainView === 'files' ? (
            <WorkspaceFiles
              workingDirectory={session.workingDirectory}
              onManageDirectories={() => setShowAllowedDirsDialog(true)}
              onFileOpen={(path, content) => {
                if (!id) return;
                openFileInStore(id, path, content);
                setMainView('editor');
              }}
              className="h-full"
            />
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

              {/* Virtualized timeline: messages and generated images sorted by timestamp */}
              {timeline.length > 0 && (
                <Virtuoso
                  ref={virtuosoRef}
                  data={timeline}
                  overscan={200}
                  increaseViewportBy={200}
                  followOutput="smooth"
                  atBottomStateChange={setIsAtBottom}
                  className="flex-1"
                  computeItemKey={(_index, item) =>
                    item.type === 'message'
                      ? `msg-${item.data.id ?? item.timestamp}`
                      : item.type === 'tool'
                        ? `tool-${item.data.toolId}`
                        : `img-${item.data.timestamp}`
                  }
                  itemContent={(index, item) => {
                    const isInTurn = inAssistantTurn[index] ?? false;
                    const isMessage = item.type === 'message';
                    let content: ReactElement;
                    if (item.type === 'message') {
                      const message = item.data;
                      if (message.id?.startsWith('compact-')) {
                        content = <CompactBoundaryCard content={message.content} />;
                      } else {
                        content = (
                          <MessageBubble
                            message={message}
                            sessionId={id!}
                            sessionStatus={session.status}
                            provider={sessionUiProvider}
                            modelLabel={asstModelLabel}
                            assistantName={providerLabel}
                          />
                        );
                      }
                    } else if (item.type === 'tool') {
                      content = <ToolExecutionCard execution={item.data} />;
                    } else {
                      const img = item.data;
                      content = (
                        <Card className="p-3 sm:p-4 bg-muted/40 border-border/60">
                          <div className="flex items-center gap-2 mb-3">
                            <div className="p-1.5 rounded-full bg-muted/60">
                              <Image className="h-4 w-4 text-primary" />
                            </div>
                            <span className="text-sm font-medium text-foreground">
                              Generated Image
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
                                link.download = `generated-image-${img.timestamp}.png`;
                                link.click();
                              }}
                            />
                          )}
                          <p className="text-xs text-muted-foreground italic">"{img.prompt}"</p>
                        </Card>
                      );
                    }
                    return (
                      <div
                        className={cn(
                          'mx-auto max-w-[760px] w-full px-4 sm:px-7 animate-fade-in',
                          isInTurn ? 'asst-turn-item' : 'pb-9',
                          isInTurn && !isMessage && 'asst-turn-cont'
                        )}
                      >
                        {content}
                      </div>
                    );
                  }}
                  components={virtuosoComponents}
                />
              )}

              {!isAtBottom && mainView === 'chat' && (
                <div className="sticky bottom-2 flex justify-center pointer-events-none z-30">
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
            </>
          )}
        </div>

        {/* Centered composer (sticky, in flow) */}
        {mainView === 'chat' && (
          <div ref={inputBarRef} className="composer-wrap shrink-0">
            <div className="composer-inner">
              {showSavedIndicator && (
                <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground animate-fade-in pb-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                  <span>Response saved</span>
                </div>
              )}
              {renderTodoStrip('desktop')}
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
                composerActions={composerActions}
                disabled={session.status === 'error'}
                isSending={isSending}
                isExecutingTool={isExecutingTool}
                isActive={isActive}
                queuesWhileActive={composerQueuesWhileActive}
              />
            </div>
          </div>
        )}
      </div>
      {/* /main column */}

      {runCockpitOpen && (
        <RunCockpit
          workingDirectory={session.workingDirectory}
          providerLabel={providerLabel}
          sessionStatus={session.status}
          messages={sessionMessages}
          streamingContent={currentStreamingContent}
          activity={currentActivity}
          todos={currentTodos}
          tools={currentToolExecutions}
          usage={currentUsage}
          queue={currentQueue}
          onClose={() => {
            setRunCockpitOpen(false);
            if (typeof window !== 'undefined') {
              window.localStorage.setItem('chat.runCockpitOpen', '0');
            }
          }}
          onInterrupt={handleInterrupt}
          onRestart={handleRestart}
          onReviewChanges={() => {
            if (!id) return;
            socketService.sendMessage(id, '/review');
            clearStreamingContent(id);
          }}
          onJumpToMessage={jumpToMessageFromRun}
        />
      )}

      {/* Right session bar: primary workspace panels live here, not in the topbar. */}
      {!runCockpitOpen && (
        <div className="session-right-dock hidden md:flex">
          <nav className="session-right-rail" aria-label="Session workspace panels">
            {RIGHT_RAIL_PANEL_KEYS.map((panel) => renderRightRailButton(panel))}
          </nav>
          {anyPanelPinned && (
            <div className="session-docked-panel-column">
              {DOCKED_PANEL_KEYS.map((p) => (pinnedPanels[p] ? renderDockedPanel(p) : null))}
            </div>
          )}
        </div>
      )}

      <Sheet
        open={mobileSheetPanel !== null}
        onOpenChange={(open) => {
          if (!open) setMobileSheetPanel(null);
        }}
      >
        <SheetContent side="bottom" className="mobile-session-sheet p-0">
          {renderMobileSheetContent()}
        </SheetContent>
      </Sheet>

      {/* Permission Approval Dialog (hooks-based flow) */}
      {currentPendingPermission && (
        <PermissionApprovalDialog
          permission={currentPendingPermission}
          onRespond={handlePermissionResponse}
          providerLabel={providerLabel}
        />
      )}

      {/* Allowed Directories Dialog */}
      <AllowedDirectoriesDialog
        sessionId={id || ''}
        open={showAllowedDirsDialog}
        onOpenChange={setShowAllowedDirsDialog}
        providerLabel={providerLabel}
        onDirectoriesChanged={() => {
          // Invalidate session query to get updated allowed directories
          queryClient.invalidateQueries({ queryKey: ['session', id] });
        }}
      />

      <RenameSessionDialog
        session={session}
        open={showRenameDialog}
        onOpenChange={setShowRenameDialog}
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
