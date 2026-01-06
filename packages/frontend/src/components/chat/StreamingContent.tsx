import { useMemo, useState } from 'react';
import { Shield, ShieldAlert, CheckCircle2, XCircle, AlertTriangle, Sparkles, Bot } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

interface StreamingContentProps {
  content: string;
  onResponse?: (response: string) => void;
}

// Strip ANSI escape codes for clean text
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b\[\?[0-9;]*[a-zA-Z]/g, '');
}

// Parse Claude CLI output into structured content
function parseClaudeOutput(content: string): {
  type: 'trust' | 'selection' | 'thinking' | 'response' | 'welcome' | 'empty' | 'plan_mode';
  path?: string;
  title?: string;
  options?: { number: string; label: string; selected: boolean }[];
  thinkingTime?: string;
  message?: string;
  isIdeating?: boolean;
  welcomeData?: {
    version: string;
    model: string;
    workingDir: string;
  };
} {
  const cleanContent = stripAnsi(content);

  // Check for trust prompt FIRST (highest priority - needs user action)
  const trustMatch = cleanContent.match(/Do you trust the files in this folder\?[\s\S]*?(\/[^\s\n]+)/);
  if (trustMatch && trustMatch[1]) {
    return { type: 'trust', path: trustMatch[1] };
  }

  // Check for selection prompts EARLY (they need user interaction)
  // Look for "Enter to select" footer which indicates a selection dialog
  if (cleanContent.includes('Enter to select') || cleanContent.includes('Tab/Arrow keys')) {
    const optionMatches = cleanContent.matchAll(/(?:❯\s*)?(\d+)\.\s*([^\n]+?)(?:\s+[A-Z][^\n]*)?$/gm);
    const options: { number: string; label: string; selected: boolean }[] = [];

    for (const match of optionMatches) {
      const num = match[1] ?? '';
      let label = match[2] ?? '';
      // Clean up the label
      label = label.replace(/\s+A\s+.*$/, '').trim();
      if (label && !label.includes('for shortcuts') && !label.includes('Enter to select')) {
        options.push({
          number: num,
          label: label,
          selected: cleanContent.includes(`❯ ${num}.`) || cleanContent.includes(`❯${num}.`),
        });
      }
    }

    if (options.length >= 2) {
      // Find the question/title
      const lines = cleanContent.split('\n').filter(l => l.trim());
      const titleLine = lines.find(l =>
        l.includes('?') &&
        !l.match(/^\s*❯?\s*\d+\./) &&
        !l.includes('for shortcuts') &&
        !l.includes('Enter to select')
      );

      return { type: 'selection', title: titleLine?.trim() || 'Select an option', options };
    }
  }

  // Check for plan mode (but not if there's actual content after it)
  if (cleanContent.includes('Entered plan mode') && !cleanContent.includes('Enter to select')) {
    // Extract any message after the plan mode indicator
    const planModeMatch = cleanContent.match(/(?:Entered plan mode|plan mode)[^\n]*\n?([\s\S]*)/i);
    const planMessage = planModeMatch?.[1]?.trim() || '';

    // Clean up the message - remove repeated status lines
    const cleanMessage = planMessage
      .split('\n')
      .filter(l =>
        !l.includes('Ideating') &&
        !l.includes('Cooking') &&
        !l.includes('? for shortcuts') &&
        !l.includes('esc to interrupt') &&
        !l.includes('plan mode on') &&
        !l.match(/^[✶✻✽·✢*]\s*$/) &&
        !l.match(/^─+$/) &&
        !l.match(/^>\s*$/) &&
        l.trim()
      )
      .join('\n')
      .replace(/Claude is now exploring[\s\S]*?approval\.\s*/i, '')
      .trim();

    // If there's meaningful content after plan mode message, show it as response
    if (cleanMessage.length > 30) {
      return {
        type: 'response',
        message: cleanMessage,
      };
    }

    return {
      type: 'plan_mode',
      message: 'Claude is exploring the codebase and designing an implementation approach...',
    };
  }

  // Check for Claude's actual response (starts with ● or similar bullet)
  // This takes priority over thinking state and welcome screen
  const responseMatch = cleanContent.match(/[●○◉◎]\s*([\s\S]*?)(?:(?:\n\s*>\s*$|\n\s*[✶✻✽·✢*]\s|\n\s*\? for shortcuts|\n\s*Hatching)[\s\S]*$|$)/);
  if (responseMatch && responseMatch[1]) {
    const message = responseMatch[1]
      .trim()
      .replace(/\s*\? for shortcuts\s*$/g, '')
      .replace(/\s*>\s*$/g, '')
      .replace(/\s*Hatching[\s\S]*$/g, '')
      .trim();

    if (message && message.length > 5) {
      return {
        type: 'response',
        message,
      };
    }
  }

  // Check for general text content that doesn't match other patterns
  // This catches responses that don't start with bullets
  const lines = cleanContent.split('\n').filter(l => l.trim());
  const textContent = lines
    .filter(l =>
      !l.includes('Cooking') &&
      !l.includes('Hatching') &&
      !l.includes('? for shortcuts') &&
      !l.match(/^[✶✻✽·✢*]\s/) &&
      !l.match(/^>\s*$/) &&
      !l.includes('esc to interrupt')
    )
    .join('\n')
    .trim();

  if (textContent.length > 20) {
    return {
      type: 'response',
      message: textContent,
    };
  }

  // Check for selection prompts (numbered options with specific patterns)
  // Only detect if there's a clear question/title before the options
  const hasQuestion = cleanContent.includes('?') && !cleanContent.includes('? for shortcuts');
  if (hasQuestion) {
    const optionMatches = cleanContent.matchAll(/(\d+)\.\s*([^\n]+)/g);
    const options: { number: string; label: string; selected: boolean }[] = [];

    for (const match of optionMatches) {
      const num = match[1] ?? '';
      const label = match[2] ?? '';
      // Skip if it looks like a list item in regular text
      if (label.trim() && !label.includes('for shortcuts')) {
        options.push({
          number: num,
          label: label.trim(),
          selected: cleanContent.includes(`❯ ${num}`) || cleanContent.includes(`❯${num}`),
        });
      }
    }

    if (options.length >= 2 && options.length <= 5) {
      const lines = cleanContent.split('\n').filter(l => l.trim());
      const title = lines.find(l =>
        l.includes('?') &&
        !l.match(/^\d+\./) &&
        !l.includes('❯') &&
        !l.includes('for shortcuts')
      ) || '';

      return { type: 'selection', title: title.trim(), options };
    }
  }

  // Check for thinking/processing state
  const thinkingPatterns = [
    /Ideating….*?thought for (\d+s?)/i,
    /Ideating….*?thinking/i,
    /Ideating…/i,
    /Hatching….*?thinking/i,
    /Hatching….*?thought for (\d+s?)/i,
    /Cooking…/i,
    /thinking\.\.\./i,
    /processing/i,
  ];

  let thinkingTime = '';
  let isThinking = false;
  let isIdeating = false;

  for (const pattern of thinkingPatterns) {
    const match = cleanContent.match(pattern);
    if (match) {
      isThinking = true;
      isIdeating = /Ideating/i.test(cleanContent);
      if (match[1]) {
        thinkingTime = match[1];
      }
      break;
    }
  }

  // If still thinking with no response yet
  if (isThinking) {
    return { type: 'thinking', thinkingTime, isIdeating };
  }

  // Check for welcome screen ONLY if no response was found
  if (cleanContent.includes('Claude Code v') && cleanContent.includes('Welcome')) {
    const versionMatch = cleanContent.match(/Claude Code v([\d.]+)/);
    const modelMatch = cleanContent.match(/(?:Opus|Sonnet|Haiku)[\s\d.]+/i);
    const dirMatch = cleanContent.match(/~\/[^\s│╯]+/);

    return {
      type: 'welcome',
      welcomeData: {
        version: versionMatch?.[1] || '',
        model: modelMatch?.[0]?.trim() || 'Claude',
        workingDir: dirMatch?.[0] || '',
      }
    };
  }

  return { type: 'empty' };
}

