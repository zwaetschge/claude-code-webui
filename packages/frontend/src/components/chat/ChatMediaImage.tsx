import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Image as ImageIcon, Maximize2, RefreshCw } from 'lucide-react';
import type { ChatMedia } from '@plum-code-webui/shared';
import { api } from '@/services/api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

interface ChatMediaImageProps {
  media: ChatMedia;
  sessionId: string;
}

export function buildChatMediaUrl(sessionId: string, mediaId: string): string {
  return `/api/sessions/${encodeURIComponent(sessionId)}/media/${encodeURIComponent(mediaId)}`;
}

export function ChatMediaImage({ media, sessionId }: ChatMediaImageProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [imageReady, setImageReady] = useState(false);
  const [error, setError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const mediaUrl = useMemo(() => buildChatMediaUrl(sessionId, media.id), [media.id, sessionId]);
  const altText = media.altText?.trim() || media.filename || 'Assistant image';

  useEffect(() => {
    const controller = new AbortController();
    let activeObjectUrl: string | null = null;
    let cancelled = false;

    setObjectUrl(null);
    setImageReady(false);
    setError(false);

    void api
      .download(mediaUrl, { signal: controller.signal })
      .then((response) => response.blob())
      .then((blob) => {
        if (cancelled) return;
        if (blob.size === 0) throw new Error('Empty image response');
        activeObjectUrl = URL.createObjectURL(blob);
        setObjectUrl(activeObjectUrl);
      })
      .catch((requestError: unknown) => {
        if (controller.signal.aborted) return;
        console.warn(`[CHAT MEDIA] Failed to load ${media.id}:`, requestError);
        setError(true);
      });

    return () => {
      cancelled = true;
      controller.abort();
      if (activeObjectUrl) URL.revokeObjectURL(activeObjectUrl);
    };
  }, [media.id, mediaUrl, retryKey]);

  const markImageFailed = () => {
    setExpanded(false);
    setImageReady(false);
    setError(true);
  };

  if (error) {
    return (
      <div className="chat-media-error" role="alert">
        <AlertCircle aria-hidden="true" />
        <div>
          <strong>Image could not be loaded</strong>
          <span>{media.filename}</span>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setRetryKey((value) => value + 1)}
        >
          <RefreshCw aria-hidden="true" />
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="chat-media-shell">
      {!imageReady && (
        <div className="chat-media-loading" role="status" aria-label={`Loading ${altText}`}>
          <ImageIcon aria-hidden="true" />
          <span>Loading image…</span>
        </div>
      )}

      {objectUrl && (
        <>
          <button
            type="button"
            className="chat-media-trigger"
            onClick={() => setExpanded(true)}
            aria-label={`Open ${altText} at full size`}
            hidden={!imageReady}
          >
            <img
              src={objectUrl}
              alt={altText}
              className="chat-media-image"
              onLoad={() => setImageReady(true)}
              onError={markImageFailed}
            />
            <span className="chat-media-expand" aria-hidden="true">
              <Maximize2 />
            </span>
          </button>

          {!imageReady && (
            <img
              src={objectUrl}
              alt=""
              className="chat-media-preload"
              onLoad={() => setImageReady(true)}
              onError={markImageFailed}
            />
          )}

          <Dialog open={expanded} onOpenChange={setExpanded}>
            <DialogContent className="chat-media-dialog">
              <DialogTitle className="sr-only">{altText}</DialogTitle>
              <img src={objectUrl} alt={altText} onError={markImageFailed} />
              <p title={media.filename}>{media.filename}</p>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}
