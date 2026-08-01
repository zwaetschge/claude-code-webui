export const DEFAULT_SESSION_ICON_THUMBNAIL_SIZE = 96;
export type SessionIconThumbnailSize = 32 | 64 | 96 | 128 | 256;

export function buildSessionIconSrc(
  url: string,
  token: string | null,
  thumbnailSize: SessionIconThumbnailSize | null = DEFAULT_SESSION_ICON_THUMBNAIL_SIZE
): string {
  if (!url.startsWith('/')) return url;

  const params: Array<[string, string]> = [];
  if (thumbnailSize !== null) params.push(['size', String(thumbnailSize)]);
  if (token) params.push(['token', token]);
  if (params.length === 0) return url;

  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}${params
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&')}`;
}
