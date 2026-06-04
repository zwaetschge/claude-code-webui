import { useState, useRef, useCallback, useMemo, memo, useEffect, type ReactNode } from 'react';
import {
  Send,
  Paperclip,
  Loader2,
  X,
  FileText,
  FileCode,
  File as FileIcon,
  StopCircle,
  Plus,
  Image,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CommandMenu } from '@/components/chat/CommandMenu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { Command } from '@claude-code-webui/shared';

type AttachmentType = 'image' | 'text' | 'pdf' | 'document';

interface FileAttachment {
  id: string;
  file: File;
  preview: string | null;
  type: AttachmentType;
}

type QuickPromptItem = { label: string; value: string; hint?: string };
type QuickPrompt = QuickPromptItem | { heading: string };

interface ComposerAction {
  id: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  badge?: number;
  badgePulse?: boolean;
  active?: boolean;
  disabled?: boolean;
}

// Supported file types for upload
const ACCEPTED_FILE_TYPES = [
  'image/*',
  'text/*',
  'application/pdf',
  'application/json',
  'application/xml',
  'application/javascript',
  'application/typescript',
  '.md',
  '.markdown',
  '.txt',
  '.csv',
  '.tsv',
  '.json',
  '.xml',
  '.yaml',
  '.yml',
  '.js',
  '.ts',
  '.tsx',
  '.jsx',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.swift',
  '.c',
  '.cpp',
  '.h',
  '.hpp',
  '.cs',
  '.html',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.sh',
  '.bash',
  '.zsh',
  '.fish',
  '.sql',
  '.graphql',
  '.env',
  '.gitignore',
  '.dockerfile',
  '.toml',
  '.ini',
  '.cfg',
  '.conf',
].join(',');

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
  quickPrompts?: QuickPrompt[];
  composerActions?: ComposerAction[];
  disabled?: boolean;
  isSending?: boolean;
  isExecutingTool?: boolean;
  isActive?: boolean;
  queuesWhileActive?: boolean;
}

