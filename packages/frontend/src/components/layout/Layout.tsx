import { useMemo, useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Menu, Plus } from 'lucide-react';
import { Sidebar } from './Sidebar';
// UsageLimitsBar removed - limits now in ContextPopover
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useProviderStore } from '@/stores/providerStore';
import { useSessionStore } from '@/stores/sessionStore';
import { api } from '@/services/api';
import type { Session, ApiResponse } from '@claude-code-webui/shared';
import { ProviderLogo } from '@/components/branding/ProviderLogo';
import { CLI_PROVIDER_ICON, CLI_PROVIDER_LABEL, UI_PROVIDER_META } from '@/lib/providers';
import { AuroraBackground } from '@/components/effects/AuroraBackground';
import { CommandPalette } from '@/components/CommandPalette';

export function Layout() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { uiProvider } = useProviderStore();
  const { sessions, activeSessionId, setSessions } = useSessionStore();
  const location = useLocation();
  // Session page manages its own scroll + floating chat bars, so it renders
  // edge-to-edge inside <main>. Every other page uses the default padded scroll.
  const isFullBleed = location.pathname.startsWith('/session/');

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
  const activeMeta = UI_PROVIDER_META[uiProvider];
  const activeSessionProvider = useMemo(() => {
    if (!activeSessionId) return null;
    const session = sessions.find((s) => s.id === activeSessionId);
    return session?.cliProvider || null;
  }, [activeSessionId, sessions]);

  // Close mobile menu on navigation
  const handleNavigation = () => {
    setMobileMenuOpen(false);
  };

  const isPlumProvider = uiProvider === 'plum';
  const isClaudeProvider = uiProvider === 'claude';
  const useAurora = isPlumProvider || isClaudeProvider;

  return (
    <div className="relative flex h-screen bg-background">
      {/* Background effects */}
      {useAurora ? (
        <AuroraBackground intensity={isPlumProvider ? 'vivid' : 'default'} />
      ) : (
        <div className="absolute inset-0 pattern-bg pointer-events-none" />
      )}

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
        <header className="md:hidden flex items-center justify-between h-14 px-4 border-b bg-card/80 backdrop-blur-sm">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMobileMenuOpen(true)}
            className="h-9 w-9"
          >
            <Menu className="h-5 w-5" />
          </Button>

          <Link to="/" className="flex items-center gap-2">
            <ProviderLogo provider={uiProvider} className="h-7 w-7 text-primary" />
            <div className="flex flex-col leading-tight">
              <span className="font-semibold text-sm">{activeMeta.productName}</span>
              {activeSessionProvider && (
                <span className="ui-pill text-[10px]">
                  <span className="font-semibold">
                    {CLI_PROVIDER_ICON[activeSessionProvider] || ''}
                  </span>
                  <span>{CLI_PROVIDER_LABEL[activeSessionProvider] || activeSessionProvider}</span>
                </span>
              )}
            </div>
          </Link>

          <Button variant="ghost" size="icon" asChild className="h-9 w-9">
            <Link to="/?new=true">
              <Plus className="h-5 w-5" />
            </Link>
          </Button>
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
