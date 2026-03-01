import { useState, useRef, useCallback, useEffect } from 'react';
import { Image, X, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface ImageAttachment {
  id: string;
  file: File;
  preview: string;
  type: 'image';
}

interface ImageUploadProps {
  attachments: ImageAttachment[];
  onAttachmentsChange: (attachments: ImageAttachment[]) => void;
  maxImages?: number;
  maxSizeMB?: number;
  className?: string;
}

function generateId() {
  return Math.random().toString(36).substring(2, 9);
}

export function ImageUpload({
  attachments,
  onAttachmentsChange,
  maxImages = 5,
  maxSizeMB = 10,
  className,
}: ImageUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  const maxSizeBytes = maxSizeMB * 1024 * 1024;

  const validateAndAddImages = useCallback((files: File[]) => {
    setError(null);
    const imageFiles = files.filter(file => file.type.startsWith('image/'));

    if (imageFiles.length === 0) {
      setError('Please select image files only');
      return;
    }

    const remaining = maxImages - attachments.length;
    if (remaining <= 0) {
      setError(`Maximum ${maxImages} images allowed`);
      return;
    }

    const filesToAdd = imageFiles.slice(0, remaining);
    const oversizedFiles = filesToAdd.filter(f => f.size > maxSizeBytes);

    if (oversizedFiles.length > 0) {
      setError(`Some files exceed ${maxSizeMB}MB limit`);
      return;
    }

    const newAttachments: ImageAttachment[] = filesToAdd.map(file => ({
      id: generateId(),
      file,
      preview: URL.createObjectURL(file),
      type: 'image' as const,
    }));

    onAttachmentsChange([...attachments, ...newAttachments]);
  }, [attachments, maxImages, maxSizeBytes, maxSizeMB, onAttachmentsChange]);

  const removeAttachment = useCallback((id: string) => {
    const attachment = attachments.find(a => a.id === id);
    if (attachment) {
      URL.revokeObjectURL(attachment.preview);
    }
    onAttachmentsChange(attachments.filter(a => a.id !== id));
  }, [attachments, onAttachmentsChange]);

  // Handle paste
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

      validateAndAddImages(files);
    };

    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [validateAndAddImages]);

  // Handle drag and drop
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget === dropZoneRef.current) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    validateAndAddImages(files);
  }, [validateAndAddImages]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    validateAndAddImages(files);
    e.target.value = '';
  }, [validateAndAddImages]);

  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  // Clean up object URLs on unmount
  useEffect(() => {
    return () => {
      attachments.forEach(a => URL.revokeObjectURL(a.preview));
    };
  }, []);

  return (
    <div className={cn('space-y-2', className)}>
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleFileSelect}
      />

      {/* Attachments preview */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 p-2 rounded-lg bg-muted/50 border">
          {attachments.map((attachment) => (
            <div
              key={attachment.id}
              className="relative group animate-scale-in"
            >
              <img
                src={attachment.preview}
                alt="Attachment"
                className="h-16 w-16 object-cover rounded-lg border"
              />
              <button
                onClick={() => removeAttachment(attachment.id)}
                className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-destructive text-destructive-foreground opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          {attachments.length < maxImages && (
            <button
              onClick={openFilePicker}
              className="h-16 w-16 rounded-lg border-2 border-dashed border-muted-foreground/30 hover:border-primary/50 flex items-center justify-center text-muted-foreground hover:text-primary transition-colors"
            >
              <Upload className="h-5 w-5" />
            </button>
          )}
        </div>
      )}

      {/* Drop zone hint (when no attachments) */}
      {attachments.length === 0 && (
        <div
          ref={dropZoneRef}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          className={cn(
            'relative rounded-lg border-2 border-dashed p-3 transition-all',
            isDragging
              ? 'border-primary bg-primary/5'
              : 'border-muted-foreground/20 hover:border-primary/40'
          )}
        >
          <div className="flex items-center justify-center gap-4 text-sm text-muted-foreground">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={openFilePicker}
              className="gap-2"
            >
              <Image className="h-4 w-4" />
              Add Image
            </Button>
            <span className="text-xs opacity-60">or paste / drop</span>
          </div>
          {isDragging && (
            <div className="absolute inset-0 flex items-center justify-center bg-primary/10 rounded-lg">
              <p className="text-sm font-medium text-primary">Drop images here</p>
            </div>
          )}
        </div>
      )}

      {/* Error message */}
      {error && (
        <p className="text-xs text-destructive animate-fade-in">{error}</p>
      )}
    </div>
  );
}

// Compact version for inline use in chat input
interface ImageUploadButtonProps {
  attachments: ImageAttachment[];
  onAttachmentsChange: (attachments: ImageAttachment[]) => void;
}

export function ImageUploadButton({ attachments, onAttachmentsChange }: ImageUploadButtonProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const imageFiles = files.filter(file => file.type.startsWith('image/'));

    const newAttachments: ImageAttachment[] = imageFiles.map(file => ({
      id: generateId(),
      file,
      preview: URL.createObjectURL(file),
      type: 'image' as const,
    }));

    onAttachmentsChange([...attachments, ...newAttachments]);
    e.target.value = '';
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleFileSelect}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => fileInputRef.current?.click()}
        className="h-10 w-10 shrink-0"
      >
        <Image className="h-5 w-5" />
      </Button>
    </>
  );
}
