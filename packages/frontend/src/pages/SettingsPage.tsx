import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Trash2,
  Server,
  Sun,
  Moon,
  Monitor,
  Terminal,
  CheckCircle2,
  RefreshCw,
  FolderOpen,
  FolderSearch,
  Bot,
  Wand2,
  Settings2,
  Pencil,
  ToggleLeft,
  ToggleRight,
  Puzzle,
  Store,
  Key,
  Eye,
  EyeOff,
  Sparkles,
  Palette,
  Wrench,
  KeyRound,
  Zap,
  AlertCircle,
  Loader2,
  Github,
  Search,
  X,
  Lock,
  User,
  Shield,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FolderBrowserDialog } from '@/components/ui/folder-browser';
import { AgentSkillEditorDialog } from '@/components/ui/agent-skill-editor';
import { PluginEditorDialog } from '@/components/ui/plugin-editor';
import { MarketplaceBrowserDialog } from '@/components/ui/marketplace-browser';
import { ProvidersSettings } from '@/components/providers';
import { api } from '@/services/api';
import { toast } from '@/hooks/use-toast';
import type { UserSettings, McpServer, CliTool, ApiResponse, Theme } from '@claude-code-webui/shared';
import { cn } from '@/lib/utils';

interface AgentInfo {
  id: string;
  name: string;
  description: string;
  tools?: string[];
  model?: string;
  filePath: string;
  source: 'user' | 'project';
  enabled: boolean;
}

interface SkillInfo {
  id: string;
  name: string;
  description: string;
  allowedTools?: string[];
  model?: string;
  dirPath: string;
  source: 'user' | 'project';
  enabled: boolean;
}

interface PluginInfo {
  id: string;
  name: string;
  description: string;
  version: string;
  author?: string;
  category?: string;
  dirPath: string;
  source: 'user' | 'marketplace';
  enabled: boolean;
  marketplace?: string;
  installedAt?: string;
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const [showMcpForm, setShowMcpForm] = useState(false);
  const [showFolderBrowser, setShowFolderBrowser] = useState(false);
  const [currentTheme, setCurrentTheme] = useState<Theme>(() => {
    return (localStorage.getItem('theme') as Theme) || 'system';
  });
  const [newMcpServer, setNewMcpServer] = useState<{
    name: string;
    type: 'subprocess' | 'sse';
    command: string;
    url: string;
  }>({
    name: '',
    type: 'subprocess',
    command: '',
    url: '',
  });

  // CLI Tools state
  const [showCliToolForm, setShowCliToolForm] = useState(false);
  const [newCliTool, setNewCliTool] = useState<{
    name: string;
    command: string;
    description: string;
    timeoutSeconds: number;
  }>({
    name: '',
    command: '',
    description: '',
    timeoutSeconds: 300,
  });

  // Agent/Skill editor state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorType, setEditorType] = useState<'agent' | 'skill'>('agent');
  const [editorMode, setEditorMode] = useState<'create' | 'edit'>('create');
  const [editingItem, setEditingItem] = useState<{ name: string; data: Record<string, unknown> } | null>(null);

  // Plugin editor state
  const [pluginEditorOpen, setPluginEditorOpen] = useState(false);
  const [pluginEditorMode, setPluginEditorMode] = useState<'create' | 'edit'>('create');
  const [editingPlugin, setEditingPlugin] = useState<{ name: string; data: Record<string, unknown> } | null>(null);

  // Marketplace browser state
  const [marketplaceBrowserOpen, setMarketplaceBrowserOpen] = useState(false);

  // Plugin search state
  const [pluginSearchQuery, setPluginSearchQuery] = useState('');

  // Gemini API key state
  const [geminiKeyInput, setGeminiKeyInput] = useState('');
  const [showGeminiKey, setShowGeminiKey] = useState(false);

  // GitHub token state
  const [githubTokenInput, setGithubTokenInput] = useState('');
  const [showGithubToken, setShowGithubToken] = useState(false);

  // Basic auth credentials state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);

  // MCP test state
  const [mcpTestResults, setMcpTestResults] = useState<Record<string, { testing: boolean; connected?: boolean; error?: string }>>({});

