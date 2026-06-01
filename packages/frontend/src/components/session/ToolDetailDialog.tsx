import { useMemo, useState } from 'react';
import { FileText, Search, Edit3, Terminal, Globe, Brain, Wrench, Copy, Check } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ToolExecution {
  toolId: string;
  toolName: string;
  status: 'started' | 'completed' | 'error';
  input?: unknown;
  result?: string;
  error?: string;
  timestamp: number;
}

interface ToolDetailDialogProps {
  tool: ToolExecution | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const toolIcons: Record<string, typeof Wrench> = {
  Write: FileText,
  Read: Search,
  Edit: Edit3,
  Bash: Terminal,
  Glob: Search,
  Grep: Search,
  WebFetch: Globe,
  WebSearch: Globe,
  Task: Brain,
};

const toolLabels: Record<string, string> = {
  Write: 'Write File',
  Read: 'Read File',
  Edit: 'Edit File',
  Bash: 'Run Command',
  Glob: 'Search Files',
  Grep: 'Search Code',
  WebFetch: 'Fetch Webpage',
  WebSearch: 'Web Search',
  Task: 'Agent Task',
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Button variant="ghost" size="sm" onClick={handleCopy} className="h-6 px-2 text-xs">
      {copied ? (
        <>
          <Check className="h-3 w-3 mr-1" />
          Copied
        </>
      ) : (
        <>
          <Copy className="h-3 w-3 mr-1" />
          Copy
        </>
      )}
    </Button>
  );
}

function CodeBlock({ title, content }: { title: string; content: string }) {
  if (!content) return null;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {title}
        </span>
        <CopyButton text={content} />
      </div>
      <pre
        className={cn(
          'text-xs p-3 rounded-lg bg-muted/50 border overflow-x-auto max-h-[300px] overflow-y-auto',
          'font-mono whitespace-pre-wrap break-all'
        )}
      >
        <code>{content}</code>
      </pre>
    </div>
  );
}

function PathDisplay({ label, path }: { label: string; path: string }) {
  if (!path) return null;

  return (
    <div className="space-y-1">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {label}
      </span>
      <div className="flex items-center gap-2">
        <code className="flex-1 text-sm p-2 rounded bg-muted/50 border font-mono truncate">
          {path}
        </code>
        <CopyButton text={path} />
      </div>
    </div>
  );
}

// Helper to safely get string from input
function getString(input: Record<string, unknown>, key: string): string {
  const val = input[key];
  return typeof val === 'string' ? val : '';
}

// Helper to safely get number from input
function getNumber(input: Record<string, unknown>, key: string): number | undefined {
  const val = input[key];
  return typeof val === 'number' ? val : undefined;
}

// Helper to safely get boolean from input
function getBoolean(input: Record<string, unknown>, key: string): boolean {
  return input[key] === true;
}

