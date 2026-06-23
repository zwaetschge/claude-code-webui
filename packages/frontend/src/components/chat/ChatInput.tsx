import { useState, useRef, useCallback, useMemo, memo, useEffect } from 'react';
import {
  MessageCircle,
  Send,
  Paperclip,
  Loader2,
  Sparkles,
  X,
  FileText,
  FileCode,
  File as FileIcon,
  StopCircle,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CommandMenu } from '@/components/chat/CommandMenu';
import { cn } from '@/lib/utils';
import type { Command, SessionSurface } from '@plum-code-webui/shared';

type AttachmentType = 'image' | 'text' | 'pdf' | 'document';
type ActiveFollowupMode = 'queue' | 'steer';

interface FileAttachment {
  id: string;
  file: File;
  preview: string | null;
  type: AttachmentType;
}

function getAttachmentType(mimeType: string, filename: string): AttachmentType {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType === 'application/pdf') return 'pdf';
  if (
    mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/xml' ||
    mimeType === 'application/javascript' ||
    filename.match(
      /\.(md|txt|json|yaml|yml|js|ts|tsx|jsx|py|rb|go|rs|java|sql|sh|html|css|xml|csv)$/i
    )
  ) {
    return 'text';
  }
  return 'document';
}

function generateId() {
  return Math.random().toString(36).substring(2, 9);
}

interface ChatInputProps {
  sessionId: string;
  onSendMessage: (message: string) => void;
  onSendMessageWithFiles: (message: string, files: File[]) => void;
  onCommandExecute: (input: string) => Promise<void>;
  onInterrupt?: () => void;
  commands?: Command[];
  selectedToolName?: string | null;
  selectedCliTool?: string | null;
  disabled?: boolean;
  isSending?: boolean;
  isExecutingTool?: boolean;
  isActive?: boolean;
  queuesWhileActive?: boolean;
  steersWhileActive?: boolean;
  surface?: SessionSurface;
  activeStatusLabel?: string;
  activeStatusDetail?: string;
  activeFollowupMode?: ActiveFollowupMode;
  onActiveFollowupModeChange?: (checked: boolean) => void;
  fastModeActive?: boolean;
  fastModePending?: boolean;
  onFastModeToggle?: () => void;
  queueDepth?: number;
  onOpenRun?: () => void;
}

