import { memo, useCallback, useState } from 'react';
import { FileText, FileCode, File as FileIcon, Copy, RotateCcw, Check, Rewind, Pencil } from 'lucide-react';
import { MemoizedMarkdown } from './MemoizedMarkdown';
import { InteractiveOptions, detectOptions, isChoicePrompt } from './InteractiveOptions';
import { DirectoryAccessPrompt } from '@/components/session/AllowedDirectoriesDialog';
import { ProviderLogo } from '@/components/branding/ProviderLogo';
import { useAuthStore } from '@/stores/authStore';
import { socketService } from '@/services/socket';
import { cn } from '@/lib/utils';
import type { Message, MessageImage, MessageAttachment } from '@claude-code-webui/shared';
import type { UiProvider } from '@/lib/providers';
import { useQueryClient } from '@tanstack/react-query';

interface MessageBubbleProps {
  message: Message;
  sessionId: string;
  sessionStatus: string;
  /** Provider for the assistant avatar / logo. Falls back to claude. */
  provider?: UiProvider;
  /** Model name shown next to the assistant name (e.g. "opus-4.7"). */
  modelLabel?: string;
  /** Display name for the assistant (default: "Claude"). */
  assistantName?: string;
}

function formatMessageTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  return sameDay
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export const MessageBubble = memo(function MessageBubble({
  message,
  sessionId,
  sessionStatus,
  provider = 'claude',
  modelLabel,
  assistantName = 'Claude',
}: MessageBubbleProps) {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);

  const handleOptionSelect = useCallback((selected: string) => {
    socketService.sendMessage(sessionId, selected);
  }, [sessionId]);

  const handleAccessGranted = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
  }, [queryClient, sessionId]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard may be blocked in insecure contexts — ignore silently
    }
  }, [message.content]);

  const handleRetry = useCallback(() => {
    if (message.role !== 'user' || !message.content.trim()) return;
    socketService.sendMessage(sessionId, message.content);
  }, [message.content, message.role, sessionId]);

  const handleRewind = useCallback(async () => {
    const confirmed = window.confirm(
      'Rewind here? This deletes this message and everything after, and resets the Claude context.'
    );
    if (!confirmed) return;
    try {
      const token = useAuthStore.getState().token || '';
      const res = await fetch(`/api/sessions/${sessionId}/rewind`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ messageId: message.id }),
      });
      if (!res.ok) throw new Error(`Rewind failed (${res.status})`);
      await queryClient.invalidateQueries({ queryKey: ['session', sessionId, 'messages'] });
      await queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
    } catch (err) {
      console.error('Rewind failed:', err);
    }
  }, [message.id, sessionId, queryClient]);

  const token = useAuthStore.getState().token || '';
  const timestamp = formatMessageTime(message.createdAt);

  const renderAttachments = () => {
    if (!message.images?.length && !message.attachments?.length) return null;
    return (
      <div className="flex flex-wrap gap-2 mb-3">
        {(!message.attachments || message.attachments.length === 0) && message.images?.map((img: MessageImage, imgIndex: number) => {
          const imageUrl = `/api/sessions/${sessionId}/images/${img.filename}?token=${encodeURIComponent(token)}`;
          return (
            <img
              key={`img-${imgIndex}`}
              src={imageUrl}
              alt={`Attachment ${imgIndex + 1}`}
              className="max-h-32 max-w-48 rounded-lg border border-foreground/15 object-cover cursor-pointer hover:opacity-90 transition-opacity"
              onClick={() => window.open(imageUrl, '_blank')}
            />
          );
        })}
        {message.attachments?.map((att: MessageAttachment, attIndex: number) => {
          const attachmentUrl = att.filename && att.path
            ? `/api/sessions/${sessionId}/attachments/${att.filename}?token=${encodeURIComponent(token)}`
            : null;

          if (att.type === 'image' && attachmentUrl) {
            return (
              <img
                key={`att-${attIndex}`}
                src={attachmentUrl}
                alt={att.filename}
                className="max-h-32 max-w-48 rounded-lg border border-foreground/15 object-cover cursor-pointer hover:opacity-90 transition-opacity"
                onClick={() => window.open(attachmentUrl, '_blank')}
              />
            );
          }

          const AttachmentIcon = att.type === 'text' ? FileCode : att.type === 'pdf' ? FileText : FileIcon;
          return (
            <div
              key={`att-${attIndex}`}
              className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer hover:opacity-90 transition-opacity",
                message.role === 'user'
                  ? "border-white/20 bg-white/10"
                  : "border-border bg-muted"
              )}
              onClick={() => attachmentUrl && window.open(attachmentUrl, '_blank')}
              title={att.filename}
            >
              <AttachmentIcon className={cn("h-5 w-5", att.type === 'pdf' && "text-red-500")} />
              <span className="text-xs truncate max-w-32">{att.filename}</span>
            </div>
          );
        })}
      </div>
    );
  };

  if (message.role === 'user') {
    return (
      <div className="turn-user animate-fade-in">
        <div>
          <div className="ub-bubble">
            {renderAttachments()}
            <MemoizedMarkdown
              content={message.content}
              className="prose prose-sm max-w-none prose-invert"
            />
          </div>
          <div className="user-meta">
            <span className="actions">
              <button onClick={handleCopy} className="mini-btn" title="Copy message">
                {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
              </button>
              <button onClick={handleRetry} className="mini-btn" title="Resend this prompt" disabled={sessionStatus === 'error'}>
                <RotateCcw className="h-3 w-3" />
              </button>
              <button onClick={handleRewind} className="mini-btn" title="Delete this message and everything after; reset context">
                <Rewind className="h-3 w-3" />
              </button>
              <button className="mini-btn" title="Edit (coming soon)" disabled>
                <Pencil className="h-3 w-3" />
              </button>
            </span>
            {timestamp && <span className="font-mono tabular-nums" title={new Date(message.createdAt).toLocaleString()}>{timestamp}</span>}
            <span className="label">Du</span>
          </div>
        </div>
      </div>
    );
  }

  // Assistant turn
  return (
    <div className="turn-asst animate-fade-in">
      <div className="ai-rail">
        <div className="ai-mark" title={assistantName}>
          <ProviderLogo provider={provider} className="h-4 w-4" />
        </div>
        <div className="ai-thread" />
      </div>
      <div className="ai-body">
        <div className="asst-meta">
          <span className="asst-name">{assistantName}</span>
          {modelLabel && <span className="asst-model">{modelLabel}</span>}
          {timestamp && <span className="asst-time" title={new Date(message.createdAt).toLocaleString()}>{timestamp}</span>}
        </div>
        {renderAttachments()}
        <MemoizedMarkdown
          content={message.content}
          className="prose prose-sm max-w-none dark:prose-invert"
        />
        {isChoicePrompt(message.content) && (() => {
          const options = detectOptions(message.content);
          return options ? (
            <InteractiveOptions
              options={options}
              onSelect={handleOptionSelect}
              disabled={sessionStatus === 'error'}
            />
          ) : null;
        })()}
        <DirectoryAccessPrompt
          message={message.content}
          sessionId={sessionId}
          onAccessGranted={handleAccessGranted}
        />
        <div className="asst-actions">
          <button onClick={handleCopy} className="a">
            {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
          <span className="sep" />
          <button onClick={handleRewind} className="a danger">
            <Rewind className="h-3 w-3" />
            <span>Rewind</span>
          </button>
        </div>
      </div>
    </div>
  );
}, (prev, next) => {
  return prev.message.id === next.message.id
    && prev.message.content === next.message.content
    && prev.sessionStatus === next.sessionStatus
    && prev.provider === next.provider
    && prev.modelLabel === next.modelLabel
    && prev.assistantName === next.assistantName;
});
