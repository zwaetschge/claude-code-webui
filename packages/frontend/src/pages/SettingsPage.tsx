import { useState, useMemo, useRef } from 'react';
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
  Upload,
  Key,
  Eye,
  EyeOff,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FolderBrowserDialog } from '@/components/ui/folder-browser';
import { AgentSkillEditorDialog } from '@/components/ui/agent-skill-editor';
import { PluginEditorDialog } from '@/components/ui/plugin-editor';
import { MarketplaceBrowserDialog } from '@/components/ui/marketplace-browser';
import { api } from '@/services/api';
import { toast } from '@/hooks/use-toast';
import type {
  UserSettings,
  McpServer,
  ApiResponse,
  Theme,
  CliProviderUpdateResponse,
  CliProviderUpdateResult,
  ProviderCapabilities,
  CLIProvider,
} from '@claude-code-webui/shared';
import { cn } from '@/lib/utils';
import { CLI_PROVIDER_LABEL } from '@/lib/providers';

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

interface OpenCodeProvider {
  id: string;
  name: string;
  apiKey: string;
  hasKey: boolean;
  baseUrl?: string;
  enabled: boolean;
}

interface CodexStatus {
  installed: boolean;
  authenticated: boolean;
  version?: string;
  authMode: 'chatgpt' | 'api-key' | 'none';
  configHome: string;
}

interface CodexFeatureFlag {
  name: string;
  stage: string;
  enabled: boolean;
}

interface CodexPluginInfo {
  id: string;
  name: string;
  marketplace: string;
  displayName: string;
  description: string;
  version: string;
  author?: string;
  category?: string;
  enabled: boolean;
  installed: boolean;
  installPolicy?: string;
  authPolicy?: string;
  capabilities?: string[];
  connectors?: string[];
}

interface ProviderDiagnostic {
  id: CLIProvider;
  name: string;
  command: string;
  binaryPath: string | null;
  installed: boolean;
  version: string | null;
  credentialsPath: string;
  authenticated: boolean;
  defaultModel: string | null;
  modelCount: number;
  models: string[];
  capabilities: ProviderCapabilities;
  mcpServerCount: number;
  codexModelsCache: {
    path: string;
    exists: boolean;
    fetchedAt: string | null;
    mtime: string | null;
    modelCount: number;
  } | null;
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const configProvider = useMemo(() => 'claude' as const, []);
  const configQuery = useMemo(
    () => `provider=${encodeURIComponent(configProvider)}`,
    [configProvider]
  );
  const withProvider = useMemo(() => {
    return (endpoint: string) => `${endpoint}${endpoint.includes('?') ? '&' : '?'}${configQuery}`;
  }, [configQuery]);
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

  const [cliUpdateResults, setCliUpdateResults] = useState<CliProviderUpdateResult[] | null>(null);

  // Agent/Skill editor state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorType, setEditorType] = useState<'agent' | 'skill'>('agent');
  const [editorMode, setEditorMode] = useState<'create' | 'edit'>('create');
  const [editingItem, setEditingItem] = useState<{
    name: string;
    data: Record<string, unknown>;
  } | null>(null);

  // Plugin editor state
  const [pluginEditorOpen, setPluginEditorOpen] = useState(false);
  const [pluginEditorMode, setPluginEditorMode] = useState<'create' | 'edit'>('create');
  const [editingPlugin, setEditingPlugin] = useState<{
    name: string;
    data: Record<string, unknown>;
  } | null>(null);

  // Marketplace browser state
  const [marketplaceBrowserOpen, setMarketplaceBrowserOpen] = useState(false);
  const [codexMarketplaceBrowserOpen, setCodexMarketplaceBrowserOpen] = useState(false);

  // Plugin search state
  const [pluginSearchQuery, setPluginSearchQuery] = useState('');
  const [codexPluginSearchQuery, setCodexPluginSearchQuery] = useState('');

  // GitHub token state
  const [githubTokenInput, setGithubTokenInput] = useState('');
  const [showGithubToken, setShowGithubToken] = useState(false);

  // Mistral API key state
  const [mistralKeyInput, setMistralKeyInput] = useState('');
  const [showMistralKey, setShowMistralKey] = useState(false);

  // Integration URLs state (ComfyUI, LoRA Tester)
  const [comfyuiUrlInput, setComfyuiUrlInput] = useState('');
  const [loraTesterUrlInput, setLoraTesterUrlInput] = useState('');
  // Result of the "Test connection" button next to ComfyUI URL.
  const [comfyuiTestResult, setComfyuiTestResult] = useState<{
    state: 'idle' | 'testing' | 'ok' | 'error';
    message?: string;
  }>({ state: 'idle' });

  // Basic auth credentials state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);

  // MCP test state
  const [mcpTestResults, setMcpTestResults] = useState<
    Record<string, { testing: boolean; connected?: boolean; error?: string }>
  >({});

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

  // Fetch OpenCode providers
  const { data: openCodeProviders, refetch: refetchOpenCodeProviders } = useQuery({
    queryKey: ['opencode-providers'],
    queryFn: async () => {
      const response = await api.get<{ success: boolean; data?: OpenCodeProvider[] }>(
        '/api/opencode/providers'
      );
      return response.data.data || [];
    },
  });

  // Fetch available OpenCode providers (with models)
  const { data: availableProviders } = useQuery({
    queryKey: ['opencode-available-providers'],
    queryFn: async () => {
      const response = await api.get<{
        success: boolean;
        data?: Record<string, { name: string; models?: string[]; description?: string }>;
      }>('/api/opencode/available-providers');
      return response.data.data || {};
    },
  });

  // Check Claude CLI status
  const { refetch: refetchClaudeStatus } = useQuery({
    queryKey: ['claude-status'],
    queryFn: async () => {
      const response =
        await api.get<
          ApiResponse<{ installed: boolean; authenticated: boolean; version?: string }>
        >('/api/claude/status');
      return response.data.data;
    },
  });

  const {
    data: codexStatus,
    refetch: refetchCodexStatus,
    isFetching: isRefetchingCodex,
  } = useQuery({
    queryKey: ['codex-status'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<CodexStatus>>('/api/codex/status');
      return response.data.data;
    },
  });

  const { data: codexFeatures, isLoading: codexFeaturesLoading } = useQuery({
    queryKey: ['codex-features'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<CodexFeatureFlag[]>>('/api/codex/features');
      return response.data.data || [];
    },
  });

  const { data: codexPlugins, isLoading: codexPluginsLoading } = useQuery({
    queryKey: ['codex-plugins'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<CodexPluginInfo[]>>('/api/codex/plugins');
      return response.data.data || [];
    },
  });

  const {
    data: providerDiagnostics,
    isLoading: providerDiagnosticsLoading,
    refetch: refetchProviderDiagnostics,
  } = useQuery({
    queryKey: ['provider-diagnostics'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<ProviderDiagnostic[]>>(
        '/api/cli-providers/diagnostics'
      );
      return response.data.data || [];
    },
  });

  // Fetch Claude agents from ~/.claude/agents/
  const { data: claudeAgents } = useQuery({
    queryKey: ['claude-agents', configProvider],
    queryFn: async () => {
      const response = await api.get<ApiResponse<AgentInfo[]>>(
        withProvider('/api/claude-config/agents')
      );
      return response.data.data || [];
    },
  });

  // Fetch Claude skills from ~/.claude/skills/
  const { data: claudeSkills } = useQuery({
    queryKey: ['claude-skills', configProvider],
    queryFn: async () => {
      const response = await api.get<ApiResponse<SkillInfo[]>>(
        withProvider('/api/claude-config/skills')
      );
      return response.data.data || [];
    },
  });

  // Fetch installed plugins
  const { data: installedPlugins } = useQuery({
    queryKey: ['installed-plugins', configProvider],
    queryFn: async () => {
      const response = await api.get<ApiResponse<PluginInfo[]>>(
        withProvider('/api/claude-config/plugins')
      );
      return response.data.data || [];
    },
  });

  // Fetch known marketplaces
  const { data: marketplaces } = useQuery({
    queryKey: ['marketplaces', configProvider],
    queryFn: async () => {
      const response = await api.get<
        ApiResponse<
          {
            id: string;
            name: string;
            source: { source: string; repo?: string; url?: string };
            lastUpdated: string;
            plugins?: { name: string; description: string; version: string }[];
          }[]
        >
      >(withProvider('/api/claude-config/marketplaces'));
      return response.data.data || [];
    },
  });

  // Fetch GitHub token status
  const { data: githubTokenStatus, refetch: refetchGithubToken } = useQuery({
    queryKey: ['github-token'],
    queryFn: async () => {
      const response = await api.get<
        ApiResponse<{ hasToken: boolean; tokenPreview: string | null }>
      >('/api/settings/github-token');
      return response.data.data;
    },
  });