  // Fetch settings
  const { data: settings, isLoading: settingsLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<UserSettings>>('/api/settings');
      return response.data.data;
    },
  });

  // Fetch MCP servers
  const { data: mcpServers, isLoading: mcpLoading } = useQuery({
    queryKey: ['mcp-servers'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<McpServer[]>>('/api/mcp-servers');
      return response.data.data || [];
    },
  });

  // Fetch CLI tools
  const { data: cliTools, isLoading: cliToolsLoading } = useQuery({
    queryKey: ['cli-tools'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<CliTool[]>>('/api/cli-tools');
      return response.data.data || [];
    },
  });

  // Check Claude CLI status
  const { data: claudeStatus, refetch: refetchClaudeStatus, isFetching: isRefetching } = useQuery({
    queryKey: ['claude-status'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<{ installed: boolean; authenticated: boolean; version?: string }>>('/api/claude/status');
      return response.data.data;
    },
  });

  // Fetch Claude agents from ~/.claude/agents/
  const { data: claudeAgents } = useQuery({
    queryKey: ['claude-agents'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<AgentInfo[]>>('/api/claude-config/agents');
      return response.data.data || [];
    },
  });

  // Fetch Claude skills from ~/.claude/skills/
  const { data: claudeSkills } = useQuery({
    queryKey: ['claude-skills'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<SkillInfo[]>>('/api/claude-config/skills');
      return response.data.data || [];
    },
  });

  // Fetch installed plugins
  const { data: installedPlugins } = useQuery({
    queryKey: ['installed-plugins'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<PluginInfo[]>>('/api/claude-config/plugins');
      return response.data.data || [];
    },
  });

  // Fetch known marketplaces
  const { data: marketplaces } = useQuery({
    queryKey: ['marketplaces'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<{
        id: string;
        name: string;
        source: { source: string; repo?: string; url?: string };
        lastUpdated: string;
        plugins?: { name: string; description: string; version: string }[];
      }[]>>('/api/claude-config/marketplaces');
      return response.data.data || [];
    },
  });

  // Fetch Gemini API key status
  const { data: geminiKeyStatus, refetch: refetchGeminiKey } = useQuery({
    queryKey: ['gemini-key'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<{ hasKey: boolean; keyPreview: string | null }>>('/api/settings/gemini-key');
      return response.data.data;
    },
  });

  // Fetch GitHub token status
  const { data: githubTokenStatus, refetch: refetchGithubToken } = useQuery({
    queryKey: ['github-token'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<{ hasToken: boolean; tokenPreview: string | null }>>('/api/settings/github-token');
      return response.data.data;
    },
  });

  // Fetch basic auth credentials info
  const { data: basicAuthCredentials, refetch: refetchBasicAuth } = useQuery({
    queryKey: ['basic-auth-credentials'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<{ username: string; enabled: boolean }>>('/api/basic-auth/credentials');
      return response.data.data;
    },
  });

  // Filter installed plugins based on search
  const filteredPlugins = useMemo(() => {
    if (!installedPlugins) return [];
    if (!pluginSearchQuery.trim()) return installedPlugins;

    const query = pluginSearchQuery.toLowerCase();
    return installedPlugins.filter((plugin) =>
      plugin.name.toLowerCase().includes(query) ||
      plugin.description?.toLowerCase().includes(query) ||
      plugin.author?.toLowerCase().includes(query) ||
      plugin.category?.toLowerCase().includes(query) ||
      plugin.marketplace?.toLowerCase().includes(query)
    );
  }, [installedPlugins, pluginSearchQuery]);

  // Claude authentication mutation
  const authenticateMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post<ApiResponse<{ authUrl?: string; message: string }>>('/api/claude/authenticate');
      return response.data.data;
    },
    onSuccess: (data) => {
      if (data?.authUrl) {
        window.open(data.authUrl, '_blank');
        toast({ title: 'Authentication started', description: 'Complete the login in the opened browser tab, then click Refresh.' });
      } else {
        toast({ title: 'Authentication', description: data?.message || 'Check status' });
        refetchClaudeStatus();
      }
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Update settings mutation
  const updateSettingsMutation = useMutation({
    mutationFn: async (data: Partial<UserSettings>) => {
      const response = await api.put<ApiResponse<UserSettings>>('/api/settings', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast({ title: 'Settings saved' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Create MCP server mutation
  const createMcpMutation = useMutation({
    mutationFn: async (data: typeof newMcpServer) => {
      const response = await api.post<ApiResponse<McpServer>>('/api/mcp-servers', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcp-servers'] });
      setShowMcpForm(false);
      setNewMcpServer({ name: '', type: 'subprocess', command: '', url: '' });
      toast({ title: 'MCP server added' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Delete MCP server mutation
  const deleteMcpMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/api/mcp-servers/${id}`);
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcp-servers'] });
      toast({ title: 'MCP server deleted' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Test MCP server connection
  const testMcpServer = async (serverId: string) => {
    setMcpTestResults((prev) => ({
      ...prev,
      [serverId]: { testing: true },
    }));

    try {
      const response = await api.post<ApiResponse<{ connected: boolean; error?: string }>>(
        `/api/mcp-servers/${serverId}/test`
      );
      const result = response.data.data;

      setMcpTestResults((prev) => ({
        ...prev,
        [serverId]: {
          testing: false,
          connected: result?.connected,
          error: result?.error,
        },
      }));

      if (result?.connected) {
        toast({ title: 'Connection successful', description: 'MCP server is responding' });
      } else {
        toast({
          title: 'Connection failed',
          description: result?.error || 'Could not connect to server',
          variant: 'destructive',
        });
      }
    } catch (error) {
      setMcpTestResults((prev) => ({
        ...prev,
        [serverId]: {
          testing: false,
          connected: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      }));
      toast({
        title: 'Test failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  // Create CLI tool mutation
  const createCliToolMutation = useMutation({
    mutationFn: async (data: typeof newCliTool) => {
      const response = await api.post<ApiResponse<CliTool>>('/api/cli-tools', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cli-tools'] });
      setShowCliToolForm(false);
      setNewCliTool({ name: '', command: '', description: '', timeoutSeconds: 300 });
      toast({ title: 'CLI tool added' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Toggle CLI tool mutation
  const toggleCliToolMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const response = await api.put<ApiResponse<CliTool>>(`/api/cli-tools/${id}`, { enabled });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cli-tools'] });
      toast({ title: 'CLI tool updated' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Delete CLI tool mutation
  const deleteCliToolMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/api/cli-tools/${id}`);
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cli-tools'] });
      toast({ title: 'CLI tool deleted' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Delete plugin mutation
  const deletePluginMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/api/claude-config/plugin/${encodeURIComponent(id)}`);
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['installed-plugins'] });
      toast({ title: 'Plugin uninstalled' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Toggle agent mutation
  const toggleAgentMutation = useMutation({
    mutationFn: async (name: string) => {
      const response = await api.put<ApiResponse<{ enabled: boolean }>>(`/api/claude-config/agent/${name}/toggle`);
      return response.data.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['claude-agents'] });
      toast({ title: data?.enabled ? 'Agent enabled' : 'Agent disabled' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Toggle skill mutation
  const toggleSkillMutation = useMutation({
    mutationFn: async (name: string) => {
      const response = await api.put<ApiResponse<{ enabled: boolean }>>(`/api/claude-config/skill/${name}/toggle`);
      return response.data.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['claude-skills'] });
      toast({ title: data?.enabled ? 'Skill enabled' : 'Skill disabled' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Toggle plugin mutation
  const togglePluginMutation = useMutation({
    mutationFn: async (name: string) => {
      const response = await api.put<ApiResponse<{ enabled: boolean }>>(`/api/claude-config/plugin/${name}/toggle`);
      return response.data.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['installed-plugins'] });
      toast({ title: data?.enabled ? 'Plugin enabled' : 'Plugin disabled' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Set Gemini API key mutation
  const setGeminiKeyMutation = useMutation({
    mutationFn: async (apiKey: string) => {
      const response = await api.put<ApiResponse<{ hasKey: boolean; keyPreview: string }>>('/api/settings/gemini-key', { apiKey });
      return response.data.data;
    },
    onSuccess: () => {
      refetchGeminiKey();
      setGeminiKeyInput('');
      toast({ title: 'Gemini API key saved' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Delete Gemini API key mutation
  const deleteGeminiKeyMutation = useMutation({
    mutationFn: async () => {
      await api.delete('/api/settings/gemini-key');
    },
    onSuccess: () => {
      refetchGeminiKey();
      toast({ title: 'Gemini API key removed' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Set GitHub token mutation
  const setGithubTokenMutation = useMutation({
    mutationFn: async (token: string) => {
      const response = await api.put<ApiResponse<{ hasToken: boolean; tokenPreview: string }>>('/api/settings/github-token', { token });
      return response.data.data;
    },
    onSuccess: () => {
      refetchGithubToken();
      setGithubTokenInput('');
      toast({ title: 'GitHub token saved' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Delete GitHub token mutation
  const deleteGithubTokenMutation = useMutation({
    mutationFn: async () => {
      await api.delete('/api/settings/github-token');
    },
    onSuccess: () => {
      refetchGithubToken();
      toast({ title: 'GitHub token removed' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Update basic auth credentials mutation
  const updateBasicAuthMutation = useMutation({
    mutationFn: async (data: { currentPassword: string; newUsername?: string; newPassword?: string }) => {
      const response = await api.put<ApiResponse<{ username: string; message: string }>>('/api/basic-auth/credentials', data);
      return response.data.data;
    },
    onSuccess: (data) => {
      refetchBasicAuth();
      setCurrentPassword('');
      setNewUsername('');
      setNewPassword('');
      setConfirmPassword('');
      toast({ title: 'Success', description: data?.message || 'Credentials updated' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Toggle basic auth mutation
  const toggleBasicAuthMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const response = await api.put<ApiResponse<{ enabled: boolean; message: string }>>('/api/basic-auth/toggle', { enabled });
      return response.data.data;
    },
    onSuccess: (data) => {
      refetchBasicAuth();
      toast({ title: data?.enabled ? 'Basic auth enabled' : 'Basic auth disabled' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const handleThemeChange = (theme: Theme) => {
    localStorage.setItem('theme', theme);
    setCurrentTheme(theme);

    document.documentElement.classList.remove('light', 'dark');
    if (theme === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.classList.add(prefersDark ? 'dark' : 'light');
    } else {
      document.documentElement.classList.add(theme);
    }

    updateSettingsMutation.mutate({ theme });
  };

  const openAgentEditor = (mode: 'create' | 'edit', agent?: AgentInfo) => {
    setEditorType('agent');
    setEditorMode(mode);
    if (agent) {
      // Extract base name from filePath
      const baseName = agent.filePath.split('/').pop()?.replace('.md.disabled', '').replace('.md', '') || agent.name;
      setEditingItem({
        name: baseName,
        data: {
          name: agent.name,
          description: agent.description,
          tools: agent.tools,
          model: agent.model,
          prompt: '', // Will be fetched by the editor
        },
      });
    } else {
      setEditingItem(null);
    }
    setEditorOpen(true);
  };

  const openSkillEditor = (mode: 'create' | 'edit', skill?: SkillInfo) => {
    setEditorType('skill');
    setEditorMode(mode);
    if (skill) {
      // Extract base name from dirPath
      const baseName = skill.dirPath.split('/').pop()?.replace('.disabled', '') || skill.name;
      setEditingItem({
        name: baseName,
        data: {
          name: skill.name,
          description: skill.description,
          allowedTools: skill.allowedTools,
          model: skill.model,
          content: '', // Will be fetched by the editor
        },
      });
    } else {
      setEditingItem(null);
    }
    setEditorOpen(true);
  };

  const openPluginEditor = (mode: 'create' | 'edit', plugin?: PluginInfo) => {
    setPluginEditorMode(mode);
    if (plugin) {
      // Extract base name from dirPath
      const baseName = plugin.dirPath.split('/').pop()?.replace('.disabled', '') || plugin.name;
      setEditingPlugin({
        name: baseName,
        data: {
          name: plugin.name,
          description: plugin.description,
          version: plugin.version,
          author: plugin.author,
          category: plugin.category,
          content: '', // Will be fetched by the editor
        },
      });
    } else {
      setEditingPlugin(null);
    }
    setPluginEditorOpen(true);
  };

  const themeOptions = [
    { value: 'light' as Theme, label: 'Light', icon: Sun, description: 'Warm cream tones' },
    { value: 'dark' as Theme, label: 'Dark', icon: Moon, description: 'Easy on the eyes' },
    { value: 'system' as Theme, label: 'Auto', icon: Monitor, description: 'Match your OS' },
  ];

  if (settingsLoading || mcpLoading || cliToolsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="loader" />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Compact Header */}
      <div className="relative mb-6 md:mb-8">
        <div className="flex items-center gap-3 md:gap-4">
          <div className="p-2.5 md:p-3 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20">
            <Settings2 className="h-5 w-5 md:h-6 md:w-6 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl md:text-2xl font-bold tracking-tight">Settings</h1>
            <p className="text-sm text-muted-foreground hidden sm:block">
              Configure your environment and personalize your experience
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto pb-12 space-y-6 md:space-y-8">

        {/* Status Overview Grid */}
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
          {/* CLI Status Card */}
          <Card className={cn(
            "relative overflow-hidden transition-all",
            claudeStatus?.authenticated
              ? "border-green-500/30 bg-green-500/5"
              : "border-amber-500/30 bg-amber-500/5"
          )}>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className={cn(
                  "p-2 rounded-lg",
                  claudeStatus?.authenticated
                    ? "bg-green-500/15 text-green-600 dark:text-green-400"
                    : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                )}>
                  <Terminal className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground">CLI</p>
                  <p className={cn(
                    "text-sm font-semibold truncate",
                    claudeStatus?.authenticated
                      ? "text-green-600 dark:text-green-400"
                      : "text-amber-600 dark:text-amber-400"
                  )}>
                    {claudeStatus?.authenticated ? 'Connected' : 'Not Auth'}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => refetchClaudeStatus()}
                  disabled={isRefetching}
                  className="h-7 w-7 shrink-0"
                >
                  <RefreshCw className={cn("h-3.5 w-3.5", isRefetching && "animate-spin")} />
                </Button>
              </div>
              {!claudeStatus?.authenticated && claudeStatus?.installed && (
                <Button
                  onClick={() => authenticateMutation.mutate()}
                  disabled={authenticateMutation.isPending}
                  size="sm"
                  className="w-full mt-3 h-8 text-xs"
                >
                  {authenticateMutation.isPending ? 'Starting...' : 'Authenticate'}
                </Button>
              )}
            </CardContent>
          </Card>

          {/* Agents Count Card */}
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/15 text-primary">
                  <Bot className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground">Agents</p>
                  <p className="text-lg font-bold">{claudeAgents?.length || 0}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Skills Count Card */}
          <Card className="border-green-500/20 bg-green-500/5">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-green-500/15 text-green-600 dark:text-green-400">
                  <Wand2 className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground">Skills</p>
                  <p className="text-lg font-bold">{claudeSkills?.length || 0}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Plugins Count Card */}
          <Card className="border-violet-500/20 bg-violet-500/5">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-violet-500/15 text-violet-600 dark:text-violet-400">
                  <Puzzle className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground">Plugins</p>
                  <p className="text-lg font-bold">{installedPlugins?.length || 0}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs Navigation */}
        <Tabs defaultValue="general" className="w-full">
          <TabsList className="grid w-full grid-cols-7 h-12">
            <TabsTrigger value="general" className="gap-2">
              <Settings2 className="h-4 w-4" />
              <span className="hidden sm:inline">General</span>
            </TabsTrigger>
            <TabsTrigger value="security" className="gap-2">
              <Shield className="h-4 w-4" />
              <span className="hidden sm:inline">Security</span>
            </TabsTrigger>
            <TabsTrigger value="appearance" className="gap-2">
              <Palette className="h-4 w-4" />
              <span className="hidden sm:inline">Appearance</span>
            </TabsTrigger>
            <TabsTrigger value="api-keys" className="gap-2">
              <KeyRound className="h-4 w-4" />
              <span className="hidden sm:inline">API Keys</span>
            </TabsTrigger>
            <TabsTrigger value="providers" className="gap-2">
              <Bot className="h-4 w-4" />
              <span className="hidden sm:inline">AI Providers</span>
            </TabsTrigger>
            <TabsTrigger value="tools" className="gap-2">
              <Wrench className="h-4 w-4" />
              <span className="hidden sm:inline">Tools</span>
            </TabsTrigger>
            <TabsTrigger value="extensions" className="gap-2">
              <Puzzle className="h-4 w-4" />
              <span className="hidden sm:inline">Extensions</span>
            </TabsTrigger>
          </TabsList>

          {/* Security Tab */}
          <TabsContent value="security" className="space-y-6">
            {/* Basic Auth Status */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold">Login Protection</h2>
                  <Shield className="h-4 w-4 text-muted-foreground" />
                </div>
                <Button
                  variant={basicAuthCredentials?.enabled ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => toggleBasicAuthMutation.mutate(!basicAuthCredentials?.enabled)}
                  disabled={toggleBasicAuthMutation.isPending}
                  className="gap-2"
                >
                  {basicAuthCredentials?.enabled ? (
                    <>
                      <ToggleRight className="h-4 w-4" />
                      Enabled
                    </>
                  ) : (
                    <>
                      <ToggleLeft className="h-4 w-4" />
                      Disabled
                    </>
                  )}
                </Button>
              </div>

              <Card className={cn(
                "border",
                basicAuthCredentials?.enabled
                  ? "border-green-500/30 bg-green-500/5"
                  : "border-muted"
              )}>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-center gap-3 mb-4">
                    <div className={cn(
                      "p-2 rounded-lg",
                      basicAuthCredentials?.enabled
                        ? "bg-green-500/15 text-green-600 dark:text-green-400"
                        : "bg-muted text-muted-foreground"
                    )}>
                      <Lock className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">
                        {basicAuthCredentials?.enabled ? 'Password protection is active' : 'Password protection is disabled'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Current username: <span className="font-mono">{basicAuthCredentials?.username || 'admin'}</span>
                      </p>
                    </div>
                  </div>

                  {basicAuthCredentials?.enabled && (
                    <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm text-amber-600 dark:text-amber-400">
                      <AlertCircle className="h-4 w-4 inline mr-2" />
                      Users must enter the password before accessing the Claude login screen.
                    </div>
                  )}
                </CardContent>
              </Card>
            </section>

            {/* Change Credentials */}
            <section>
              <h2 className="text-lg font-semibold mb-3">Change Credentials</h2>
              <Card>
                <CardHeader className="pb-4">
                  <CardTitle className="text-base">Update Username & Password</CardTitle>
                  <CardDescription>
                    Change your login credentials. You'll need to enter your current password.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Current Password */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Current Password *</label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        type={showCurrentPassword ? 'text' : 'password'}
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        placeholder="Enter current password"
                        className="pl-10 pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-muted"
                      >
                        {showCurrentPassword ? (
                          <EyeOff className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <Eye className="h-4 w-4 text-muted-foreground" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    {/* New Username */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium">New Username</label>
                      <div className="relative">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          type="text"
                          value={newUsername}
                          onChange={(e) => setNewUsername(e.target.value)}
                          placeholder="Leave empty to keep current"
                          className="pl-10"
                        />
                      </div>
                    </div>

                    {/* New Password */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium">New Password</label>
                      <div className="relative">
                        <Key className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          type={showNewPassword ? 'text' : 'password'}
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="Leave empty to keep current"
                          className="pl-10 pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setShowNewPassword(!showNewPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-muted"
                        >
                          {showNewPassword ? (
                            <EyeOff className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <Eye className="h-4 w-4 text-muted-foreground" />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Confirm Password */}
                  {newPassword && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Confirm New Password</label>
                      <div className="relative">
                        <Key className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          type={showNewPassword ? 'text' : 'password'}
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          placeholder="Confirm new password"
                          className={cn(
                            "pl-10",
                            confirmPassword && newPassword !== confirmPassword && "border-destructive"
                          )}
                        />
                      </div>
                      {confirmPassword && newPassword !== confirmPassword && (
                        <p className="text-xs text-destructive">Passwords do not match</p>
                      )}
                    </div>
                  )}

                  <Button
                    onClick={() => {
                      if (newPassword && newPassword !== confirmPassword) {
                        toast({ title: 'Error', description: 'Passwords do not match', variant: 'destructive' });
                        return;
                      }
                      updateBasicAuthMutation.mutate({
                        currentPassword,
                        newUsername: newUsername || undefined,
                        newPassword: newPassword || undefined,
                      });
                    }}
                    disabled={
                      !currentPassword ||
                      (!newUsername && !newPassword) ||
                      (newPassword && newPassword !== confirmPassword) ||
                      updateBasicAuthMutation.isPending
                    }
                  >
                    {updateBasicAuthMutation.isPending ? 'Updating...' : 'Update Credentials'}
                  </Button>
                </CardContent>
              </Card>
            </section>
          </TabsContent>

          {/* General Tab */}
          <TabsContent value="general" className="space-y-6">
            {/* Default Working Directory */}
            <section>
              <h2 className="text-lg font-semibold mb-3">Default Directory</h2>
              <div className="flex gap-2">
                <div className="p-2.5 rounded-lg bg-muted shrink-0">
                  <FolderOpen className="h-4 w-4 text-muted-foreground" />
                </div>
                <Input
                  value={settings?.defaultWorkingDir || ''}
                  onChange={(e) =>
                    updateSettingsMutation.mutate({ defaultWorkingDir: e.target.value || null })
                  }
                  placeholder="/home/user/projects"
                  className="flex-1 font-mono text-sm h-10"
                />
                <Button
                  variant="secondary"
                  size="icon"
                  onClick={() => setShowFolderBrowser(true)}
                  className="shrink-0 h-10 w-10"
                >
                  <FolderSearch className="h-4 w-4" />
                </Button>
              </div>
            </section>

            {/* Allowed Tools */}
            <section>
              <h2 className="text-lg font-semibold mb-3">Allowed Tools</h2>
              <div className="flex flex-wrap gap-2">
                {['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'Task', 'TodoWrite'].map((tool) => {
                  const isEnabled = settings?.allowedTools?.includes(tool);
                  return (
                    <button
                      type="button"
                      key={tool}
                      onClick={() => {
                        const current = settings?.allowedTools || [];
                        const updated = isEnabled
                          ? current.filter(t => t !== tool)
                          : [...current, tool];
                        updateSettingsMutation.mutate({ allowedTools: updated });
                      }}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-sm font-medium transition-all",
                        "hover:scale-105 active:scale-95",
                        isEnabled
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:bg-muted/80"
                      )}
                    >
                      {tool}
                    </button>
                  );
                })}
              </div>
            </section>
          </TabsContent>

          {/* Appearance Tab */}
          <TabsContent value="appearance" className="space-y-6">
            <section>
              <h2 className="text-lg font-semibold mb-3">Theme</h2>
              <div className="flex gap-2 flex-wrap">
                {themeOptions.map((option) => {
                  const Icon = option.icon;
                  const isActive = currentTheme === option.value;

                  return (
                    <button
                      type="button"
                      key={option.value}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleThemeChange(option.value);
                      }}
                      className={cn(
                        "flex items-center gap-2 px-4 py-2.5 rounded-xl border transition-all",
                        "hover:scale-[1.02] active:scale-[0.98]",
                        isActive
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-card hover:border-primary/40"
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      <span className="text-sm font-medium">{option.label}</span>
                      {isActive && (
                        <CheckCircle2 className="h-4 w-4 ml-1" />
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
          </TabsContent>

          {/* API Keys Tab */}
          <TabsContent value="api-keys" className="space-y-6">
            {/* Gemini API Key */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-lg font-semibold">Gemini API Key</h2>
            <Sparkles className="h-4 w-4 text-amber-500" />
          </div>
          <Card className={cn(
            "border",
            geminiKeyStatus?.hasKey
              ? "border-green-500/30 bg-green-500/5"
              : "border-amber-500/30 bg-amber-500/5"
          )}>
            <CardContent className="pt-4 pb-4">
              {geminiKeyStatus?.hasKey ? (
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-green-500/15">
                    <Key className="h-4 w-4 text-green-600 dark:text-green-400" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-green-600 dark:text-green-400">API Key configured</p>
                    <p className="text-xs text-muted-foreground font-mono">{geminiKeyStatus.keyPreview}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => deleteGeminiKeyMutation.mutate()}
                    disabled={deleteGeminiKeyMutation.isPending}
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    Remove
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-amber-500/15">
                      <Key className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-amber-600 dark:text-amber-400">No API key set</p>
                      <p className="text-xs text-muted-foreground">Required for Gemini image generation</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Input
                        type={showGeminiKey ? 'text' : 'password'}
                        value={geminiKeyInput}
                        onChange={(e) => setGeminiKeyInput(e.target.value)}
                        placeholder="AIzaSy..."
                        className="font-mono text-sm pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowGeminiKey(!showGeminiKey)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-muted"
                      >
                        {showGeminiKey ? (
                          <EyeOff className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <Eye className="h-4 w-4 text-muted-foreground" />
                        )}
                      </button>
                    </div>
                    <Button
                      onClick={() => setGeminiKeyMutation.mutate(geminiKeyInput)}
                      disabled={!geminiKeyInput || setGeminiKeyMutation.isPending}
                    >
                      {setGeminiKeyMutation.isPending ? 'Saving...' : 'Save'}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Get your API key from{' '}
                    <a
                      href="https://aistudio.google.com/apikey"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      Google AI Studio
                    </a>
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
            </section>

            {/* GitHub Token */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-lg font-semibold">GitHub Token</h2>
                <Github className="h-4 w-4 text-gray-500" />
              </div>
              <Card className={cn(
                "border",
                githubTokenStatus?.hasToken
                  ? "border-green-500/30 bg-green-500/5"
                  : "border-gray-500/30 bg-gray-500/5"
              )}>
                <CardContent className="pt-4 pb-4">
                  {githubTokenStatus?.hasToken ? (
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-green-500/15">
                        <Github className="h-4 w-4 text-green-600 dark:text-green-400" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-green-600 dark:text-green-400">Token configured</p>
                        <p className="text-xs text-muted-foreground font-mono">{githubTokenStatus.tokenPreview}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteGithubTokenMutation.mutate()}
                        disabled={deleteGithubTokenMutation.isPending}
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-4 w-4 mr-1" />
                        Remove
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-gray-500/15">
                          <Github className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-medium text-gray-600 dark:text-gray-400">No token set</p>
                          <p className="text-xs text-muted-foreground">Required for GitHub integration features</p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <Input
                            type={showGithubToken ? 'text' : 'password'}
                            value={githubTokenInput}
                            onChange={(e) => setGithubTokenInput(e.target.value)}
                            placeholder="ghp_..."
                            className="font-mono text-sm pr-10"
                          />
                          <button
                            type="button"
                            onClick={() => setShowGithubToken(!showGithubToken)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-muted"
                          >
                            {showGithubToken ? (
                              <EyeOff className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <Eye className="h-4 w-4 text-muted-foreground" />
                            )}
                          </button>
                        </div>
                        <Button
                          onClick={() => setGithubTokenMutation.mutate(githubTokenInput)}
                          disabled={!githubTokenInput || setGithubTokenMutation.isPending}
                        >
                          {setGithubTokenMutation.isPending ? 'Saving...' : 'Save'}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Get a Personal Access Token from{' '}
                        <a
                          href="https://github.com/settings/tokens/new"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline"
                        >
                          GitHub Settings
                        </a>
                        {' '}(scopes: repo, read:user)
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </section>
          </TabsContent>

          {/* AI Providers Tab */}
          <TabsContent value="providers" className="space-y-6">
            <ProvidersSettings />
          </TabsContent>

          {/* Tools Tab */}
          <TabsContent value="tools" className="space-y-6">
            {/* MCP Servers */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">MCP Servers</h2>
              {mcpServers && mcpServers.length > 0 && (
                <span className="px-2 py-0.5 text-xs font-medium bg-muted rounded-full">
                  {mcpServers.length}
                </span>
              )}
            </div>
            <Button size="sm" onClick={() => setShowMcpForm(true)} className="gap-1.5 h-8 px-3 text-xs">
              <Plus className="h-3.5 w-3.5" />
              Add
            </Button>
          </div>

          {showMcpForm && (
            <Card className="mb-4 border-primary/30 bg-primary/5 animate-scale-in">
              <CardHeader className="pb-4">
                <CardTitle className="text-base">New MCP Server</CardTitle>
                <CardDescription>Configure a Model Context Protocol server connection</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Server Name</label>
                    <Input
                      value={newMcpServer.name}
                      onChange={(e) => setNewMcpServer({ ...newMcpServer, name: e.target.value })}
                      placeholder="My Server"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Type</label>
                    <select
                      className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
                      value={newMcpServer.type}
                      onChange={(e) =>
                        setNewMcpServer({ ...newMcpServer, type: e.target.value as 'subprocess' | 'sse' })
                      }
                    >
                      <option value="subprocess">Subprocess</option>
                      <option value="sse">SSE (Server-Sent Events)</option>
                    </select>
                  </div>
                </div>
                {newMcpServer.type === 'subprocess' ? (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Command</label>
                    <Input
                      value={newMcpServer.command}
                      onChange={(e) => setNewMcpServer({ ...newMcpServer, command: e.target.value })}
                      placeholder="npx @modelcontextprotocol/server-filesystem"
                      className="font-mono text-sm"
                    />
                  </div>
                ) : (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">URL</label>
                    <Input
                      value={newMcpServer.url}
                      onChange={(e) => setNewMcpServer({ ...newMcpServer, url: e.target.value })}
                      placeholder="https://api.example.com/mcp/sse"
                      className="font-mono text-sm"
                    />
                  </div>
                )}
                <div className="flex gap-3 pt-2">
                  <Button
                    onClick={() => createMcpMutation.mutate(newMcpServer)}
                    disabled={!newMcpServer.name || createMcpMutation.isPending}
                  >
                    {createMcpMutation.isPending ? 'Adding...' : 'Add Server'}
                  </Button>
                  <Button variant="ghost" onClick={() => setShowMcpForm(false)}>
                    Cancel
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {mcpServers && mcpServers.length > 0 ? (
            <div className="space-y-2">
              {mcpServers.map((server) => {
                const testResult = mcpTestResults[server.id];
                return (
                  <div
                    key={server.id}
                    className={cn(
                      "group flex items-center gap-4 p-4 rounded-xl border bg-card transition-all hover:border-primary/30 hover:shadow-sm",
                      testResult?.connected === true && "border-green-500/30",
                      testResult?.connected === false && "border-red-500/30"
                    )}
                  >
                    <div className={cn(
                      "p-2.5 rounded-lg transition-colors",
                      testResult?.connected === true
                        ? "bg-green-500/10 text-green-600 dark:text-green-400"
                        : testResult?.connected === false
                        ? "bg-red-500/10 text-red-600 dark:text-red-400"
                        : server.type === 'subprocess'
                        ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                        : "bg-purple-500/10 text-purple-600 dark:text-purple-400"
                    )}>
                      {testResult?.testing ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : testResult?.connected === true ? (
                        <CheckCircle2 className="h-4 w-4" />
                      ) : testResult?.connected === false ? (
                        <AlertCircle className="h-4 w-4" />
                      ) : (
                        <Server className="h-4 w-4" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{server.name}</p>
                        {testResult?.connected === true && (
                          <span className="text-xs text-green-600 dark:text-green-400">Connected</span>
                        )}
                        {testResult?.connected === false && (
                          <span className="text-xs text-red-600 dark:text-red-400">Failed</span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground font-mono truncate">
                        {server.type === 'subprocess' ? server.command : server.url}
                      </p>
                      {testResult?.error && (
                        <p className="text-xs text-red-500 truncate mt-0.5">{testResult.error}</p>
                      )}
                    </div>
                    <span className={cn(
                      "px-2.5 py-1 text-xs rounded-full font-medium shrink-0",
                      server.type === 'subprocess'
                        ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                        : "bg-purple-500/10 text-purple-600 dark:text-purple-400"
                    )}>
                      {server.type.toUpperCase()}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => testMcpServer(server.id)}
                      disabled={testResult?.testing}
                      className="h-8 px-2 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      {testResult?.testing ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Zap className="h-4 w-4" />
                      )}
                      <span className="ml-1 text-xs">Test</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteMcpMutation.mutate(server.id)}
                      className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
          ) : !showMcpForm && (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <div className="p-4 rounded-full bg-muted/50 mb-4">
                  <Server className="h-8 w-8 text-muted-foreground/50" />
                </div>
                <p className="font-medium text-muted-foreground mb-1">No MCP servers configured</p>
                <p className="text-sm text-muted-foreground/70 max-w-xs">
                  Add Model Context Protocol servers to extend Claude's capabilities
                </p>
              </CardContent>
            </Card>
          )}
        </section>

        {/* CLI Tools for AI Orchestration */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">CLI Tools</h2>
              {cliTools && cliTools.length > 0 && (
                <span className="px-2 py-0.5 text-xs font-medium bg-orange-500/10 text-orange-600 dark:text-orange-400 rounded-full">
                  {cliTools.length}
                </span>
              )}
            </div>
            <Button size="sm" onClick={() => setShowCliToolForm(true)} className="gap-1.5 h-8 px-3 text-xs bg-orange-600 hover:bg-orange-700">
              <Plus className="h-3.5 w-3.5" />
              Add
            </Button>
          </div>

          {showCliToolForm && (
            <Card className="mb-4 border-orange-500/30 bg-orange-500/5 animate-scale-in">
              <CardHeader className="pb-4">
                <CardTitle className="text-base">New CLI Tool</CardTitle>
                <CardDescription>Add an AI CLI tool for Claude to orchestrate</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Tool Name</label>
                    <Input
                      value={newCliTool.name}
                      onChange={(e) => setNewCliTool({ ...newCliTool, name: e.target.value })}
                      placeholder="Codex"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Timeout (seconds)</label>
                    <Input
                      type="number"
                      value={newCliTool.timeoutSeconds}
                      onChange={(e) => setNewCliTool({ ...newCliTool, timeoutSeconds: parseInt(e.target.value) || 300 })}
                      min={10}
                      max={3600}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Command</label>
                  <Input
                    value={newCliTool.command}
                    onChange={(e) => setNewCliTool({ ...newCliTool, command: e.target.value })}
                    placeholder="codex"
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground">The prompt will be appended as an argument</p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Description</label>
                  <Input
                    value={newCliTool.description}
                    onChange={(e) => setNewCliTool({ ...newCliTool, description: e.target.value })}
                    placeholder="OpenAI's Codex CLI for code generation"
                  />
                </div>
                <div className="flex gap-3 pt-2">
                  <Button
                    onClick={() => createCliToolMutation.mutate(newCliTool)}
                    disabled={!newCliTool.name || !newCliTool.command || createCliToolMutation.isPending}
                    className="bg-orange-600 hover:bg-orange-700"
                  >
                    {createCliToolMutation.isPending ? 'Adding...' : 'Add Tool'}
                  </Button>
                  <Button variant="ghost" onClick={() => setShowCliToolForm(false)}>
                    Cancel
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {cliTools && cliTools.length > 0 ? (
            <div className="space-y-2">
              {cliTools.map((tool) => (
                <div
                  key={tool.id}
                  className={cn(
                    "group flex items-center gap-4 p-4 rounded-xl border bg-card transition-all hover:shadow-sm",
                    tool.enabled ? "hover:border-orange-500/30" : "opacity-60"
                  )}
                >
                  <div className={cn(
                    "p-2.5 rounded-lg transition-colors",
                    tool.enabled
                      ? "bg-orange-500/10 text-orange-600 dark:text-orange-400"
                      : "bg-muted text-muted-foreground"
                  )}>
                    <Terminal className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{tool.name}</p>
                      {!tool.enabled && (
                        <span className="px-1.5 py-0.5 text-[10px] rounded bg-muted text-muted-foreground">
                          Disabled
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground font-mono truncate">
                      {tool.command}
                    </p>
                    {tool.description && (
                      <p className="text-xs text-muted-foreground/70 truncate mt-0.5">
                        {tool.description}
                      </p>
                    )}
                  </div>
                  <span className="px-2.5 py-1 text-xs rounded-full font-medium shrink-0 bg-orange-500/10 text-orange-600 dark:text-orange-400">
                    {tool.timeoutSeconds}s
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => toggleCliToolMutation.mutate({ id: tool.id, enabled: !tool.enabled })}
                    className="h-8 w-8"
                    title={tool.enabled ? 'Disable' : 'Enable'}
                  >
                    {tool.enabled ? (
                      <ToggleRight className="h-4 w-4 text-orange-600" />
                    ) : (
                      <ToggleLeft className="h-4 w-4 text-muted-foreground" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => deleteCliToolMutation.mutate(tool.id)}
                    className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          ) : !showCliToolForm && (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <div className="p-4 rounded-full bg-orange-500/10 mb-4">
                  <Terminal className="h-8 w-8 text-orange-500/50" />
                </div>
                <p className="font-medium text-muted-foreground mb-1">No CLI tools configured</p>
                <p className="text-sm text-muted-foreground/70 max-w-xs">
                  Add AI CLI tools like Codex or Aider for Claude to orchestrate
                </p>
              </CardContent>
            </Card>
          )}
        </section>
          </TabsContent>

          {/* Extensions Tab */}
          <TabsContent value="extensions" className="space-y-6">
            {/* Claude Agents */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">Agents</h2>
              {claudeAgents && claudeAgents.length > 0 && (
                <span className="px-2 py-0.5 text-xs font-medium bg-primary/10 text-primary rounded-full">
                  {claudeAgents.length}
                </span>
              )}
            </div>
            <Button size="sm" onClick={() => openAgentEditor('create')} className="gap-1.5 h-8 px-3 text-xs">
              <Plus className="h-3.5 w-3.5" />
              Add
            </Button>
          </div>

          {claudeAgents && claudeAgents.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {claudeAgents.map((agent) => {
                const baseName = agent.filePath.split('/').pop()?.replace('.md.disabled', '').replace('.md', '') || agent.name;
                return (
                  <Card
                    key={agent.id}
                    className={cn(
                      "group relative overflow-hidden transition-all hover:shadow-md",
                      agent.enabled
                        ? "hover:border-primary/30"
                        : "opacity-60 hover:opacity-80"
                    )}
                  >
                    <CardContent className="pt-5 pb-4">
                      <div className="flex items-start gap-3">
                        <div className={cn(
                          "p-2 rounded-lg shrink-0",
                          agent.enabled ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                        )}>
                          <Bot className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="font-semibold truncate">{agent.name}</p>
                            {!agent.enabled && (
                              <span className="px-1.5 py-0.5 text-[10px] rounded bg-muted text-muted-foreground shrink-0">
                                Disabled
                              </span>
                            )}
                            {agent.model && (
                              <span className="px-1.5 py-0.5 text-[10px] rounded bg-muted text-muted-foreground shrink-0">
                                {agent.model}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground line-clamp-2">
                            {agent.description || 'No description'}
                          </p>
                          {agent.tools && agent.tools.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {agent.tools.slice(0, 3).map(tool => (
                                <span key={tool} className="px-1.5 py-0.5 text-[10px] rounded bg-muted/70 text-muted-foreground">
                                  {tool}
                                </span>
                              ))}
                              {agent.tools.length > 3 && (
                                <span className="px-1.5 py-0.5 text-[10px] rounded bg-muted/70 text-muted-foreground">
                                  +{agent.tools.length - 3}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => toggleAgentMutation.mutate(baseName)}
                          title={agent.enabled ? 'Disable' : 'Enable'}
                        >
                          {agent.enabled ? (
                            <ToggleRight className="h-4 w-4 text-green-600" />
                          ) : (
                            <ToggleLeft className="h-4 w-4 text-muted-foreground" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => openAgentEditor('edit', agent)}
                          title="Edit"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </CardContent>
                    <div className={cn(
                      "absolute inset-x-0 bottom-0 h-0.5 bg-gradient-to-r from-primary/50 to-primary/10 opacity-0 group-hover:opacity-100 transition-opacity",
                      !agent.enabled && "from-muted-foreground/30 to-muted-foreground/10"
                    )} />
                  </Card>
                );
              })}
            </div>
          ) : (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <div className="p-4 rounded-full bg-primary/10 mb-4">
                  <Bot className="h-8 w-8 text-primary/50" />
                </div>
                <p className="font-medium text-muted-foreground mb-1">No agents found</p>
                <p className="text-sm text-muted-foreground/70 max-w-xs mb-4">
                  Create custom agents to extend Claude's capabilities
                </p>
                <Button size="sm" onClick={() => openAgentEditor('create')} className="gap-2">
                  <Plus className="h-4 w-4" />
                  Create Agent
                </Button>
              </CardContent>
            </Card>
          )}
        </section>

        {/* Claude Skills */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">Skills</h2>
              {claudeSkills && claudeSkills.length > 0 && (
                <span className="px-2 py-0.5 text-xs font-medium bg-green-500/10 text-green-600 dark:text-green-400 rounded-full">
                  {claudeSkills.length}
                </span>
              )}
            </div>
            <Button size="sm" onClick={() => openSkillEditor('create')} className="gap-1.5 h-8 px-3 text-xs bg-green-600 hover:bg-green-700">
              <Plus className="h-3.5 w-3.5" />
              Add
            </Button>
          </div>

          {claudeSkills && claudeSkills.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {claudeSkills.map((skill) => {
                const baseName = skill.dirPath.split('/').pop()?.replace('.disabled', '') || skill.name;
                return (
                  <Card
                    key={skill.id}
                    className={cn(
                      "group relative overflow-hidden transition-all hover:shadow-md",
                      skill.enabled
                        ? "hover:border-green-500/30"
                        : "opacity-60 hover:opacity-80"
                    )}
                  >
                    <CardContent className="pt-5 pb-4">
                      <div className="flex items-start gap-3">
                        <div className={cn(
                          "p-2 rounded-lg shrink-0",
                          skill.enabled
                            ? "bg-green-500/10 text-green-600 dark:text-green-400"
                            : "bg-muted text-muted-foreground"
                        )}>
                          <Wand2 className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="font-semibold truncate">{skill.name}</p>
                            {!skill.enabled && (
                              <span className="px-1.5 py-0.5 text-[10px] rounded bg-muted text-muted-foreground shrink-0">
                                Disabled
                              </span>
                            )}
                            {skill.model && (
                              <span className="px-1.5 py-0.5 text-[10px] rounded bg-muted text-muted-foreground shrink-0">
                                {skill.model}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground line-clamp-2">
                            {skill.description || 'No description'}
                          </p>
                          {skill.allowedTools && skill.allowedTools.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {skill.allowedTools.map(tool => (
                                <span key={tool} className="px-1.5 py-0.5 text-[10px] rounded bg-green-500/10 text-green-600 dark:text-green-400">
                                  {tool}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => toggleSkillMutation.mutate(baseName)}
                          title={skill.enabled ? 'Disable' : 'Enable'}
                        >
                          {skill.enabled ? (
                            <ToggleRight className="h-4 w-4 text-green-600" />
                          ) : (
                            <ToggleLeft className="h-4 w-4 text-muted-foreground" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => openSkillEditor('edit', skill)}
                          title="Edit"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </CardContent>
                    <div className={cn(
                      "absolute inset-x-0 bottom-0 h-0.5 bg-gradient-to-r from-green-500/50 to-green-500/10 opacity-0 group-hover:opacity-100 transition-opacity",
                      !skill.enabled && "from-muted-foreground/30 to-muted-foreground/10"
                    )} />
                  </Card>
                );
              })}
            </div>
          ) : (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <div className="p-4 rounded-full bg-green-500/10 mb-4">
                  <Wand2 className="h-8 w-8 text-green-500/50" />
                </div>
                <p className="font-medium text-muted-foreground mb-1">No skills found</p>
                <p className="text-sm text-muted-foreground/70 max-w-xs mb-4">
                  Create custom skills to add reusable capabilities
                </p>
                <Button size="sm" onClick={() => openSkillEditor('create')} className="gap-2 bg-green-600 hover:bg-green-700">
                  <Plus className="h-4 w-4" />
                  Create Skill
                </Button>
              </CardContent>
            </Card>
          )}
        </section>

        {/* Plugins */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">Plugins</h2>
              {installedPlugins && installedPlugins.length > 0 && (
                <span className="px-2 py-0.5 text-xs font-medium bg-violet-500/10 text-violet-600 dark:text-violet-400 rounded-full">
                  {filteredPlugins.length}/{installedPlugins.length}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setMarketplaceBrowserOpen(true)} className="gap-1.5 h-8 px-3 text-xs">
                <Store className="h-3.5 w-3.5" />
                Browse
              </Button>
              <Button size="sm" onClick={() => openPluginEditor('create')} className="gap-1.5 h-8 px-3 text-xs bg-violet-600 hover:bg-violet-700">
                <Plus className="h-3.5 w-3.5" />
                Create
              </Button>
            </div>
          </div>

          {/* Search input */}
          {installedPlugins && installedPlugins.length > 0 && (
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={pluginSearchQuery}
                onChange={(e) => setPluginSearchQuery(e.target.value)}
                placeholder="Search plugins by name, description, category..."
                className="pl-10 pr-10"
              />
              {pluginSearchQuery && (
                <button
                  type="button"
                  onClick={() => setPluginSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-muted"
                >
                  <X className="h-4 w-4 text-muted-foreground" />
                </button>
              )}
            </div>
          )}

          {installedPlugins && installedPlugins.length > 0 ? (
            filteredPlugins.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filteredPlugins.map((plugin) => {
                const baseName = plugin.source === 'user'
                  ? plugin.dirPath.split('/').pop()?.replace('.disabled', '') || plugin.name
                  : plugin.name;
                const isUserPlugin = plugin.source === 'user';

                return (
                  <Card
                    key={plugin.id}
                    className={cn(
                      "group relative overflow-hidden transition-all hover:shadow-md",
                      plugin.enabled
                        ? "hover:border-violet-500/30"
                        : "opacity-60 hover:opacity-80"
                    )}
                  >
                    <CardContent className="pt-5 pb-4">
                      <div className="flex items-start gap-3">
                        <div className={cn(
                          "p-2 rounded-lg shrink-0",
                          plugin.enabled
                            ? "bg-violet-500/10 text-violet-600 dark:text-violet-400"
                            : "bg-muted text-muted-foreground"
                        )}>
                          <Puzzle className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="font-semibold truncate">{plugin.name}</p>
                            {!plugin.enabled && (
                              <span className="px-1.5 py-0.5 text-[10px] rounded bg-muted text-muted-foreground shrink-0">
                                Disabled
                              </span>
                            )}
                            <span className="px-1.5 py-0.5 text-[10px] rounded bg-muted text-muted-foreground shrink-0">
                              v{plugin.version}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground line-clamp-2">
                            {plugin.description || 'No description'}
                          </p>
                          <div className="flex flex-wrap gap-1 mt-2">
                            <span className={cn(
                              "px-1.5 py-0.5 text-[10px] rounded",
                              isUserPlugin
                                ? "bg-violet-500/10 text-violet-600 dark:text-violet-400"
                                : "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                            )}>
                              {isUserPlugin ? 'User' : `@${plugin.marketplace}`}
                            </span>
                            {plugin.category && (
                              <span className="px-1.5 py-0.5 text-[10px] rounded bg-muted/70 text-muted-foreground">
                                {plugin.category}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {isUserPlugin && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => togglePluginMutation.mutate(baseName)}
                              title={plugin.enabled ? 'Disable' : 'Enable'}
                            >
                              {plugin.enabled ? (
                                <ToggleRight className="h-4 w-4 text-violet-600" />
                              ) : (
                                <ToggleLeft className="h-4 w-4 text-muted-foreground" />
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => openPluginEditor('edit', plugin)}
                              title="Edit"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deletePluginMutation.mutate(plugin.id)}
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </CardContent>
                    <div className={cn(
                      "absolute inset-x-0 bottom-0 h-0.5 bg-gradient-to-r from-violet-500/50 to-violet-500/10 opacity-0 group-hover:opacity-100 transition-opacity",
                      !plugin.enabled && "from-muted-foreground/30 to-muted-foreground/10"
                    )} />
                  </Card>
                );
              })}
            </div>
            ) : (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-8 text-center">
                  <Search className="h-8 w-8 text-muted-foreground/50 mb-3" />
                  <p className="font-medium text-muted-foreground mb-1">No matching plugins</p>
                  <p className="text-sm text-muted-foreground/70 max-w-xs mb-3">
                    No plugins found matching "{pluginSearchQuery}"
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setPluginSearchQuery('')}
                    className="gap-2"
                  >
                    <X className="h-4 w-4" />
                    Clear search
                  </Button>
                </CardContent>
              </Card>
            )
          ) : (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <div className="p-4 rounded-full bg-violet-500/10 mb-4">
                  <Puzzle className="h-8 w-8 text-violet-500/50" />
                </div>
                <p className="font-medium text-muted-foreground mb-1">No plugins installed</p>
                <p className="text-sm text-muted-foreground/70 max-w-xs mb-4">
                  Create custom plugins or install from marketplaces
                </p>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setMarketplaceBrowserOpen(true)} className="gap-2">
                    <Store className="h-4 w-4" />
                    Browse Marketplace
                  </Button>
                  <Button size="sm" onClick={() => openPluginEditor('create')} className="gap-2 bg-violet-600 hover:bg-violet-700">
                    <Plus className="h-4 w-4" />
                    Create Plugin
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Marketplaces */}
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Store className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium text-muted-foreground">Marketplaces</span>
                {marketplaces && marketplaces.length > 0 && (
                  <span className="px-1.5 py-0.5 text-[10px] rounded bg-muted text-muted-foreground">
                    {marketplaces.length}
                  </span>
                )}
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setMarketplaceBrowserOpen(true)}
                className="h-7 text-xs text-muted-foreground hover:text-foreground"
              >
                Manage
              </Button>
            </div>
            {marketplaces && marketplaces.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {marketplaces.map((mp) => (
                  <button
                    type="button"
                    key={mp.id}
                    onClick={() => setMarketplaceBrowserOpen(true)}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/50 border text-sm hover:border-violet-500/30 transition-colors"
                  >
                    <span className="font-medium">{mp.name}</span>
                    {mp.plugins && (
                      <span className="text-xs text-muted-foreground">
                        ({mp.plugins.length} plugins)
                      </span>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                No marketplaces added. Click "Manage" to add one.
              </p>
            )}
          </div>
            </section>
          </TabsContent>
        </Tabs>

        {/* Dialogs */}
        <FolderBrowserDialog
          open={showFolderBrowser}
          onOpenChange={setShowFolderBrowser}
          value={settings?.defaultWorkingDir || ''}
          onChange={(path) => {
            updateSettingsMutation.mutate({ defaultWorkingDir: path });
          }}
        />

        <AgentSkillEditorDialog
          open={editorOpen}
          onOpenChange={setEditorOpen}
          type={editorType}
          mode={editorMode}
          initialData={editingItem?.data}
          editName={editingItem?.name}
        />

        <PluginEditorDialog
          open={pluginEditorOpen}
          onOpenChange={setPluginEditorOpen}
          mode={pluginEditorMode}
          initialData={editingPlugin?.data}
          editName={editingPlugin?.name}
        />

        <MarketplaceBrowserDialog
          open={marketplaceBrowserOpen}
          onOpenChange={setMarketplaceBrowserOpen}
        />
      </div>
    </div>
  );
}
