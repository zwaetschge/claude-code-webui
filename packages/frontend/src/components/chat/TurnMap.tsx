import { memo } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Message } from '@claude-code-webui/shared';

interface TurnMapProps {
  messages: Message[];
  activeMessageId?: string | null;
  onJump?: (messageId: string) => void;
  onClose?: () => void;
  assistantName?: string;
}

function preview(content: string, max = 100): string {
  const stripped = content
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#>*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.length > max ? `${stripped.slice(0, max).trim()}…` : stripped;
}

function formatHM(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export const TurnMap = memo(function TurnMap({
  messages,
  activeMessageId,
  onJump,
  onClose,
  assistantName = 'Assistant',
}: TurnMapProps) {
  // Filter out compact-boundary placeholders from the map
  const visible = messages.filter((m) => m.role === 'user' || m.role === 'assistant');

  return (
    <aside className="turn-map-rail">
      <div className="turn-map-header">
        <h3>Turn map</h3>
        {onClose && (
          <button
            type="button"
            className="turn-map-close"
            onClick={onClose}
            title="Close turn map"
            aria-label="Close turn map"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {visible.length === 0 ? (
        <div className="text-xs text-muted-foreground/70 px-2 py-3">
          No turns yet. Send a message to start the conversation.
        </div>
      ) : (
        <div className="turn-map-list">
          {visible.map((m) => {
            const isUser = m.role === 'user';
            return (
              <button
                key={m.id}
                type="button"
                className={cn('turn-map-item', activeMessageId === m.id && 'active')}
                onClick={() => onJump?.(m.id)}
              >
                <div className="turn-map-tick">
                  <span className={cn('turn-map-pip', isUser ? 'user' : 'asst')} />
                </div>
                <div className="turn-map-text">
                  <div className={cn('role', !isUser && 'asst')}>
                    {isUser ? 'Du' : assistantName}
                    {formatHM(m.createdAt) && (
                      <span className="ml-1.5 opacity-60">· {formatHM(m.createdAt)}</span>
                    )}
                  </div>
                  <div className="preview">
                    {preview(m.content) || <span className="opacity-50">(empty)</span>}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </aside>
  );
});
