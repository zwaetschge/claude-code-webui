import { CheckCircle2, LoaderCircle, Sparkles } from 'lucide-react';

interface ProviderToolNoticeProps {
  tools: string[];
  complete: boolean;
}

function providerToolLabel(name: string): string {
  return name
    .replace(/^analyze_image$/i, 'Image analysis')
    .replace(/_/g, ' ')
    .replace(/^./, (character) => character.toUpperCase());
}

export function ProviderToolNotice({ tools, complete }: ProviderToolNoticeProps) {
  if (tools.length === 0) return null;

  return (
    <div className="my-2 flex w-fit max-w-full items-center gap-2 rounded-lg border border-border/70 bg-muted/35 px-3 py-2 text-xs text-muted-foreground">
      <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
      <span className="truncate">Z.AI · {tools.map(providerToolLabel).join(', ')}</span>
      {complete ? (
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-label="Complete" />
      ) : (
        <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin" aria-label="Running" />
      )}
    </div>
  );
}
