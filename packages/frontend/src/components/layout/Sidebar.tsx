import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, MessageSquare, Settings, Plus, FolderOpen, LogOut, User, Star, BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useSessionStore } from '@/stores/sessionStore';
import { useAuthStore } from '@/stores/authStore';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const navItems = [
  { icon: LayoutDashboard, label: 'Dashboard', path: '/' },
  { icon: BarChart3, label: 'Analytics', path: '/analytics' },
];

interface SidebarProps {
  onNavigate?: () => void;
  mobile?: boolean;
}

export function Sidebar({ onNavigate, mobile }: SidebarProps) {
  const location = useLocation();
  const { sessions } = useSessionStore();
  const { user, logout } = useAuthStore();
  const [collapsed, setCollapsed] = useState(false);
  const [showStarredOnly, setShowStarredOnly] = useState(false);

  // On mobile, never collapse (full width in sheet)
  const isCollapsed = mobile ? false : collapsed;

  // Filter sessions based on starred filter
  const filteredSessions = showStarredOnly
    ? sessions.filter(s => s.starred)
    : sessions;

  const starredCount = sessions.filter(s => s.starred).length;

  const handleLinkClick = () => {
    if (onNavigate) {
      onNavigate();
    }
  };

  return (
    <div className={cn(
      "flex flex-col h-full bg-card/50 backdrop-blur-sm transition-all duration-300",
      mobile ? "w-full" : "border-r",
      !mobile && (isCollapsed ? "w-16" : "w-64")
    )}>
      {/* Logo - Click to toggle sidebar (only on desktop) */}
      <div className={cn(
        "flex items-center border-b transition-all duration-300",
        isCollapsed ? "h-16 justify-center px-2" : "h-16 px-4"
      )}>
        {mobile ? (
          <Link
            to="/"
            onClick={handleLinkClick}
            className="flex items-center gap-3 py-2"
          >
            <img
              src="/claude-logo.png"
              alt="Claude"
              className="h-8 w-8 object-contain"
            />
            <div className="text-left">
              <h1 className="text-base font-semibold text-foreground">Claude Code</h1>
              <p className="text-[10px] text-muted-foreground font-medium">WebUI</p>
            </div>
          </Link>
        ) : (
          <button
            onClick={() => setCollapsed(!isCollapsed)}
            className={cn(
              "flex items-center gap-3 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer",
              isCollapsed ? "p-2" : "py-2"
            )}
            title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <img
              src="/claude-logo.png"
              alt="Claude"
              className="h-8 w-8 object-contain"
            />
            {!isCollapsed && (
              <div className="text-left">
                <h1 className="text-base font-semibold text-foreground">Claude Code</h1>
                <p className="text-[10px] text-muted-foreground font-medium">WebUI</p>
              </div>
            )}
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 p-2 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = location.pathname === item.path;

          return (
            <Link
              key={item.path}
              to={item.path}
              onClick={handleLinkClick}
              title={isCollapsed ? item.label : undefined}
              className={cn(
                'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200',
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

        {/* Sessions Section */}
        <div className="pt-4">
          <div className={cn(
            "flex items-center px-3 py-2",
            isCollapsed ? "justify-center" : "justify-between"
          )}>
            {!isCollapsed && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Sessions
                </span>
                {/* Starred filter toggle */}
                {starredCount > 0 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "h-5 w-5 rounded-md",
                      showStarredOnly && "bg-amber-500/10 text-amber-500"
                    )}
                    onClick={() => setShowStarredOnly(!showStarredOnly)}
                    title={showStarredOnly ? "Show all sessions" : "Show starred only"}
                  >
                    <Star className={cn("h-3 w-3", showStarredOnly && "fill-amber-500")} />
                  </Button>
                )}
              </div>
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

          <div className="space-y-1 mt-1">
            {filteredSessions.length === 0 ? (
              !isCollapsed && (
                <div className="px-3 py-4 text-center">
                  <p className="text-xs text-muted-foreground/70">
                    {showStarredOnly ? "No starred sessions" : "No sessions"}
                  </p>
                  {showStarredOnly && sessions.length > 0 && (
                    <Button
                      variant="link"
                      size="sm"
                      className="text-xs mt-1 h-auto p-0"
                      onClick={() => setShowStarredOnly(false)}
                    >
                      Show all sessions
                    </Button>
                  )}
                </div>
              )
            ) : (
              filteredSessions.slice(0, mobile ? 20 : 10).map((session) => {
                const isActive = location.pathname === `/session/${session.id}`;

                return (
                  <Link
                    key={session.id}
                    to={`/session/${session.id}`}
                    onClick={handleLinkClick}
                    title={isCollapsed ? session.name : undefined}
                    className={cn(
                      'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all duration-200',
                      isActive
                        ? 'bg-primary/10 text-foreground'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      isCollapsed && 'justify-center px-2'
                    )}
                  >
                    <div className="relative shrink-0">
                      <MessageSquare className="h-4 w-4" />
                      <div
                        className={cn(
                          'absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border-2 border-card',
                          session.status === 'running' && 'bg-green-500',
                          session.status === 'stopped' && 'bg-gray-400',
                          session.status === 'error' && 'bg-red-500'
                        )}
                      />
                    </div>
                    {!isCollapsed && (
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 truncate font-medium text-sm">
                          {session.starred && <Star className="h-3 w-3 text-amber-500 fill-amber-500 shrink-0" />}
                          <span className="truncate">{session.name}</span>
                        </div>
                        <div className="flex items-center gap-1 text-[10px] opacity-60">
                          <FolderOpen className="h-2.5 w-2.5" />
                          <span className="truncate">{session.workingDirectory.split('/').pop()}</span>
                        </div>
                      </div>
                    )}
                  </Link>
                );
              })
            )}
          </div>
        </div>
      </nav>

      {/* Account Section */}
      <div className="p-2 border-t">
        {user && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 h-auto hover:bg-muted/50 rounded-xl",
                  isCollapsed && "justify-center px-2"
                )}
              >
                {user.avatarUrl ? (
                  <img
                    src={user.avatarUrl}
                    alt={user.name || 'User'}
                    className="h-8 w-8 rounded-full ring-2 ring-background shrink-0"
                  />
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground shrink-0">
                    <User className="h-4 w-4" />
                  </div>
                )}
                {!isCollapsed && (
                  <div className="flex-1 text-left min-w-0">
                    <div className="text-sm font-medium truncate">{user.name || 'User'}</div>
                  </div>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align={isCollapsed ? "center" : "end"} side="top" className="w-56">
              <DropdownMenuItem asChild>
                <Link to="/settings" onClick={handleLinkClick} className="flex items-center cursor-pointer">
                  <Settings className="mr-2 h-4 w-4" />
                  Settings
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={logout} className="text-destructive cursor-pointer focus:text-destructive">
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
