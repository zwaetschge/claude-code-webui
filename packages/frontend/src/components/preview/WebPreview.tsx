import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ExternalLink,
  RefreshCw,
  Plus,
  Trash2,
  Server,
  Zap,
  Globe,
  Database,
  Settings as SettingsIcon,
  AlertTriangle,
  Play,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface WebPreviewProps {
  className?: string;
}

interface SavedPort {
  port: number;
  name: string;
  icon: 'globe' | 'server' | 'zap' | 'database' | 'settings';
  path?: string;
}

interface PreviewConfig {
  enabled: boolean;
  hostname: string | null;
}

const DEFAULT_PORTS: SavedPort[] = [
  { port: 3000, name: 'Dev Server', icon: 'server' },
  { port: 5173, name: 'Vite', icon: 'zap' },
  { port: 8080, name: 'App', icon: 'globe' },
  { port: 4000, name: 'API', icon: 'database' },
];

const ICON_MAP = {
  globe: Globe,
  server: Server,
  zap: Zap,
  database: Database,
  settings: SettingsIcon,
};

const STORAGE_KEY = 'webpreview_ports_v2';

function loadPorts(): SavedPort[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as SavedPort[];
      if (Array.isArray(parsed) && parsed.every((p) => typeof p.port === 'number')) {
        return parsed;
      }
    }
  } catch {
    // ignore
  }
  return DEFAULT_PORTS;
}

function savePorts(ports: SavedPort[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ports));
}

function buildPreviewUrl(hostname: string, path = '/'): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `https://${hostname}${normalizedPath === '/' ? '/' : normalizedPath}`;
}

function buildInitUrl(hostname: string, port: number): string {
  return `https://${hostname}/__preview-init?port=${port}`;
}

