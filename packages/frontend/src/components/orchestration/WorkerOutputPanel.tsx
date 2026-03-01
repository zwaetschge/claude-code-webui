import * as React from 'react';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useOrchestrationStore, WorkerOutputEntry } from '@/stores/orchestrationStore';
import type { CLIProvider } from '@claude-code-webui/shared';
import { Terminal, Trash2, X } from 'lucide-react';

interface WorkerOutputPanelProps {
  sessionId: string;
  workerId?: string;
  className?: string;
  onClose?: () => void;
}

// Provider colors
const providerColors: Record<CLIProvider, string> = {
  claude: 'text-orange-400',
  codex: 'text-green-400',
  gemini: 'text-blue-400',
  glm: 'text-cyan-400',
  kimi: 'text-gray-400',
  multi: 'text-purple-400',
};

function OutputLine({ entry }: { entry: WorkerOutputEntry }) {
  const colorClass = providerColors[entry.provider] || 'text-gray-400';
  const time = new Date(entry.timestamp).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  // Try to parse JSON for better formatting
  let content = entry.content;
  let parsedContent: unknown = null;

  try {
    parsedContent = JSON.parse(entry.content);
    if (typeof parsedContent === 'object' && parsedContent !== null) {
      // Format specific message types
      const obj = parsedContent as Record<string, unknown>;
      if (obj.type === 'message' && obj.content) {
        content = String(obj.content);
      } else if (obj.type === 'assistant' && obj.text) {
        content = String(obj.text);
      } else if (obj.text) {
        content = String(obj.text);
      }
    }
  } catch {
    // Not JSON, use as-is
  }

  return (
    <div className={cn('font-mono text-xs py-0.5', entry.isError && 'text-red-400')}>
      <span className="text-muted-foreground">[{time}]</span>{' '}
      <span className={colorClass}>[{entry.provider}]</span>{' '}
      <span className="whitespace-pre-wrap break-all">{content}</span>
    </div>
  );
}

export function WorkerOutputPanel({
  sessionId,
  workerId,
  className,
  onClose,
}: WorkerOutputPanelProps) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = React.useState(true);

  const { getWorkerOutputs, clearWorkerOutputs, getWorkers } = useOrchestrationStore();

  const outputs = getWorkerOutputs(sessionId, workerId);
  const workers = getWorkers(sessionId);
  const worker = workerId ? workers.find((w) => w.id === workerId) : null;

  // Auto-scroll on new output
  React.useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [outputs.length, autoScroll]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement;
    const isAtBottom =
      target.scrollHeight - target.scrollTop <= target.clientHeight + 50;
    setAutoScroll(isAtBottom);
  };

  const handleClear = () => {
    clearWorkerOutputs(sessionId, workerId);
  };

  const title = worker
    ? `${worker.provider.charAt(0).toUpperCase() + worker.provider.slice(1)} Output`
    : 'Worker Output';

  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader className="p-3 pb-2 flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm flex items-center gap-2">
          <Terminal className="w-4 h-4" />
          {title}
        </CardTitle>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0"
            onClick={handleClear}
            title="Output leeren"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
          {onClose && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              onClick={onClose}
              title="Schließen"
            >
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0 flex-1 min-h-0">
        <ScrollArea
          ref={scrollRef}
          onScroll={handleScroll}
          className="h-full max-h-64 px-3 pb-3"
        >
          {outputs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Kein Output vorhanden
            </p>
          ) : (
            <div className="space-y-0.5">
              {outputs.map((entry, i) => (
                <OutputLine key={`${entry.timestamp}-${i}`} entry={entry} />
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
