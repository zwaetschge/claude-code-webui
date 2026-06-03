import { useEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  BarChart3,
  Settings,
  Plus,
  MessageSquare,
  Square,
  RotateCcw,
  Brain,
  CheckCircle,
  Hand,
  Zap,
  Star,
  FolderKey,
} from 'lucide-react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command';
import { useCommandPaletteStore } from '@/stores/commandPaletteStore';
import { useSessionStore } from '@/stores/sessionStore';
import { socketService } from '@/services/socket';
import { ProviderLogo } from '@/components/branding/ProviderLogo';
import { toUiProvider } from '@/lib/providers';
import type { SessionMode } from '@claude-code-webui/shared';

export function CommandPalette() {
  const { open, setOpen } = useCommandPaletteStore();
  const navigate = useNavigate();
  const location = useLocation();
  const sessions = useSessionStore((s) => s.sessions);

  const sessionMatch = location.pathname.match(/^\/session\/([^/]+)/);
  const activeSessionId = sessionMatch ? sessionMatch[1] : null;
  const activeSession = activeSessionId ? sessions.find((s) => s.id === activeSessionId) : null;

  // Top 10 most recent sessions
  const recentSessions = useMemo(() => sessions.slice(0, 10), [sessions]);

  // Global hotkey Cmd/Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        useCommandPaletteStore.getState().toggle();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const run = (fn: () => void) => {
    setOpen(false);
    // Defer a tick so the dialog close animation doesn't race the action
    setTimeout(fn, 0);
  };

  const setMode = (mode: SessionMode) => {
    if (!activeSessionId) return;
    socketService.setSessionMode(activeSessionId, mode);
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Navigation">
          <CommandItem onSelect={() => run(() => navigate('/'))}>
            <LayoutDashboard />
            <span>Dashboard</span>
          </CommandItem>
          <CommandItem onSelect={() => run(() => navigate('/analytics'))}>
            <BarChart3 />
            <span>Analytics</span>
          </CommandItem>
          <CommandItem onSelect={() => run(() => navigate('/settings'))}>
            <Settings />
            <span>Settings</span>
          </CommandItem>
          <CommandItem onSelect={() => run(() => navigate('/?new=true'))}>
            <Plus />
            <span>New Session</span>
            <CommandShortcut>N</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        {activeSession && (
          <>
            <CommandSeparator />
            <CommandGroup heading={`Active Session: ${activeSession.name}`}>
              <CommandItem
                onSelect={() => run(() => socketService.interruptSession(activeSessionId!))}
              >
                <Square />
                <span>Interrupt</span>
                <CommandShortcut>^C</CommandShortcut>
              </CommandItem>
              <CommandItem
                onSelect={() => run(() => socketService.restartSession(activeSessionId!))}
              >
                <RotateCcw />
                <span>Restart Session</span>
              </CommandItem>
              <CommandItem onSelect={() => run(() => setMode('planning'))}>
                <Brain className="text-blue-500" />
                <span>Mode: Plan</span>
              </CommandItem>
              <CommandItem onSelect={() => run(() => setMode('auto-accept'))}>
                <CheckCircle className="text-green-500" />
                <span>Mode: Auto</span>
              </CommandItem>
              <CommandItem onSelect={() => run(() => setMode('manual'))}>
                <Hand className="text-amber-500" />
                <span>Mode: Manual</span>
              </CommandItem>
              <CommandItem onSelect={() => run(() => setMode('danger'))}>
                <Zap className="text-red-500" />
                <span>Mode: YOLO</span>
              </CommandItem>
              <CommandItem
                onSelect={() =>
                  run(() => {
                    // Dispatch a custom event so SessionPage can open the allowed directories dialog
                    window.dispatchEvent(new CustomEvent('command:open-allowed-dirs'));
                  })
                }
              >
                <FolderKey />
                <span>Manage Allowed Directories</span>
              </CommandItem>
            </CommandGroup>
          </>
        )}

        {recentSessions.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Recent Sessions">
              {recentSessions.map((session) => (
                <CommandItem
                  key={session.id}
                  value={`session-${session.id} ${session.name} ${session.workingDirectory}`}
                  onSelect={() => run(() => navigate(`/session/${session.id}`))}
                >
                  <MessageSquare />
                  <span className="flex-1 truncate">{session.name}</span>
                  {session.starred && <Star className="h-3 w-3 text-amber-500 fill-amber-500" />}
                  <ProviderLogo
                    provider={toUiProvider(session.cliProvider)}
                    className="h-3.5 w-3.5 shrink-0 opacity-75"
                    alt=""
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
