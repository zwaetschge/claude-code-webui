import path from 'path';

/**
 * Sanitize a string for use in shell commands
 * Removes/escapes shell metacharacters to prevent command injection
 */
export function sanitizeShellArg(arg: string): string {
  // Remove null bytes
  let sanitized = arg.replace(/\0/g, '');

  // Remove common shell metacharacters that could enable command injection
  // Only allow alphanumeric, dots, dashes, underscores, slashes, colons, and @
  sanitized = sanitized.replace(/[^a-zA-Z0-9.\-_/:@]/g, '');

  return sanitized;
}

/**
 * Validate a GitHub repository string (owner/repo format)
 */
export function isValidGitHubRepo(repo: string): boolean {
  // GitHub repo format: owner/repo or owner/repo.git
  // Owner: alphanumeric and hyphens, 1-39 chars
  // Repo: alphanumeric, hyphens, underscores, dots
  const githubRepoRegex = /^[a-zA-Z0-9][-a-zA-Z0-9]{0,38}\/[a-zA-Z0-9._-]+$/;
  return githubRepoRegex.test(repo.replace(/\.git$/, ''));
}

/**
 * Validate a git URL for safe cloning
 * Only allows https:// URLs to prevent SSRF and protocol attacks
 */
export function isValidGitUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    // Only allow https protocol to prevent SSRF via file://, git://, ssh://, etc.
    if (parsed.protocol !== 'https:') {
      return false;
    }
    // Block localhost and private IP ranges
    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.') ||
      hostname.startsWith('172.') ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal')
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Sanitize a filename to prevent path traversal and other attacks
 * Removes dangerous characters and path components
 */
export function sanitizeFilename(filename: string): string {
  // Remove null bytes
  let sanitized = filename.replace(/\0/g, '');

  // Get just the filename without any path
  sanitized = path.basename(sanitized);

  // Remove path traversal attempts
  sanitized = sanitized.replace(/\.\./g, '');

  // Replace potentially dangerous characters
  // Keep alphanumeric, dots, dashes, underscores, spaces
  sanitized = sanitized.replace(/[^a-zA-Z0-9.\-_\s]/g, '_');

  // Collapse multiple underscores/dots
  sanitized = sanitized.replace(/_+/g, '_');
  sanitized = sanitized.replace(/\.+/g, '.');

  // Remove leading/trailing dots and underscores
  sanitized = sanitized.replace(/^[._]+|[._]+$/g, '');

  // Ensure there's still a filename
  if (!sanitized || sanitized.length === 0) {
    sanitized = 'unnamed_file';
  }

  // Limit filename length
  if (sanitized.length > 255) {
    const ext = path.extname(sanitized);
    const name = path.basename(sanitized, ext);
    sanitized = name.substring(0, 255 - ext.length) + ext;
  }

  return sanitized;
}

/**
 * Validate MIME type against actual file content (basic validation)
 * Returns true if the file appears to match its claimed type
 */
export function validateMimeType(buffer: Buffer, claimedMimeType: string): boolean {
  // Check common file signatures (magic numbers)
  const signatures: Record<string, number[][]> = {
    'image/png': [[0x89, 0x50, 0x4e, 0x47]],
    'image/jpeg': [[0xff, 0xd8, 0xff]],
    'image/gif': [[0x47, 0x49, 0x46, 0x38]],
    'image/webp': [[0x52, 0x49, 0x46, 0x46]], // RIFF header
    'application/pdf': [[0x25, 0x50, 0x44, 0x46]], // %PDF
    'application/zip': [
      [0x50, 0x4b, 0x03, 0x04],
      [0x50, 0x4b, 0x05, 0x06],
    ],
  };

  const expectedSignatures = signatures[claimedMimeType];
  if (!expectedSignatures) {
    // No signature check for this type - allow it
    return true;
  }

  return expectedSignatures.some((signature) =>
    signature.every((byte, index) => buffer[index] === byte)
  );
}

/**
 * Redact likely credentials from process output before it is sent back to clients.
 */
export function redactSensitiveText(value: string): string {
  return value
    .replace(
      /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g,
      '[REDACTED_PRIVATE_KEY]'
    )
    .replace(/\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g, '[REDACTED_OPENAI_KEY]')
    .replace(/\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, '[REDACTED_ANTHROPIC_KEY]')
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{30,}\b/g, '[REDACTED_GITHUB_TOKEN]')
    .replace(/\bAIza[0-9A-Za-z_-]{35}\b/g, '[REDACTED_GOOGLE_KEY]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED_AWS_ACCESS_KEY]')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[REDACTED_JWT]')
    .replace(/\b(Authorization\s*[:=]\s*Bearer\s+)[^\s'"]+/gi, '$1[REDACTED_TOKEN]')
    .replace(
      /\b([A-Z0-9_]*(?:API[_-]?KEY|ACCESS[_-]?TOKEN|REFRESH[_-]?TOKEN|ID[_-]?TOKEN|CLIENT[_-]?SECRET|SESSION[_-]?SECRET|JWT[_-]?SECRET|PASSWORD|COOKIE|CREDENTIAL|PRIVATE[_-]?KEY|SECRET)[A-Z0-9_]*\s*=\s*)([^\s'"]+)/gi,
      '$1[REDACTED]'
    )
    .replace(
      /\b((?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|session[_-]?secret|jwt[_-]?secret|password|cookie|credential|private[_-]?key|secret)\s*[:=]\s*)(['"]?)([^'",\s}]{8,})(\2)/gi,
      '$1$2[REDACTED]$4'
    );
}

/**
 * List of allowed MIME types for file uploads
 */
export const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  // Images
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  // Documents
  'application/pdf',
  'application/json',
  'application/xml',
  'text/plain',
  'text/csv',
  'text/markdown',
  'text/html',
  'text/css',
  'text/javascript',
  // Code files (often detected as octet-stream)
  'application/octet-stream',
  'application/javascript',
  'application/typescript',
  // Spreadsheets
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // .xls
  'application/vnd.oasis.opendocument.spreadsheet', // .ods
  // Word documents
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/msword', // .doc
  'application/vnd.oasis.opendocument.text', // .odt
  // Presentations
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
  'application/vnd.ms-powerpoint', // .ppt
  // Archives
  'application/zip',
  'application/x-tar',
  'application/gzip',
  'application/x-7z-compressed',
  'application/x-rar-compressed',
]);