  // Fetch Mistral API key status
  const { data: mistralKeyStatus, refetch: refetchMistralKey } = useQuery({
    queryKey: ['mistral-key'],
    queryFn: async () => {
      const response = await api.get<
        ApiResponse<{
          hasKey: boolean;
          keyPreview: string | null;
          source: 'user' | 'env' | 'none';
          envFallback: boolean;
        }>
      >('/api/settings/mistral-key');
      return response.data.data;
    },
  });

  // Fetch integration URLs (ComfyUI, LoRA Tester)
  const { data: integrations, refetch: refetchIntegrations } = useQuery({
    queryKey: ['integrations'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<{ comfyuiUrl: string; loraTesterUrl: string }>>(
        '/api/settings/integrations'
      );
      const data = response.data.data ?? { comfyuiUrl: '', loraTesterUrl: '' };
      setComfyuiUrlInput(data.comfyuiUrl || '');
      setLoraTesterUrlInput(data.loraTesterUrl || '');
      return data;
    },
  });

  // Fetch basic auth credentials info
  const { data: basicAuthCredentials, refetch: refetchBasicAuth } = useQuery({
    queryKey: ['basic-auth-credentials'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<{ username: string; enabled: boolean }>>(
        '/api/basic-auth/credentials'
      );
      return response.data.data;
    },
  });

  // Filter installed plugins based on search
  const filteredPlugins = useMemo(() => {
    if (!installedPlugins) return [];
    if (!pluginSearchQuery.trim()) return installedPlugins;

    const query = pluginSearchQuery.toLowerCase();
    return installedPlugins.filter(
      (plugin) =>
        plugin.name.toLowerCase().includes(query) ||
        plugin.description?.toLowerCase().includes(query) ||
        plugin.author?.toLowerCase().includes(query) ||
        plugin.category?.toLowerCase().includes(query) ||
        plugin.marketplace?.toLowerCase().includes(query)
    );
  }, [installedPlugins, pluginSearchQuery]);

  const filteredCodexPlugins = useMemo(() => {
    if (!codexPlugins) return [];
    const query = codexPluginSearchQuery.trim().toLowerCase();
    if (!query) return codexPlugins;

    return codexPlugins.filter(
      (plugin) =>
        plugin.displayName.toLowerCase().includes(query) ||
        plugin.name.toLowerCase().includes(query) ||
        plugin.description?.toLowerCase().includes(query) ||
        plugin.category?.toLowerCase().includes(query) ||
        plugin.marketplace.toLowerCase().includes(query)
    );
  }, [codexPlugins, codexPluginSearchQuery]);

  const enabledCodexPlugins = useMemo(
    () => (codexPlugins || []).filter((plugin) => plugin.enabled),
    [codexPlugins]
  );

  const codexFeatureGroups = useMemo(() => {
    const features = codexFeatures || [];
    return {
      stable: features.filter((feature) => feature.stage === 'stable'),
      experimental: features.filter((feature) => feature.stage !== 'stable'),
    };
  }, [codexFeatures]);