export const ChatInput = memo(function ChatInput({
  onSendMessage,
  onSendMessageWithFiles,
  onCommandExecute,
  onInterrupt,
  commands,
  selectedToolName,
  selectedCliTool,
  disabled,
  isSending,
  isExecutingTool,
  isActive,
  queuesWhileActive,
  steersWhileActive,
  surface = 'code',
  activeStatusLabel,
  activeStatusDetail,
  activeFollowupMode,
  onActiveFollowupModeChange,
  fastModeActive = false,
  fastModePending = false,
  onFastModeToggle,
  queueDepth = 0,
  onOpenRun,
}: ChatInputProps) {
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [showCommandMenu, setShowCommandMenu] = useState(false);
  const [commandMenuIndex, setCommandMenuIndex] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Memoized filtered commands
  const filteredCommands = useMemo(() => {
    if (!commands || !showCommandMenu) return [];
    const filter = input.startsWith('/') ? input.slice(1).toLowerCase() : '';
    return commands.filter((cmd) => cmd.name.toLowerCase().includes(filter));
  }, [commands, showCommandMenu, input]);

  const addFiles = useCallback(
    (files: File[]) => {
      const maxFiles = 10;
      const remaining = maxFiles - attachments.length;

      if (remaining <= 0) return;

      const filesToAdd = files.slice(0, remaining);
      const newAttachments: FileAttachment[] = filesToAdd.map((file) => {
        const type = getAttachmentType(file.type, file.name);
        return {
          id: generateId(),
          file,
          preview: type === 'image' ? URL.createObjectURL(file) : null,
          type,
        };
      });

      setAttachments((prev) => [...prev, ...newAttachments]);
    },
    [attachments.length]
  );

  // Handle paste for images
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const imageItems = Array.from(items).filter((item) => item.type.startsWith('image/'));
      if (imageItems.length === 0) return;

      e.preventDefault();
      const files = imageItems.map((item) => item.getAsFile()).filter((f): f is File => f !== null);

      addFiles(files);
    };

    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [addFiles]);

  const removeAttachment = useCallback((attachmentId: string) => {
    setAttachments((prev) => {
      const attachment = prev.find((a) => a.id === attachmentId);
      if (attachment?.preview) {
        URL.revokeObjectURL(attachment.preview);
      }
      return prev.filter((a) => a.id !== attachmentId);
    });
  }, []);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      addFiles(files);
      e.target.value = '';
    },
    [addFiles]
  );

  const allowsActiveFollowup = !!queuesWhileActive || !!steersWhileActive;
  const blocksSubmitForActiveRun = !!isActive && !allowsActiveFollowup;
  const activeSubmitLabel = steersWhileActive
    ? isActive
      ? 'Steer message'
      : 'Send'
    : queuesWhileActive && isActive
      ? 'Queue message'
      : 'Send';
  const showActiveFollowupButton = !!activeFollowupMode;
  const canToggleActiveFollowupMode = !!onActiveFollowupModeChange;
  const showFastModeButton = !!onFastModeToggle;
  const idleModeSummary = [
    activeFollowupMode === 'steer'
      ? 'Steering'
      : activeFollowupMode === 'queue'
        ? 'Follow-up'
        : null,
    fastModeActive ? 'Fast' : null,
  ]
    .filter(Boolean)
    .join(' / ');
  const composerStatusLabel =
    activeStatusLabel ||
    (isActive
      ? steersWhileActive
        ? 'Steering active turn'
        : queuesWhileActive
          ? 'Follow-up queue'
          : 'Turn running'
      : queueDepth > 0
        ? `${queueDepth} queued`
        : selectedToolName
          ? `${selectedToolName} selected`
          : '');
  const composerStatusDetail =
    activeStatusDetail ||
    (isActive
      ? steersWhileActive
        ? 'Updating current run.'
        : queuesWhileActive
          ? 'Waiting behind current run.'
          : 'Run lock active.'
      : '');
  const composerBriefLabel =
    composerStatusLabel || (showActiveFollowupButton || showFastModeButton ? 'Ready' : '');
  const composerBriefDetail =
    composerStatusDetail || (!composerStatusLabel && composerBriefLabel ? idleModeSummary : '');
  const showStatusStrip =
    !!composerBriefLabel ||
    !!composerBriefDetail ||
    showActiveFollowupButton ||
    showFastModeButton ||
    (surface === 'task' && !!selectedToolName);
  const showStatusBubble = !!composerBriefLabel || !!composerBriefDetail;
  const composerTone = steersWhileActive
    ? 'steer'
    : queuesWhileActive
      ? 'queue'
      : isActive
        ? 'blocked'
        : selectedCliTool
          ? 'tool'
          : 'idle';
  const inputPlaceholder = selectedToolName
    ? `Prompt for ${selectedToolName}...`
    : isActive
      ? steersWhileActive
        ? 'Steer the active run...'
        : queuesWhileActive
          ? 'Add a follow-up...'
          : 'Current run is active...'
      : surface === 'task'
        ? 'Give Plum a task...'
        : 'Message...';

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (
        (!input.trim() && attachments.length === 0) ||
        disabled ||
        isSending ||
        isExecutingTool ||
        blocksSubmitForActiveRun
      )
        return;

      const currentInput = input;
      const currentAttachments = [...attachments];

      // Clear input immediately for responsiveness
      setInput('');
      // Reset textarea height
      if (inputRef.current) {
        inputRef.current.style.height = 'auto';
      }

      if (currentInput.startsWith('/')) {
        setShowCommandMenu(false);
        await onCommandExecute(currentInput);
        return;
      }

      // Send message
      if (currentAttachments.length > 0) {
        onSendMessageWithFiles(
          currentInput,
          currentAttachments.map((a) => a.file)
        );
        // Clean up previews
        currentAttachments.forEach((a) => {
          if (a.preview) URL.revokeObjectURL(a.preview);
        });
        setAttachments([]);
      } else {
        onSendMessage(currentInput);
      }
    },
    [
      input,
      attachments,
      disabled,
      isSending,
      isExecutingTool,
      blocksSubmitForActiveRun,
      onCommandExecute,
      onSendMessage,
      onSendMessageWithFiles,
    ]
  );

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInput(value);
    // Show command menu when typing /
    if (value.startsWith('/') && !value.includes(' ')) {
      setShowCommandMenu(true);
      setCommandMenuIndex(0);
    } else {
      setShowCommandMenu(false);
    }
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (showCommandMenu && filteredCommands.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setCommandMenuIndex((i) => Math.min(i + 1, filteredCommands.length - 1));
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setCommandMenuIndex((i) => Math.max(i - 1, 0));
        } else if (e.key === 'Tab' || e.key === 'Enter') {
          e.preventDefault();
          const selected = filteredCommands[commandMenuIndex];
          if (selected) {
            setInput(`/${selected.name} `);
            setShowCommandMenu(false);
          }
        } else if (e.key === 'Escape') {
          setShowCommandMenu(false);
        }
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit(e as unknown as React.FormEvent);
      }
    },
    [showCommandMenu, filteredCommands, commandMenuIndex, handleSubmit]
  );

  const handleCommandSelect = useCallback((cmd: Command) => {
    setInput(`/${cmd.name} `);
    setShowCommandMenu(false);
    inputRef.current?.focus();
  }, []);

  // Helper to get icon for attachment type
  const getAttachmentIcon = (type: AttachmentType) => {
    switch (type) {
      case 'text':
        return <FileCode className="h-6 w-6" />;
      case 'pdf':
        return <FileText className="h-6 w-6 text-red-500" />;
      case 'document':
        return <FileIcon className="h-6 w-6" />;
      default:
        return null;
    }
  };

  return (
    <div className="shrink-0 space-y-2">
      {/* File attachments preview */}
      {attachments.length > 0 && (
        <div className="glass-panel inline-flex flex-wrap gap-2 p-3 rounded-2xl animate-scale-in w-fit max-w-full">
          {attachments.map((attachment) => (
            <div key={attachment.id} className="relative group">
              {attachment.type === 'image' && attachment.preview ? (
                <img
                  src={attachment.preview}
                  alt="Attachment"
                  className="h-16 w-16 object-cover rounded-lg border border-border/40 shadow-sm"
                />
              ) : (
                <div className="h-16 w-40 flex items-center gap-2 px-3 rounded-lg border border-border/40 shadow-sm bg-background/60">
                  {getAttachmentIcon(attachment.type)}
                  <span className="text-xs truncate flex-1" title={attachment.file.name}>
                    {attachment.file.name}
                  </span>
                </div>
              )}
              <button
                type="button"
                onClick={() => removeAttachment(attachment.id)}
                className="absolute -top-2 -right-2 p-1 rounded-full bg-destructive text-destructive-foreground shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className={cn(
          'glass-chrome chat-composer-form relative rounded-[18px] md:rounded-2xl shadow-lg shadow-black/5 dark:shadow-black/20',
          surface === 'task' && 'is-task-composer',
          selectedCliTool && 'ring-1 ring-orange-500/30'
        )}
      >
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />

        {showStatusStrip && (
          <div className={cn('composer-brief-row', `is-${composerTone}`)}>
            {showStatusBubble && (
              <div className="composer-now-brief">
                <span className="composer-brief-indicator">
                  {isActive ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Sparkles className="h-3 w-3" />
                  )}
                </span>
                <span className="composer-brief-copy">
                  <span className="composer-brief-label">{composerBriefLabel}</span>
                  {composerBriefDetail && (
                    <span className="composer-brief-detail">{composerBriefDetail}</span>
                  )}
                </span>
                {queueDepth > 0 && <span className="composer-brief-count">{queueDepth}</span>}
                {onOpenRun && isActive && (
                  <button type="button" className="composer-brief-run" onClick={onOpenRun}>
                    Run
                  </button>
                )}
              </div>
            )}

            <div className="composer-brief-actions">
              {showActiveFollowupButton && (
                <button
                  type="button"
                  className={cn(
                    'composer-bubble-button is-followup',
                    activeFollowupMode === 'steer' && 'is-active',
                    activeFollowupMode === 'queue' && !canToggleActiveFollowupMode && 'is-active'
                  )}
                  onClick={
                    canToggleActiveFollowupMode
                      ? () => onActiveFollowupModeChange?.(activeFollowupMode !== 'steer')
                      : undefined
                  }
                  tabIndex={canToggleActiveFollowupMode ? undefined : -1}
                  aria-pressed={
                    activeFollowupMode === 'steer' ||
                    (activeFollowupMode === 'queue' && !canToggleActiveFollowupMode)
                  }
                  aria-disabled={!canToggleActiveFollowupMode}
                  aria-label={
                    canToggleActiveFollowupMode
                      ? 'Toggle active-send steering mode'
                      : 'Follow-up queue is active'
                  }
                  title={
                    activeFollowupMode === 'steer'
                      ? 'Steering is active. New messages preempt the active Codex turn.'
                      : 'Follow-up mode is active. New messages wait until the current turn finishes.'
                  }
                >
                  <MessageCircle className="h-3.5 w-3.5" />
                  <span>{activeFollowupMode === 'steer' ? 'Steering' : 'Follow-up'}</span>
                </button>
              )}
              {showFastModeButton && (
                <button
                  type="button"
                  className={cn('composer-bubble-button is-fast', fastModeActive && 'is-active')}
                  onClick={onFastModeToggle}
                  disabled={fastModePending}
                  aria-pressed={fastModeActive}
                  aria-label={fastModeActive ? 'Disable fast mode' : 'Enable fast mode'}
                  title={fastModeActive ? 'Disable Fast mode' : 'Enable Fast mode'}
                >
                  {fastModePending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Zap className="h-3.5 w-3.5" />
                  )}
                  <span>Fast</span>
                </button>
              )}
            </div>
          </div>
        )}

        <div className="composer-input-shell">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled}
            className="composer-control-button composer-attach-button"
            title="Attach files"
            aria-label="Attach files"
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip className="h-4 w-4" />
          </Button>

          {/* Text input */}
          <div className="composer-field relative">
            {/* Command autocomplete menu */}
            {showCommandMenu && filteredCommands.length > 0 && (
              <CommandMenu
                commands={filteredCommands}
                filter=""
                selectedIndex={commandMenuIndex}
                onSelect={handleCommandSelect}
                onClose={() => setShowCommandMenu(false)}
              />
            )}
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={inputPlaceholder}
              rows={1}
              className={cn(
                'composer-textarea w-full min-h-[40px] max-h-[148px] md:max-h-[220px] bg-transparent border-0 focus:outline-none focus:ring-0 text-base md:text-sm resize-none placeholder:text-muted-foreground/60 text-foreground'
              )}
              style={{ height: 'auto', overflow: 'hidden' }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                const maxHeight =
                  typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches
                    ? 148
                    : 220;
                target.style.height = 'auto';
                target.style.height = Math.min(target.scrollHeight, maxHeight) + 'px';
              }}
            />
          </div>

          <div className="composer-actions-right">
            {onInterrupt && isActive && !allowsActiveFollowup ? (
              <Button
                type="button"
                size="icon"
                variant="destructive"
                onClick={onInterrupt}
                className="composer-control-button composer-control-danger"
                title="Stop (Escape)"
                aria-label="Stop generation"
              >
                <StopCircle className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                type="submit"
                size="icon"
                variant="ghost"
                disabled={
                  (!input.trim() && attachments.length === 0) ||
                  disabled ||
                  isSending ||
                  isExecutingTool ||
                  blocksSubmitForActiveRun
                }
                className={cn(
                  'composer-control-button composer-control-send',
                  selectedCliTool && 'composer-control-tool'
                )}
                title={isActive ? activeSubmitLabel : 'Send'}
                aria-label={isActive ? activeSubmitLabel : 'Send message'}
              >
                {isSending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
});
