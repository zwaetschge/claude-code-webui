import { useMutation } from '@tanstack/react-query';
import { X, Circle, Loader2, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/services/api';
import { toast } from '@/hooks/use-toast';
import { useSessionStore } from '@/stores/sessionStore';
import { CodeEditor } from './CodeEditor';
import { FileIcon } from '@/components/file-tree/file-icons';
import type { ApiResponse } from '@claude-code-webui/shared';
import { cn } from '@/lib/utils';

interface EditorPanelProps {
  sessionId: string;
}

export function EditorPanel({ sessionId }: EditorPanelProps) {
  const {
    openFiles,
    activeFileTab,
    updateFileContent,
    closeFile,
    setActiveTab,
    markFileSaved,
  } = useSessionStore();

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
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Double-click a file in the tree to open it
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Tab Bar */}
      <div className="shrink-0 flex items-center gap-1 px-2 py-1 border-b overflow-x-auto">
        {files.map((file) => {
          const isActive = file.path === activeTab;
          const fileName = getFileName(file.path);

          return (
            <button
              key={file.path}
              onClick={() => setActiveTab(sessionId, file.path)}
              className={cn(
                'group flex items-center gap-1.5 px-2 py-1 text-xs rounded-md transition-colors min-w-0',
                isActive
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
              )}
            >
              <FileIcon
                filename={fileName}
                isDirectory={false}
                className="h-3.5 w-3.5 shrink-0"
              />
              <span className="truncate max-w-32">{fileName}</span>

              {/* Dirty indicator */}
              {file.isDirty && (
                <Circle className="h-2 w-2 fill-current text-amber-500 shrink-0" />
              )}

              {/* Close button */}
              <button
                onClick={(e) => handleClose(file.path, e)}
                className={cn(
                  'shrink-0 p-0.5 rounded hover:bg-muted-foreground/20 transition-colors',
                  isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                )}
              >
                <X className="h-3 w-3" />
              </button>
            </button>
          );
        })}

        {/* Save button */}
        {activeFile?.isDirty && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 ml-auto"
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

      {/* Editor */}
      <div className="flex-1 min-h-0">
        {activeFile && (
          <CodeEditor
            key={activeFile.path}
            path={activeFile.path}
            value={activeFile.content}
            onChange={(value) => updateFileContent(sessionId, activeFile.path, value)}
            onSave={handleSave}
          />
        )}
      </div>
    </div>
  );
}

export default EditorPanel;