// Trust Dialog Component
function TrustDialog({ path, onResponse }: { path: string; onResponse?: (response: string) => void }) {
  const [isResponding, setIsResponding] = useState(false);

  const handleResponse = (response: 'yes' | 'no') => {
    setIsResponding(true);
    const input = response === 'yes' ? '1' : '2';
    onResponse?.(input);
  };

  return (
    <Card className="p-0 overflow-hidden border-2 border-amber-500/30 bg-gradient-to-br from-amber-500/5 to-transparent">
      <div className="flex items-center gap-3 p-4 bg-amber-500/10 border-b border-amber-500/20">
        <div className="p-2 rounded-lg bg-amber-500/20">
          <ShieldAlert className="h-5 w-5 text-amber-500" />
        </div>
        <div>
          <h3 className="font-semibold text-base">Do you trust the files in this folder?</h3>
          <p className="text-xs text-muted-foreground">Security confirmation required</p>
        </div>
      </div>

      <div className="p-4 space-y-4">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 font-mono text-sm">
          <Shield className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="truncate">{path}</span>
        </div>

        <div className="flex items-start gap-2 text-sm text-muted-foreground">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" />
          <p>
            Claude Code may read, write, or execute files in this directory.
            Only trust folders from known sources.
          </p>
        </div>

        <div className="flex gap-2 pt-2">
          <Button
            onClick={() => handleResponse('yes')}
            disabled={isResponding}
            className="flex-1 gap-2 bg-green-600 hover:bg-green-700"
          >
            <CheckCircle2 className="h-4 w-4" />
            Yes, proceed
          </Button>
          <Button
            onClick={() => handleResponse('no')}
            disabled={isResponding}
            variant="outline"
            className="flex-1 gap-2 border-red-500/30 text-red-500 hover:bg-red-500/10"
          >
            <XCircle className="h-4 w-4" />
            No, exit
          </Button>
        </div>
      </div>
    </Card>
  );
}

