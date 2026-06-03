import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  MessageSquare,
  Settings,
  Plus,
  FolderOpen,
  LogOut,
  User,
  Star,
  BarChart3,
  Shield,
  Search,
  X,
  MoreHorizontal,
  Pencil,
  Trash2,
  ArrowDownAZ,
  ArrowUpDown,
  Clock,
  CalendarPlus,
  Folder,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSessionStore } from '@/stores/sessionStore';
import { useAuthStore } from '@/stores/authStore';
import { useProviderStore } from '@/stores/providerStore';
import { useCategoryStore } from '@/stores/categoryStore';
import { ProviderLogo } from '@/components/branding/ProviderLogo';
import { CLI_PROVIDER_LABEL, UI_PROVIDER_META, toUiProvider } from '@/lib/providers';
import { api, ApiError } from '@/services/api';
import { useToast } from '@/hooks/use-toast';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import type { Session } from '@claude-code-webui/shared';

const baseNavItems = [
  { icon: LayoutDashboard, label: 'Dashboard', path: '/' },
  { icon: BarChart3, label: 'Analytics', path: '/analytics' },
  { icon: Settings, label: 'Settings', path: '/settings' },
];

const adminNavItem = {
  icon: Shield,
  label: 'Admin',
  path: '/settings?tab=admin&adminTab=overview',
};

type SortMode = 'updated' | 'created' | 'name' | 'starred';

const SORT_OPTIONS: { value: SortMode; label: string; icon: typeof Clock }[] = [
  { value: 'updated', label: 'Recently active', icon: Clock },
  { value: 'created', label: 'Newest', icon: CalendarPlus },
  { value: 'name', label: 'Name (A-Z)', icon: ArrowDownAZ },
  { value: 'starred', label: 'Starred first', icon: Star },
];

const COLOR_VALUES: Record<string, string> = {
  blue: '#3b82f6',
  green: '#22c55e',
  purple: '#a855f7',
  orange: '#f97316',
  pink: '#ec4899',
  yellow: '#eab308',
  red: '#ef4444',
  teal: '#14b8a6',
};

interface SidebarProps {
  onNavigate?: () => void;
  mobile?: boolean;
}

