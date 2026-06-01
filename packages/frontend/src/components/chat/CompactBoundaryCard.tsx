import { useState } from 'react';
import { Scissors, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CompactBoundaryCardProps {
  content: string;
  className?: string;
}

export function CompactBoundaryCard({ content, className }: CompactBoundaryCardProps) {
  const [expanded, setExpanded] = useState(false);

  const parts = content.split('\n\n');
  const summary = parts.slice(1).join('\n\n');

  return (
    <div className={cn('flex flex-col items-center gap-2 py-3', className)}>
      {/* Dashed line with scissors icon */}
      <div className="flex items-center gap-2 w-full max-w-[80%]">
        <div className="flex-1 border-t border-dashed border-muted-foreground/30" />
        <button
          onClick={() => summary && setExpanded(!expanded)}
          className={cn(
            'flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs text-muted-foreground',
            'bg-muted/50 border border-border/50',
            summary && 'hover:bg-muted cursor-pointer transition-colors'
          )}
        >
          <Scissors className="h-3 w-3" />
          <span>Context Compacted</span>
          {summary &&
            (expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />)}
        </button>
        <div className="flex-1 border-t border-dashed border-muted-foreground/30" />
      </div>

      {/* Expandable summary */}
      {expanded && summary && (
        <div className="w-full max-w-[80%] text-xs text-muted-foreground bg-muted/30 rounded-lg p-3 border border-border/30">
          <pre className="whitespace-pre-wrap font-sans">{summary}</pre>
        </div>
      )}
    </div>
  );
}
