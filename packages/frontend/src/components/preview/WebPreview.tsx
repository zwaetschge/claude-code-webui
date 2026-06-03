import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FolderTree,
  Globe,
  Loader2,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FileIcon } from '@/components/file-tree/file-icons';
import { api } from '@/services/api';
import { cn } from '@/lib/utils';
import type { ApiResponse, DirectoryContents, FileInfo } from '@claude-code-webui/shared';

interface WebPreviewProps {
  sessionId?: string;
  workingDirectory?: string;
  className?: string;
}

interface PreviewConfig {
  enabled: boolean;
  hostname: string | null;
}

interface StaticPreviewTarget {
  projectPath: string;
  filePath: string;
  relativePath: string;
  name: string;
  urlPath: string;
  size: number;
  modifiedAt: string;
}

interface TreeState {
  expanded: Record<string, boolean>;
  loading: Record<string, boolean>;
  children: Record<string, FileInfo[]>;
  errors: Record<string, string | null>;
}

const ACTIVE_FILE_PREFIX = 'webpreview_active_file_v1';

function scopedKey(prefix: string, sessionId?: string, workingDirectory?: string): string {
  return `${prefix}:${sessionId || workingDirectory || 'global'}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Request failed';
}

function isHtmlFile(filename: string): boolean {
  return /\.html?$/i.test(filename);
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
  return `${Math.round(bytes / 104_857.6) / 10} MB`;
}

function encodePreviewPath(relativePath: string): string {
  return `/${relativePath
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/')}`;
}

function previewOrigin(hostname: string): string {
  const protocol = window.location.protocol === 'https:' ? 'https' : 'http';
  return `${protocol}://${hostname}`;
}

function buildStaticUrl(hostname: string, target: StaticPreviewTarget): string {
  return `${previewOrigin(hostname)}${encodePreviewPath(target.relativePath)}`;
}

function buildStaticInitUrl(hostname: string, target: StaticPreviewTarget): string {
  return `${previewOrigin(hostname)}${target.urlPath}`;
}

function sortFiles(files: FileInfo[]): FileInfo[] {
  return [...files].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

export function WebPreview({ sessionId, workingDirectory, className }: WebPreviewProps) {
  const activeFileStorageKey = useMemo(
    () => scopedKey(ACTIVE_FILE_PREFIX, sessionId, workingDirectory),
    [sessionId, workingDirectory]
  );

  const [config, setConfig] = useState<PreviewConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [activeTarget, setActiveTarget] = useState<StaticPreviewTarget | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [openingFile, setOpeningFile] = useState<string | null>(null);
  const [iframeKey, setIframeKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .get<PreviewConfig>('/api/preview/config')
      .then(({ data }) => {
        if (!cancelled) setConfig(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setConfigError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const openHtmlFile = useCallback(
    async (filePath: string, options?: { silent?: boolean }) => {
      if (!workingDirectory) return;

      setOpeningFile(filePath);
      if (!options?.silent) setOpenError(null);
      try {
        const params = new URLSearchParams({
          projectPath: workingDirectory,
          filePath,
        });
        const { data } = await api.get<StaticPreviewTarget>(
          `/api/preview/static-file?${params.toString()}`
        );
        setActiveTarget(data);
        setSelectedFile(data.filePath);
        setOpenError(null);
        setIframeKey((key) => key + 1);
      } catch (err) {
        if (!options?.silent) setOpenError(errorMessage(err));
        setActiveTarget((current) => (current?.filePath === filePath ? null : current));
      } finally {
        setOpeningFile(null);
      }
    },
    [workingDirectory]
  );

  useEffect(() => {
    const storedPath = localStorage.getItem(activeFileStorageKey);
    setSelectedFile(storedPath);
    if (storedPath) {
      void openHtmlFile(storedPath, { silent: true });
      return;
    }
    setActiveTarget(null);
  }, [activeFileStorageKey, openHtmlFile]);

  useEffect(() => {
    if (!activeTarget) {
      localStorage.removeItem(activeFileStorageKey);
      return;
    }
    localStorage.setItem(activeFileStorageKey, activeTarget.filePath);
  }, [activeFileStorageKey, activeTarget]);

  const reloadPreview = useCallback(() => {
    setIframeKey((key) => key + 1);
  }, []);

  const openExternal = useCallback(() => {
    if (!config?.hostname || !activeTarget) return;
    window.open(buildStaticInitUrl(config.hostname, activeTarget), '_blank', 'noopener,noreferrer');
  }, [activeTarget, config]);

  const iframeSrc = useMemo(() => {
    if (!config?.hostname || !activeTarget) return null;
    return buildStaticInitUrl(config.hostname, activeTarget);
  }, [activeTarget, config]);

  if (configError) {
    return (
      <PreviewError title="Preview service unreachable" body={configError} className={className} />
    );
  }

  if (!config) {
    return <PreviewLoading className={className} />;
  }

  if (!workingDirectory) {
    return (
      <PreviewError
        title="Workspace unavailable"
        body="This session does not expose a workspace path."
        className={className}
      />
    );
  }

  if (!config.enabled || !config.hostname) {
    return (
      <PreviewError
        title="Preview not configured"
        body="Set PREVIEW_HOSTNAME in the backend environment and route that hostname to the WebUI backend."
        className={className}
      />
    );
  }

  return (
    <div className={cn('flex h-full flex-col overflow-hidden bg-background', className)}>
      <div className="shrink-0 border-b bg-card/95">
        <div className="flex min-h-12 items-center gap-2 px-3 py-2">
          <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="truncate font-mono text-xs text-muted-foreground">
              {activeTarget
                ? `${buildStaticUrl(config.hostname, activeTarget)} -> ${activeTarget.relativePath}`
                : previewOrigin(config.hostname)}
            </div>
            <div className="truncate text-[11px] text-muted-foreground/75">
              {activeTarget
                ? `Static HTML · ${formatBytes(activeTarget.size)}`
                : 'No HTML file open'}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={reloadPreview}
            disabled={!activeTarget}
            title="Reload preview"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={openExternal}
            disabled={!activeTarget}
            title="Open in new tab"
          >
            <ExternalLink className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <WorkspaceBrowser
          workingDirectory={workingDirectory}
          selectedFile={selectedFile}
          activeFile={activeTarget?.filePath ?? null}
          openingFile={openingFile}
          onSelect={setSelectedFile}
          onOpenHtml={openHtmlFile}
        />

        <main className="relative min-w-0 flex-1 bg-background">
          {iframeSrc ? (
            <iframe
              key={iframeKey}
              src={iframeSrc}
              className="h-full w-full border-0 bg-white"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
              title="Preview"
            />
          ) : (
            <PreviewEmpty openError={openError} />
          )}
          {openError && iframeSrc && (
            <div className="absolute bottom-3 left-1/2 max-w-lg -translate-x-1/2 rounded-md border border-destructive/30 bg-background px-3 py-2 text-xs text-destructive shadow-lg">
              {openError}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function WorkspaceBrowser({
  workingDirectory,
  selectedFile,
  activeFile,
  openingFile,
  onSelect,
  onOpenHtml,
}: {
  workingDirectory: string;
  selectedFile: string | null;
  activeFile: string | null;
  openingFile: string | null;
  onSelect: (path: string | null) => void;
  onOpenHtml: (path: string) => void;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [treeState, setTreeState] = useState<TreeState>({
    expanded: { [workingDirectory]: true },
    loading: {},
    children: {},
    errors: {},
  });

  const loadDirectory = useCallback(async (directoryPath: string, force = false) => {
    let shouldLoad = true;
    setTreeState((prev) => {
      if (!force && (prev.loading[directoryPath] || prev.children[directoryPath])) {
        shouldLoad = false;
        return prev;
      }
      return {
        ...prev,
        loading: { ...prev.loading, [directoryPath]: true },
        errors: { ...prev.errors, [directoryPath]: null },
      };
    });

    if (!shouldLoad) return;

    try {
      const response = await api.get<ApiResponse<DirectoryContents>>(
        `/api/files?path=${encodeURIComponent(directoryPath)}`
      );
      if (!response.data.success || !response.data.data) {
        throw new Error(response.data.error?.message || 'Failed to load directory');
      }
      const files = response.data.data.files;
      setTreeState((prev) => ({
        ...prev,
        loading: { ...prev.loading, [directoryPath]: false },
        children: { ...prev.children, [directoryPath]: files },
        errors: { ...prev.errors, [directoryPath]: null },
      }));
    } catch (err) {
      setTreeState((prev) => ({
        ...prev,
        loading: { ...prev.loading, [directoryPath]: false },
        errors: { ...prev.errors, [directoryPath]: errorMessage(err) },
      }));
    }
  }, []);

  useEffect(() => {
    setTreeState({
      expanded: { [workingDirectory]: true },
      loading: {},
      children: {},
      errors: {},
    });
    onSelect(null);
    void loadDirectory(workingDirectory, true);
  }, [loadDirectory, onSelect, workingDirectory]);

  const toggleDirectory = useCallback(
    (directoryPath: string) => {
      setTreeState((prev) => ({
        ...prev,
        expanded: { ...prev.expanded, [directoryPath]: !prev.expanded[directoryPath] },
      }));
      if (!treeState.expanded[directoryPath]) void loadDirectory(directoryPath);
    },
    [loadDirectory, treeState.expanded]
  );

  const refreshRoot = useCallback(() => {
    setTreeState((prev) => ({
      ...prev,
      children: {},
      loading: {},
      errors: {},
      expanded: { [workingDirectory]: true },
    }));
    void loadDirectory(workingDirectory, true);
  }, [loadDirectory, workingDirectory]);

  const filterFiles = useCallback(
    (files: FileInfo[]): FileInfo[] => {
      const query = searchQuery.trim().toLowerCase();
      if (!query) return sortFiles(files);

      return sortFiles(files).filter((file) => {
        if (file.name.toLowerCase().includes(query)) return true;
        if (file.type !== 'directory') return false;
        const children = treeState.children[file.path];
        return children ? filterFiles(children).length > 0 : false;
      });
    },
    [searchQuery, treeState.children]
  );

  const renderNode = useCallback(
    (file: FileInfo, depth: number): ReactNode => {
      const isDirectory = file.type === 'directory';
      const isExpanded = Boolean(treeState.expanded[file.path]);
      const isLoading = Boolean(treeState.loading[file.path]);
      const children = treeState.children[file.path] ?? [];
      const visibleChildren = filterFiles(children);
      const selected = selectedFile === file.path;
      const active = activeFile === file.path;
      const canOpen = !isDirectory && isHtmlFile(file.name);
      const isOpening = openingFile === file.path;
      const paddingLeft = 8 + depth * 14;

      return (
        <div key={file.path}>
          <div
            role="treeitem"
            tabIndex={0}
            aria-expanded={isDirectory ? isExpanded : undefined}
            aria-selected={selected || active}
            className={cn(
              'group flex min-h-7 cursor-pointer items-center gap-1.5 rounded-sm py-0.5 pr-2 text-sm outline-none transition-colors',
              'hover:bg-muted/60 focus-visible:ring-1 focus-visible:ring-primary/50',
              active && 'bg-primary/10 text-primary',
              selected && !active && 'bg-muted text-foreground'
            )}
            style={{ paddingLeft }}
            title={canOpen ? 'Double-click to open preview' : file.path}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(file.path);
              if (isDirectory) toggleDirectory(file.path);
            }}
            onDoubleClick={(event) => {
              event.stopPropagation();
              if (isDirectory) return;
              if (canOpen) onOpenHtml(file.path);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                if (isDirectory) toggleDirectory(file.path);
                else if (canOpen) onOpenHtml(file.path);
              }
              if (event.key === 'ArrowRight' && isDirectory && !isExpanded) {
                event.preventDefault();
                toggleDirectory(file.path);
              }
              if (event.key === 'ArrowLeft' && isDirectory && isExpanded) {
                event.preventDefault();
                toggleDirectory(file.path);
              }
            }}
          >
            <span className="flex h-4 w-4 shrink-0 items-center justify-center">
              {isDirectory ? (
                isLoading ? (
                  <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                ) : isExpanded ? (
                  <ChevronDown className="h-3 w-3 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-3 w-3 text-muted-foreground" />
                )
              ) : null}
            </span>
            <FileIcon
              filename={file.name}
              isDirectory={isDirectory}
              isOpen={isExpanded}
              className="h-4 w-4 shrink-0"
            />
            <span className="min-w-0 flex-1 truncate">
              {highlightMatch(file.name, searchQuery)}
            </span>
            {isOpening ? (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
            ) : canOpen ? (
              <span className="shrink-0 rounded-sm border px-1 py-px text-[10px] uppercase text-muted-foreground">
                HTML
              </span>
            ) : null}
          </div>

          {isDirectory && isExpanded && (
            <div role="group">
              {isLoading ? (
                <div
                  className="flex items-center gap-2 py-2 text-xs text-muted-foreground"
                  style={{ paddingLeft: paddingLeft + 24 }}
                >
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Loading
                </div>
              ) : visibleChildren.length > 0 ? (
                visibleChildren.map((child) => renderNode(child, depth + 1))
              ) : treeState.errors[file.path] ? (
                <div
                  className="truncate py-1 text-xs text-destructive"
                  style={{ paddingLeft: paddingLeft + 24 }}
                  title={treeState.errors[file.path] ?? undefined}
                >
                  {treeState.errors[file.path]}
                </div>
              ) : null}
            </div>
          )}
        </div>
      );
    },
    [
      activeFile,
      filterFiles,
      onOpenHtml,
      onSelect,
      openingFile,
      searchQuery,
      selectedFile,
      toggleDirectory,
      treeState,
    ]
  );

  const rootFiles = treeState.children[workingDirectory] ?? [];
  const rootLoading = Boolean(treeState.loading[workingDirectory]);
  const rootError = treeState.errors[workingDirectory];
  const displayFiles = filterFiles(rootFiles);

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r bg-muted/15 max-sm:w-56">
      <div className="shrink-0 space-y-2 border-b p-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
            <FolderTree className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">Workspace</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={refreshRoot}
            disabled={rootLoading}
            title="Refresh files"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', rootLoading && 'animate-spin')} />
          </Button>
        </div>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search files"
            className="h-7 pl-7 pr-7 text-sm"
          />
          {searchQuery && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-0.5 top-1/2 h-6 w-6 -translate-y-1/2"
              onClick={() => setSearchQuery('')}
              title="Clear search"
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-1" role="tree">
        {rootLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : rootError ? (
          <div className="m-2 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
            {rootError}
          </div>
        ) : displayFiles.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            {searchQuery ? 'No matching files' : 'No files found'}
          </div>
        ) : (
          displayFiles.map((file) => renderNode(file, 0))
        )}
      </div>

      <div className="shrink-0 border-t px-2 py-1.5">
        <p
          className="truncate font-mono text-[10px] text-muted-foreground"
          title={workingDirectory}
        >
          {workingDirectory}
        </p>
      </div>
    </aside>
  );
}

function PreviewEmpty({ openError }: { openError: string | null }) {
  return (
    <div className="flex h-full w-full items-center justify-center p-6 text-center">
      <div className="w-full max-w-md">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-md border bg-muted/30">
          <Globe className="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 className="mb-1 font-semibold">No HTML file open</h3>
        <p className="text-sm text-muted-foreground">Workspace files are available on the left.</p>
        {openError && (
          <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {openError}
          </div>
        )}
      </div>
    </div>
  );
}

function PreviewLoading({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'flex h-full items-center justify-center text-sm text-muted-foreground',
        className
      )}
    >
      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      Loading preview
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
        <h3 className="mb-1 font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

function highlightMatch(text: string, query: string): ReactNode {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return text;

  const lowerText = text.toLowerCase();
  const lowerQuery = normalizedQuery.toLowerCase();
  const index = lowerText.indexOf(lowerQuery);
  if (index < 0) return text;

  return (
    <>
      {text.slice(0, index)}
      <span className="rounded bg-primary/15 px-0.5 text-primary">
        {text.slice(index, index + normalizedQuery.length)}
      </span>
      {text.slice(index + normalizedQuery.length)}
    </>
  );
}

export default WebPreview;
