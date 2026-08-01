import path from 'node:path';
import type { Response } from 'express';

const ACTIVE_DOCUMENT_EXTENSIONS = new Set(['.html', '.htm', '.svg', '.xml', '.xhtml']);

export function isActiveDocument(filePath: string): boolean {
  return ACTIVE_DOCUMENT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/** Prevent user/workspace documents from executing with the WebUI origin. */
export function applyUntrustedFileHeaders(res: Response, filePath: string): boolean {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

  if (!isActiveDocument(filePath)) return false;

  const filename = path.basename(filePath).replace(/[\r\n"]/g, '') || 'download';
  const asciiFallback = filename.replace(/[^\x20-\x7E]/g, '_') || 'download';
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`
  );
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
  return true;
}

export { ACTIVE_DOCUMENT_EXTENSIONS };