export function ToolDetailDialog({ tool, open, onOpenChange }: ToolDetailDialogProps) {
  const Icon = tool ? toolIcons[tool.toolName] || Wrench : Wrench;
  const label = tool ? toolLabels[tool.toolName] || tool.toolName : '';

  const input = useMemo(() => {
    if (!tool?.input) return null;
    return tool.input as Record<string, unknown>;
  }, [tool]);

  if (!tool) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="h-5 w-5 text-primary" />
            {label}
            <span
              className={cn(
                'ml-2 px-2 py-0.5 text-xs rounded-full',
                tool.status === 'completed' && 'bg-green-500/20 text-green-500',
                tool.status === 'started' && 'bg-primary/20 text-primary',
                tool.status === 'error' && 'bg-destructive/20 text-destructive'
              )}
            >
              {tool.status}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Read Tool */}
          {tool.toolName === 'Read' && input && (
            <>
              <PathDisplay label="File Path" path={getString(input, 'file_path')} />
              {(getNumber(input, 'offset') !== undefined ||
                getNumber(input, 'limit') !== undefined) && (
                <div className="text-xs text-muted-foreground">
                  {getNumber(input, 'offset') !== undefined && (
                    <span>Offset: {getNumber(input, 'offset')}</span>
                  )}
                  {getNumber(input, 'offset') !== undefined &&
                    getNumber(input, 'limit') !== undefined && <span> · </span>}
                  {getNumber(input, 'limit') !== undefined && (
                    <span>Limit: {getNumber(input, 'limit')} lines</span>
                  )}
                </div>
              )}
              {tool.result && <CodeBlock title="File Content" content={tool.result} />}
            </>
          )}

          {/* Write Tool */}
          {tool.toolName === 'Write' && input && (
            <>
              <PathDisplay label="File Path" path={getString(input, 'file_path')} />
              {getString(input, 'content') && (
                <CodeBlock title="Content Written" content={getString(input, 'content')} />
              )}
            </>
          )}

          {/* Edit Tool */}
          {tool.toolName === 'Edit' && input && (
            <>
              <PathDisplay label="File Path" path={getString(input, 'file_path')} />
              {getBoolean(input, 'replace_all') && (
                <div className="text-xs text-muted-foreground">Replace all occurrences</div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {getString(input, 'old_string') && (
                  <div className="space-y-1">
                    <span className="text-xs font-medium text-red-400 uppercase tracking-wide flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-red-500" />
                      Removed
                    </span>
                    <pre className="text-xs p-3 rounded-lg bg-red-500/10 border border-red-500/20 overflow-x-auto max-h-[200px] overflow-y-auto font-mono whitespace-pre-wrap break-all">
                      <code>{getString(input, 'old_string')}</code>
                    </pre>
                  </div>
                )}
                {getString(input, 'new_string') && (
                  <div className="space-y-1">
                    <span className="text-xs font-medium text-green-400 uppercase tracking-wide flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-green-500" />
                      Added
                    </span>
                    <pre className="text-xs p-3 rounded-lg bg-green-500/10 border border-green-500/20 overflow-x-auto max-h-[200px] overflow-y-auto font-mono whitespace-pre-wrap break-all">
                      <code>{getString(input, 'new_string')}</code>
                    </pre>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Bash Tool */}
          {tool.toolName === 'Bash' && input && (
            <>
              <CodeBlock title="Command" content={getString(input, 'command')} />
              {getNumber(input, 'timeout') !== undefined && (
                <div className="text-xs text-muted-foreground">
                  Timeout: {getNumber(input, 'timeout')}ms
                </div>
              )}
              {tool.result && <CodeBlock title="Output" content={tool.result} />}
            </>
          )}

          {/* Glob Tool */}
          {tool.toolName === 'Glob' && input && (
            <>
              <div className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Pattern
                </span>
                <code className="block text-sm p-2 rounded bg-muted/50 border font-mono">
                  {getString(input, 'pattern')}
                </code>
              </div>
              {getString(input, 'path') && (
                <PathDisplay label="Search Path" path={getString(input, 'path')} />
              )}
              {tool.result && <CodeBlock title="Matching Files" content={tool.result} />}
            </>
          )}

          {/* Grep Tool */}
          {tool.toolName === 'Grep' && input && (
            <>
              <div className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Search Pattern
                </span>
                <code className="block text-sm p-2 rounded bg-muted/50 border font-mono">
                  {getString(input, 'pattern')}
                </code>
              </div>
              {getString(input, 'path') && (
                <PathDisplay label="Search Path" path={getString(input, 'path')} />
              )}
              {tool.result && <CodeBlock title="Results" content={tool.result} />}
            </>
          )}

          {/* WebFetch Tool */}
          {tool.toolName === 'WebFetch' && input && (
            <>
              <div className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  URL
                </span>
                <code className="block text-sm p-2 rounded bg-muted/50 border font-mono break-all">
                  {getString(input, 'url')}
                </code>
              </div>
              {getString(input, 'prompt') && (
                <div className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Prompt
                  </span>
                  <p className="text-sm p-2 rounded bg-muted/50 border">
                    {getString(input, 'prompt')}
                  </p>
                </div>
              )}
              {tool.result && <CodeBlock title="Response" content={tool.result} />}
            </>
          )}

          {/* WebSearch Tool */}
          {tool.toolName === 'WebSearch' && input && (
            <>
              <div className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Query
                </span>
                <p className="text-sm p-2 rounded bg-muted/50 border">
                  {getString(input, 'query')}
                </p>
              </div>
              {tool.result && <CodeBlock title="Results" content={tool.result} />}
            </>
          )}

          {/* Task (Agent) Tool */}
          {tool.toolName === 'Task' && input && (
            <>
              {getString(input, 'description') && (
                <div className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Description
                  </span>
                  <p className="text-sm p-2 rounded bg-muted/50 border">
                    {getString(input, 'description')}
                  </p>
                </div>
              )}
              {getString(input, 'prompt') && (
                <CodeBlock title="Prompt" content={getString(input, 'prompt')} />
              )}
              {tool.result && <CodeBlock title="Result" content={tool.result} />}
            </>
          )}

          {/* Fallback for unknown tools */}
          {![
            'Read',
            'Write',
            'Edit',
            'Bash',
            'Glob',
            'Grep',
            'WebFetch',
            'WebSearch',
            'Task',
          ].includes(tool.toolName) && (
            <>
              {input && <CodeBlock title="Input" content={JSON.stringify(input, null, 2)} />}
              {tool.result && <CodeBlock title="Result" content={tool.result} />}
            </>
          )}

          {/* Error display */}
          {tool.error && (
            <div className="space-y-1">
              <span className="text-xs font-medium text-destructive uppercase tracking-wide">
                Error
              </span>
              <pre className="text-xs p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive overflow-x-auto font-mono whitespace-pre-wrap">
                {tool.error}
              </pre>
            </div>
          )}

          {/* Timestamp */}
          <div className="text-xs text-muted-foreground pt-2 border-t">
            {new Date(tool.timestamp).toLocaleString()}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