// Selection Dialog Component
function SelectionDialog({
  title,
  options,
  onResponse,
}: {
  title: string;
  options: { number: string; label: string; selected: boolean }[];
  onResponse?: (response: string) => void;
}) {
  const [isResponding, setIsResponding] = useState(false);

  const handleSelect = (number: string) => {
    setIsResponding(true);
    onResponse?.(number);
  };

  // Parse label to separate title from description
  const parseOption = (label: string) => {
    // Pattern: "Fun/playful app A whimsical app..." or just "Fun/playful app"
    const match = label.match(/^([^A-Z]*[a-z])(\s+[A-Z].*)$/);
    if (match && match[1] && match[2]) {
      return { title: match[1].trim(), description: match[2].trim() };
    }
    return { title: label, description: '' };
  };

  return (
    <Card className="max-w-[80%] p-0 overflow-hidden border-2 border-primary/30">
      <div className="flex items-center gap-3 p-4 bg-primary/10 border-b border-primary/20">
        <div className="p-2 rounded-lg bg-primary/20">
          <AlertTriangle className="h-5 w-5 text-primary" />
        </div>
        <h3 className="font-semibold text-base">{title || 'Select an option'}</h3>
      </div>

      <div className="p-4 space-y-2">
        {options.map((option) => {
          const { title: optTitle, description } = parseOption(option.label);
          return (
            <Button
              key={option.number}
              onClick={() => handleSelect(option.number)}
              disabled={isResponding}
              variant={option.selected ? 'default' : 'outline'}
              className={cn(
                'w-full justify-start gap-3 h-auto py-3 px-4',
                option.selected && 'ring-2 ring-primary'
              )}
            >
              <span className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-sm font-mono shrink-0">
                {option.number}
              </span>
              <div className="text-left">
                <div className="font-medium">{optTitle}</div>
                {description && (
                  <div className="text-xs text-muted-foreground mt-0.5">{description}</div>
                )}
              </div>
            </Button>
          );
        })}
      </div>
    </Card>
  );
}

// Welcome screen component
function WelcomeScreen({ data }: { data: { version: string; model: string; workingDir: string } }) {
  return (
    <Card className="max-w-md p-0 overflow-hidden border-2 border-primary/20 bg-gradient-to-br from-primary/5 via-transparent to-primary/5">
      <div className="p-6 text-center space-y-4">
        <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/10 flex items-center justify-center">
          <Sparkles className="h-8 w-8 text-primary" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">Claude Code Ready</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {data.model} · v{data.version}
          </p>
        </div>
        {data.workingDir && (
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/50 text-xs font-mono text-muted-foreground">
            <Shield className="h-3 w-3" />
            {data.workingDir}
          </div>
        )}
      </div>
    </Card>
  );
}

