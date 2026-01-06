import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, FolderOpen, MessageSquare, Settings, RefreshCw, FolderPlus, Folder } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { FolderBrowserDialog } from '@/components/ui/folder-browser';
import { DiscoveredProjects } from '@/components/projects';
import { useSessionStore } from '@/stores/sessionStore';
import { api } from '@/services/api';
import { toast } from '@/hooks/use-toast';
import type { Session, ApiResponse, UserSettings } from '@claude-code-webui/shared';
import { cn } from '@/lib/utils';

// Usage limit display components
function UsageBar({ percent, color }: { percent: number; color: string }) {
  return (
    <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
      <div
        className={cn('h-full rounded-full transition-all', color)}
        style={{ width: `${Math.min(percent, 100)}%` }}
      />
    </div>
  );
}

function formatTimeUntil(date: Date): string {
  const now = new Date();
  const diff = date.getTime() - now.getTime();
  if (diff <= 0) return 'now';

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `${days} day${days > 1 ? 's' : ''}`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function formatResetDate(date: Date): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const day = days[date.getDay()];
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${day}, ${hours}:${minutes}`;
}

function LimitCard({
  title,
  subtitle,
  percent,
  resetInfo,
}: {
  title: string;
  subtitle?: string;
  percent: number;
  resetInfo: string;
}) {
  const getColor = (p: number) => {
    if (p >= 90) return 'bg-red-500';
    if (p >= 70) return 'bg-amber-500';
    return 'bg-green-500';
  };

  return (
    <div className="flex-1 min-w-[100px] sm:min-w-[140px] p-2 sm:p-3 rounded-lg bg-muted/30 border border-border/50">
      <div className="flex items-center justify-between mb-1 sm:mb-1.5">
        <span className="text-xs sm:text-sm font-medium">{title}</span>
        {subtitle && (
          <span className="text-[10px] sm:text-xs text-muted-foreground">{subtitle}</span>
        )}
      </div>
      <div className="flex items-center gap-1.5 sm:gap-2 mb-1 sm:mb-1.5">
        <UsageBar percent={percent} color={getColor(percent)} />
        <span className={cn(
          'text-xs sm:text-sm font-mono font-medium min-w-[32px] sm:min-w-[36px] text-right',
          percent >= 90 ? 'text-red-500' : percent >= 70 ? 'text-amber-500' : 'text-foreground'
        )}>
          {percent}%
        </span>
      </div>
      <div className="flex items-center gap-1 text-[10px] sm:text-xs text-muted-foreground">
        <RefreshCw className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
        <span className="truncate">{resetInfo}</span>
      </div>
    </div>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { setSessions, sessions } = useSessionStore();

  const [showNewSession, setShowNewSession] = useState(searchParams.get('new') === 'true');
  const [newSessionName, setNewSessionName] = useState('');
  const [sessionMode, setSessionMode] = useState<'new' | 'existing'>('new');
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [showFolderBrowser, setShowFolderBrowser] = useState(false);

  // Usage limits state - must be before any early returns
  const [limits, setLimits] = useState<{
    session: { percentUsed: number; resetsAt: Date | null };
    weeklyAll: { percentUsed: number; resetsAt: Date | null };
    weeklySonnet: { percentUsed: number; resetsAt: Date | null };
  } | null>(null);
  const [isRefreshingLimits, setIsRefreshingLimits] = useState(false);
  const [limitsError, setLimitsError] = useState<string | null>(null);

  // Fetch user settings to check for default working directory
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<UserSettings>>('/api/settings');
      return response.data.data;
    },
  });

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

  // Create session mutation
  const createMutation = useMutation({
    mutationFn: async (data: { name: string; workingDirectory?: string }) => {
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
        navigate(`/session/${data.data.id}`);
      }
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
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
      const payload: { name: string; workingDirectory?: string } = {
        name: newSessionName.trim(),
      };

      // If using existing folder mode and a folder is selected, include it
      if (sessionMode === 'existing' && selectedFolder) {
        payload.workingDirectory = selectedFolder;
      }

      createMutation.mutate(payload);
    }
  };

  useEffect(() => {
    if (searchParams.get('new') === 'true') {
      setShowNewSession(true);
    }
  }, [searchParams]);

  // Fetch usage limits from API
  const fetchLimits = async () => {
    setIsRefreshingLimits(true);
    setLimitsError(null);
    try {
      const response = await api.get<{
        success: boolean;
        data: {
          subscriptionType: string;
          rateLimitTier: string;
          fiveHour: { utilization: number; resetsAt: string | null } | null;
          sevenDay: { utilization: number; resetsAt: string | null } | null;
          sevenDaySonnet: { utilization: number; resetsAt: string | null } | null;
        };
      }>('/api/usage/limits');

      if (response.data.success && response.data.data) {
        const data = response.data.data;
        setLimits({
          session: {
            percentUsed: Math.round(data.fiveHour?.utilization ?? 0),
            resetsAt: data.fiveHour?.resetsAt ? new Date(data.fiveHour.resetsAt) : null,
          },
          weeklyAll: {
            percentUsed: Math.round(data.sevenDay?.utilization ?? 0),
            resetsAt: data.sevenDay?.resetsAt ? new Date(data.sevenDay.resetsAt) : null,
          },
          weeklySonnet: {
            percentUsed: Math.round(data.sevenDaySonnet?.utilization ?? 0),
            resetsAt: data.sevenDaySonnet?.resetsAt ? new Date(data.sevenDaySonnet.resetsAt) : null,
          },
        });
      }
    } catch (err) {
      console.error('Failed to fetch usage limits:', err);
      // Don't show error - usage API may be blocked by Cloudflare
      setLimitsError(null);
    } finally {
      setIsRefreshingLimits(false);
    }
  };

  // Fetch limits on mount
  useEffect(() => {
    fetchLimits();
  }, []);

  const handleRefreshLimits = () => {
    fetchLimits();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight">Dashboard</h2>
          <p className="text-sm md:text-base text-muted-foreground">Manage your Claude Code sessions</p>
        </div>
        <Button onClick={() => setShowNewSession(true)} className="w-full sm:w-auto">
          <Plus className="mr-2 h-4 w-4" />
          New Session
        </Button>
      </div>

      {/* Usage Limits */}
      <div className="flex items-center gap-2 md:gap-4 flex-wrap">
        {limitsError ? (
          <div className="text-sm text-muted-foreground">{limitsError}</div>
        ) : limits ? (
          <>
            <LimitCard
              title="5h Session"
              percent={limits.session.percentUsed}
              resetInfo={limits.session.resetsAt ? `in ${formatTimeUntil(limits.session.resetsAt)}` : '-'}
            />
            <LimitCard
              title="Weekly"
              subtitle="All Models"
              percent={limits.weeklyAll.percentUsed}
              resetInfo={limits.weeklyAll.resetsAt ? formatResetDate(limits.weeklyAll.resetsAt) : '-'}
            />
            <LimitCard
              title="Weekly"
              subtitle="Sonnet"
              percent={limits.weeklySonnet.percentUsed}
              resetInfo={limits.weeklySonnet.resetsAt ? formatResetDate(limits.weeklySonnet.resetsAt) : '-'}
            />
          </>
        ) : (
          <div className="text-sm text-muted-foreground">Loading limits...</div>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={handleRefreshLimits}
          disabled={isRefreshingLimits}
          className="h-9 w-9"
          title="Refresh limits"
        >
          <RefreshCw className={cn("h-4 w-4", isRefreshingLimits && "animate-spin")} />
        </Button>
      </div>

      {/* Discovered Projects */}
      <DiscoveredProjects />

      {/* New Session Form */}
      {showNewSession && (
        <Card>
          <CardHeader>
            <CardTitle>Create New Session</CardTitle>
            <CardDescription>
              {sessionMode === 'new'
                ? (hasDefaultDir ? `A folder will be created in ${settings?.defaultWorkingDir}` : 'Set a default working directory in Settings first')
                : 'Select an existing folder to work with'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Mode Toggle */}
            <div className="flex gap-2 mb-4">
              <Button
                type="button"
                variant={sessionMode === 'new' ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  setSessionMode('new');
                  setSelectedFolder(null);
                }}
                className="gap-2"
              >
                <FolderPlus className="h-4 w-4" />
                New Folder
              </Button>
              <Button
                type="button"
                variant={sessionMode === 'existing' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSessionMode('existing')}
                className="gap-2"
              >
                <Folder className="h-4 w-4" />
                Existing Folder
              </Button>
            </div>

            {sessionMode === 'new' && !hasDefaultDir ? (
              <div className="text-center py-4">
                <FolderOpen className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground mb-4">
                  Please set a default working directory in Settings to create new folders.
                </p>
                <div className="flex justify-center gap-2">
                  <Button asChild>
                    <Link to="/settings">
                      <Settings className="mr-2 h-4 w-4" />
                      Go to Settings
                    </Link>
                  </Button>
                  <Button variant="outline" onClick={() => setShowNewSession(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleCreateSession} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Session Name</label>
                  <Input
                    value={newSessionName}
                    onChange={(e) => setNewSessionName(e.target.value)}
                    placeholder="My Project"
                    autoFocus
                  />
                </div>

                {sessionMode === 'existing' ? (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Working Directory</label>
                    <div className="flex gap-2">
                      <Input
                        value={selectedFolder || ''}
                        readOnly
                        placeholder="Select a folder..."
                        className="flex-1 bg-muted/50"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setShowFolderBrowser(true)}
                      >
                        Browse
                      </Button>
                    </div>
                    {selectedFolder && (
                      <p className="text-xs text-muted-foreground">
                        Session will use: {selectedFolder}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    This will create a folder: {settings?.defaultWorkingDir}/{newSessionName ? newSessionName.toLowerCase().replace(/[^a-z0-9-_]/gi, '-') : 'my-project'}
                  </p>
                )}

                <div className="flex gap-2">
                  <Button
                    type="submit"
                    disabled={
                      createMutation.isPending ||
                      !newSessionName.trim() ||
                      (sessionMode === 'existing' && !selectedFolder)
                    }
                  >
                    {createMutation.isPending ? 'Creating...' : 'Create Session'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowNewSession(false);
                      setSessionMode('new');
                      setSelectedFolder(null);
                      setNewSessionName('');
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      )}

      {/* Folder Browser Dialog */}
      <FolderBrowserDialog
        open={showFolderBrowser}
        onOpenChange={setShowFolderBrowser}
        value={selectedFolder || undefined}
        onChange={(path: string) => {
          setSelectedFolder(path);
          setShowFolderBrowser(false);
          // Auto-fill session name from folder name if empty
          if (!newSessionName) {
            const folderName = path.split('/').pop() || '';
            setNewSessionName(folderName);
          }
        }}
      />

      {/* Sessions Grid */}
      <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {sessions.map((session) => (
          <Card
            key={session.id}
            className="cursor-pointer transition-colors hover:border-primary"
            onClick={() => navigate(`/session/${session.id}`)}
          >
            <CardHeader className="flex flex-row items-start justify-between space-y-0">
              <div className="space-y-1">
                <CardTitle className="text-lg flex items-center gap-2">
                  <MessageSquare className="h-4 w-4" />
                  {session.name}
                </CardTitle>
                <CardDescription className="flex items-center gap-1">
                  <FolderOpen className="h-3 w-3" />
                  {session.workingDirectory}
                </CardDescription>
              </div>
              <div
                className={cn(
                  'h-3 w-3 rounded-full',
                  session.status === 'running' && 'bg-green-500',
                  session.status === 'stopped' && 'bg-gray-500',
                  session.status === 'error' && 'bg-red-500'
                )}
              />
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {new Date(session.updatedAt).toLocaleDateString()}
                </span>
                <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => deleteMutation.mutate(session.id)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}

        {sessions.length === 0 && !showNewSession && (
          <Card className="col-span-full">
            <CardContent className="flex flex-col items-center justify-center py-10">
              <MessageSquare className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground mb-4">No sessions yet</p>
              <Button onClick={() => setShowNewSession(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Create your first session
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
