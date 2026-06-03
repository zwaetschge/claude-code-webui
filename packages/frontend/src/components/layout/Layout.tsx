import { useEffect, useMemo, useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Menu } from 'lucide-react';
import { Sidebar } from './Sidebar';
// UsageLimitsBar removed - limits now in ContextPopover
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useProviderStore } from '@/stores/providerStore';
import { useSessionStore } from '@/stores/sessionStore';
import { api } from '@/services/api';
import type { Session, ApiResponse } from '@claude-code-webui/shared';
import { ProviderLogo } from '@/components/branding/ProviderLogo';
import { UI_PROVIDER_META, toUiProvider } from '@/lib/providers';
import { AuroraBackground } from '@/components/effects/AuroraBackground';
import { CommandPalette } from '@/components/CommandPalette';
import { ContextPopover } from '@/components/session/SessionControls';

export function Layout() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { uiProvider } = useProviderStore();
  const { sessions, activeSessionId, setSessions, usage } = useSessionStore();
  const location = useLocation();
  // Session page manages its own scroll + floating chat bars, so it renders
  // edge-to-edge inside <main>. Every other page uses the default padded scroll.
  const isFullBleed = location.pathname.startsWith('/session/');
  const routeSessionId = location.pathname.match(/^\/session\/([^/]+)/)?.[1] ?? null;

  // Populate session list on every authenticated page so the sidebar works
  // when a user lands directly on a session URL (bypassing the dashboard).
  useQuery({
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

  const { data: routeSession } = useQuery({
    queryKey: ['session', routeSessionId],
    queryFn: async () => {
      if (!routeSessionId) return null;
      const response = await api.get<ApiResponse<Session>>(`/api/sessions/${routeSessionId}`);
      return response.data.success && response.data.data ? response.data.data : null;
    },
    enabled: !!routeSessionId,
  });

  const activeMeta = UI_PROVIDER_META[uiProvider];
  const activeSession = useMemo(() => {
    const sessionId = routeSessionId ?? activeSessionId;
    if (!sessionId) return null;
    return routeSession ?? sessions.find((s) => s.id === sessionId) ?? null;
  }, [activeSessionId, routeSession, routeSessionId, sessions]);
  const headerProvider = activeSession?.cliProvider
    ? toUiProvider(activeSession.cliProvider)
    : uiProvider;
  const headerTitle = activeSession?.name ?? activeMeta.productName;
  const headerUsageSessionId = routeSessionId ?? activeSessionId;
  const headerUsage = headerUsageSessionId ? usage[headerUsageSessionId] : undefined;

  // Close mobile menu on navigation
  const handleNavigation = () => {
    setMobileMenuOpen(false);
  };

  const auroraIntensity =
    uiProvider === 'codex'
      ? 'subtle'
      : uiProvider === 'plum' || uiProvider === 'opencode'
        ? 'vivid'
        : 'default';

  useEffect(() => {
    document.title = activeSession
      ? `${activeSession.name} · Plum Code`
      : `${activeMeta.productName} WebUI`;
  }, [activeMeta.productName, activeSession]);

  return (
    <div className="relative flex h-screen bg-background">
      {/* Background effects */}
      <AuroraBackground intensity={auroraIntensity} />
      <div className="absolute inset-0 pattern-bg pointer-events-none" />

      {/* Desktop Sidebar */}
      <div className="hidden md:block relative z-10">
        <Sidebar />
      </div>

      {/* Mobile Sheet */}
      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <SheetContent side="left" className="p-0 w-72">
          <Sidebar onNavigate={handleNavigation} mobile />
        </SheetContent>
      </Sheet>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden relative z-10">
        {/* Usage Limits Bar - shown on session pages */}

        {/* Mobile Header */}
        <header className="md:hidden flex h-12 items-center gap-2 border-b border-border/70 bg-background/95 px-2 backdrop-blur-md">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMobileMenuOpen(true)}
            className="h-9 w-9"
            title="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </Button>

          <Link
            to={activeSession ? `/session/${activeSession.id}` : '/'}
            className="flex min-w-0 flex-1 items-center gap-2 px-1"
            title={headerTitle}
          >
            <ProviderLogo provider={headerProvider} className="h-6 w-6 shrink-0 object-contain" />
            <span className="truncate text-sm font-semibold leading-tight text-foreground">
              {headerTitle}
            </span>
          </Link>

          {isFullBleed && headerUsage && headerUsage.contextWindow > 0 && (
            <div className="mobile-header-context shrink-0">
              <ContextPopover usage={headerUsage} />
            </div>
          )}
        </header>

        {/* Page Content */}
        <main
          className={
            isFullBleed ? 'flex-1 min-h-0 overflow-hidden' : 'flex-1 overflow-auto p-4 md:p-6'
          }
        >
          <Outlet />
        </main>
      </div>

      {/* Global command palette (Cmd/Ctrl+K) */}
      <CommandPalette />
    </div>
  );
}
