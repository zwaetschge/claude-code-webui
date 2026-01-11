import { useState, useEffect, useCallback } from 'react';
import {
  FileCode2,
  Eye,
  Edit3,
  Save,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Columns,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { api } from '@/services/api';
import { cn } from '@/lib/utils';
import { useDebounce } from '@/hooks/useDebounce';
import ReactMarkdown from 'react-markdown';

interface AgentsEditorProps {
  workingDirectory: string;
  className?: string;
}

interface FileReadResponse {
  success: boolean;
  data?: { content: string; exists: boolean };
}

interface FileWriteResponse {
  success: boolean;
}

export function AgentsEditor({ workingDirectory, className }: AgentsEditorProps) {
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [viewMode, setViewMode] = useState<'edit' | 'preview' | 'split'>('split');
  const [fileExists, setFileExists] = useState(false);

  const debouncedContent = useDebounce(content, 1000);
  const hasChanges = content !== originalContent;

  // Load AGENTS.md content
  const loadContent = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const filePath = `${workingDirectory}/AGENTS.md`;
      const response = await api.get<FileReadResponse>(
        `/api/files/read?path=${encodeURIComponent(filePath)}`
      );

      if (response.data.success && response.data.data) {
        setContent(response.data.data.content || '');
        setOriginalContent(response.data.data.content || '');
        setFileExists(response.data.data.exists !== false);
      } else {
        // File doesn't exist, start with template
        const template = getAgentsTemplate();
        setContent(template);
        setOriginalContent('');
        setFileExists(false);
      }
    } catch {
      // File doesn't exist, use template
      const template = getAgentsTemplate();
      setContent(template);
      setOriginalContent('');
      setFileExists(false);
    } finally {
      setLoading(false);
    }
  }, [workingDirectory]);

  useEffect(() => {
    if (workingDirectory) {
      loadContent();
    }
  }, [workingDirectory, loadContent]);

  // Auto-save
  useEffect(() => {
    if (debouncedContent && debouncedContent !== originalContent && fileExists) {
      saveContent();
    }
  }, [debouncedContent]);

  const saveContent = async () => {
    setSaving(true);
    setError(null);

    try {
      const filePath = `${workingDirectory}/AGENTS.md`;
      const response = await api.post<FileWriteResponse>('/api/files/write', {
        path: filePath,
        content: content,
      });

      if (response.data.success) {
        setOriginalContent(content);
        setFileExists(true);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } else {
        setError('Failed to save file');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save file');
    } finally {
      setSaving(false);
    }
  };

  const createFile = async () => {
    setSaving(true);
    setError(null);

    try {
      const filePath = `${workingDirectory}/AGENTS.md`;
      const response = await api.post<FileWriteResponse>('/api/files/write', {
        path: filePath,
        content: content,
      });

      if (response.data.success) {
        setOriginalContent(content);
        setFileExists(true);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } else {
        setError('Failed to create file');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create file');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-2">
          <FileCode2 className="h-5 w-5 text-blue-500" />
          <h3 className="font-medium">AGENTS.md</h3>
          {!fileExists && (
            <span className="text-xs bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300 px-2 py-0.5 rounded">
              New
            </span>
          )}
          {hasChanges && fileExists && (
            <span className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 px-2 py-0.5 rounded">
              Modified
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* View mode toggle */}
          <div className="flex border rounded-md">
            <Button
              variant="ghost"
              size="sm"
              className={cn('h-7 px-2 rounded-r-none', viewMode === 'edit' && 'bg-muted')}
              onClick={() => setViewMode('edit')}
              title="Edit only"
            >
              <Edit3 className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={cn('h-7 px-2 rounded-none border-x', viewMode === 'split' && 'bg-muted')}
              onClick={() => setViewMode('split')}
              title="Split view"
            >
              <Columns className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={cn('h-7 px-2 rounded-l-none', viewMode === 'preview' && 'bg-muted')}
              onClick={() => setViewMode('preview')}
              title="Preview only"
            >
              <Eye className="h-4 w-4" />
            </Button>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={loadContent}
            disabled={loading}
            title="Reload"
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>

          {!fileExists ? (
            <Button
              variant="default"
              size="sm"
              onClick={createFile}
              disabled={saving}
            >
              {saving ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-1" />
              )}
              Create
            </Button>
          ) : (
            <Button
              variant="default"
              size="sm"
              onClick={saveContent}
              disabled={saving || !hasChanges}
            >
              {saving ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : saved ? (
                <CheckCircle className="h-4 w-4 mr-1 text-green-500" />
              ) : (
                <Save className="h-4 w-4 mr-1" />
              )}
              {saved ? 'Saved' : 'Save'}
            </Button>
          )}
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="shrink-0 flex items-center gap-2 px-3 py-2 bg-destructive/10 text-destructive text-sm">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-h-0 flex">
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* Editor */}
            {(viewMode === 'edit' || viewMode === 'split') && (
              <div className={cn('flex-1 min-w-0', viewMode === 'split' && 'border-r')}>
                <Textarea
                  value={content}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setContent(e.target.value)}
                  placeholder="# AGENTS.md

Define your agent instructions here..."
                  className="h-full w-full resize-none rounded-none border-0 font-mono text-sm focus-visible:ring-0"
                />
              </div>
            )}

            {/* Preview */}
            {(viewMode === 'preview' || viewMode === 'split') && (
              <div className="flex-1 min-w-0">
                <ScrollArea className="h-full">
                  <div className="p-4 prose prose-sm dark:prose-invert max-w-none">
                    <ReactMarkdown>{content || '*No content yet*'}</ReactMarkdown>
                  </div>
                </ScrollArea>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 flex items-center justify-between px-3 py-2 border-t bg-muted/30 text-xs text-muted-foreground">
        <span>{workingDirectory}/AGENTS.md</span>
        <span>{content.length} characters</span>
      </div>
    </div>
  );
}

function getAgentsTemplate(): string {
  return `# AGENTS.md

Instructions for AI agents working on this project.

## Project Overview

Describe your project here.

## Coding Guidelines

- Follow existing code patterns
- Write clear, maintainable code
- Include comments for complex logic

## File Structure

\`\`\`
src/
  components/  - React components
  hooks/       - Custom hooks
  services/    - API services
  utils/       - Utility functions
\`\`\`

## Important Notes

- Important conventions or patterns to follow
- Things to avoid
- Common pitfalls

## Available Commands

\`\`\`bash
npm run dev    # Start development server
npm run build  # Build for production
npm run test   # Run tests
\`\`\`
`;
}

export default AgentsEditor;