  const updateCliProvidersMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post<ApiResponse<CliProviderUpdateResponse>>(
        '/api/cli-providers/update',
        {}
      );
      return response.data.data;
    },
    onSuccess: (data) => {
      const results = data?.results || [];
      setCliUpdateResults(results);

      const summary =
        results.length > 0
          ? results
              .map((result) => `${CLI_PROVIDER_LABEL[result.provider]}: ${result.status}`)
              .join(', ')
          : 'No update results returned.';
      const hasFailure = results.some((result) => result.status === 'failed');
      toast({
        title: 'CLI update finished',
        description: summary,
        variant: hasFailure ? 'destructive' : undefined,
      });
      refetchClaudeStatus();
      refetchCodexStatus();
      queryClient.invalidateQueries({ queryKey: ['cli-providers'] });
    },
    onError: (error: Error) => {
      toast({ title: 'CLI update failed', description: error.message, variant: 'destructive' });
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

  const codexFeatureMutation = useMutation({
    mutationFn: async ({ name, enabled }: { name: string; enabled: boolean }) => {
      const response = await api.post<ApiResponse<CodexFeatureFlag[]>>(
        `/api/codex/features/${encodeURIComponent(name)}`,
        { enabled }
      );
      return response.data.data || [];
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['codex-features'] });
      toast({ title: 'Codex feature updated' });
    },
    onError: (error: Error) => {
      toast({
        title: 'Codex feature update failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const codexPluginMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const response = await api.post<ApiResponse<CodexPluginInfo[]>>(
        `/api/codex/plugins/${encodeURIComponent(id)}`,
        { enabled }
      );
      return response.data.data || [];
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['codex-plugins'] });
      toast({
        title: 'Codex plugin updated',
        description: 'New Codex sessions will load the updated plugin set.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Codex plugin update failed',
        description: error.message,
        variant: 'destructive',
      });
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

  // Delete plugin mutation
  const deletePluginMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(withProvider(`/api/claude-config/plugin/${encodeURIComponent(id)}`));
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['installed-plugins', configProvider] });
      toast({ title: 'Plugin uninstalled' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Toggle agent mutation
  const toggleAgentMutation = useMutation({
    mutationFn: async (name: string) => {
      const response = await api.put<ApiResponse<{ enabled: boolean }>>(
        withProvider(`/api/claude-config/agent/${name}/toggle`)
      );
      return response.data.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['claude-agents', configProvider] });
      toast({ title: data?.enabled ? 'Agent enabled' : 'Agent disabled' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Toggle skill mutation
  const toggleSkillMutation = useMutation({
    mutationFn: async (name: string) => {
      const response = await api.put<ApiResponse<{ enabled: boolean }>>(
        withProvider(`/api/claude-config/skill/${name}/toggle`)
      );
      return response.data.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['claude-skills', configProvider] });
      toast({ title: data?.enabled ? 'Skill enabled' : 'Skill disabled' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Skill bulk import
  const skillImportInputRef = useRef<HTMLInputElement | null>(null);
  const importSkillsMutation = useMutation({
    mutationFn: async (files: File[]) => {
      const form = new FormData();
      for (const f of files) form.append('files', f);
      const response = await api.post<
        ApiResponse<{
          imported: Array<{ name: string; dirPath: string }>;
          skipped: Array<{ file: string; skillName?: string; reason: string }>;
          errors: Array<{ file: string; error: string }>;
        }>
      >(withProvider('/api/claude-config/skills/import'), form);
      return response.data.data!;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['claude-skills', configProvider] });
      const importedCount = data.imported.length;
      const skippedCount = data.skipped.length;
      const errorCount = data.errors.length;
      const parts = [`${importedCount} imported`];
      if (skippedCount) parts.push(`${skippedCount} skipped`);
      if (errorCount) parts.push(`${errorCount} errors`);
      toast({
        title: importedCount > 0 ? 'Skills imported' : 'No skills imported',
        description: parts.join(' · '),
        variant: errorCount > 0 ? 'destructive' : undefined,
      });
    },
    onError: (error: Error) => {
      toast({ title: 'Import failed', description: error.message, variant: 'destructive' });
    },
  });

  const handleSkillImportFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    importSkillsMutation.mutate(Array.from(files));
    if (skillImportInputRef.current) skillImportInputRef.current.value = '';
  };

  // Toggle plugin mutation
  const togglePluginMutation = useMutation({
    mutationFn: async (name: string) => {
      const response = await api.put<ApiResponse<{ enabled: boolean }>>(
        withProvider(`/api/claude-config/plugin/${name}/toggle`)
      );
      return response.data.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['installed-plugins', configProvider] });
      toast({ title: data?.enabled ? 'Plugin enabled' : 'Plugin disabled' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Set GitHub token mutation
  const setGithubTokenMutation = useMutation({
    mutationFn: async (token: string) => {
      const response = await api.put<ApiResponse<{ hasToken: boolean; tokenPreview: string }>>(
        '/api/settings/github-token',
        { token }
      );
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

  const setMistralKeyMutation = useMutation({
    mutationFn: async (apiKey: string) => {
      const response = await api.put<ApiResponse<{ hasKey: boolean; keyPreview: string }>>(
        '/api/settings/mistral-key',
        { apiKey }
      );
      return response.data.data;
    },
    onSuccess: () => {
      refetchMistralKey();
      setMistralKeyInput('');
      toast({ title: 'Mistral API key saved' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const deleteMistralKeyMutation = useMutation({
    mutationFn: async () => {
      await api.delete('/api/settings/mistral-key');
    },
    onSuccess: () => {
      refetchMistralKey();
      toast({ title: 'Mistral API key removed' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Save integration URLs mutation
  const saveIntegrationsMutation = useMutation({
    mutationFn: async (payload: { comfyuiUrl?: string; loraTesterUrl?: string }) => {
      const response = await api.put<ApiResponse<{ comfyuiUrl: string; loraTesterUrl: string }>>(
        '/api/settings/integrations',
        payload
      );
      return response.data.data;
    },
    onSuccess: () => {
      refetchIntegrations();
      toast({
        title: 'Integrations saved',
        description: 'New sessions will use the updated URLs.',
      });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Update basic auth credentials mutation
  const updateBasicAuthMutation = useMutation({
    mutationFn: async (data: {
      currentPassword: string;
      newUsername?: string;
      newPassword?: string;
    }) => {
      const response = await api.put<ApiResponse<{ username: string; message: string }>>(
        '/api/basic-auth/credentials',
        data
      );
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
      const response = await api.put<ApiResponse<{ enabled: boolean; message: string }>>(
        '/api/basic-auth/toggle',
        { enabled }
      );
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

  // OpenCode providers mutations
  const deleteOpenCodeProviderMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/api/opencode/providers/${id}`);
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['opencode-providers'] });
      toast({ title: 'Provider deleted' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // OpenCode models state
  const [modelProviderId, setModelProviderId] = useState<string>('');
  const [modelModelId, setModelModelId] = useState<string>('');
  const openCodeModels = settings?.cliProviderModelLists?.opencode || [];

  const removeOpenCodeModel = (model: string) => {
    const current = openCodeModels || [];
    const updated = current.filter((m) => m !== model);
    updateSettingsMutation.mutate({
      cliProviderModelLists: {
        ...settings?.cliProviderModelLists,
        opencode: updated.length > 0 ? updated : undefined,
      },
    });
  };

  // OpenCode providers state
  const [openCodeProviderDialog, setOpenCodeProviderDialog] = useState(false);
  const [selectedProviderId, setSelectedProviderId] = useState<string>('');
  const [openCodeProviderForm, setOpenCodeProviderForm] = useState({
    id: '',
    name: '',
    apiKey: '',
    baseUrl: '',
  });
  const [showOpenCodeApiKey, setShowOpenCodeApiKey] = useState(false);

  const saveOpenCodeProvider = async () => {
    try {
      const response = await api.put<ApiResponse<OpenCodeProvider>>('/api/opencode/providers', {
        id: openCodeProviderForm.id,
        name: openCodeProviderForm.name,
        apiKey: openCodeProviderForm.apiKey || undefined,
        baseUrl: openCodeProviderForm.baseUrl || undefined,
        enabled: true,
      });

      if (response.data.success) {
        toast({ title: 'Provider erfolgreich gespeichert' });
        setOpenCodeProviderDialog(false);
        setSelectedProviderId('');
        setOpenCodeProviderForm({ id: '', name: '', apiKey: '', baseUrl: '' });
        refetchOpenCodeProviders();
      } else {
        toast({
          title: 'Error saving provider',
          description: response.data.error?.toString() || 'Unknown error',
          variant: 'destructive',
        });
      }
    } catch (error: unknown) {
      console.error('Failed to save OpenCode provider:', error);
      const errorMsg = error instanceof Error ? error.message : 'Failed to save provider';
      toast({ title: 'Error', description: errorMsg, variant: 'destructive' });
    }
  };

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

  const updateLocalUsageBudget = (
    provider: 'opencode' | 'vibe',
    key: 'dailyUsd' | 'weeklyUsd',
    rawValue: string
  ) => {
    const normalized = rawValue.trim();
    const parsed = normalized ? Number(normalized) : 0;
    const next = {
      ...(settings?.localUsageBudgets || {}),
      [provider]: {
        ...(settings?.localUsageBudgets?.[provider] || {}),
      },
    };

    if (Number.isFinite(parsed) && parsed > 0) {
      next[provider] = { ...next[provider], [key]: Math.round(parsed * 100) / 100 };
    } else {
      const providerBudget = { ...(next[provider] || {}) };
      delete providerBudget[key];
      if (providerBudget.dailyUsd || providerBudget.weeklyUsd) {
        next[provider] = providerBudget;
      } else {
        delete next[provider];
      }
    }

    updateSettingsMutation.mutate({ localUsageBudgets: next });
  };

  const openAgentEditor = (mode: 'create' | 'edit', agent?: AgentInfo) => {
    setEditorType('agent');
    setEditorMode(mode);
    if (agent) {
      // Extract base name from filePath
      const baseName =
        agent.filePath.split('/').pop()?.replace('.md.disabled', '').replace('.md', '') ||
        agent.name;
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

  if (settingsLoading || mcpLoading) {
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
          <Card
            className={cn(
              'relative overflow-hidden transition-all',
              codexStatus?.authenticated
                ? 'border-green-500/30 bg-green-500/5'
                : 'border-amber-500/30 bg-amber-500/5'
            )}
          >
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    'p-2 rounded-lg',
                    codexStatus?.authenticated
                      ? 'bg-green-500/15 text-green-600 dark:text-green-400'
                      : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                  )}
                >
                  <Terminal className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground">CLI</p>
                  <p
                    className={cn(
                      'text-sm font-semibold truncate',
                      codexStatus?.authenticated
                        ? 'text-green-600 dark:text-green-400'
                        : 'text-amber-600 dark:text-amber-400'
                    )}
                  >
                    {codexStatus?.authenticated ? 'Codex ready' : 'Codex not auth'}
                  </p>
                  <p className="text-[10px] text-muted-foreground truncate">
                    {codexStatus?.version || codexStatus?.configHome || 'Checking Codex'}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => refetchCodexStatus()}
                  disabled={isRefetchingCodex}
                  className="h-7 w-7 shrink-0"
                >
                  <RefreshCw className={cn('h-3.5 w-3.5', isRefetchingCodex && 'animate-spin')} />
                </Button>
              </div>
              {!codexStatus?.authenticated && codexStatus?.installed && (
                <Button
                  onClick={() => {
                    window.location.href = '/auth/codex';
                  }}
                  size="sm"
                  className="w-full mt-3 h-8 text-xs"
                >
                  Check Codex login
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
          <TabsList className="grid w-full grid-cols-6 h-12">
            <TabsTrigger value="general" className="gap-2">
              <Settings2 className="h-4 w-4" />
              <span className="hidden sm:inline">General</span>
            </TabsTrigger>
            <TabsTrigger value="security" className="gap-2">
              <Shield className="h-4 w-4" />
              <span className="hidden sm:inline">Security</span>
            </TabsTrigger>
            <TabsTrigger value="api-keys" className="gap-2">
              <KeyRound className="h-4 w-4" />
              <span className="hidden sm:inline">API Keys</span>
            </TabsTrigger>
            <TabsTrigger value="integrations" className="gap-2">
              <Wand2 className="h-4 w-4" />
              <span className="hidden sm:inline">Integrations</span>
            </TabsTrigger>
            <TabsTrigger value="diagnostics" className="gap-2">
              <Terminal className="h-4 w-4" />
              <span className="hidden sm:inline">Diagnostics</span>
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

              <Card
                className={cn(
                  'border',
                  basicAuthCredentials?.enabled
                    ? 'border-green-500/30 bg-green-500/5'
                    : 'border-muted'
                )}
              >
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-center gap-3 mb-4">
                    <div
                      className={cn(
                        'p-2 rounded-lg',
                        basicAuthCredentials?.enabled
                          ? 'bg-green-500/15 text-green-600 dark:text-green-400'
                          : 'bg-muted text-muted-foreground'
                      )}
                    >
                      <Lock className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">
                        {basicAuthCredentials?.enabled
                          ? 'Password protection is active'
                          : 'Password protection is disabled'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Current username:{' '}
                        <span className="font-mono">
                          {basicAuthCredentials?.username || 'admin'}
                        </span>
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
                            'pl-10',
                            confirmPassword &&
                              newPassword !== confirmPassword &&
                              'border-destructive'
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
                        toast({
                          title: 'Error',
                          description: 'Passwords do not match',
                          variant: 'destructive',
                        });
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
              <p className="mt-2 text-xs text-muted-foreground">
                Shared across all providers and used when creating new sessions.
              </p>
            </section>

            {/* CLI Updates */}
            <section>
              <Card className="border border-border/70">
                <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="space-y-1">
                    <CardTitle className="text-base">CLI Updates</CardTitle>
                    <CardDescription>Update Claude, Codex, and OpenCode CLI tools.</CardDescription>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => updateCliProvidersMutation.mutate()}
                    disabled={updateCliProvidersMutation.isPending}
                  >
                    {updateCliProvidersMutation.isPending ? 'Updating...' : 'Update CLI tools'}
                  </Button>
                </CardHeader>
                {cliUpdateResults && (
                  <CardContent className="space-y-3">
                    <div className="grid gap-2 text-sm">
                      {cliUpdateResults.map((result) => (
                        <div key={result.provider} className="flex items-center justify-between">
                          <span className="font-medium">{CLI_PROVIDER_LABEL[result.provider]}</span>
                          <span
                            className={cn(
                              'text-xs font-semibold uppercase tracking-wide',
                              result.status === 'updated'
                                ? 'text-green-600 dark:text-green-400'
                                : 'text-red-600 dark:text-red-400'
                            )}
                          >
                            {result.status}
                          </span>
                        </div>
                      ))}
                    </div>
                    <pre className="max-h-64 overflow-auto rounded-lg border border-border/70 bg-muted/40 p-3 text-xs font-mono whitespace-pre-wrap">
                      {cliUpdateResults
                        .map((result) => {
                          const label = CLI_PROVIDER_LABEL[result.provider];
                          const output = result.output || 'No output.';
                          return `# ${label} (${result.status})\n${output}`;
                        })
                        .join('\n\n')}
                    </pre>
                  </CardContent>
                )}
              </Card>
            </section>

            {/* Local Usage Budgets */}
            <section>
              <Card className="border border-border/70">
                <CardHeader>
                  <CardTitle className="text-base">Local Usage Budgets</CardTitle>
                  <CardDescription>
                    Optional spend guardrails for providers without upstream quota APIs.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2">
                  {(['opencode', 'vibe'] as const).map((provider) => (
                    <div key={provider} className="rounded-lg border border-border/70 p-3">
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-sm font-medium">{CLI_PROVIDER_LABEL[provider]}</span>
                        <span className="text-[11px] text-muted-foreground">USD</span>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <label className="space-y-1 text-xs">
                          <span className="text-muted-foreground">24h budget</span>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            defaultValue={settings?.localUsageBudgets?.[provider]?.dailyUsd ?? ''}
                            onBlur={(event) =>
                              updateLocalUsageBudget(provider, 'dailyUsd', event.target.value)
                            }
                            placeholder="0.00"
                          />
                        </label>
                        <label className="space-y-1 text-xs">
                          <span className="text-muted-foreground">Weekly budget</span>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            defaultValue={settings?.localUsageBudgets?.[provider]?.weeklyUsd ?? ''}
                            onBlur={(event) =>
                              updateLocalUsageBudget(provider, 'weeklyUsd', event.target.value)
                            }
                            placeholder="0.00"
                          />
                        </label>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </section>

            {/* Codex CLI */}
            <section>
              <Card className="border border-border/70">
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-base">Codex CLI</CardTitle>
                      <CardDescription>
                        Control Codex-specific workflows used by chat sessions.
                      </CardDescription>
                    </div>
                    <div
                      className={cn(
                        'rounded-full px-2.5 py-1 text-xs font-medium',
                        codexStatus?.authenticated
                          ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                          : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                      )}
                    >
                      {codexStatus?.authenticated
                        ? codexStatus.authMode === 'chatgpt'
                          ? 'ChatGPT auth'
                          : 'API key auth'
                        : 'Not authenticated'}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="grid gap-4 md:grid-cols-[1fr_220px]">
                    <div className="space-y-1">
                      <p className="text-sm font-medium">Runtime</p>
                      <p className="text-xs text-muted-foreground">
                        {codexStatus?.installed
                          ? `${codexStatus.version || 'Codex installed'} · ${codexStatus.configHome}`
                          : 'Codex CLI is not available in the WebUI container.'}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => refetchCodexStatus()}
                      disabled={isRefetchingCodex}
                      className="gap-2"
                    >
                      <RefreshCw
                        className={cn('h-3.5 w-3.5', isRefetchingCodex && 'animate-spin')}
                      />
                      Refresh
                    </Button>
                  </div>

                  <div className="grid gap-3 md:grid-cols-[1fr_260px] md:items-center">
                    <div>
                      <p className="text-sm font-medium">Web search</p>
                      <p className="text-xs text-muted-foreground">
                        Applied to the next Codex turn via <code>web_search</code> config override.
                      </p>
                    </div>
                    <Select
                      value={settings?.codexWebSearch || 'auto'}
                      onValueChange={(value) =>
                        updateSettingsMutation.mutate({
                          codexWebSearch: value as UserSettings['codexWebSearch'],
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">Auto</SelectItem>
                        <SelectItem value="cached">Cached</SelectItem>
                        <SelectItem value="live">Live</SelectItem>
                        <SelectItem value="disabled">Disabled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-3 border-t pt-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">Feature flags</p>
                        <p className="text-xs text-muted-foreground">
                          Mirrors <code>codex features list</code>; toggles persist to{' '}
                          <code>~/.codex/config.toml</code>.
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          queryClient.invalidateQueries({ queryKey: ['codex-features'] })
                        }
                        disabled={codexFeaturesLoading}
                      >
                        <RefreshCw
                          className={cn('h-3.5 w-3.5', codexFeaturesLoading && 'animate-spin')}
                        />
                      </Button>
                    </div>

                    {codexFeaturesLoading ? (
                      <div className="text-sm text-muted-foreground">Loading feature flags...</div>
                    ) : (
                      <div className="grid gap-2 md:grid-cols-2">
                        {[...codexFeatureGroups.stable, ...codexFeatureGroups.experimental]
                          .filter((feature) => feature.stage !== 'removed')
                          .slice(0, 24)
                          .map((feature) => (
                            <button
                              type="button"
                              key={feature.name}
                              onClick={() =>
                                codexFeatureMutation.mutate({
                                  name: feature.name,
                                  enabled: !feature.enabled,
                                })
                              }
                              disabled={
                                codexFeatureMutation.isPending ||
                                feature.stage === 'deprecated' ||
                                feature.stage === 'removed'
                              }
                              className={cn(
                                'flex items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                                feature.enabled
                                  ? 'border-green-500/25 bg-green-500/5'
                                  : 'border-border bg-card hover:border-primary/30'
                              )}
                            >
                              {feature.enabled ? (
                                <ToggleRight className="h-5 w-5 shrink-0 text-green-600 dark:text-green-400" />
                              ) : (
                                <ToggleLeft className="h-5 w-5 shrink-0 text-muted-foreground" />
                              )}
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-xs font-medium">
                                  {feature.name}
                                </span>
                                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                  {feature.stage}
                                </span>
                              </span>
                            </button>
                          ))}
                      </div>
                    )}
                  </div>

                  <div className="space-y-3 border-t pt-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">Codex plugins</p>
                        <p className="text-xs text-muted-foreground">
                          Writes official Codex plugin flags to <code>~/.codex/config.toml</code>.
                          Start a new chat after changes.
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setCodexMarketplaceBrowserOpen(true)}
                          className="h-8 gap-1.5 text-xs"
                        >
                          <Store className="h-3.5 w-3.5" />
                          Marketplace
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            queryClient.invalidateQueries({ queryKey: ['codex-plugins'] })
                          }
                          disabled={codexPluginsLoading}
                        >
                          <RefreshCw
                            className={cn('h-3.5 w-3.5', codexPluginsLoading && 'animate-spin')}
                          />
                        </Button>
                      </div>
                    </div>

                    {(codexPlugins?.length || 0) > 6 && (
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          value={codexPluginSearchQuery}
                          onChange={(event) => setCodexPluginSearchQuery(event.target.value)}
                          placeholder="Search Codex plugins..."
                          className="h-9 pl-9 pr-9 text-sm"
                        />
                        {codexPluginSearchQuery && (
                          <button
                            type="button"
                            onClick={() => setCodexPluginSearchQuery('')}
                            className="absolute right-3 top-1/2 rounded p-0.5 -translate-y-1/2 hover:bg-muted"
                          >
                            <X className="h-4 w-4 text-muted-foreground" />
                          </button>
                        )}
                      </div>
                    )}

                    {codexPluginsLoading ? (
                      <div className="text-sm text-muted-foreground">Loading Codex plugins...</div>
                    ) : filteredCodexPlugins.length > 0 ? (
                      <div className="grid max-h-[420px] gap-2 overflow-y-auto pr-1 md:grid-cols-2">
                        {filteredCodexPlugins.map((plugin) => {
                          const nextEnabled = !plugin.enabled;
                          const actionLabel = plugin.enabled
                            ? 'Disable'
                            : plugin.installed
                              ? 'Enable'
                              : 'Install';
                          return (
                            <div
                              key={plugin.id}
                              className={cn(
                                'flex min-h-[104px] gap-3 rounded-lg border p-3 transition-colors',
                                plugin.enabled
                                  ? 'border-green-500/25 bg-green-500/5'
                                  : 'border-border bg-card'
                              )}
                            >
                              <div
                                className={cn(
                                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                                  plugin.enabled
                                    ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                                    : 'bg-muted text-muted-foreground'
                                )}
                              >
                                <Puzzle className="h-4 w-4" />
                              </div>
                              <div className="min-w-0 flex-1 space-y-2">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-semibold">
                                      {plugin.displayName}
                                    </p>
                                    <p className="truncate text-[11px] text-muted-foreground">
                                      {plugin.name}@{plugin.marketplace}
                                    </p>
                                  </div>
                                  <Button
                                    variant={plugin.enabled ? 'outline' : 'default'}
                                    size="sm"
                                    onClick={() =>
                                      codexPluginMutation.mutate({
                                        id: plugin.id,
                                        enabled: nextEnabled,
                                      })
                                    }
                                    disabled={codexPluginMutation.isPending}
                                    className="h-7 shrink-0 px-2 text-xs"
                                  >
                                    {actionLabel}
                                  </Button>
                                </div>
                                <p className="line-clamp-2 text-xs text-muted-foreground">
                                  {plugin.description || 'No description'}
                                </p>
                                <div className="flex flex-wrap gap-1">
                                  <span
                                    className={cn(
                                      'rounded px-1.5 py-0.5 text-[10px]',
                                      plugin.enabled
                                        ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                                        : plugin.installed
                                          ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                                          : 'bg-muted text-muted-foreground'
                                    )}
                                  >
                                    {plugin.enabled
                                      ? 'Enabled'
                                      : plugin.installed
                                        ? 'Installed'
                                        : 'Available'}
                                  </span>
                                  {plugin.category && (
                                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                      {plugin.category}
                                    </span>
                                  )}
                                  {plugin.connectors && plugin.connectors.length > 0 && (
                                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                      {plugin.connectors.length} connector
                                      {plugin.connectors.length === 1 ? '' : 's'}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                        No Codex plugins found.
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </section>

            {/* Allowed Tools */}
            <section>
              <h2 className="text-lg font-semibold mb-3">Allowed Tools</h2>
              <div className="flex flex-wrap gap-2">
                {[
                  'Bash',
                  'Read',
                  'Write',
                  'Edit',
                  'Glob',
                  'Grep',
                  'WebSearch',
                  'WebFetch',
                  'Task',
                  'TodoWrite',
                ].map((tool) => {
                  const isEnabled = settings?.allowedTools?.includes(tool);
                  return (
                    <button
                      type="button"
                      key={tool}
                      onClick={() => {
                        const current = settings?.allowedTools || [];
                        const updated = isEnabled
                          ? current.filter((t) => t !== tool)
                          : [...current, tool];
                        updateSettingsMutation.mutate({ allowedTools: updated });
                      }}
                      className={cn(
                        'px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                        'hover:scale-105 active:scale-95',
                        isEnabled
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground hover:bg-muted/80'
                      )}
                    >
                      {tool}
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Theme */}
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
                        'flex items-center gap-2 px-4 py-2.5 rounded-xl border transition-all',
                        'hover:scale-[1.02] active:scale-[0.98]',
                        isActive
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border bg-card hover:border-primary/40'
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      <span className="text-sm font-medium">{option.label}</span>
                      {isActive && <CheckCircle2 className="h-4 w-4 ml-1" />}
                    </button>
                  );
                })}
              </div>
            </section>

            {/* OpenCode Models */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-lg font-semibold">OpenCode Models</h2>
                <span className="text-xs text-muted-foreground">⚡ 75+ LLM providers</span>
              </div>
              <Card className="border border-border/70">
                <CardHeader className="pb-4">
                  <CardTitle className="text-base">Modell auswählen</CardTitle>
                  <CardDescription>
                    Wähle einen Provider und dann ein Modell aus der Liste
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Provider Selection */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium">1. Provider wählen</label>
                    <Select
                      value={modelProviderId}
                      onValueChange={(value) => {
                        setModelProviderId(value);
                        setModelModelId('');
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Provider auswählen..." />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(availableProviders || {}).map(([id, provider]) => (
                          <SelectItem key={id} value={id}>
                            <div className="flex flex-col">
                              <span className="font-medium">{provider.name}</span>
                              <span className="text-xs text-muted-foreground">{id}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Model Selection */}
                  {modelProviderId && availableProviders?.[modelProviderId]?.models && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium">2. Modell wählen</label>
                      <Select value={modelModelId} onValueChange={setModelModelId}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Modell auswählen..." />
                        </SelectTrigger>
                        <SelectContent>
                          {availableProviders[modelProviderId].models?.map((model) => (
                            <SelectItem key={model} value={model}>
                              <code className="text-xs">{model}</code>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {/* Add Button */}
                  <div className="flex gap-2">
                    <Button
                      onClick={() => {
                        if (modelProviderId && modelModelId) {
                          const fullModel = `${modelProviderId}/${modelModelId}`;
                          const current = openCodeModels || [];
                          if (!current.includes(fullModel)) {
                            updateSettingsMutation.mutate({
                              cliProviderModelLists: {
                                ...settings?.cliProviderModelLists,
                                opencode: [...current, fullModel],
                              },
                            });
                          }
                          setModelModelId('');
                        }
                      }}
                      disabled={!modelProviderId || !modelModelId}
                      className="bg-purple-600 hover:bg-purple-700"
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      Modell hinzufügen
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setModelProviderId('');
                        setModelModelId('');
                      }}
                    >
                      Zurücksetzen
                    </Button>
                  </div>

                  {/* Configured Models */}
                  {openCodeModels && openCodeModels.length > 0 && (
                    <div className="space-y-2 pt-4 border-t">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">
                          Konfigurierte Modelle ({openCodeModels.length})
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs text-destructive"
                          onClick={() => {
                            updateSettingsMutation.mutate({
                              cliProviderModelLists: {
                                ...settings?.cliProviderModelLists,
                                opencode: undefined,
                              },
                            });
                          }}
                        >
                          Alle entfernen
                        </Button>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {openCodeModels.map((model) => (
                          <div
                            key={model}
                            className="group flex items-center gap-1 px-2.5 py-1 rounded-lg bg-purple-500/10 border border-purple-500/30 text-sm font-mono"
                          >
                            <span>{model}</span>
                            <button
                              type="button"
                              onClick={() => removeOpenCodeModel(model)}
                              className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </section>
          </TabsContent>

          {/* API Keys Tab */}
          <TabsContent value="api-keys" className="space-y-6">
            {/* GitHub Token */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-lg font-semibold">GitHub Token</h2>
                <Github className="h-4 w-4 text-gray-500" />
              </div>
              <Card
                className={cn(
                  'border',
                  githubTokenStatus?.hasToken
                    ? 'border-green-500/30 bg-green-500/5'
                    : 'border-gray-500/30 bg-gray-500/5'
                )}
              >
                <CardContent className="pt-4 pb-4">
                  {githubTokenStatus?.hasToken ? (
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-green-500/15">
                        <Github className="h-4 w-4 text-green-600 dark:text-green-400" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-green-600 dark:text-green-400">
                          Token configured
                        </p>
                        <p className="text-xs text-muted-foreground font-mono">
                          {githubTokenStatus.tokenPreview}
                        </p>
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
                          <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                            No token set
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Required for GitHub integration features
                          </p>
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
                        </a>{' '}
                        (scopes: repo, read:user)
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </section>

            {/* Mistral API Key */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-lg font-semibold">Mistral API Key</h2>
                <Key className="h-4 w-4 text-gray-500" />
              </div>
              <Card
                className={cn(
                  'border',
                  mistralKeyStatus?.hasKey
                    ? 'border-green-500/30 bg-green-500/5'
                    : 'border-gray-500/30 bg-gray-500/5'
                )}
              >
                <CardContent className="pt-4 pb-4">
                  {mistralKeyStatus?.hasKey ? (
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-green-500/15">
                        <Key className="h-4 w-4 text-green-600 dark:text-green-400" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-green-600 dark:text-green-400">
                          API key configured
                          {mistralKeyStatus.source === 'env' && (
                            <span className="ml-2 text-xs font-normal text-muted-foreground">
                              (from .env)
                            </span>
                          )}
                          {mistralKeyStatus.source === 'user' && (
                            <span className="ml-2 text-xs font-normal text-muted-foreground">
                              (per-user)
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground font-mono">
                          {mistralKeyStatus.keyPreview}
                        </p>
                      </div>
                      {mistralKeyStatus.source === 'user' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteMistralKeyMutation.mutate()}
                          disabled={deleteMistralKeyMutation.isPending}
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="h-4 w-4 mr-1" />
                          Remove
                        </Button>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-gray-500/15">
                          <Key className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                            No key set
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Required for the Mistral Vibe CLI provider
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <Input
                            type={showMistralKey ? 'text' : 'password'}
                            value={mistralKeyInput}
                            onChange={(e) => setMistralKeyInput(e.target.value)}
                            placeholder="Mistral API key"
                            className="font-mono text-sm pr-10"
                          />
                          <button
                            type="button"
                            onClick={() => setShowMistralKey(!showMistralKey)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-muted"
                          >
                            {showMistralKey ? (
                              <EyeOff className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <Eye className="h-4 w-4 text-muted-foreground" />
                            )}
                          </button>
                        </div>
                        <Button
                          onClick={() => setMistralKeyMutation.mutate(mistralKeyInput)}
                          disabled={!mistralKeyInput || setMistralKeyMutation.isPending}
                        >
                          {setMistralKeyMutation.isPending ? 'Saving...' : 'Save'}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Generate one at{' '}
                        <a
                          href="https://console.mistral.ai/api-keys/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline"
                        >
                          console.mistral.ai
                        </a>
                        . Stored encrypted in your user settings.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </section>

            {/* OpenCode Providers (wrapped in its own section) */}
            <section>
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base">OpenCode Providers</CardTitle>
                      <CardDescription>
                        Configure API keys for OpenCode-compatible providers
                      </CardDescription>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => {
                        setSelectedProviderId('');
                        setOpenCodeProviderForm({ id: '', name: '', apiKey: '', baseUrl: '' });
                        setOpenCodeProviderDialog(true);
                      }}
                      className="gap-1.5 h-8 px-3 text-xs"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add Provider
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {openCodeProviders && openCodeProviders.length > 0 ? (
                    <div className="space-y-2">
                      {openCodeProviders.map((provider) => (
                        <div
                          key={provider.id}
                          className="group flex items-center gap-4 p-4 rounded-xl border bg-card transition-all hover:border-primary/30 hover:shadow-sm"
                        >
                          <div className="p-2.5 rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400">
                            <Key className="h-4 w-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="font-medium">{provider.name}</p>
                              <span className="text-xs text-muted-foreground font-mono">
                                {provider.id}
                              </span>
                              {!provider.enabled && (
                                <span className="text-xs text-muted-foreground">(disabled)</span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {provider.hasKey ? 'API key configured' : 'No API key'}
                              {provider.baseUrl && ` • ${provider.baseUrl}`}
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => deleteOpenCodeProviderMutation.mutate(provider.id)}
                            className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-8 text-center">
                      <div className="p-4 rounded-full bg-muted/50 mb-4">
                        <Key className="h-8 w-8 text-muted-foreground/50" />
                      </div>
                      <p className="font-medium text-muted-foreground mb-1">
                        No providers configured
                      </p>
                      <p className="text-sm text-muted-foreground/70 max-w-xs">
                        Add OpenCode-compatible providers like OpenAI, Anthropic, or custom
                        endpoints
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </section>
          </TabsContent>

          {/* Integrations Tab */}
          <TabsContent value="integrations" className="space-y-6">
            <section>
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-lg font-semibold">ComfyUI Integration</h2>
                <Wand2 className="h-4 w-4 text-muted-foreground" />
              </div>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Image generation</CardTitle>
                  <CardDescription>
                    Plum Code WebUI ships three baked-in workflows (Z-Image Turbo, Flux.2 Klein T2I,
                    Flux.2 Klein image-edit). Set your ComfyUI server URL below — every CLI session
                    can then generate images via the{' '}
                    <code className="px-1 py-0.5 rounded bg-muted text-xs">generate_image</code>,{' '}
                    <code className="px-1 py-0.5 rounded bg-muted text-xs">
                      generate_image_quality
                    </code>{' '}
                    and <code className="px-1 py-0.5 rounded bg-muted text-xs">edit_image</code> MCP
                    tools without any external LoRA Tester container. Defaults to{' '}
                    <code className="px-1 py-0.5 rounded bg-muted text-xs">$COMFYUI_URL</code> env
                    var when unset.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">ComfyUI URL</label>
                    <div className="flex gap-2">
                      <Input
                        type="url"
                        value={comfyuiUrlInput}
                        onChange={(e) => setComfyuiUrlInput(e.target.value)}
                        placeholder="http://192.168.1.23:8188"
                        className="font-mono text-sm"
                      />
                      <Button
                        variant="outline"
                        onClick={async () => {
                          setComfyuiTestResult({ state: 'testing' });
                          try {
                            const resp =
                              await api.get<
                                ApiResponse<{ reachable: boolean; version: string | null }>
                              >('/api/comfyui/test');
                            const reachable = resp.data.data?.reachable;
                            const version = resp.data.data?.version;
                            if (reachable) {
                              setComfyuiTestResult({
                                state: 'ok',
                                message: version ? `ComfyUI ${version}` : 'reachable',
                              });
                            } else {
                              setComfyuiTestResult({ state: 'error', message: 'not reachable' });
                            }
                          } catch (err) {
                            const msg =
                              (err as { response?: { data?: { error?: { message?: string } } } })
                                ?.response?.data?.error?.message ||
                              (err instanceof Error ? err.message : 'request failed');
                            setComfyuiTestResult({ state: 'error', message: msg });
                          }
                        }}
                        disabled={comfyuiTestResult.state === 'testing' || !comfyuiUrlInput.trim()}
                      >
                        {comfyuiTestResult.state === 'testing' ? 'Testing...' : 'Test'}
                      </Button>
                    </div>
                    {comfyuiTestResult.state === 'ok' && (
                      <p className="text-xs text-emerald-500">✓ {comfyuiTestResult.message}</p>
                    )}
                    {comfyuiTestResult.state === 'error' && (
                      <p className="text-xs text-red-500">✗ {comfyuiTestResult.message}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Direct ComfyUI server. The WebUI talks to it via{' '}
                      <code className="px-1 py-0.5 rounded bg-muted text-xs">POST /prompt</code> +{' '}
                      <code className="px-1 py-0.5 rounded bg-muted text-xs">GET /history</code> +{' '}
                      <code className="px-1 py-0.5 rounded bg-muted text-xs">GET /view</code>. The
                      "Test" button does a quick{' '}
                      <code className="px-1 py-0.5 rounded bg-muted text-xs">/system_stats</code>{' '}
                      probe.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">
                      LoRA Tester Backend URL{' '}
                      <span className="text-muted-foreground">(deprecated)</span>
                    </label>
                    <Input
                      type="url"
                      value={loraTesterUrlInput}
                      onChange={(e) => setLoraTesterUrlInput(e.target.value)}
                      placeholder="(unused since WebUI talks to ComfyUI directly)"
                      className="font-mono text-sm"
                    />
                    <p className="text-xs text-muted-foreground">
                      Older versions proxied generation through a LoRA Tester sidecar. The WebUI now
                      ships the workflows directly — this field is kept for skills that still
                      reference{' '}
                      <code className="px-1 py-0.5 rounded bg-muted text-xs">$LORA_TESTER_URL</code>{' '}
                      via env.
                    </p>
                  </div>

                  <div className="flex gap-2 pt-2">
                    <Button
                      onClick={() =>
                        saveIntegrationsMutation.mutate({
                          comfyuiUrl: comfyuiUrlInput.trim(),
                          loraTesterUrl: loraTesterUrlInput.trim(),
                        })
                      }
                      disabled={saveIntegrationsMutation.isPending}
                    >
                      {saveIntegrationsMutation.isPending ? 'Saving...' : 'Save'}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setComfyuiUrlInput(integrations?.comfyuiUrl || '');
                        setLoraTesterUrlInput(integrations?.loraTesterUrl || '');
                        setComfyuiTestResult({ state: 'idle' });
                      }}
                      disabled={saveIntegrationsMutation.isPending}
                    >
                      Reset
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </section>
          </TabsContent>

          {/* Diagnostics Tab */}
          <TabsContent value="diagnostics" className="space-y-6">
            <Card className="border border-border/70">
              <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <CardTitle className="text-base">Provider Diagnostics</CardTitle>
                  <CardDescription>
                    CLI availability, auth state, model discovery, MCP wiring, and capability flags.
                  </CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refetchProviderDiagnostics()}
                  disabled={providerDiagnosticsLoading}
                  className="gap-2"
                >
                  <RefreshCw
                    className={cn('h-3.5 w-3.5', providerDiagnosticsLoading && 'animate-spin')}
                  />
                  Refresh
                </Button>
              </CardHeader>
              <CardContent>
                {providerDiagnosticsLoading ? (
                  <div className="text-sm text-muted-foreground">Checking providers...</div>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {(providerDiagnostics || []).map((provider) => {
                      const healthy = provider.installed && provider.authenticated;
                      const caps = provider.capabilities;
                      const activeCaps = [
                        caps.nativeVision
                          ? 'native vision'
                          : caps.imageBridge
                            ? 'vision bridge'
                            : null,
                        caps.approvals ? 'approvals' : null,
                        caps.mcp ? `${provider.mcpServerCount} MCP` : null,
                        caps.usageLimits !== 'none' ? caps.usageLimits : null,
                        caps.allowedDirectories ? 'allowed dirs' : null,
                      ].filter((item): item is string => Boolean(item));

                      return (
                        <div
                          key={provider.id}
                          className={cn(
                            'rounded-lg border p-4',
                            healthy
                              ? 'border-green-500/25 bg-green-500/5'
                              : 'border-amber-500/25 bg-amber-500/5'
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold">{provider.name}</span>
                                <span
                                  className={cn(
                                    'rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide',
                                    healthy
                                      ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                                      : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                                  )}
                                >
                                  {healthy ? 'ready' : 'attention'}
                                </span>
                              </div>
                              <p className="mt-1 truncate text-xs text-muted-foreground">
                                {provider.version || provider.command}
                              </p>
                            </div>
                            {healthy ? (
                              <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600 dark:text-green-400" />
                            ) : (
                              <AlertCircle className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
                            )}
                          </div>

                          <div className="mt-4 grid gap-2 text-xs">
                            <div className="flex justify-between gap-3">
                              <span className="text-muted-foreground">Binary</span>
                              <span className="truncate font-mono">
                                {provider.binaryPath || 'not found'}
                              </span>
                            </div>
                            <div className="flex justify-between gap-3">
                              <span className="text-muted-foreground">Credentials</span>
                              <span className="truncate font-mono">{provider.credentialsPath}</span>
                            </div>
                            <div className="flex justify-between gap-3">
                              <span className="text-muted-foreground">Models</span>
                              <span>
                                {provider.modelCount} discovered · default{' '}
                                {provider.defaultModel || 'auto'}
                              </span>
                            </div>
                            {provider.codexModelsCache && (
                              <div className="flex justify-between gap-3">
                                <span className="text-muted-foreground">Codex cache</span>
                                <span>
                                  {provider.codexModelsCache.exists
                                    ? `${provider.codexModelsCache.modelCount} models`
                                    : 'missing'}
                                </span>
                              </div>
                            )}
                          </div>

                          <div className="mt-4 flex flex-wrap gap-1.5">
                            {activeCaps.map((cap) => (
                              <span key={cap} className="ui-pill ui-pill-subtle text-[11px]">
                                {cap}
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Extensions Tab */}
          <TabsContent value="extensions" className="space-y-6">
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
                <Button
                  size="sm"
                  onClick={() => setShowMcpForm(true)}
                  className="gap-1.5 h-8 px-3 text-xs"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add
                </Button>
              </div>

              {showMcpForm && (
                <Card className="mb-4 border-primary/30 bg-primary/5 animate-scale-in">
                  <CardHeader className="pb-4">
                    <CardTitle className="text-base">New MCP Server</CardTitle>
                    <CardDescription>
                      Configure a Model Context Protocol server connection
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Server Name</label>
                        <Input
                          value={newMcpServer.name}
                          onChange={(e) =>
                            setNewMcpServer({ ...newMcpServer, name: e.target.value })
                          }
                          placeholder="My Server"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Type</label>
                        <select
                          className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
                          value={newMcpServer.type}
                          onChange={(e) =>
                            setNewMcpServer({
                              ...newMcpServer,
                              type: e.target.value as 'subprocess' | 'sse',
                            })
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
                          onChange={(e) =>
                            setNewMcpServer({ ...newMcpServer, command: e.target.value })
                          }
                          placeholder="npx @modelcontextprotocol/server-filesystem"
                          className="font-mono text-sm"
                        />
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <label className="text-sm font-medium">URL</label>
                        <Input
                          value={newMcpServer.url}
                          onChange={(e) =>
                            setNewMcpServer({ ...newMcpServer, url: e.target.value })
                          }
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
                          'group flex items-center gap-4 p-4 rounded-xl border bg-card transition-all hover:border-primary/30 hover:shadow-sm',
                          testResult?.connected === true && 'border-green-500/30',
                          testResult?.connected === false && 'border-red-500/30'
                        )}
                      >
                        <div
                          className={cn(
                            'p-2.5 rounded-lg transition-colors',
                            testResult?.connected === true
                              ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                              : testResult?.connected === false
                                ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                                : server.type === 'subprocess'
                                  ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                                  : 'bg-purple-500/10 text-purple-600 dark:text-purple-400'
                          )}
                        >
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
                              <span className="text-xs text-green-600 dark:text-green-400">
                                Connected
                              </span>
                            )}
                            {testResult?.connected === false && (
                              <span className="text-xs text-red-600 dark:text-red-400">Failed</span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground font-mono truncate">
                            {server.type === 'subprocess' ? server.command : server.url}
                          </p>
                          {testResult?.error && (
                            <p className="text-xs text-red-500 truncate mt-0.5">
                              {testResult.error}
                            </p>
                          )}
                        </div>
                        <span
                          className={cn(
                            'px-2.5 py-1 text-xs rounded-full font-medium shrink-0',
                            server.type === 'subprocess'
                              ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                              : 'bg-purple-500/10 text-purple-600 dark:text-purple-400'
                          )}
                        >
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
              ) : (
                !showMcpForm && (
                  <Card className="border-dashed">
                    <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                      <div className="p-4 rounded-full bg-muted/50 mb-4">
                        <Server className="h-8 w-8 text-muted-foreground/50" />
                      </div>
                      <p className="font-medium text-muted-foreground mb-1">
                        No MCP servers configured
                      </p>
                      <p className="text-sm text-muted-foreground/70 max-w-xs">
                        Add Model Context Protocol servers to extend Claude's capabilities
                      </p>
                    </CardContent>
                  </Card>
                )
              )}
            </section>

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
                <Button
                  size="sm"
                  onClick={() => openAgentEditor('create')}
                  className="gap-1.5 h-8 px-3 text-xs"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add
                </Button>
              </div>

              {claudeAgents && claudeAgents.length > 0 ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {claudeAgents.map((agent) => {
                    const baseName =
                      agent.filePath
                        .split('/')
                        .pop()
                        ?.replace('.md.disabled', '')
                        .replace('.md', '') || agent.name;
                    return (
                      <Card
                        key={agent.id}
                        className={cn(
                          'group relative overflow-hidden transition-all hover:shadow-md',
                          agent.enabled ? 'hover:border-primary/30' : 'opacity-60 hover:opacity-80'
                        )}
                      >
                        <CardContent className="pt-5 pb-4">
                          <div className="flex items-start gap-3">
                            <div
                              className={cn(
                                'p-2 rounded-lg shrink-0',
                                agent.enabled
                                  ? 'bg-primary/10 text-primary'
                                  : 'bg-muted text-muted-foreground'
                              )}
                            >
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
                                  {agent.tools.slice(0, 3).map((tool) => (
                                    <span
                                      key={tool}
                                      className="px-1.5 py-0.5 text-[10px] rounded bg-muted/70 text-muted-foreground"
                                    >
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
                        <div
                          className={cn(
                            'absolute inset-x-0 bottom-0 h-0.5 bg-gradient-to-r from-primary/50 to-primary/10 opacity-0 group-hover:opacity-100 transition-opacity',
                            !agent.enabled && 'from-muted-foreground/30 to-muted-foreground/10'
                          )}
                        />
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
                <div className="flex items-center gap-2">
                  <input
                    ref={skillImportInputRef}
                    type="file"
                    multiple
                    accept=".md,.skill,.zip"
                    className="hidden"
                    onChange={(e) => handleSkillImportFiles(e.target.files)}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => skillImportInputRef.current?.click()}
                    disabled={importSkillsMutation.isPending}
                    className="gap-1.5 h-8 px-3 text-xs"
                    title="Import .md or .skill/.zip files"
                  >
                    {importSkillsMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Upload className="h-3.5 w-3.5" />
                    )}
                    Import
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => openSkillEditor('create')}
                    className="gap-1.5 h-8 px-3 text-xs bg-green-600 hover:bg-green-700"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add
                  </Button>
                </div>
              </div>

              {claudeSkills && claudeSkills.length > 0 ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {claudeSkills.map((skill) => {
                    const baseName =
                      skill.dirPath.split('/').pop()?.replace('.disabled', '') || skill.name;
                    return (
                      <Card
                        key={skill.id}
                        className={cn(
                          'group relative overflow-hidden transition-all hover:shadow-md',
                          skill.enabled
                            ? 'hover:border-green-500/30'
                            : 'opacity-60 hover:opacity-80'
                        )}
                      >
                        <CardContent className="pt-5 pb-4">
                          <div className="flex items-start gap-3">
                            <div
                              className={cn(
                                'p-2 rounded-lg shrink-0',
                                skill.enabled
                                  ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                                  : 'bg-muted text-muted-foreground'
                              )}
                            >
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
                                  {skill.allowedTools.map((tool) => (
                                    <span
                                      key={tool}
                                      className="px-1.5 py-0.5 text-[10px] rounded bg-green-500/10 text-green-600 dark:text-green-400"
                                    >
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
                        <div
                          className={cn(
                            'absolute inset-x-0 bottom-0 h-0.5 bg-gradient-to-r from-green-500/50 to-green-500/10 opacity-0 group-hover:opacity-100 transition-opacity',
                            !skill.enabled && 'from-muted-foreground/30 to-muted-foreground/10'
                          )}
                        />
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
                    <Button
                      size="sm"
                      onClick={() => openSkillEditor('create')}
                      className="gap-2 bg-green-600 hover:bg-green-700"
                    >
                      <Plus className="h-4 w-4" />
                      Create Skill
                    </Button>
                  </CardContent>
                </Card>
              )}
            </section>

            {/* Codex Marketplace */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold">Codex Marketplace</h2>
                  {codexPlugins && codexPlugins.length > 0 && (
                    <span className="px-2 py-0.5 text-xs font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-full">
                      {enabledCodexPlugins.length}/{codexPlugins.length}
                    </span>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setCodexMarketplaceBrowserOpen(true)}
                  className="gap-1.5 h-8 px-3 text-xs"
                >
                  <Store className="h-3.5 w-3.5" />
                  Browse
                </Button>
              </div>

              <Card>
                <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3">
                    <div className="rounded-lg bg-blue-500/10 p-2 text-blue-600 dark:text-blue-400">
                      <Puzzle className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium">Official Codex plugins</p>
                      <p className="text-xs text-muted-foreground">
                        Browse OpenAI-curated plugins and enable them for new Codex sessions.
                      </p>
                      {enabledCodexPlugins.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {enabledCodexPlugins.slice(0, 6).map((plugin) => (
                            <span
                              key={plugin.id}
                              className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-600 dark:text-blue-400"
                            >
                              {plugin.displayName}
                            </span>
                          ))}
                          {enabledCodexPlugins.length > 6 && (
                            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              +{enabledCodexPlugins.length - 6}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => setCodexMarketplaceBrowserOpen(true)}
                    className="shrink-0 gap-1.5"
                  >
                    <Store className="h-4 w-4" />
                    Open Marketplace
                  </Button>
                </CardContent>
              </Card>
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
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setMarketplaceBrowserOpen(true)}
                    className="gap-1.5 h-8 px-3 text-xs"
                  >
                    <Store className="h-3.5 w-3.5" />
                    Browse
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => openPluginEditor('create')}
                    className="gap-1.5 h-8 px-3 text-xs bg-violet-600 hover:bg-violet-700"
                  >
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
                      const baseName =
                        plugin.source === 'user'
                          ? plugin.dirPath.split('/').pop()?.replace('.disabled', '') || plugin.name
                          : plugin.name;
                      const isUserPlugin = plugin.source === 'user';

                      return (
                        <Card
                          key={plugin.id}
                          className={cn(
                            'group relative overflow-hidden transition-all hover:shadow-md',
                            plugin.enabled
                              ? 'hover:border-violet-500/30'
                              : 'opacity-60 hover:opacity-80'
                          )}
                        >
                          <CardContent className="pt-5 pb-4">
                            <div className="flex items-start gap-3">
                              <div
                                className={cn(
                                  'p-2 rounded-lg shrink-0',
                                  plugin.enabled
                                    ? 'bg-violet-500/10 text-violet-600 dark:text-violet-400'
                                    : 'bg-muted text-muted-foreground'
                                )}
                              >
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
                                  <span
                                    className={cn(
                                      'px-1.5 py-0.5 text-[10px] rounded',
                                      isUserPlugin
                                        ? 'bg-violet-500/10 text-violet-600 dark:text-violet-400'
                                        : 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                                    )}
                                  >
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
                          <div
                            className={cn(
                              'absolute inset-x-0 bottom-0 h-0.5 bg-gradient-to-r from-violet-500/50 to-violet-500/10 opacity-0 group-hover:opacity-100 transition-opacity',
                              !plugin.enabled && 'from-muted-foreground/30 to-muted-foreground/10'
                            )}
                          />
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
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setMarketplaceBrowserOpen(true)}
                        className="gap-2"
                      >
                        <Store className="h-4 w-4" />
                        Browse Marketplace
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => openPluginEditor('create')}
                        className="gap-2 bg-violet-600 hover:bg-violet-700"
                      >
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
          configProvider={configProvider}
        />

        <PluginEditorDialog
          open={pluginEditorOpen}
          onOpenChange={setPluginEditorOpen}
          mode={pluginEditorMode}
          initialData={editingPlugin?.data}
          editName={editingPlugin?.name}
          configProvider={configProvider}
        />

        <MarketplaceBrowserDialog
          open={marketplaceBrowserOpen}
          onOpenChange={setMarketplaceBrowserOpen}
          configProvider={configProvider}
        />

        <MarketplaceBrowserDialog
          open={codexMarketplaceBrowserOpen}
          onOpenChange={setCodexMarketplaceBrowserOpen}
          configProvider="codex"
        />

        {/* OpenCode Provider Dialog */}
        <Dialog open={openCodeProviderDialog} onOpenChange={setOpenCodeProviderDialog}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Add OpenCode Provider</DialogTitle>
              <DialogDescription>
                Wähle einen Provider aus der Liste und gib deinen API Key ein
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              {/* Provider Selection */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Provider auswählen</label>
                <Select
                  value={selectedProviderId}
                  onValueChange={(value) => {
                    setSelectedProviderId(value);
                    const provider = availableProviders?.[value];
                    if (provider) {
                      setOpenCodeProviderForm({
                        ...openCodeProviderForm,
                        id: value,
                        name: provider.name,
                      });
                    }
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Provider auswählen..." />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(availableProviders || {}).map(([id, provider]) => (
                      <SelectItem key={id} value={id}>
                        <div className="flex flex-col">
                          <span className="font-medium">{provider.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {id} - {provider.description}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Available Models for selected provider */}
              {selectedProviderId && availableProviders?.[selectedProviderId]?.models && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Verfügbare Modelle</label>
                  <div className="p-3 bg-muted/50 rounded-lg space-y-1">
                    {availableProviders[selectedProviderId].models?.map((model) => (
                      <div key={model} className="flex items-center justify-between text-sm">
                        <code className="text-xs bg-background px-2 py-1 rounded font-mono">
                          {selectedProviderId}/{model}
                        </code>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-xs"
                          onClick={() => {
                            const fullModel = `${selectedProviderId}/${model}`;
                            const current = openCodeModels || [];
                            if (!current.includes(fullModel)) {
                              updateSettingsMutation.mutate({
                                cliProviderModelLists: {
                                  ...settings?.cliProviderModelLists,
                                  opencode: [...current, fullModel],
                                },
                              });
                            }
                          }}
                        >
                          {openCodeModels.includes(`${selectedProviderId}/${model}`)
                            ? 'Hinzugefügt'
                            : 'Hinzufügen'}
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* API Key */}
              <div className="space-y-2">
                <label className="text-sm font-medium">API Key</label>
                <div className="relative">
                  <Input
                    type={showOpenCodeApiKey ? 'text' : 'password'}
                    value={openCodeProviderForm.apiKey}
                    onChange={(e) =>
                      setOpenCodeProviderForm({ ...openCodeProviderForm, apiKey: e.target.value })
                    }
                    placeholder="sk-... oder provider-spezifischer Key"
                    className="font-mono text-sm pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowOpenCodeApiKey(!showOpenCodeApiKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-muted"
                  >
                    {showOpenCodeApiKey ? (
                      <EyeOff className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Eye className="h-4 w-4 text-muted-foreground" />
                    )}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Der API Key wird verschlüsselt gespeichert
                </p>
              </div>

              {/* Optional Base URL */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Base URL (optional)</label>
                <Input
                  value={openCodeProviderForm.baseUrl}
                  onChange={(e) =>
                    setOpenCodeProviderForm({ ...openCodeProviderForm, baseUrl: e.target.value })
                  }
                  placeholder="https://api.example.com/v1"
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Nur erforderlich für Custom Endpoints
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => {
                  setOpenCodeProviderDialog(false);
                  setSelectedProviderId('');
                  setOpenCodeProviderForm({ id: '', name: '', apiKey: '', baseUrl: '' });
                }}
              >
                Abbrechen
              </Button>
              <Button
                onClick={saveOpenCodeProvider}
                disabled={!openCodeProviderForm.id || !openCodeProviderForm.apiKey}
                className="bg-purple-600 hover:bg-purple-700"
              >
                Provider speichern
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
