import { memo, useCallback, useState } from 'react';
import { FileText, FileCode, File as FileIcon, Copy, Check } from 'lucide-react';
import { MemoizedMarkdown } from './MemoizedMarkdown';
import { ChatMediaImage } from './ChatMediaImage';
import { InteractiveOptions, detectOptions, isChoicePrompt } from './InteractiveOptions';
import { DirectoryAccessPrompt } from '@/components/session/AllowedDirectoriesDialog';
import { ProviderLogo } from '@/components/branding/ProviderLogo';
import { useAuthStore } from '@/stores/authStore';
import { socketService } from '@/services/socket';
import { cn } from '@/lib/utils';
import { normalizeClaudeDisplayContent } from '@/lib/claudeDisplay';
import type { Message, MessageImage, MessageAttachment } from '@plum-code-webui/shared';
import type { UiProvider } from '@/lib/providers';
import { useQueryClient } from '@tanstack/react-query';
import { ProviderToolNotice } from './ProviderToolNotice';

interface MessageBubbleProps {
  message: Message;
  sessionId: string;
  sessionStatus: string;
  /** Provider for the assistant avatar / logo. Falls back to the primary provider. */
  provider?: UiProvider;
  /** Model name shown next to the assistant name (e.g. "opus-4.7"). */
  modelLabel?: string;
  /** Display name for the assistant (default: "Assistant"). */
  assistantName?: string;
  /** Show provider/model identity for the first message in an assistant streak. */
  showAssistantIdentity?: boolean;
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
    : date.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
}

function mediaSignature(message: Message): string {
  return (message.media ?? [])
    .map(
      (media) =>
        `${media.id}\u0000${media.filename}\u0000${media.mimeType}\u0000${media.byteSize}\u0000${media.altText ?? ''}\u0000${media.source}`
    )
    .join('\u0001');
}

export const MessageBubble = memo(
  function MessageBubble({
    message,
    sessionId,
    sessionStatus,
    provider = 'codex',
    modelLabel,
    assistantName = 'Assistant',
    showAssistantIdentity = true,
  }: MessageBubbleProps) {
    const queryClient = useQueryClient();
    const [copied, setCopied] = useState(false);

    const handleOptionSelect = useCallback(
      (selected: string) => {
        socketService.sendMessage(sessionId, selected);
      },
      [sessionId]
    );

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

    const token = useAuthStore.getState().token || '';
    const timestamp = formatMessageTime(message.createdAt);
    const displayContent =
      message.role === 'assistant' && (provider === 'claude' || provider === 'zai')
        ? normalizeClaudeDisplayContent(message.content)
        : { message: message.content, providerTools: [], providerToolComplete: false };

    const assistantMedia = message.role === 'assistant' ? (message.media ?? []) : [];
    const assistantMediaFilenames = new Set(assistantMedia.map((media) => media.filename));
    const legacyImages =
      message.role === 'assistant'
        ? message.images?.filter((image) => !assistantMediaFilenames.has(image.filename))
        : message.images;
    const legacyAttachments =
      message.role === 'assistant'
        ? message.attachments?.filter(
            (attachment) => !assistantMediaFilenames.has(attachment.filename)
          )
        : message.attachments;

    const renderAttachments = () => {
      if (!legacyImages?.length && !legacyAttachments?.length) return null;
      return (
        <div className="flex flex-wrap gap-2 mb-3">
          {(!legacyAttachments || legacyAttachments.length === 0) &&
            legacyImages?.map((img: MessageImage, imgIndex: number) => {
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
          {legacyAttachments?.map((att: MessageAttachment, attIndex: number) => {
            const attachmentUrl =
              att.filename && att.path
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

            const AttachmentIcon =
              att.type === 'text' ? FileCode : att.type === 'pdf' ? FileText : FileIcon;
            return (
              <div
                key={`att-${attIndex}`}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer hover:opacity-90 transition-opacity',
                  message.role === 'user' ? 'border-white/20 bg-white/10' : 'border-border bg-muted'
                )}
                onClick={() => attachmentUrl && window.open(attachmentUrl, '_blank')}
                title={att.filename}
              >
                <AttachmentIcon className={cn('h-5 w-5', att.type === 'pdf' && 'text-red-500')} />
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
            <div className="message-copy-shell">
              <button onClick={handleCopy} className="message-copy-button" title="Copy message">
                {copied ? (
                  <Check className="h-3 w-3 text-emerald-500" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </button>
              <div className="ub-bubble">
                {renderAttachments()}
                <MemoizedMarkdown
                  content={message.content}
                  className="prose prose-sm max-w-none prose-invert"
                />
              </div>
            </div>
            <div className="user-meta">
              {timestamp && (
                <span
                  className="font-mono tabular-nums"
                  title={new Date(message.createdAt).toLocaleString()}
                >
                  {timestamp}
                </span>
              )}
              <span className="label">Du</span>
            </div>
          </div>
        </div>
      );
    }

    const copyButton = (
      <button onClick={handleCopy} className="message-copy-button" title="Copy message">
        {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
      </button>
    );

    // Assistant turn
    return (
      <div className="turn-asst animate-fade-in">
        <div className="ai-body">
          {copyButton}
          {showAssistantIdentity && (
            <div className="asst-meta">
              <ProviderLogo provider={provider} className="asst-provider-mark" />
              <span className="asst-name">{assistantName}</span>
              {modelLabel && <span className="asst-model">{modelLabel}</span>}
            </div>
          )}
          {renderAttachments()}
          {assistantMedia.length > 0 && (
            <div className="chat-media-grid">
              {assistantMedia.map((media) => (
                <ChatMediaImage key={media.id} media={media} sessionId={sessionId} />
              ))}
            </div>
          )}
          {displayContent.message && (
            <MemoizedMarkdown
              content={displayContent.message}
              className="prose prose-sm max-w-none dark:prose-invert"
            />
          )}
          <ProviderToolNotice
            tools={displayContent.providerTools}
            complete={displayContent.providerToolComplete}
          />
          {isChoicePrompt(message.content) &&
            (() => {
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
            providerLabel={assistantName}
            onAccessGranted={handleAccessGranted}
          />
        </div>
      </div>
    );
  },
  (prev, next) => {
    return (
      prev.message.id === next.message.id &&
      prev.message.content === next.message.content &&
      mediaSignature(prev.message) === mediaSignature(next.message) &&
      prev.sessionStatus === next.sessionStatus &&
      prev.provider === next.provider &&
      prev.modelLabel === next.modelLabel &&
      prev.assistantName === next.assistantName &&
      prev.showAssistantIdentity === next.showAssistantIdentity
    );
  }
);
