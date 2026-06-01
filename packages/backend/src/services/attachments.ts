import fs from 'fs/promises';
import path from 'path';

export interface FileAttachmentData {
  data: string;
  mimeType: string;
  filename?: string;
}

export type AttachmentType = 'image' | 'text' | 'pdf' | 'document';

export interface MaterializedAttachmentFile {
  path: string;
  filename: string;
  type: AttachmentType;
  mimeType: string;
  sizeBytes: number;
}

export interface InlineTextAttachment {
  filename: string;
  content: string;
  sizeBytes: number;
}

export interface RejectedAttachment {
  filename: string;
  reason: string;
  sizeBytes?: number;
}

export interface MaterializedAttachments {
  files: MaterializedAttachmentFile[];
  inlineText: InlineTextAttachment[];
  rejected: RejectedAttachment[];
}

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_INLINE_TEXT_BYTES = 50 * 1024;

export function classifyAttachment(mimeType: string, filename?: string): AttachmentType {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType === 'application/pdf') return 'pdf';
  if (
    mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/xml' ||
    mimeType === 'application/javascript' ||
    (filename &&
      /\.(md|txt|json|yaml|yml|js|ts|tsx|jsx|py|rb|go|rs|java|sql|sh|html|css|xml|csv|toml|ini|cfg|conf|env|gitignore)$/i.test(
        filename
      ))
  ) {
    return 'text';
  }
  return 'document';
}

export function extensionForAttachment(mimeType: string, filename?: string): string {
  if (filename) {
    const ext = filename.split('.').pop()?.toLowerCase();
    if (ext) return ext;
  }

  const mimeMap: Record<string, string> = {
    'text/plain': 'txt',
    'text/markdown': 'md',
    'text/html': 'html',
    'text/css': 'css',
    'text/csv': 'csv',
    'application/json': 'json',
    'application/xml': 'xml',
    'application/pdf': 'pdf',
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
  };
  return mimeMap[mimeType] || 'bin';
}

export function sanitizeAttachmentFilename(filename: string): string {
  const cleaned = filename.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^_+/, '');
  return cleaned || 'attachment';
}

export async function materializeAttachments(
  attachments: FileAttachmentData[] | undefined,
  workingDirectory: string
): Promise<MaterializedAttachments> {
  const result: MaterializedAttachments = { files: [], inlineText: [], rejected: [] };
  if (!attachments?.length) return result;

  const attachmentDir = path.join(workingDirectory, '.claude-webui-attachments');
  await fs.mkdir(attachmentDir, { recursive: true });

  for (const [index, attachment] of attachments.entries()) {
    const ext = extensionForAttachment(attachment.mimeType, attachment.filename);
    const fallbackName = `file_${Date.now()}_${index}.${ext}`;
    const originalName = attachment.filename || fallbackName;
    let buffer: Buffer;

    try {
      buffer = Buffer.from(attachment.data, 'base64');
    } catch {
      result.rejected.push({
        filename: originalName,
        reason: 'Attachment data was not valid base64',
      });
      continue;
    }

    if (buffer.length > MAX_ATTACHMENT_BYTES) {
      result.rejected.push({
        filename: originalName,
        reason: `Attachment exceeds ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)} MB limit`,
        sizeBytes: buffer.length,
      });
      continue;
    }

    const type = classifyAttachment(attachment.mimeType, attachment.filename);
    const safeName = sanitizeAttachmentFilename(originalName);

    if (type === 'text' && buffer.length < MAX_INLINE_TEXT_BYTES) {
      result.inlineText.push({
        filename: safeName,
        content: buffer.toString('utf-8'),
        sizeBytes: buffer.length,
      });
      continue;
    }

    const filepath = path.join(attachmentDir, `${Date.now()}_${index}_${safeName}`);
    await fs.writeFile(filepath, buffer);
    result.files.push({
      path: filepath,
      filename: path.basename(filepath),
      type,
      mimeType: attachment.mimeType,
      sizeBytes: buffer.length,
    });
  }

  return result;
}