export function WebPreview({ className }: WebPreviewProps) {
  const [config, setConfig] = useState<PreviewConfig | null>(null);
  const [ports, setPorts] = useState<SavedPort[]>(loadPorts);
  const [activePort, setActivePort] = useState<number | null>(null);
  const [iframeKey, setIframeKey] = useState(0);
  const [isAdding, setIsAdding] = useState(false);
  const [newPort, setNewPort] = useState('');
  const [newName, setNewName] = useState('');
  const [configError, setConfigError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    savePorts(ports);
  }, [ports]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/preview/config', { credentials: 'include' })
      .then((r) => r.json())
      .then((data: PreviewConfig) => {
        if (!cancelled) setConfig(data);
      })
      .catch((err: Error) => {
        if (!cancelled) setConfigError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const activate = useCallback(
    (port: number) => {
      if (!config?.enabled || !config.hostname) return;
      setActivePort(port);
      setIframeKey((k) => k + 1);
    },
    [config]
  );

  const refresh = useCallback(() => {
    setIframeKey((k) => k + 1);
  }, []);

  const openExternal = useCallback(() => {
    if (!config?.hostname || activePort === null) return;
    window.open(buildPreviewUrl(config.hostname), '_blank', 'noopener,noreferrer');
  }, [config, activePort]);

  const addPort = useCallback(() => {
    const parsed = parseInt(newPort, 10);
    if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65535) return;
    const name = newName.trim() || `Port ${parsed}`;
    setPorts((prev) => {
      if (prev.some((p) => p.port === parsed)) return prev;
      return [...prev, { port: parsed, name, icon: 'globe' }];
    });
    setNewPort('');
    setNewName('');
    setIsAdding(false);
  }, [newPort, newName]);

  const removePort = useCallback(
    (port: number) => {
      setPorts((prev) => prev.filter((p) => p.port !== port));
      if (activePort === port) setActivePort(null);
    },
    [activePort]
  );

  const iframeSrc = useMemo(() => {
    if (!config?.hostname || activePort === null) return null;
    // On every activation cycle, hit __preview-init to (re)set the cookie,
    // then it redirects to /. This guarantees the cookie is fresh when we
    // start browsing.
    return buildInitUrl(config.hostname, activePort);
  }, [config, activePort]);

  if (configError) {
    return (
      <PreviewError title="Preview service unreachable" body={configError} className={className} />
    );
  }

  if (!config) {
    return <PreviewLoading className={className} />;
  }

  if (!config.enabled || !config.hostname) {
    return (
      <PreviewError
        title="Preview not configured"
        body="Set PREVIEW_HOSTNAME in the backend environment and add a Traefik router for that subdomain."
        className={className}
      />
    );
  }

  return (
    <div
      className={cn('flex h-full flex-col bg-card overflow-hidden rounded-lg border', className)}
    >
      <div className="shrink-0 flex items-center gap-2 border-b bg-muted/40 px-3 py-2">
        <Globe className="h-4 w-4 text-muted-foreground" />
        <div className="flex-1 min-w-0 text-sm font-mono truncate text-muted-foreground">
          {activePort !== null
            ? `https://${config.hostname}  →  localhost:${activePort}`
            : 'No port selected'}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={refresh}
          disabled={activePort === null}
          title="Reload preview"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={openExternal}
          disabled={activePort === null}
          title="Open in new tab"
        >
          <ExternalLink className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex flex-1 min-h-0">
        <aside className="shrink-0 w-56 border-r bg-muted/20 flex flex-col">
          <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Ports
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setIsAdding((s) => !s)}
              title="Add port"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>

          {isAdding && (
            <div className="shrink-0 border-b bg-background/60 p-2 space-y-2">
              <Input
                type="number"
                min={1024}
                max={65535}
                value={newPort}
                onChange={(e) => setNewPort(e.target.value)}
                placeholder="3000"
                className="h-8 text-sm"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addPort();
                  if (e.key === 'Escape') {
                    setIsAdding(false);
                    setNewPort('');
                    setNewName('');
                  }
                }}
              />
              <Input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Name (optional)"
                className="h-8 text-sm"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addPort();
                }}
              />
              <div className="flex gap-1">
                <Button
                  size="sm"
                  className="h-7 flex-1"
                  onClick={addPort}
                  disabled={!newPort.trim()}
                >
                  Add
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7"
                  onClick={() => {
                    setIsAdding(false);
                    setNewPort('');
                    setNewName('');
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          <ul className="flex-1 overflow-auto p-2 space-y-1">
            {ports.map((p) => {
              const Icon = ICON_MAP[p.icon];
              const isActive = activePort === p.port;
              return (
                <li key={p.port}>
                  <div
                    className={cn(
                      'group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer transition-colors',
                      isActive ? 'bg-primary/15 text-primary' : 'hover:bg-muted/60 text-foreground'
                    )}
                    onClick={() => activate(p.port)}
                  >
                    <Icon
                      className={cn(
                        'h-4 w-4 shrink-0',
                        isActive ? 'text-primary' : 'text-muted-foreground'
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{p.name}</div>
                      <div className="text-[10px] font-mono text-muted-foreground truncate">
                        :{p.port}
                      </div>
                    </div>
                    {isActive ? (
                      <Play className="h-3 w-3 text-primary shrink-0" />
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={(e) => {
                          e.stopPropagation();
                          removePort(p.port);
                        }}
                        title="Remove"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
            {ports.length === 0 && (
              <li className="px-2 py-4 text-center text-xs text-muted-foreground">
                No saved ports
              </li>
            )}
          </ul>
        </aside>

        <main className="flex-1 min-w-0 relative bg-background">
          {iframeSrc ? (
            <iframe
              ref={iframeRef}
              key={iframeKey}
              src={iframeSrc}
              className="h-full w-full border-0"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
              title="Preview"
            />
          ) : (
            <div className="h-full w-full flex flex-col items-center justify-center gap-3 text-muted-foreground">
              <Globe className="h-10 w-10 opacity-40" />
              <p className="text-sm">Pick a port on the left to preview the running dev server.</p>
              <p className="text-xs">
                Served over <code className="font-mono">{config.hostname}</code> with Authelia SSO.
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function PreviewLoading({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'flex h-full items-center justify-center text-muted-foreground text-sm',
        className
      )}
    >
      Loading preview…
    </div>
  );
}

function PreviewError({
  title,
  body,
  className,
}: {
  title: string;
  body: string;
  className?: string;
}) {
  return (
    <div className={cn('flex h-full items-center justify-center p-6', className)}>
      <div className="max-w-md rounded-lg border bg-card p-6 text-center">
        <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-amber-500" />
        <h3 className="font-semibold mb-1">{title}</h3>
        <p className="text-sm text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

export default WebPreview;
