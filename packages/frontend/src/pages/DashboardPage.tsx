import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Trash2,
  FolderOpen,
  MessageSquare,
  Settings,
  FolderPlus,
  Folder,
  Tags,
  Palette,
  ArrowUpRight,
  MoreHorizontal,
  Pencil,
  Activity,
  Star,
  Sparkles,
  ImageIcon,
  Upload,
  FolderInput,
  RotateCcw,
  Loader2,
  Send,
  Code2,
  ClipboardList,
  Brain,
  Zap,
  Hand,
  CheckCircle,
  SlidersHorizontal,
  ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { FolderBrowserDialog } from '@/components/ui/folder-browser';
import { SessionCategories, CategorySelector } from '@/components/session-categories';
import { ProviderLogo } from '@/components/branding/ProviderLogo';
import { RenameSessionDialog } from '@/components/session/RenameSessionDialog';
import { SessionIcon } from '@/components/session/SessionIcon';
import { useSessionStore } from '@/stores/sessionStore';
import { useCategoryStore } from '@/stores/categoryStore';
import { api, ApiError } from '@/services/api';
import { toast } from '@/hooks/use-toast';
import type {
  Session,
  ApiResponse,
  UserSettings,
  CLIProvider,
  BackgroundAnimation,
  SessionMode,
  SessionSurface,
} from '@plum-code-webui/shared';
import { cn } from '@/lib/utils';
import { getSessionRunState } from '@/lib/sessionRunState';
import { useAppearanceStore, BACKGROUND_ANIMATION_OPTIONS } from '@/stores/appearanceStore';
import { CLI_PROVIDER_DEFAULT_MODEL, toUiProvider } from '@/lib/providers';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const DASHBOARD_SESSION_MODE_OPTIONS: Array<{
  value: SessionMode;
  label: string;
  description: string;
  icon: typeof Brain;
}> = [
  { value: 'planning', label: 'Plan', description: 'ask before executing', icon: Brain },
  { value: 'auto-accept', label: 'Auto', description: 'approve safe work', icon: CheckCircle },
  { value: 'manual', label: 'Manual', description: 'approve each step', icon: Hand },
  { value: 'danger', label: 'YOLO', description: 'skip confirmations', icon: Zap },
];

const TASK_STARTERS = [
  'Lektoriere diesen Text und gib mir zuerst die wichtigsten Verbesserungen.',
  'Überarbeite diese Datei sprachlich, ohne Inhalt oder Struktur unnötig zu verändern.',
  'Fasse mir die wichtigsten Punkte verständlich zusammen.',
  'Formuliere daraus eine klare Nachricht oder E-Mail.',
];

const DASHBOARD_FAVORITES_GROUP_ID = '__favorites';
const DASHBOARD_RECENT_GROUP_ID = '__recent';
const DASHBOARD_UNCATEGORIZED_GROUP_ID = '__uncategorized';

function getDashboardReasoningOptions(provider: CLIProvider) {
  if (provider === 'claude') {
    return [
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' },
      { value: 'max', label: 'Max' },
    ];
  }
  if (provider === 'vibe') {
    return [
      { value: 'off', label: 'Off' },
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' },
      { value: 'max', label: 'Max' },
    ];
  }
  if (provider === 'opencode') {
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
    { value: 'xhigh', label: 'XHigh' },
  ];
}

function normalizeDashboardReasoning(provider: CLIProvider, value: unknown) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return getDashboardReasoningOptions(provider).some((option) => option.value === normalized)
    ? normalized
    : '';
}

function deriveSessionName(prompt: string, surface: SessionSurface): string {
  const compact = prompt
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^\/\w+\s*/, '')
    .slice(0, 58)
    .replace(/[.:,;!?]+$/g, '')
    .trim();
  if (compact) return compact;
  return surface === 'task' ? 'New Task' : 'New Code Session';
}

function formatDashboardFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function getDashboardDefaultProvider(savedDefaultProvider: CLIProvider | undefined): CLIProvider {
  if (savedDefaultProvider && savedDefaultProvider !== 'claude') {
    return savedDefaultProvider;
  }

  return 'codex';
}

