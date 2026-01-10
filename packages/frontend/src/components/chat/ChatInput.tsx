import { useState, useRef, useCallback, useMemo, memo, useEffect } from 'react';
import { Send, Paperclip, Loader2, X, FileText, FileCode, File as FileIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CommandMenu } from '@/components/chat/CommandMenu';
import { cn } from '@/lib/utils';
import type { Command } from '@claude-code-webui/shared';

type AttachmentType = 'image' | 'text' | 'pdf' | 'document';

interface FileAttachment {
  id: string;
  file: File;
  preview: string | null;
  type: AttachmentType;
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
  '.md', '.markdown',
  '.txt', '.csv', '.tsv',
  '.json', '.xml', '.yaml', '.yml',
  '.js', '.ts', '.tsx', '.jsx',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift',
  '.c', '.cpp', '.h', '.hpp', '.cs',
  '.html', '.css', '.scss', '.sass', '.less',
  '.sh', '.bash', '.zsh', '.fish',
  '.sql', '.graphql',
  '.env', '.gitignore', '.dockerfile',
  '.toml', '.ini', '.cfg', '.conf',
].join(',');

function getAttachmentType(mimeType: string, filename: string): AttachmentType {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType === 'application/pdf') return 'pdf';
  if (
    mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/xml' ||
    mimeType === 'application/javascript' ||
    filename.match(/\.(md|txt|json|yaml|yml|js|ts|tsx|jsx|py|rb|go|rs|java|sql|sh|html|css|xml|csv)$/i)
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
  commands?: Command[];
  selectedToolName?: string | null;
  selectedCliTool?: string | null;
  disabled?: boolean;
  isSending?: boolean;
  isExecutingTool?: boolean;
}

export const ChatInput = memo(function ChatInput({
  onSendMessage,
  onSendMessageWithFiles,
  onCommandExecute,
  commands,
  selectedToolName,
  selectedCliTool,
  disabled,
  isSending,
  isExecutingTool,
}: ChatInputProps) {
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [showCommandMenu, setShowCommandMenu] = useState(false);
  const [commandMenuIndex, setCommandMenuIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Memoized filtered commands
  const filteredCommands = useMemo(() => {
    if (!commands || !showCommandMenu) return [];
    const filter = input.startsWith('/') ? input.slice(1).toLowerCase() : '';
    return commands.filter(cmd => cmd.name.toLowerCase().includes(filter));
  }, [commands, showCommandMenu, input]);

  // Handle paste for images
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const imageItems = Array.from(items).filter(item => item.type.startsWith('image/'));
      if (imageItems.length === 0) return;

      e.preventDefault();
      const files = imageItems
        .map(item => item.getAsFile())
        .filter((f): f is File => f !== null);

      addFiles(files);
    };

    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, []);

  const addFiles = useCallback((files: File[]) => {
    const maxFiles = 10;
    const remaining = maxFiles - attachments.length;

    if (remaining <= 0) return;

    const filesToAdd = files.slice(0, remaining);
    const newAttachments: FileAttachment[] = filesToAdd.map(file => {
      const type = getAttachmentType(file.type, file.name);
      return {
        id: generateId(),
        file,
        preview: type === 'image' ? URL.createObjectURL(file) : null,
        type,
      };
    });

    setAttachments(prev => [...prev, ...newAttachments]);
  }, [attachments.length]);

  const removeAttachment = useCallback((attachmentId: string) => {
    setAttachments(prev => {
      const attachment = prev.find(a => a.id === attachmentId);
      if (attachment?.preview) {
        URL.revokeObjectURL(attachment.preview);
      }
      return prev.filter(a => a.id !== attachmentId);
    });
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    addFiles(files);
    e.target.value = '';
  }, [addFiles]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!input.trim() && attachments.length === 0) || disabled || isSending || isExecutingTool) return;

    const currentInput = input;
    const currentAttachments = [...attachments];

    // Clear input immediately for responsiveness
    setInput('');

    // Check for slash commands
    if (currentInput.startsWith('/')) {
      setShowCommandMenu(false);
      await onCommandExecute(currentInput);
      return;
    }

    // Send message
    if (currentAttachments.length > 0) {
      onSendMessageWithFiles(currentInput, currentAttachments.map(a => a.file));
      // Clean up previews
      currentAttachments.forEach(a => {
        if (a.preview) URL.revokeObjectURL(a.preview);
      });
      setAttachments([]);
    } else {
      onSendMessage(currentInput);
    }
  }, [input, attachments, disabled, isSending, isExecutingTool, onCommandExecute, onSendMessage, onSendMessageWithFiles]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
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

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (showCommandMenu && filteredCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setCommandMenuIndex(i => Math.min(i + 1, filteredCommands.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setCommandMenuIndex(i => Math.max(i - 1, 0));
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
  }, [showCommandMenu, filteredCommands, commandMenuIndex, handleSubmit]);

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
    <div className="shrink-0 pt-4 border-t space-y-3">
      {/* File attachments preview */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 p-3 rounded-xl bg-muted/50 border animate-scale-in">
          {attachments.map((attachment) => (
            <div key={attachment.id} className="relative group">
              {attachment.type === 'image' && attachment.preview ? (
                <img
                  src={attachment.preview}
                  alt="Attachment"
                  className="h-16 w-16 object-cover rounded-lg border shadow-sm"
                />
              ) : (
                <div className="h-16 w-40 flex items-center gap-2 px-3 rounded-lg border shadow-sm bg-background">
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

      <form onSubmit={handleSubmit} className="flex gap-2 items-center">
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_FILE_TYPES}
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />

        {/* File upload button */}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => fileInputRef.current?.click()}
          className="h-12 w-12 md:h-10 md:w-10 shrink-0"
          title="Attach files (images, text, pdf, code)"
        >
          <Paperclip className="h-5 w-5" />
        </Button>

        {/* Text input */}
        <div className="flex-1 flex items-center relative">
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
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={selectedToolName
              ? `Prompt for ${selectedToolName}...`
              : "Message..."
            }
            className={cn(
              "w-full h-12 md:h-10 px-4 rounded-xl border bg-background focus:outline-none focus:ring-2 focus:ring-ring text-base md:text-sm",
              selectedCliTool && "border-orange-500/30 focus:ring-orange-500/50"
            )}
          />
        </div>

        {/* Send button */}
        <Button
          type="submit"
          size="icon"
          disabled={(!input.trim() && attachments.length === 0) || isSending || isExecutingTool}
          className={cn(
            "h-12 w-12 md:h-10 md:w-10 shrink-0",
            selectedCliTool && "bg-orange-600 hover:bg-orange-700"
          )}
        >
          {isExecutingTool ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </form>
    </div>
  );
});
