import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, FolderOpen, MessageSquare, Settings, FolderPlus, Folder, Tags, Bot, Palette, ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FolderBrowserDialog } from '@/components/ui/folder-browser';
import { DiscoveredProjects } from '@/components/projects';
import { SessionCategories, CategorySelector } from '@/components/session-categories';
import { ProviderLogo } from '@/components/branding/ProviderLogo';
import { useSessionStore } from '@/stores/sessionStore';
import { api } from '@/services/api';
import { toast } from '@/hooks/use-toast';
import type { Session, ApiResponse, UserSettings, CLIProvider } from '@claude-code-webui/shared';
import { cn } from '@/lib/utils';
import { useProviderStore } from '@/stores/providerStore';
import { toCliProvider, CLI_PROVIDER_ICON, UI_PROVIDER_META, type UiProvider } from '@/lib/providers';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function DashboardPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { setSessions, sessions } = useSessionStore();
  const { uiProvider, setProvider } = useProviderStore();

  const [showNewSession, setShowNewSession] = useState(searchParams.get('new') === 'true');
  const [newSessionName, setNewSessionName] = useState('');
  const [sessionMode, setSessionMode] = useState<'new' | 'existing'>('new');
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [showFolderBrowser, setShowFolderBrowser] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [showCategories, setShowCategories] = useState(false);
  const [selectedCliProvider, setSelectedCliProvider] = useState<CLIProvider>(() => toCliProvider(uiProvider));

  // Fetch user settings
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<UserSettings>>('/api/settings');
      return response.data.data;
    },
  });

  useEffect(() => {
    if (settings?.uiProvider) {
      setProvider(settings.uiProvider);
    }
  }, [settings?.uiProvider, setProvider]);

  useEffect(() => {
    if (!showNewSession || !settings?.defaultCliProvider) return;
    setSelectedCliProvider(settings.defaultCliProvider);
  }, [settings?.defaultCliProvider, showNewSession]);

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
  });

  // Fetch available CLI providers
  interface CLIProviderInfo {
    id: CLIProvider;
    name: string;
    icon: string;
    available: boolean;
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
    mutationFn: async (data: { name: string; workingDirectory?: string; cliProvider?: CLIProvider }) => {
      const response = await api.post<ApiResponse<Session>>('/api/sessions', data);
      return response.data;
    },
    onSuccess: (data) => {
      if (data.success && data.data) {
        queryClient.invalidateQueries({ queryKey: ['sessions'] });
        setShowNewSession(false);
        setNewSessionName('');
        setSessionMode('new');
        setSelectedFolder(null);
        setSelectedCliProvider(settings?.defaultCliProvider ?? toCliProvider(uiProvider));
        navigate(`/session/${data.data.id}`);
      }
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const themeMutation = useMutation({
    mutationFn: async (provider: UiProvider) => {
      const response = await api.put<ApiResponse<UserSettings>>('/api/settings', { uiProvider: provider });
      return response.data.data;
    },
    onMutate: (provider) => {
      setProvider(provider);
      const previous = queryClient.getQueryData<UserSettings>(['settings']);
      queryClient.setQueryData(['settings'], { ...(previous || {}), uiProvider: provider });
      return { previous };
    },
    onError: (error: Error, _provider, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['settings'], context.previous);
        if (context.previous.uiProvider) setProvider(context.previous.uiProvider as UiProvider);
      }
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
    onSuccess: (data) => {
      if (data) queryClient.setQueryData(['settings'], data);
    },
  });

  const hasDefaultDir = !!settings?.defaultWorkingDir;

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

  const handleCreateSession = (e: React.FormEvent) => {
    e.preventDefault();
    if (newSessionName.trim()) {
      const payload: { name: string; workingDirectory?: string; cliProvider?: CLIProvider } = {
        name: newSessionName.trim(),
        cliProvider: selectedCliProvider,
      };
      if (sessionMode === 'existing' && selectedFolder) {
        payload.workingDirectory = selectedFolder;
      }
      createMutation.mutate(payload);
    }
  };

  useEffect(() => {
    if (searchParams.get('new') === 'true') setShowNewSession(true);
  }, [searchParams]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Compact horizontal header */}
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            Sessions
            <span className="rounded-full bg-muted/60 px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {sessions.length}
            </span>
          </h1>
          <span className="text-sm text-muted-foreground hidden sm:inline">Pick up where you left off</span>
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={() => setShowNewSession(true)} size="sm" className="gap-1.5">
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">New Session</span>
          </Button>
          <Button
            variant={showCategories ? 'default' : 'outline'}
            size="sm"
            onClick={() => setShowCategories(!showCategories)}
            className="gap-1.5"
          >
            <Tags className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" asChild className="gap-1.5">
            <Link to="/connect">
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                <Palette className="h-4 w-4" />
                <span className="hidden md:inline">{UI_PROVIDER_META[uiProvider].label}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              {(Object.keys(UI_PROVIDER_META) as UiProvider[]).map((provider) => (
                <DropdownMenuItem
                  key={provider}
                  className="flex items-center gap-2 cursor-pointer"
                  onClick={() => themeMutation.mutate(provider)}
                >
                  <ProviderLogo provider={provider} className="h-4 w-4" alt="" />
                  <span className="flex-1">{UI_PROVIDER_META[provider].label}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* New Session Form */}
      {showNewSession && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Create New Session</CardTitle>
            <CardDescription className="text-xs">
              {sessionMode === 'new'
                ? (hasDefaultDir ? `Folder created in ${settings?.defaultWorkingDir}` : 'Set default directory in Settings')
                : 'Select an existing folder'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2 mb-3">
              <Button
                type="button"
                variant={sessionMode === 'new' ? 'default' : 'outline'}
                size="sm"
                onClick={() => { setSessionMode('new'); setSelectedFolder(null); }}
                className="gap-1.5"
              >
                <FolderPlus className="h-3.5 w-3.5" />
                New
              </Button>
              <Button
                type="button"
                variant={sessionMode === 'existing' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSessionMode('existing')}
                className="gap-1.5"
              >
                <Folder className="h-3.5 w-3.5" />
                Existing
              </Button>
            </div>

            {sessionMode === 'new' && !hasDefaultDir ? (
              <div className="text-center py-4">
                <FolderOpen className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground mb-3">Set default working directory in Settings.</p>
                <div className="flex justify-center gap-2">
                  <Button size="sm" asChild>
                    <Link to="/settings"><Settings className="mr-1.5 h-3.5 w-3.5" />Settings</Link>
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setShowNewSession(false)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleCreateSession} className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium">Session Name</label>
                    <Input
                      value={newSessionName}
                      onChange={(e) => setNewSessionName(e.target.value)}
                      placeholder="My Project"
                      autoFocus
                      className="h-9"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium flex items-center gap-1.5">
                      <Bot className="h-3.5 w-3.5" />
                      Provider
                    </label>
                    <Select value={selectedCliProvider} onValueChange={(v) => setSelectedCliProvider(v as CLIProvider)}>
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="Select provider" />
                      </SelectTrigger>
                      <SelectContent>
                        {cliProviders?.map((provider) => (
                          <SelectItem key={provider.id} value={provider.id} disabled={!provider.available}>
                            <span className="flex items-center gap-2">
                              <span>{provider.icon}</span>
                              <span>{provider.name}</span>
                              {!provider.available && <span className="text-xs text-muted-foreground">(N/A)</span>}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Multi-CLI Configuration */}
                {/* Multi-CLI config removed - multi provider no longer exists */}

                {sessionMode === 'existing' && (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <Input
                        value={selectedFolder || ''}
                        readOnly
                        placeholder="Select folder..."
                        className="flex-1 bg-muted/50 h-9"
                      />
                      <Button type="button" variant="outline" size="sm" onClick={() => setShowFolderBrowser(true)}>
                        Browse
                      </Button>
                    </div>
                    <DiscoveredProjects cliProvider={selectedCliProvider} defaultExpanded className="border-dashed bg-muted/30" />
                  </div>
                )}

                <div className="flex gap-2">
                  <Button
                    type="submit"
                    size="sm"
                    disabled={createMutation.isPending || !newSessionName.trim() || (sessionMode === 'existing' && !selectedFolder)}
                  >
                    {createMutation.isPending ? 'Creating...' : 'Create'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => { setShowNewSession(false); setSessionMode('new'); setSelectedFolder(null); setNewSessionName(''); }}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      )}

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
      <div className="flex gap-4">
        {showCategories && (
          <Card className="w-56 shrink-0 hidden md:block">
            <SessionCategories selectedCategory={selectedCategory} onCategorySelect={setSelectedCategory} className="h-[350px]" />
          </Card>
        )}

        <div className="flex-1 grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {(selectedCategory ? sessions.filter(s => (s as any).category === selectedCategory) : sessions).map((session) => (
            <Card
              key={session.id}
              className="cursor-pointer transition-colors hover:border-primary"
              onClick={() => navigate(`/session/${session.id}`)}
            >
              <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                <div className="space-y-0.5 min-w-0 flex-1">
                  <CardTitle className="text-sm flex items-center gap-1.5 truncate">
                    <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{session.name}</span>
                    {session.cliProvider && (
                      <span className="inline-flex items-center rounded bg-muted/60 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground shrink-0">
                        {CLI_PROVIDER_ICON[session.cliProvider]}
                      </span>
                    )}
                  </CardTitle>
                  <CardDescription className="flex items-center gap-1 text-[10px] truncate">
                    <FolderOpen className="h-2.5 w-2.5 shrink-0" />
                    <span className="truncate">{session.workingDirectory}</span>
                  </CardDescription>
                </div>
                <div className={cn(
                  'h-2 w-2 rounded-full shrink-0 mt-1',
                  session.status === 'running' && 'bg-green-500',
                  session.status === 'stopped' && 'bg-gray-400',
                  session.status === 'error' && 'bg-red-500'
                )} />
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <CategorySelector sessionId={session.id} currentCategory={(session as any).category || null} />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(session.updatedAt).toLocaleDateString()}
                    </span>
                    <div onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => deleteMutation.mutate(session.id)}>
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}

          {(selectedCategory ? sessions.filter(s => (s as any).category === selectedCategory) : sessions).length === 0 && !showNewSession && (
            <Card className="col-span-full">
              <CardContent className="flex flex-col items-center justify-center py-8">
                <MessageSquare className="h-10 w-10 text-muted-foreground mb-3" />
                <p className="text-sm text-muted-foreground mb-3">No sessions yet</p>
                <Button size="sm" onClick={() => setShowNewSession(true)}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Create your first session
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