export const ChatInput = memo(function ChatInput({
  onSendMessage,
  onSendMessageWithFiles,
  onCommandExecute,
  onInterrupt,
  commands,
  selectedToolName,
  selectedCliTool,
  quickPrompts,
  composerActions,
  disabled,
  isSending,
  isExecutingTool,
  isActive,
  queuesWhileActive,
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

  const blocksSubmitForActiveRun = !!isActive && !queuesWhileActive;

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

      // Check for slash commands
      if (currentInput.trim().startsWith('/imagegen') && currentAttachments.length > 0) {
        onSendMessageWithFiles(
          currentInput.trim().replace(/^\/imagegen\b/, '$imagegen'),
          currentAttachments.map((a) => a.file)
        );
        currentAttachments.forEach((a) => {
          if (a.preview) URL.revokeObjectURL(a.preview);
        });
        setAttachments([]);
        return;
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

  const handleQuickPrompt = useCallback(
    (value: string) => {
      const commandInput = value.trimStart();
      const hasTrailingWhitespace = /\s$/.test(value);

      setShowCommandMenu(false);

      if (commandInput.startsWith('/') && !hasTrailingWhitespace) {
        void onCommandExecute(commandInput);
        inputRef.current?.focus();
        return;
      }

      if (!commandInput.startsWith('/')) {
        const prompt = value.trim();
        if (!prompt) return;

        setInput('');
        if (inputRef.current) {
          inputRef.current.style.height = 'auto';
        }

        if (attachments.length > 0) {
          const currentAttachments = [...attachments];
          onSendMessageWithFiles(
            prompt,
            currentAttachments.map((attachment) => attachment.file)
          );
          currentAttachments.forEach((attachment) => {
            if (attachment.preview) URL.revokeObjectURL(attachment.preview);
          });
          setAttachments([]);
        } else {
          onSendMessage(prompt);
        }

        inputRef.current?.focus();
        return;
      }

      setInput(value);
      inputRef.current?.focus();
    },
    [attachments, onCommandExecute, onSendMessage, onSendMessageWithFiles]
  );

  const imagegenQuickPrompt = useMemo(() => {
    return quickPrompts?.find(
      (prompt): prompt is QuickPromptItem =>
        !('heading' in prompt) && prompt.value.trimStart().startsWith('/imagegen')
    );
  }, [quickPrompts]);

  const quickPromptTemplates = useMemo(() => {
    return (
      quickPrompts?.filter(
        (prompt): prompt is QuickPromptItem =>
          !('heading' in prompt) && !prompt.value.trimStart().startsWith('/')
      ) ?? []
    );
  }, [quickPrompts]);

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
          selectedCliTool && 'ring-1 ring-orange-500/30'
        )}
      >
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_FILE_TYPES}
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />

        <div className="composer-input-shell">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={disabled}
                className="composer-control-button composer-plus-button"
                title="Add tools and actions"
                aria-label="Add tools and actions"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              side="top"
              sideOffset={8}
              className="composer-plus-menu glass-panel min-w-[280px] max-h-[72vh] overflow-y-auto border-foreground/10 rounded-xl p-1"
            >
              <DropdownMenuLabel className="composer-menu-label">Add</DropdownMenuLabel>
              <DropdownMenuItem
                onSelect={() => fileInputRef.current?.click()}
                className="composer-plus-menu-item"
              >
                <Paperclip className="composer-menu-icon" />
                <span className="flex-1">Attach files</span>
                <span className="composer-menu-meta">Images, docs, code</span>
              </DropdownMenuItem>
              {imagegenQuickPrompt && (
                <DropdownMenuItem
                  disabled={isSending || isExecutingTool}
                  onSelect={() => handleQuickPrompt(imagegenQuickPrompt.value)}
                  className="composer-plus-menu-item"
                >
                  <Image className="composer-menu-icon" />
                  <span className="flex-1">{imagegenQuickPrompt.label}</span>
                  {imagegenQuickPrompt.hint && (
                    <span className="composer-menu-meta">{imagegenQuickPrompt.hint}</span>
                  )}
                </DropdownMenuItem>
              )}

              {composerActions && composerActions.length > 0 && (
                <DropdownMenuGroup className="md:hidden">
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="composer-menu-label">Workspace</DropdownMenuLabel>
                  {composerActions.map((action) => (
                    <DropdownMenuItem
                      key={action.id}
                      disabled={action.disabled}
                      onSelect={action.onSelect}
                      className={cn('composer-plus-menu-item', action.active && 'is-active')}
                    >
                      {action.icon && <span className="composer-menu-icon">{action.icon}</span>}
                      <span className="flex-1">{action.label}</span>
                      {action.badge !== undefined && action.badge > 0 && (
                        <span
                          className={cn(
                            'composer-menu-badge',
                            action.badgePulse && 'panel-badge-pulse'
                          )}
                        >
                          {action.badge}
                        </span>
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              )}

              {quickPromptTemplates.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="composer-menu-label">Prompts</DropdownMenuLabel>
                  {quickPromptTemplates.map((prompt, index) => (
                    <DropdownMenuItem
                      key={`${prompt.label}-${index}`}
                      disabled={disabled || isSending || isExecutingTool || blocksSubmitForActiveRun}
                      onSelect={() => handleQuickPrompt(prompt.value)}
                      className="composer-plus-menu-item"
                    >
                      <Sparkles className="composer-menu-icon" />
                      <span className="flex-1">{prompt.label}</span>
                      {prompt.hint && <span className="composer-menu-meta">{prompt.hint}</span>}
                    </DropdownMenuItem>
                  ))}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

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
              placeholder={selectedToolName ? `Prompt for ${selectedToolName}...` : 'Message...'}
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
            {onInterrupt && isActive && !queuesWhileActive ? (
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
                title={isActive && queuesWhileActive ? 'Queue message' : 'Send'}
                aria-label={isActive && queuesWhileActive ? 'Queue message' : 'Send message'}
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
