import { useEffect, useMemo, useState } from 'react';
import { Outlet, Link } from 'react-router-dom';
import { Menu, Plus, AlertTriangle } from 'lucide-react';
import { Sidebar } from './Sidebar';
// UsageLimitsBar removed - limits now in ContextPopover
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useProviderStore } from '@/stores/providerStore';
import { useSessionStore } from '@/stores/sessionStore';
import { ProviderLogo } from '@/components/branding/ProviderLogo';
import { CLI_PROVIDER_ICON, CLI_PROVIDER_LABEL, UI_PROVIDER_META } from '@/lib/providers';
import { PlumBackground } from '@/components/effects/PlumBackground';

export function Layout() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isRepairBot, setIsRepairBot] = useState(false);
  const { uiProvider } = useProviderStore();
  const { sessions, activeSessionId } = useSessionStore();
  const activeMeta = UI_PROVIDER_META[uiProvider];
  const activeSessionProvider = useMemo(() => {
    if (!activeSessionId) return null;
    const session = sessions.find((s) => s.id === activeSessionId);
    return session?.cliProvider || null;
  }, [activeSessionId, sessions]);

  useEffect(() => {
    fetch('/api/instance-info')
      .then((r) => r.json())
      .then((data) => setIsRepairBot(!!data.repairBotMode))
      .catch(() => {});
  }, []);

  // Close mobile menu on navigation
  const handleNavigation = () => {
    setMobileMenuOpen(false);
  };

  const isPlumProvider = uiProvider === 'plum';

  return (
    <div className={`relative flex h-screen bg-background ${isRepairBot ? 'pt-8' : ''}`}>
      {/* Background effects */}
      {isPlumProvider ? (
        <PlumBackground enableCursorGlow />
      ) : (
        <div className="absolute inset-0 pattern-bg pointer-events-none" />
      )}

      {/* Repair Bot Banner */}
      {isRepairBot && (
        <div className="absolute top-0 left-0 right-0 z-50 bg-amber-600 text-white text-center py-1.5 px-4 text-sm font-semibold flex items-center justify-center gap-2 shadow-md">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          EMERGENCY REPAIR WEBUI
          <AlertTriangle className="h-4 w-4 shrink-0" />
        </div>
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

          <Button
            variant="ghost"
            size="icon"
            asChild
            className="h-9 w-9"
          >
            <Link to="/?new=true">
              <Plus className="h-5 w-5" />
            </Link>
          </Button>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-auto p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