// Thinking indicator
function ThinkingIndicator({ thinkingTime, isIdeating }: { thinkingTime?: string; isIdeating?: boolean }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="relative">
        <Sparkles className={cn("h-5 w-5 animate-pulse", isIdeating ? "text-blue-500" : "text-primary")} />
        <div className={cn("absolute inset-0 h-5 w-5 rounded-full animate-ping", isIdeating ? "bg-blue-500/20" : "bg-primary/20")} />
      </div>
      <div className="flex flex-col">
        <span className="text-sm font-medium">
          {isIdeating ? 'Claude is ideating...' : 'Claude is thinking...'}
        </span>
        {thinkingTime && (
          <span className="text-xs text-muted-foreground">{thinkingTime}</span>
        )}
      </div>
    </div>
  );
}

// Plan mode indicator
function PlanModeIndicator({ message }: { message?: string }) {
  return (
    <Card className="max-w-[80%] p-0 overflow-hidden border-2 border-blue-500/30 bg-gradient-to-br from-blue-500/5 to-transparent">
      <div className="flex items-center gap-3 p-4 bg-blue-500/10 border-b border-blue-500/20">
        <div className="p-2 rounded-lg bg-blue-500/20">
          <Sparkles className="h-5 w-5 text-blue-500 animate-pulse" />
        </div>
        <div>
          <h3 className="font-semibold text-base">Plan Mode</h3>
          <p className="text-xs text-muted-foreground">Exploring and designing implementation</p>
        </div>
      </div>
      {message && (
        <div className="p-4">
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{message}</ReactMarkdown>
          </div>
        </div>
      )}
    </Card>
  );
}

// Claude response with markdown and LaTeX support
function ClaudeResponse({ message }: { message: string }) {
  return (
    <div className="flex gap-3">
      <div className="shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
        <Bot className="h-4 w-4 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{message}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}

export function StreamingContent({ content, onResponse }: StreamingContentProps) {
  const parsed = useMemo(() => {
    const clean = stripAnsi(content);
    const result = parseClaudeOutput(content);
    console.log('StreamingContent parsed:', result.type);
    console.log('Clean content:', clean);
    console.log('Has bullet:', /[●○◉◎]/.test(clean));
    console.log('Has Hatching:', clean.includes('Hatching'));
    return result;
  }, [content]);

  if (parsed.type === 'welcome' && parsed.welcomeData) {
    return <WelcomeScreen data={parsed.welcomeData} />;
  }

  if (parsed.type === 'trust') {
    return <TrustDialog path={parsed.path!} onResponse={onResponse} />;
  }

  if (parsed.type === 'selection') {
    return (
      <SelectionDialog
        title={parsed.title!}
        options={parsed.options!}
        onResponse={onResponse}
      />
    );
  }

  if (parsed.type === 'plan_mode') {
    return <PlanModeIndicator message={parsed.message} />;
  }

  if (parsed.type === 'thinking') {
    return (
      <Card className={cn(
        "max-w-[80%] p-0 bg-card border overflow-hidden",
        parsed.isIdeating && "border-blue-500/30"
      )}>
        <ThinkingIndicator thinkingTime={parsed.thinkingTime} isIdeating={parsed.isIdeating} />
      </Card>
    );
  }

  if (parsed.type === 'response' && parsed.message) {
    return (
      <Card className="max-w-[80%] p-4 bg-card border">
        <ClaudeResponse message={parsed.message} />
        {parsed.thinkingTime && (
          <div className="mt-3 pt-3 border-t flex items-center gap-2">
            <ThinkingIndicator thinkingTime={parsed.thinkingTime} />
          </div>
        )}
      </Card>
    );
  }

  // Empty or unrecognized - show minimal loading state
  return (
    <Card className="max-w-[80%] p-0 bg-card border overflow-hidden">
      <ThinkingIndicator />
    </Card>
  );
}