export function DashboardPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const {
    setSessions,
    sessions,
    updateSession,
    activity,
    activeAgent,
    agentRuns,
    streamingContent,
    toolExecutions,
    queueState,
  } = useSessionStore();
  const { backgroundAnimation, setBackgroundAnimation } = useAppearanceStore();
  const { categories, fetchCategories } = useCategoryStore();

  const [showNewSession, setShowNewSession] = useState(searchParams.get('new') === 'true');
  const [newSessionPrompt, setNewSessionPrompt] = useState('');
  const [newSessionName, setNewSessionName] = useState('');
  const [sessionMode, setSessionMode] = useState<'new' | 'existing'>('new');
  const [newSessionSurface, setNewSessionSurface] = useState<SessionSurface>('code');
  const [newSessionPermissionMode, setNewSessionPermissionMode] =
    useState<SessionMode>('auto-accept');
  const [selectedModel, setSelectedModel] = useState('');
  const [selectedReasoning, setSelectedReasoning] = useState('');
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [newSessionFiles, setNewSessionFiles] = useState<File[]>([]);
  const [showFolderBrowser, setShowFolderBrowser] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [showCategories, setShowCategories] = useState(false);
  const [collapsedDashboardGroupIds, setCollapsedDashboardGroupIds] = useState<
    Record<string, boolean>
  >({});
  const [renamingSession, setRenamingSession] = useState<Session | null>(null);
  const [iconUploadSessionId, setIconUploadSessionId] = useState<string | null>(null);
  const [iconBusySessionId, setIconBusySessionId] = useState<string | null>(null);
  const [selectedCliProvider, setSelectedCliProvider] = useState<CLIProvider>(() =>
    getDashboardDefaultProvider(undefined)
  );
  const providerSelectedExplicitlyRef = useRef(false);
  const sessionNameEditedRef = useRef(false);
  const promptInputRef = useRef<HTMLTextAreaElement>(null);
  const newSessionFileInputRef = useRef<HTMLInputElement>(null);
  const iconUploadInputRef = useRef<HTMLInputElement>(null);

  // Fetch user settings
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<UserSettings>>('/api/settings');
      return response.data.data;
    },
  });
  const dashboardDefaultProvider = getDashboardDefaultProvider(settings?.defaultCliProvider);

  useEffect(() => {
    if (settings?.backgroundAnimation) {
      setBackgroundAnimation(settings.backgroundAnimation);
    }
  }, [settings?.backgroundAnimation, setBackgroundAnimation]);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  useEffect(() => {
    if (!showNewSession || !providerSelectedExplicitlyRef.current) {
      setSelectedCliProvider(dashboardDefaultProvider);
    }
  }, [dashboardDefaultProvider, showNewSession]);

  useEffect(() => {
    setSelectedModel(settings?.cliProviderModels?.[selectedCliProvider] || '');
    setSelectedReasoning(
      normalizeDashboardReasoning(
        selectedCliProvider,
        settings?.cliProviderReasoning?.[selectedCliProvider]
      )
    );
  }, [selectedCliProvider, settings?.cliProviderModels, settings?.cliProviderReasoning]);

  useEffect(() => {
    const input = promptInputRef.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 176)}px`;
  }, [newSessionPrompt]);

  // Fetch sessions
  const { isLoading } = useQuery({
    queryKey: ['sessions'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<Session[]>>('/api/sessions');
      if (response.data.success && response.data.data) {
        setSessions(response.data.data);
        return response.data.data;
      }
      return [];
    },
    refetchInterval: 4000,
    refetchIntervalInBackground: true,
  });

  // Fetch available CLI providers
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

  // Create session mutation
  const createMutation = useMutation({
    mutationFn: async (data: {
      name: string;
      workingDirectory?: string;
      cliProvider?: CLIProvider;
      cliModel?: string | null;
      cliReasoning?: string | null;
      mode?: SessionMode;
      surface?: SessionSurface;
      initialMessage?: string;
      files?: File[];
    }) => {
      if (data.files && data.files.length > 0) {
        const formData = new FormData();
        formData.append('name', data.name);
        if (data.workingDirectory) formData.append('workingDirectory', data.workingDirectory);
        if (data.cliProvider) formData.append('cliProvider', data.cliProvider);
        if (data.cliModel) formData.append('cliModel', data.cliModel);
        if (data.cliReasoning) formData.append('cliReasoning', data.cliReasoning);
        if (data.mode) formData.append('mode', data.mode);
        if (data.surface) formData.append('surface', data.surface);
        if (data.initialMessage) formData.append('initialMessage', data.initialMessage);
        data.files.forEach((file) => formData.append('files', file));

        const response = await api.post<ApiResponse<Session>>('/api/sessions', formData);
        return response.data;
      }

      const { files: _files, ...jsonData } = data;
      const response = await api.post<ApiResponse<Session>>('/api/sessions', jsonData);
      return response.data;
    },
    onSuccess: (data) => {
      if (data.success && data.data) {
        queryClient.invalidateQueries({ queryKey: ['sessions'] });
        providerSelectedExplicitlyRef.current = false;
        setShowNewSession(false);
        setNewSessionPrompt('');
        setNewSessionName('');
        sessionNameEditedRef.current = false;
        setSessionMode('new');
        setNewSessionSurface('code');
        setNewSessionPermissionMode('auto-accept');
        setSelectedModel('');
        setSelectedReasoning('');
        setSelectedFolder(null);
        setNewSessionFiles([]);
        if (newSessionFileInputRef.current) newSessionFileInputRef.current.value = '';
        setSelectedCliProvider(dashboardDefaultProvider);
        navigate(`/session/${data.data.id}`);
      }
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const backgroundMutation = useMutation({
    mutationFn: async (animation: BackgroundAnimation) => {
      const response = await api.put<ApiResponse<UserSettings>>('/api/settings', {
        backgroundAnimation: animation,
      });
      return response.data.data;
    },
    onMutate: (animation) => {
      setBackgroundAnimation(animation);
      const previous = queryClient.getQueryData<UserSettings>(['settings']);
      queryClient.setQueryData(['settings'], {
        ...(previous || {}),
        backgroundAnimation: animation,
      });
      return { previous };
    },
    onError: (error: Error, _animation, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['settings'], context.previous);
        if (context.previous.backgroundAnimation) {
          setBackgroundAnimation(context.previous.backgroundAnimation);
        }
      }
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
    onSuccess: (data) => {
      if (data) queryClient.setQueryData(['settings'], data);
    },
  });

  const hasDefaultDir = !!settings?.defaultWorkingDir;
  const filteredSessions = useMemo(
    () => (selectedCategory ? sessions.filter((s) => s.category === selectedCategory) : sessions),
    [selectedCategory, sessions]
  );
  const sessionRunStates = useMemo(
    () =>
      new Map(
        sessions.map((session) => [
          session.id,
          getSessionRunState(session, {
            activity: activity[session.id],
            activeAgent: activeAgent[session.id],
            agentRuns: agentRuns[session.id],
            streamingContent: streamingContent[session.id],
            tools: toolExecutions[session.id],
            queue: queueState[session.id],
          }),
        ])
      ),
    [activity, activeAgent, agentRuns, queueState, sessions, streamingContent, toolExecutions]
  );
  const dashboardSessionGroups = useMemo(() => {
    const knownCategoryIds = new Set(categories.map((category) => category.id));
    const usedSessionIds = new Set<string>();
    const grouped = new Map<string, Session[]>();
    const getHasWorking = (groupSessions: Session[]) =>
      groupSessions.some((session) => sessionRunStates.get(session.id)?.isWorking);
    const priorityGroups: Array<{
      id: string;
      label: string;
      sessions: Session[];
      hasWorking: boolean;
    }> = [];

    const favoriteSessions = filteredSessions.filter((session) => session.starred);
    if (favoriteSessions.length > 0) {
      priorityGroups.push({
        id: DASHBOARD_FAVORITES_GROUP_ID,
        label: 'Favorites',
        sessions: favoriteSessions,
        hasWorking: getHasWorking(favoriteSessions),
      });
      favoriteSessions.forEach((session) => usedSessionIds.add(session.id));
    }

    const recentSessions = [...filteredSessions]
      .filter((session) => !usedSessionIds.has(session.id))
      .sort((a, b) =>
        (b.updatedAt ?? b.createdAt ?? '').localeCompare(a.updatedAt ?? a.createdAt ?? '')
      )
      .slice(0, 5);

    if (recentSessions.length > 0) {
      priorityGroups.push({
        id: DASHBOARD_RECENT_GROUP_ID,
        label: 'Recent Sessions',
        sessions: recentSessions,
        hasWorking: getHasWorking(recentSessions),
      });
      recentSessions.forEach((session) => usedSessionIds.add(session.id));
    }

    for (const session of filteredSessions) {
      if (usedSessionIds.has(session.id)) continue;
      const groupId =
        session.category && knownCategoryIds.has(session.category)
          ? session.category
          : DASHBOARD_UNCATEGORIZED_GROUP_ID;
      const groupSessions = grouped.get(groupId) ?? [];
      groupSessions.push(session);
      grouped.set(groupId, groupSessions);
    }

    const categoryGroups = categories
      .map((category) => {
        const groupSessions = grouped.get(category.id) ?? [];
        return {
          id: category.id,
          label: category.name,
          sessions: groupSessions,
          hasWorking: getHasWorking(groupSessions),
        };
      })
      .filter((group) => group.sessions.length > 0);

    const uncategorized = grouped.get(DASHBOARD_UNCATEGORIZED_GROUP_ID) ?? [];
    if (uncategorized.length > 0) {
      categoryGroups.push({
        id: DASHBOARD_UNCATEGORIZED_GROUP_ID,
        label: 'Uncategorized',
        sessions: uncategorized,
        hasWorking: getHasWorking(uncategorized),
      });
    }

    categoryGroups.sort((a, b) => {
      if (a.hasWorking !== b.hasWorking) return a.hasWorking ? -1 : 1;
      return 0;
    });

    return [...priorityGroups, ...categoryGroups];
  }, [categories, filteredSessions, sessionRunStates]);
  const workingSessions = useMemo(
    () => sessions.filter((session) => sessionRunStates.get(session.id)?.isWorking).length,
    [sessionRunStates, sessions]
  );
  const liveIdleSessions = useMemo(
    () =>
      sessions.filter((session) => {
        const runState = sessionRunStates.get(session.id);
        return runState?.isLive && !runState.isWorking;
      }).length,
    [sessionRunStates, sessions]
  );
  const starredSessions = useMemo(
    () => sessions.filter((session) => session.starred).length,
    [sessions]
  );
  const providerCounts = useMemo(() => {
    return sessions.reduce(
      (acc, session) => {
        const provider = session.cliProvider || 'codex';
        acc[provider] = (acc[provider] || 0) + 1;
        return acc;
      },
      {} as Partial<Record<CLIProvider, number>>
    );
  }, [sessions]);
  const activeBackgroundOption =
    BACKGROUND_ANIMATION_OPTIONS.find((option) => option.value === backgroundAnimation) ??
    BACKGROUND_ANIMATION_OPTIONS[0]!;
  const selectedProviderInfo = cliProviders?.find(
    (provider) => provider.id === selectedCliProvider
  );
  const configuredModelsForProvider = settings?.cliProviderModelLists?.[selectedCliProvider] || [];
  const selectedProviderModelLabels = selectedProviderInfo?.modelLabels || {};
  const resolvedDefaultModel =
    selectedCliProvider === 'opencode'
      ? configuredModelsForProvider[0] || CLI_PROVIDER_DEFAULT_MODEL.opencode
      : CLI_PROVIDER_DEFAULT_MODEL[selectedCliProvider];
  const modelOptions = useMemo(() => {
    if (selectedCliProvider === 'opencode') {
      return Array.from(new Set(configuredModelsForProvider));
    }
    const options = new Set<string>();
    for (const model of selectedProviderInfo?.models || []) options.add(model);
    for (const model of configuredModelsForProvider) options.add(model);
    if (selectedModel) options.add(selectedModel);
    if (resolvedDefaultModel) options.add(resolvedDefaultModel);
    return Array.from(options);
  }, [
    configuredModelsForProvider,
    resolvedDefaultModel,
    selectedCliProvider,
    selectedModel,
    selectedProviderInfo?.models,
  ]);
  const showDefaultModelOption =
    selectedCliProvider !== 'opencode' || configuredModelsForProvider.length > 0;
  const reasoningOptions = useMemo(
    () => getDashboardReasoningOptions(selectedCliProvider),
    [selectedCliProvider]
  );
  const selectedModeOption = DASHBOARD_SESSION_MODE_OPTIONS.find(
    (option) => option.value === newSessionPermissionMode
  );
  const SelectedModeIcon = selectedModeOption?.icon || Brain;
  const selectedUiProvider = toUiProvider(selectedCliProvider);
  const workspaceSummary =
    sessionMode === 'new'
      ? hasDefaultDir
        ? `New folder in ${settings?.defaultWorkingDir}`
        : 'Default folder missing'
      : selectedFolder || 'Choose an existing folder';

  // Delete session mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/api/sessions/${id}`);
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      toast({ title: 'Session deleted' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const getIconErrorMessage = (error: unknown, fallback: string) =>
    error instanceof ApiError ? error.message : error instanceof Error ? error.message : fallback;

  const refreshSessions = async () => {
    const response = await api.get<ApiResponse<Session[]>>('/api/sessions');
    if (response.data.success && response.data.data) {
      setSessions(response.data.data);
      queryClient.setQueryData(['sessions'], response.data.data);
    }
  };

  const syncIconSession = async (session: Session | undefined) => {
    if (!session) return;
    updateSession(session.id, session);
    queryClient.setQueryData<Session[]>(
      ['sessions'],
      (current) =>
        current?.map((item) => (item.id === session.id ? { ...item, ...session } : item)) ?? current
    );
    await refreshSessions().catch(() => undefined);
  };

  const handleGenerateIcon = async (session: Session) => {
    if (iconBusySessionId) return;
    setIconBusySessionId(session.id);
    toast({ title: 'Generating icon', description: 'This can take a moment.' });
    try {
      const response = await api.post<ApiResponse<Session>>(
        `/api/sessions/${session.id}/icon/generate`
      );
      await syncIconSession(response.data.data);
      toast({ title: 'Session icon updated' });
    } catch (error) {
      toast({
        title: 'Icon generation failed',
        description: getIconErrorMessage(error, 'Failed to generate icon'),
        variant: 'destructive',
      });
    } finally {
      setIconBusySessionId(null);
    }
  };

  const handleUseProjectIcon = async (session: Session) => {
    if (iconBusySessionId) return;
    setIconBusySessionId(session.id);
    try {
      const response = await api.post<ApiResponse<Session>>(
        `/api/sessions/${session.id}/icon/project`
      );
      await syncIconSession(response.data.data);
      toast({ title: 'Project icon applied' });
    } catch (error) {
      toast({
        title: 'Project icon not found',
        description: getIconErrorMessage(error, 'No usable icon was found in this project'),
        variant: 'destructive',
      });
    } finally {
      setIconBusySessionId(null);
    }
  };

  const startIconUpload = (sessionId: string) => {
    setIconUploadSessionId(sessionId);
    if (iconUploadInputRef.current) {
      iconUploadInputRef.current.value = '';
      iconUploadInputRef.current.click();
    }
  };

  const handleIconUploadFile = async (file: File | undefined) => {
    if (!file || !iconUploadSessionId || iconBusySessionId) {
      if (!file) setIconUploadSessionId(null);
      return;
    }
    setIconBusySessionId(iconUploadSessionId);
    const formData = new FormData();
    formData.append('icon', file);
    try {
      const response = await api.post<ApiResponse<Session>>(
        `/api/sessions/${iconUploadSessionId}/icon/upload`,
        formData
      );
      await syncIconSession(response.data.data);
      toast({ title: 'Session icon uploaded' });
    } catch (error) {
      toast({
        title: 'Icon upload failed',
        description: getIconErrorMessage(error, 'Failed to upload icon'),
        variant: 'destructive',
      });
    } finally {
      setIconBusySessionId(null);
      setIconUploadSessionId(null);
      if (iconUploadInputRef.current) iconUploadInputRef.current.value = '';
    }
  };

  const handleResetIcon = async (session: Session) => {
    if (iconBusySessionId) return;
    setIconBusySessionId(session.id);
    try {
      const response = await api.delete<ApiResponse<Session>>(`/api/sessions/${session.id}/icon`);
      await syncIconSession(response.data.data);
      toast({ title: 'Session icon reset' });
    } catch (error) {
      toast({
        title: 'Failed to reset icon',
        description: getIconErrorMessage(error, 'Failed to reset icon'),
        variant: 'destructive',
      });
    } finally {
      setIconBusySessionId(null);
    }
  };

  const handlePromptChange = (value: string) => {
    setNewSessionPrompt(value);
    if (!sessionNameEditedRef.current) {
      setNewSessionName(deriveSessionName(value, newSessionSurface));
    }
  };

  const handleSurfaceChange = (surface: SessionSurface) => {
    setNewSessionSurface(surface);
    if (!sessionNameEditedRef.current) {
      setNewSessionName(deriveSessionName(newSessionPrompt, surface));
    }
  };

  const handleNewSessionFilesChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files || []);
    if (selectedFiles.length === 0) return;

    setNewSessionFiles((current) => {
      const seen = new Set(current.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
      const next = [...current];
      for (const file of selectedFiles) {
        const key = `${file.name}:${file.size}:${file.lastModified}`;
        if (seen.has(key)) continue;
        seen.add(key);
        next.push(file);
      }
      return next;
    });

    event.target.value = '';
  };

  const removeNewSessionFile = (index: number) => {
    setNewSessionFiles((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };

  const clearNewSessionFiles = () => {
    setNewSessionFiles([]);
    if (newSessionFileInputRef.current) newSessionFileInputRef.current.value = '';
  };

  const handleCreateSession = (e: FormEvent) => {
    e.preventDefault();
    const prompt = newSessionPrompt.trim();
    if (!prompt) {
      toast({
        title: 'Write a request first',
        description: 'The dashboard starts sessions from a prompt.',
      });
      return;
    }
    if (sessionMode === 'new' && !hasDefaultDir) {
      toast({
        title: 'Default folder missing',
        description: 'Set a default working directory before creating new workspace folders.',
        variant: 'destructive',
      });
      return;
    }
    if (sessionMode === 'existing' && !selectedFolder) {
      toast({
        title: 'Choose a folder',
        description: 'Select an existing workspace folder for this session.',
        variant: 'destructive',
      });
      return;
    }

    const reasoning = selectedReasoning.trim();
    const payload: {
      name: string;
      workingDirectory?: string;
      cliProvider?: CLIProvider;
      cliModel?: string | null;
      cliReasoning?: string | null;
      mode?: SessionMode;
      surface?: SessionSurface;
      initialMessage?: string;
      files?: File[];
    } = {
      name: (newSessionName.trim() || deriveSessionName(prompt, newSessionSurface)).slice(0, 100),
      cliProvider: selectedCliProvider,
      cliModel: selectedModel.trim() || null,
      cliReasoning: normalizeDashboardReasoning(selectedCliProvider, reasoning) || null,
      mode: newSessionPermissionMode,
      surface: newSessionSurface,
      initialMessage: prompt,
      files: newSessionFiles,
    };
    if (sessionMode === 'existing' && selectedFolder) {
      payload.workingDirectory = selectedFolder;
    }
    createMutation.mutate(payload);
  };

  useEffect(() => {
    if (searchParams.get('new') === 'true') {
      providerSelectedExplicitlyRef.current = false;
      setShowNewSession(true);
      window.setTimeout(() => promptInputRef.current?.focus(), 0);
    }
  }, [searchParams]);

  const openNewSession = (provider?: CLIProvider) => {
    providerSelectedExplicitlyRef.current = !!provider;
    setSelectedCliProvider(provider ?? dashboardDefaultProvider);
    setShowNewSession(true);
    window.setTimeout(() => promptInputRef.current?.focus(), 0);
  };

  const closeNewSession = () => {
    providerSelectedExplicitlyRef.current = false;
    setShowNewSession(false);
    setSessionMode('new');
    setSelectedFolder(null);
    setNewSessionPrompt('');
    setNewSessionName('');
    clearNewSessionFiles();
    sessionNameEditedRef.current = false;
  };

  const toggleDashboardGroup = (groupId: string) => {
    setCollapsedDashboardGroupIds((current) => ({
      ...current,
      [groupId]: !current[groupId],
    }));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="dashboard-shell space-y-5">
      <section className="dashboard-command">
        <div className="dashboard-command-header">
          <div className="dashboard-hero-main">
            <div className="dashboard-eyebrow">
              <Sparkles className="h-3.5 w-3.5" />
              <span>Plum Code</span>
            </div>
            <div className="dashboard-title-row">
              <h1>What should Plum do?</h1>
              <span className="dashboard-count">{sessions.length}</span>
            </div>
            <p className="dashboard-subtitle ui-text">
              Start a code workspace or a quieter task chat directly from here.
            </p>
          </div>

          <div className="dashboard-hero-actions">
            <Button onClick={() => openNewSession()} size="sm" className="gap-1.5">
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Focus prompt</span>
            </Button>
            <Button
              variant={showCategories ? 'default' : 'outline'}
              size="sm"
              onClick={() => setShowCategories(!showCategories)}
              className="gap-1.5"
              title="Categories"
            >
              <Tags className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" asChild className="gap-1.5" title="Connections">
              <Link to="/connect">
                <ArrowUpRight className="h-4 w-4" />
              </Link>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Palette className="h-4 w-4" />
                  <span className="hidden md:inline">{activeBackgroundOption.label}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="panel-dropdown w-56">
                {BACKGROUND_ANIMATION_OPTIONS.map((option) => (
                  <DropdownMenuItem
                    key={option.value}
                    className="flex items-center gap-2 cursor-pointer"
                    onClick={() => backgroundMutation.mutate(option.value)}
                  >
                    <Palette className="h-4 w-4 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{option.label}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {option.description}
                      </span>
                    </span>
                    {backgroundAnimation === option.value ? (
                      <CheckCircle className="h-4 w-4 text-primary" />
                    ) : null}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <form
          onSubmit={handleCreateSession}
          className="dashboard-start-composer dashboard-chatbar glass-chrome relative"
        >
          <div className="dashboard-chatbar-topline">
            <div
              className="dashboard-surface-switch dashboard-chatbar-segment"
              aria-label="New session surface"
            >
              <button
                type="button"
                className={cn(newSessionSurface === 'code' && 'is-active')}
                onClick={() => handleSurfaceChange('code')}
              >
                <Code2 className="h-4 w-4" />
                <span>Code</span>
              </button>
              <button
                type="button"
                className={cn(newSessionSurface === 'task' && 'is-active')}
                onClick={() => handleSurfaceChange('task')}
              >
                <ClipboardList className="h-4 w-4" />
                <span>Task</span>
              </button>
            </div>

            <label className="dashboard-chatbar-name" title="Session name">
              <Pencil className="h-3.5 w-3.5" />
              <input
                value={newSessionName}
                onChange={(event) => {
                  sessionNameEditedRef.current = true;
                  setNewSessionName(event.target.value);
                }}
                placeholder={newSessionSurface === 'task' ? 'Vanessa editing task' : 'Feature work'}
                aria-label="Session name"
              />
            </label>
          </div>

          <div className="dashboard-prompt-shell dashboard-chatbar-input-shell">
            <div className="dashboard-chatbar-field">
              <textarea
                ref={promptInputRef}
                value={newSessionPrompt}
                onChange={(event) => handlePromptChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                onInput={(event) => {
                  const target = event.currentTarget;
                  target.style.height = 'auto';
                  target.style.height = `${Math.min(target.scrollHeight, 176)}px`;
                }}
                placeholder={
                  newSessionSurface === 'task'
                    ? 'Ask for editing, writing, summarizing, research, file changes...'
                    : 'Describe what should be built, fixed, debugged, or changed...'
                }
                className="dashboard-prompt-input dashboard-chatbar-textarea"
                rows={1}
                style={{ height: 'auto', overflow: 'hidden' }}
              />
            </div>
            <Button
              type="submit"
              size="icon"
              variant="ghost"
              className="dashboard-send-button dashboard-chatbar-send composer-control-button composer-control-send"
              disabled={
                createMutation.isPending ||
                !newSessionPrompt.trim() ||
                (sessionMode === 'new' && !hasDefaultDir) ||
                (sessionMode === 'existing' && !selectedFolder) ||
                !!(selectedProviderInfo && !selectedProviderInfo.available)
              }
              title="Start session"
              aria-label="Start session"
            >
              {createMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>

          {newSessionSurface === 'task' && (
            <div className="dashboard-template-row dashboard-chatbar-suggestions">
              {TASK_STARTERS.map((starter) => (
                <button
                  key={starter}
                  type="button"
                  onClick={() => handlePromptChange(starter)}
                  className="dashboard-template-chip"
                >
                  {starter}
                </button>
              ))}
            </div>
          )}

          <div className="dashboard-composer-controls dashboard-chatbar-tools">
            <label className="dashboard-control dashboard-chatbar-chip dashboard-chatbar-provider">
              <ProviderLogo provider={selectedUiProvider} className="h-4 w-4" alt="" />
              <span>Provider</span>
              <select
                value={selectedCliProvider}
                onChange={(event) => {
                  providerSelectedExplicitlyRef.current = true;
                  setSelectedCliProvider(event.target.value as CLIProvider);
                }}
                aria-label="Provider"
              >
                {cliProviders?.map((provider) => (
                  <option key={provider.id} value={provider.id} disabled={!provider.available}>
                    {provider.name}
                    {!provider.available ? ' (N/A)' : ''}
                  </option>
                ))}
              </select>
            </label>

            <label className="dashboard-control dashboard-chatbar-chip">
              <SelectedModeIcon className="h-4 w-4" />
              <span>Mode</span>
              <select
                value={newSessionPermissionMode}
                onChange={(event) => setNewSessionPermissionMode(event.target.value as SessionMode)}
                aria-label="Mode"
              >
                {DASHBOARD_SESSION_MODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label} · {option.description}
                  </option>
                ))}
              </select>
            </label>

            <label className="dashboard-control dashboard-chatbar-chip dashboard-chatbar-model">
              <Brain className="h-4 w-4" />
              <span>Model</span>
              <select
                value={selectedModel || '__default__'}
                onChange={(event) =>
                  setSelectedModel(event.target.value === '__default__' ? '' : event.target.value)
                }
                aria-label="Model"
              >
                {showDefaultModelOption && (
                  <option value="__default__">
                    Default
                    {resolvedDefaultModel
                      ? ` · ${selectedProviderModelLabels[resolvedDefaultModel] || resolvedDefaultModel}`
                      : ''}
                  </option>
                )}
                {modelOptions.map((model) => (
                  <option key={model} value={model}>
                    {selectedProviderModelLabels[model] || model}
                  </option>
                ))}
              </select>
            </label>

            <label className="dashboard-control dashboard-chatbar-chip">
              <Zap className="h-4 w-4" />
              <span>{selectedCliProvider === 'claude' ? 'Effort' : 'Reasoning'}</span>
              <select
                value={selectedReasoning || '__default__'}
                onChange={(event) =>
                  setSelectedReasoning(
                    event.target.value === '__default__' ? '' : event.target.value
                  )
                }
                aria-label={selectedCliProvider === 'claude' ? 'Effort' : 'Reasoning'}
              >
                <option value="__default__">Default</option>
                {reasoningOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              className={cn(
                'dashboard-workspace-toggle dashboard-chatbar-chip dashboard-chatbar-workspace',
                showNewSession && 'is-open'
              )}
              onClick={() => setShowNewSession((open) => !open)}
              title={workspaceSummary}
            >
              <SlidersHorizontal className="h-4 w-4" />
              <span>Workspace</span>
              <strong>{workspaceSummary}</strong>
            </button>

            <input
              ref={newSessionFileInputRef}
              type="file"
              multiple
              className="sr-only"
              onChange={handleNewSessionFilesChange}
            />
            <button
              type="button"
              className={cn(
                'dashboard-workspace-toggle dashboard-chatbar-chip dashboard-chatbar-upload',
                newSessionFiles.length > 0 && 'has-files'
              )}
              onClick={() => newSessionFileInputRef.current?.click()}
              disabled={createMutation.isPending}
              title={
                newSessionFiles.length > 0
                  ? `${newSessionFiles.length} file(s) will be copied into the workfolder`
                  : 'Upload files into the workfolder before the session starts'
              }
            >
              <Upload className="h-4 w-4" />
              <span>Files</span>
              <strong>
                {newSessionFiles.length > 0 ? `${newSessionFiles.length} selected` : 'Upload'}
              </strong>
            </button>
          </div>

          {newSessionFiles.length > 0 && (
            <div className="dashboard-upload-list">
              {newSessionFiles.map((file, index) => (
                <span
                  key={`${file.name}-${file.size}-${file.lastModified}`}
                  className="dashboard-upload-pill"
                  title={`${file.name} · ${formatDashboardFileSize(file.size)}`}
                >
                  <Upload className="h-3.5 w-3.5" />
                  <span>{file.name}</span>
                  <em>{formatDashboardFileSize(file.size)}</em>
                  <button
                    type="button"
                    onClick={() => removeNewSessionFile(index)}
                    aria-label={`Remove ${file.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </span>
              ))}
              <button
                type="button"
                className="dashboard-upload-clear"
                onClick={clearNewSessionFiles}
              >
                Clear files
              </button>
            </div>
          )}

          {showNewSession && (
            <div className="dashboard-workspace-panel">
              <div className="dashboard-workspace-modes">
                <Button
                  type="button"
                  variant={sessionMode === 'new' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => {
                    setSessionMode('new');
                    setSelectedFolder(null);
                  }}
                  className="gap-1.5"
                >
                  <FolderPlus className="h-3.5 w-3.5" />
                  New folder
                </Button>
                <Button
                  type="button"
                  variant={sessionMode === 'existing' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSessionMode('existing')}
                  className="gap-1.5"
                >
                  <Folder className="h-3.5 w-3.5" />
                  Existing folder
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={closeNewSession}>
                  Clear
                </Button>
              </div>

              {sessionMode === 'new' && !hasDefaultDir ? (
                <div className="dashboard-workspace-warning">
                  <FolderOpen className="h-4 w-4" />
                  <span>Set a default working directory before creating new folders.</span>
                  <Button size="sm" asChild>
                    <Link to="/settings">
                      <Settings className="mr-1.5 h-3.5 w-3.5" />
                      Settings
                    </Link>
                  </Button>
                </div>
              ) : sessionMode === 'existing' ? (
                <div className="dashboard-folder-picker">
                  <Input
                    value={selectedFolder || ''}
                    readOnly
                    placeholder="Select folder..."
                    className="bg-muted/50"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowFolderBrowser(true)}
                  >
                    Browse
                  </Button>
                </div>
              ) : (
                <div className="dashboard-workspace-note">
                  <FolderOpen className="h-4 w-4" />
                  <span>{workspaceSummary}</span>
                </div>
              )}
            </div>
          )}
        </form>

        <div className="dashboard-stat-grid">
          <div className="dashboard-stat">
            <MessageSquare className="h-4 w-4" />
            <span>Total</span>
            <strong>{sessions.length}</strong>
          </div>
          <div className="dashboard-stat">
            <Activity className="h-4 w-4" />
            <span>Working</span>
            <strong>{workingSessions}</strong>
          </div>
          <div className="dashboard-stat">
            <Star className="h-4 w-4" />
            <span>Starred</span>
            <strong>{starredSessions}</strong>
          </div>
          <div className="dashboard-stat">
            <Tags className="h-4 w-4" />
            <span>Live idle</span>
            <strong>{liveIdleSessions}</strong>
          </div>
        </div>

        {cliProviders && cliProviders.length > 0 && (
          <div className="dashboard-provider-strip">
            {cliProviders.map((provider) => (
              <button
                key={provider.id}
                type="button"
                disabled={!provider.available}
                className={cn(
                  'dashboard-provider-chip',
                  selectedCliProvider === provider.id && 'is-selected'
                )}
                onClick={() => openNewSession(provider.id)}
                title={`Start with ${provider.name}`}
              >
                <ProviderLogo provider={toUiProvider(provider.id)} className="h-5 w-5" alt="" />
                <span>{provider.name}</span>
                {provider.id === 'claude' && <em>Legacy</em>}
                <strong>{providerCounts[provider.id] || 0}</strong>
              </button>
            ))}
          </div>
        )}
      </section>

      <FolderBrowserDialog
        open={showFolderBrowser}
        onOpenChange={setShowFolderBrowser}
        value={selectedFolder || undefined}
        onChange={(path: string) => {
          setSelectedFolder(path);
          setShowFolderBrowser(false);
          if (!newSessionName) setNewSessionName(path.split('/').pop() || '');
        }}
      />

      {/* Sessions with Optional Categories */}
      <div className="dashboard-content-row">
        {showCategories && (
          <Card className="dashboard-categories-panel">
            <SessionCategories
              selectedCategory={selectedCategory}
              onCategorySelect={setSelectedCategory}
              className="h-[350px]"
            />
          </Card>
        )}

        <div className="dashboard-session-sections">
          {dashboardSessionGroups.map((group) => {
            const groupCollapsed = collapsedDashboardGroupIds[group.id] ?? false;
            return (
              <section
                key={group.id}
                className={cn(
                  'dashboard-session-section',
                  group.hasWorking && 'is-working',
                  groupCollapsed && 'is-collapsed'
                )}
              >
                <button
                  type="button"
                  className="dashboard-session-section-header"
                  aria-expanded={!groupCollapsed}
                  onClick={() => toggleDashboardGroup(group.id)}
                >
                  <div className="dashboard-session-section-heading">
                    <ChevronRight
                      className="dashboard-session-section-chevron"
                      aria-hidden="true"
                    />
                    <span className="dashboard-session-section-dot" />
                    <h2>{group.label}</h2>
                  </div>
                  <span className="dashboard-session-section-count">{group.sessions.length}</span>
                </button>

                {!groupCollapsed && (
                  <div className="dashboard-session-grid">
                    {group.sessions.map((session) => {
                      const runState =
                        sessionRunStates.get(session.id) ?? getSessionRunState(session);
                      return (
                        <Card
                          key={session.id}
                          className={cn(
                            'dashboard-session-card cursor-pointer',
                            `is-${runState.tone}`
                          )}
                          onClick={() => navigate(`/session/${session.id}`)}
                        >
                          <CardHeader className="dashboard-session-header">
                            <div className="dashboard-session-heading">
                              <div className="dashboard-session-title-row">
                                <span className="dashboard-session-icon-wrap">
                                  <SessionIcon
                                    session={session}
                                    className="shrink-0"
                                    logoClassName="h-5 w-5"
                                    imageClassName="h-7 w-7 rounded-full"
                                  />
                                  {iconBusySessionId === session.id && (
                                    <span className="session-icon-busy-overlay">
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    </span>
                                  )}
                                </span>
                                <CardTitle className="dashboard-session-title">
                                  {session.name}
                                </CardTitle>
                              </div>
                              <CardDescription className="dashboard-session-path ui-text">
                                <FolderOpen className="h-2.5 w-2.5 shrink-0" />
                                <span className="truncate">{session.workingDirectory}</span>
                              </CardDescription>
                              <div className="dashboard-session-meta-row">
                                <div className="dashboard-run-state" title={runState.detail}>
                                  <span
                                    className={cn('dashboard-status-dot', `is-${runState.tone}`)}
                                  />
                                  <span>{runState.label}</span>
                                </div>
                                <span className="dashboard-session-date ui-text">
                                  {new Date(session.updatedAt).toLocaleDateString()}
                                </span>
                              </div>
                            </div>
                            <div
                              className="dashboard-session-card-actions"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {session.starred && (
                                <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" />
                              )}
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="dashboard-session-menu-button"
                                  >
                                    <MoreHorizontal className="h-3.5 w-3.5" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-44">
                                  <DropdownMenuItem
                                    onClick={() => setRenamingSession(session)}
                                    className="cursor-pointer"
                                  >
                                    <Pencil className="mr-2 h-3.5 w-3.5" />
                                    Rename
                                  </DropdownMenuItem>
                                  <DropdownMenuSub>
                                    <DropdownMenuSubTrigger className="cursor-pointer">
                                      <ImageIcon className="mr-2 h-3.5 w-3.5" />
                                      Icon
                                    </DropdownMenuSubTrigger>
                                    <DropdownMenuSubContent className="w-52">
                                      <DropdownMenuItem
                                        onSelect={(event) => {
                                          event.preventDefault();
                                          void handleGenerateIcon(session);
                                        }}
                                        disabled={!!iconBusySessionId}
                                        className="cursor-pointer"
                                      >
                                        {iconBusySessionId === session.id ? (
                                          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                                        ) : (
                                          <Sparkles className="mr-2 h-3.5 w-3.5" />
                                        )}
                                        {iconBusySessionId === session.id
                                          ? 'Generating...'
                                          : 'Generate'}
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        onSelect={(event) => {
                                          event.preventDefault();
                                          startIconUpload(session.id);
                                        }}
                                        disabled={!!iconBusySessionId}
                                        className="cursor-pointer"
                                      >
                                        <Upload className="mr-2 h-3.5 w-3.5" />
                                        Upload image
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        onSelect={(event) => {
                                          event.preventDefault();
                                          void handleUseProjectIcon(session);
                                        }}
                                        disabled={!!iconBusySessionId}
                                        className="cursor-pointer"
                                      >
                                        <FolderInput className="mr-2 h-3.5 w-3.5" />
                                        Use project icon
                                      </DropdownMenuItem>
                                      {session.iconUrl && (
                                        <>
                                          <DropdownMenuSeparator />
                                          <DropdownMenuItem
                                            onSelect={(event) => {
                                              event.preventDefault();
                                              void handleResetIcon(session);
                                            }}
                                            disabled={!!iconBusySessionId}
                                            className="cursor-pointer"
                                          >
                                            <RotateCcw className="mr-2 h-3.5 w-3.5" />
                                            Reset icon
                                          </DropdownMenuItem>
                                        </>
                                      )}
                                    </DropdownMenuSubContent>
                                  </DropdownMenuSub>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onClick={() => deleteMutation.mutate(session.id)}
                                    className="cursor-pointer text-destructive focus:text-destructive"
                                  >
                                    <Trash2 className="mr-2 h-3.5 w-3.5" />
                                    Delete
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </CardHeader>
                          <CardContent className="dashboard-session-body">
                            {session.lastMessage && (
                              <p className="dashboard-last-message ui-text">
                                {session.lastMessage}
                              </p>
                            )}
                            {runState.isWorking && (
                              <p className="dashboard-run-detail ui-text" title={runState.detail}>
                                {runState.detail}
                              </p>
                            )}
                            <div className="dashboard-session-footer">
                              <div
                                className="dashboard-session-category"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <CategorySelector
                                  sessionId={session.id}
                                  currentCategory={session.category || null}
                                  onCategoryChange={(categoryId) => {
                                    updateSession(session.id, { category: categoryId });
                                    queryClient.invalidateQueries({ queryKey: ['sessions'] });
                                  }}
                                />
                              </div>
                              <span
                                className="dashboard-session-open-affordance"
                                aria-hidden="true"
                              >
                                <ArrowUpRight className="h-3.5 w-3.5" />
                              </span>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}

          {filteredSessions.length === 0 && !showNewSession && (
            <Card className="dashboard-empty-card">
              <CardContent className="flex flex-col items-center justify-center py-8">
                <MessageSquare className="h-10 w-10 text-muted-foreground mb-3" />
                <p className="text-sm text-muted-foreground mb-3">No sessions yet</p>
                <Button size="sm" onClick={() => openNewSession()}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Create your first session
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <RenameSessionDialog
        session={renamingSession}
        open={!!renamingSession}
        onOpenChange={(open) => {
          if (!open) setRenamingSession(null);
        }}
      />
      <input
        ref={iconUploadInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/x-icon,.ico"
        className="hidden"
        onChange={(event) => handleIconUploadFile(event.target.files?.[0])}
      />
    </div>
  );
}
