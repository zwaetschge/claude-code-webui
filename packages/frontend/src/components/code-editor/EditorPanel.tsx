import { useMutation } from '@tanstack/react-query';
import { X, Circle, Loader2, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/services/api';
import { toast } from '@/hooks/use-toast';
import { useSessionStore } from '@/stores/sessionStore';
import { CodeEditor } from './CodeEditor';
import { FileIcon } from '@/components/file-tree/file-icons';
import type { ApiResponse } from '@plum-code-webui/shared';
import { cn } from '@/lib/utils';

interface EditorPanelProps {
  sessionId: string;
}

export function EditorPanel({ sessionId }: EditorPanelProps) {
  const { openFiles, activeFileTab, updateFileContent, closeFile, setActiveTab, markFileSaved } =
    useSessionStore();

  const files = openFiles[sessionId] || [];
  const activeTab = activeFileTab[sessionId];
  const activeFile = files.find((f) => f.path === activeTab);

  // Save file mutation
  const saveMutation = useMutation({
    mutationFn: async ({ path, content }: { path: string; content: string }) => {
      const response = await api.put<ApiResponse<unknown>>('/api/files/content', {
        path,
        content,
      });
      return response.data;
    },
    onSuccess: (_, { path }) => {
      markFileSaved(sessionId, path);
      toast({ title: 'File saved', description: getFileName(path) });
    },
    onError: (error: Error) => {
      toast({ title: 'Save failed', description: error.message, variant: 'destructive' });
    },
  });

  const handleSave = () => {
    if (activeFile && activeFile.isDirty) {
      saveMutation.mutate({ path: activeFile.path, content: activeFile.content });
    }
  };

  const handleClose = (path: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const file = files.find((f) => f.path === path);

    if (file?.isDirty) {
      if (!confirm('You have unsaved changes. Discard them?')) {
        return;
      }
    }

    closeFile(sessionId, path);
  };

  const getFileName = (path: string) => path.split('/').pop() || path;

  if (files.length === 0) {
    return (
      <div className="workspace-editor-empty flex h-full items-center justify-center text-muted-foreground text-sm">
        <div className="workspace-files-state-card text-center">
          <FileIcon filename="empty.ts" isDirectory={false} className="mx-auto mb-3 h-7 w-7" />
          <div className="text-sm font-medium text-foreground">No file open</div>
          <div className="mt-1 text-xs text-muted-foreground">Open a file from Files view.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="workspace-editor-shell flex h-full flex-col bg-background">
      <div className="workspace-editor-tabbar shrink-0 flex items-center gap-1 overflow-x-auto border-b px-2 py-1">
        {files.map((file) => {
          const isActive = file.path === activeTab;
          const fileName = getFileName(file.path);

          return (
            <div
              key={file.path}
              className={cn('workspace-editor-tab group', isActive && 'is-active')}
            >
              <button
                type="button"
                onClick={() => setActiveTab(sessionId, file.path)}
                className="workspace-editor-tab-main"
                title={file.path}
              >
                <FileIcon
                  filename={fileName}
                  isDirectory={false}
                  className="h-3.5 w-3.5 shrink-0"
                />
                <span className="truncate">{fileName}</span>
                {file.isDirty && (
                  <Circle className="h-2 w-2 shrink-0 fill-current text-amber-500" />
                )}
              </button>

              <button
                type="button"
                onClick={(e) => handleClose(file.path, e)}
                className="workspace-editor-tab-close"
                aria-label={`Close ${fileName}`}
                title="Close file"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}

        <div className="workspace-editor-tab-spacer" />

        {activeFile?.isDirty && (
          <Button
            size="sm"
            variant="ghost"
            className="workspace-editor-save h-7 px-2"
            onClick={handleSave}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
            ) : (
              <Save className="h-3 w-3 mr-1" />
            )}
            <span className="text-xs">Ctrl+S</span>
          </Button>
        )}
      </div>

      <div className="workspace-editor-body flex-1 min-h-0">
        {activeFile ? (
          <CodeEditor
            key={activeFile.path}
            path={activeFile.path}
            value={activeFile.content}
            onChange={(value) => updateFileContent(sessionId, activeFile.path, value)}
            onSave={handleSave}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Select an open file tab.
          </div>
        )}
      </div>
    </div>
  );
}

export default EditorPanel;