export function Sidebar({ onNavigate, mobile }: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { sessions, updateSession, removeSession } = useSessionStore();
  const { user, logout } = useAuthStore();
  const { uiProvider } = useProviderStore();
  const { categories, fetchCategories } = useCategoryStore();
  const activeMeta = UI_PROVIDER_META[uiProvider];

  const [collapsed, setCollapsed] = useState(false);
  const [showStarredOnly, setShowStarredOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('updated');
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  // On mobile, never collapse (full width in sheet)
  const isCollapsed = mobile ? false : collapsed;

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  const activeMatch = location.pathname.match(/^\/session\/([^/]+)/);
  const activeId = activeMatch ? activeMatch[1] : null;
  const settingsTab = useMemo(
    () => new URLSearchParams(location.search).get('tab'),
    [location.search]
  );
  const isAdminSettingsTab =
    settingsTab === 'admin' ||
    settingsTab === 'admin-overview' ||
    settingsTab === 'admin-users' ||
    settingsTab === 'admin-audit-log';

  const filteredSessions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = sessions;

    if (showStarredOnly) list = list.filter((s) => s.starred);
    if (categoryFilter) list = list.filter((s) => s.category === categoryFilter);
    if (q) {
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.workingDirectory.toLowerCase().includes(q) ||
          (s.lastMessage ?? '').toLowerCase().includes(q)
      );
    }

    const sorted = [...list];
    switch (sortMode) {
      case 'name':
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'created':
        sorted.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
        break;
      case 'starred':
        sorted.sort((a, b) => {
          if (a.starred !== b.starred) return a.starred ? -1 : 1;
          return (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '');
        });
        break;
      case 'updated':
      default:
        sorted.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
        break;
    }
    return sorted;
  }, [sessions, showStarredOnly, categoryFilter, searchQuery, sortMode]);

  const starredCount = useMemo(() => sessions.filter((s) => s.starred).length, [sessions]);

  const handleLinkClick = () => {
    if (onNavigate) onNavigate();
  };

  const startRename = (session: Session) => {
    setEditingId(session.id);
    setEditName(session.name);
  };

  const cancelRename = () => {
    setEditingId(null);
    setEditName('');
  };

  const commitRename = async (id: string) => {
    const trimmed = editName.trim();
    if (!trimmed) {
      cancelRename();
      return;
    }
    const original = sessions.find((s) => s.id === id);
    if (original && original.name === trimmed) {
      cancelRename();
      return;
    }
    try {
      await api.put(`/api/sessions/${id}`, { name: trimmed });
      updateSession(id, { name: trimmed });
      toast({ title: 'Session renamed' });
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Rename failed';
      toast({ title: 'Rename failed', description: msg, variant: 'destructive' });
    } finally {
      cancelRename();
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete session "${name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/api/sessions/${id}`);
      removeSession(id);
      toast({ title: 'Session deleted' });
      if (activeId === id) navigate('/');
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Delete failed';
      toast({ title: 'Delete failed', description: msg, variant: 'destructive' });
    }
  };

  const handleToggleStar = async (id: string, currentlyStarred: boolean) => {
    try {
      await api.patch(`/api/sessions/${id}/star`, { starred: !currentlyStarred });
      updateSession(id, { starred: !currentlyStarred });
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Failed';
      toast({ title: 'Failed to update star', description: msg, variant: 'destructive' });
    }
  };

  const handleAssignCategory = async (id: string, categoryId: string | null) => {
    try {
      await api.patch(`/api/sessions/${id}/category`, { categoryId });
      updateSession(id, { category: categoryId });
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Failed';
      toast({ title: 'Failed to update category', description: msg, variant: 'destructive' });
    }
  };

  const handleRenameKey = (e: KeyboardEvent<HTMLInputElement>, id: string) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRename(id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelRename();
    }
  };

  return (
    <div
      className={cn(
        'flex flex-col h-full bg-card/50 backdrop-blur-sm transition-all duration-300',
        mobile ? 'w-full' : 'border-r',
        !mobile && (isCollapsed ? 'w-16' : 'w-64')
      )}
    >
      {/* Logo */}
      <div
        className={cn(
          'flex items-center border-b transition-all duration-300',
          isCollapsed ? 'h-14 justify-center px-2' : 'h-14 px-4'
        )}
      >
        {mobile ? (
          <Link to="/" onClick={handleLinkClick} className="flex items-center gap-3">
            <ProviderLogo provider={uiProvider} className="h-7 w-7 text-primary" />
            <span className="text-sm font-semibold text-foreground">
              {activeMeta.productName}{' '}
              <span className="text-muted-foreground font-normal">{activeMeta.tagline}</span>
            </span>
          </Link>
        ) : (
          <button
            onClick={() => setCollapsed(!isCollapsed)}
            className={cn(
              'flex items-center gap-3 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer',
              isCollapsed ? 'p-1.5' : ''
            )}
            title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <ProviderLogo provider={uiProvider} className="h-7 w-7 text-primary" />
            {!isCollapsed && (
              <span className="text-sm font-semibold text-foreground">
                {activeMeta.productName}{' '}
                <span className="text-muted-foreground font-normal">{activeMeta.tagline}</span>
              </span>
            )}
          </button>
        )}
      </div>

      <nav className="flex-1 flex flex-col min-h-0 p-2 overflow-hidden">
        {/* Top nav */}
        <div className="space-y-1 shrink-0">
          {(user?.role === 'admin' ? [...baseNavItems, adminNavItem] : baseNavItems).map((item) => {
            const Icon = item.icon;
            const isActive = item.path.startsWith('/settings?tab=admin')
              ? location.pathname.startsWith('/admin') ||
                (location.pathname === '/settings' && isAdminSettingsTab)
              : item.path === '/settings'
                ? location.pathname === '/settings' && !isAdminSettingsTab
                : location.pathname === item.path;

            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={handleLinkClick}
                title={isCollapsed ? item.label : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-all duration-200',
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  isCollapsed && 'justify-center px-2'
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!isCollapsed && item.label}
              </Link>
            );
          })}
        </div>

        {/* Sessions section */}
        <div className="pt-3 flex flex-col flex-1 min-h-0">
          <div
            className={cn(
              'flex items-center px-3 py-1.5 shrink-0',
              isCollapsed ? 'justify-center' : 'justify-between'
            )}
          >
            {!isCollapsed && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Sessions
                </span>
                {starredCount > 0 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      'h-5 w-5 rounded-md',
                      showStarredOnly && 'bg-amber-500/10 text-amber-500'
                    )}
                    onClick={() => setShowStarredOnly(!showStarredOnly)}
                    title={showStarredOnly ? 'Show all sessions' : 'Show starred only'}
                  >
                    <Star className={cn('h-3 w-3', showStarredOnly && 'fill-amber-500')} />
                  </Button>
                )}
              </div>
            )}
            <div className="flex items-center gap-0.5">
              {!isCollapsed && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 rounded-lg"
                      title="Sort sessions"
                    >
                      <ArrowUpDown className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {SORT_OPTIONS.map((opt) => {
                      const Icon = opt.icon;
                      return (
                        <DropdownMenuItem
                          key={opt.value}
                          onClick={() => setSortMode(opt.value)}
                          className="cursor-pointer"
                        >
                          <Icon className="mr-2 h-4 w-4" />
                          <span className="flex-1">{opt.label}</span>
                          {sortMode === opt.value && <span className="text-primary">•</span>}
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 rounded-lg"
                asChild
                title="New Session"
              >
                <Link to="/?new=true" onClick={handleLinkClick}>
                  <Plus className="h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
          </div>

          {/* Search + Category filter (only when expanded) */}
          {!isCollapsed && (
            <div className="px-2 pb-1 space-y-1.5 shrink-0">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search sessions..."
                  className="h-7 pl-7 pr-7 text-xs rounded-lg"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 h-4 w-4 rounded-sm hover:bg-muted flex items-center justify-center"
                    title="Clear search"
                  >
                    <X className="h-3 w-3 text-muted-foreground" />
                  </button>
                )}
              </div>

              {categories.length > 0 && (
                <div className="flex items-center gap-1 overflow-x-auto scrollbar-none">
                  <button
                    onClick={() => setCategoryFilter(null)}
                    className={cn(
                      'shrink-0 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium border transition-colors',
                      categoryFilter === null
                        ? 'bg-primary/15 text-foreground border-primary/30'
                        : 'bg-muted/40 text-muted-foreground border-transparent hover:bg-muted'
                    )}
                  >
                    <Folder className="h-2.5 w-2.5" />
                    All
                  </button>
                  {categories.map((cat) => {
                    const isActive = categoryFilter === cat.id;
                    const colorValue = COLOR_VALUES[cat.color] ?? cat.color;
                    return (
                      <button
                        key={cat.id}
                        onClick={() => setCategoryFilter(isActive ? null : cat.id)}
                        className={cn(
                          'shrink-0 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium border transition-colors',
                          isActive
                            ? 'text-foreground border-foreground/30'
                            : 'bg-muted/40 text-muted-foreground border-transparent hover:bg-muted'
                        )}
                        style={isActive ? { backgroundColor: `${colorValue}20` } : undefined}
                        title={cat.name}
                      >
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: colorValue }}
                        />
                        <span className="truncate max-w-[8ch]">{cat.name}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Session list — scrollable, no slice */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="space-y-0.5 mt-1">
              {filteredSessions.length === 0
                ? !isCollapsed && (
                    <div className="px-3 py-3 text-center">
                      <p className="text-xs text-muted-foreground/70">
                        {searchQuery
                          ? 'No matches'
                          : showStarredOnly
                            ? 'No starred sessions'
                            : categoryFilter
                              ? 'No sessions in this category'
                              : 'No sessions'}
                      </p>
                      {(showStarredOnly || categoryFilter || searchQuery) && (
                        <Button
                          variant="link"
                          size="sm"
                          className="text-xs mt-1 h-auto p-0"
                          onClick={() => {
                            setShowStarredOnly(false);
                            setCategoryFilter(null);
                            setSearchQuery('');
                          }}
                        >
                          Clear filters
                        </Button>
                      )}
                    </div>
                  )
                : filteredSessions.map((session) => {
                    const isActive = location.pathname === `/session/${session.id}`;
                    const isEditing = editingId === session.id;
                    const sessionCategory = session.category
                      ? categories.find((c) => c.id === session.category)
                      : null;

                    if (isEditing && !isCollapsed) {
                      return (
                        <div
                          key={session.id}
                          className="flex items-center gap-1 px-2 py-1.5 rounded-xl bg-muted/40"
                        >
                          <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <Input
                            autoFocus
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => handleRenameKey(e, session.id)}
                            onBlur={() => commitRename(session.id)}
                            className="h-6 px-1.5 text-xs"
                          />
                        </div>
                      );
                    }

                    return (
                      <div
                        key={session.id}
                        className={cn(
                          'group/session relative flex items-center rounded-xl transition-all duration-200',
                          isActive
                            ? 'bg-primary/15 text-foreground font-medium shadow-[inset_2px_0_0_0_hsl(var(--primary))]'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                        )}
                      >
                        <Link
                          to={`/session/${session.id}`}
                          onClick={handleLinkClick}
                          title={isCollapsed ? session.name : undefined}
                          className={cn(
                            'flex flex-1 items-center gap-2.5 px-3 py-2 text-sm min-w-0',
                            isCollapsed && 'justify-center px-2'
                          )}
                        >
                          <div className="relative shrink-0">
                            <MessageSquare className="h-3.5 w-3.5" />
                            <div
                              className={cn(
                                'absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full border border-card',
                                session.status === 'running' && 'bg-green-500',
                                session.status === 'stopped' && 'bg-gray-400',
                                session.status === 'error' && 'bg-red-500'
                              )}
                            />
                          </div>
                          {!isCollapsed && (
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 truncate text-xs">
                                {session.starred && (
                                  <Star className="h-2.5 w-2.5 text-amber-500 fill-amber-500 shrink-0" />
                                )}
                                {sessionCategory && (
                                  <span
                                    className="h-2 w-2 rounded-full shrink-0"
                                    style={{
                                      backgroundColor:
                                        COLOR_VALUES[sessionCategory.color] ??
                                        sessionCategory.color,
                                    }}
                                    title={sessionCategory.name}
                                  />
                                )}
                                <span className="truncate font-medium">{session.name}</span>
                                {session.cliProvider && (
                                  <span
                                    className="inline-flex h-4 w-4 items-center justify-center rounded bg-muted/60 p-0.5 shrink-0"
                                    title={
                                      CLI_PROVIDER_LABEL[session.cliProvider] || session.cliProvider
                                    }
                                  >
                                    <ProviderLogo
                                      provider={toUiProvider(session.cliProvider)}
                                      className="h-3 w-3"
                                      alt=""
                                    />
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-1 text-[9px] opacity-50">
                                <FolderOpen className="h-2 w-2" />
                                <span className="truncate">
                                  {session.workingDirectory.split('/').pop()}
                                </span>
                              </div>
                            </div>
                          )}
                        </Link>

                        {!isCollapsed && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                className={cn(
                                  'mr-1 h-6 w-6 rounded-md flex items-center justify-center text-muted-foreground transition-opacity',
                                  'opacity-0 group-hover/session:opacity-100 focus:opacity-100 hover:bg-muted-foreground/10',
                                  'data-[state=open]:opacity-100 data-[state=open]:bg-muted-foreground/10'
                                )}
                                onClick={(e) => e.stopPropagation()}
                                title="Session options"
                              >
                                <MoreHorizontal className="h-3.5 w-3.5" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-52">
                              <DropdownMenuItem
                                onClick={() => startRename(session)}
                                className="cursor-pointer"
                              >
                                <Pencil className="mr-2 h-3.5 w-3.5" />
                                Rename
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => handleToggleStar(session.id, session.starred)}
                                className="cursor-pointer"
                              >
                                <Star
                                  className={cn(
                                    'mr-2 h-3.5 w-3.5',
                                    session.starred && 'fill-amber-500 text-amber-500'
                                  )}
                                />
                                {session.starred ? 'Unstar' : 'Star'}
                              </DropdownMenuItem>
                              <DropdownMenuSub>
                                <DropdownMenuSubTrigger className="cursor-pointer">
                                  <Folder className="mr-2 h-3.5 w-3.5" />
                                  Category
                                </DropdownMenuSubTrigger>
                                <DropdownMenuSubContent className="w-48">
                                  <DropdownMenuItem
                                    onClick={() => handleAssignCategory(session.id, null)}
                                    className="cursor-pointer"
                                  >
                                    <span className="mr-2 h-2.5 w-2.5 rounded-full border border-muted-foreground/40" />
                                    None
                                    {!session.category && (
                                      <span className="ml-auto text-primary">•</span>
                                    )}
                                  </DropdownMenuItem>
                                  {categories.length > 0 && <DropdownMenuSeparator />}
                                  {categories.map((cat) => (
                                    <DropdownMenuItem
                                      key={cat.id}
                                      onClick={() => handleAssignCategory(session.id, cat.id)}
                                      className="cursor-pointer"
                                    >
                                      <span
                                        className="mr-2 h-2.5 w-2.5 rounded-full"
                                        style={{
                                          backgroundColor: COLOR_VALUES[cat.color] ?? cat.color,
                                        }}
                                      />
                                      <span className="flex-1 truncate">{cat.name}</span>
                                      {session.category === cat.id && (
                                        <span className="ml-auto text-primary">•</span>
                                      )}
                                    </DropdownMenuItem>
                                  ))}
                                </DropdownMenuSubContent>
                              </DropdownMenuSub>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => handleDelete(session.id, session.name)}
                                className="cursor-pointer text-destructive focus:text-destructive"
                              >
                                <Trash2 className="mr-2 h-3.5 w-3.5" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    );
                  })}
            </div>
          </div>
        </div>
      </nav>

      {/* Account */}
      <div className="p-2 border-t">
        {user && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2 h-auto hover:bg-muted/50 rounded-xl',
                  isCollapsed && 'justify-center px-2'
                )}
              >
                {user.avatarUrl ? (
                  <img
                    src={user.avatarUrl}
                    alt={user.name || 'User'}
                    className="h-7 w-7 rounded-full ring-2 ring-background shrink-0"
                  />
                ) : (
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground shrink-0">
                    <User className="h-3.5 w-3.5" />
                  </div>
                )}
                {!isCollapsed && (
                  <div className="flex-1 text-left min-w-0">
                    <div className="text-xs font-medium truncate">{user.name || 'User'}</div>
                  </div>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align={isCollapsed ? 'center' : 'end'} side="top" className="w-48">
              <DropdownMenuItem asChild>
                <Link
                  to="/settings"
                  onClick={handleLinkClick}
                  className="flex items-center cursor-pointer"
                >
                  <Settings className="mr-2 h-4 w-4" />
                  Settings
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={logout}
                className="text-destructive cursor-pointer focus:text-destructive"
              >
                <LogOut className="mr-2 h-4 w-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}
