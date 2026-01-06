import { useState, useRef, useEffect } from 'react';
import {
  ExternalLink,
  RefreshCw,
  Smartphone,
  Tablet,
  Monitor,
  X,
  Maximize2,
  Minimize2,
  Link,
  Globe,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface WebPreviewProps {
  initialUrl?: string;
  className?: string;
  onClose?: () => void;
}

type ViewportSize = 'mobile' | 'tablet' | 'desktop' | 'responsive';

const VIEWPORT_SIZES: Record<ViewportSize, { width: string; height: string; label: string }> = {
  mobile: { width: '375px', height: '667px', label: 'Mobile (375x667)' },
  tablet: { width: '768px', height: '1024px', label: 'Tablet (768x1024)' },
  desktop: { width: '100%', height: '100%', label: 'Desktop' },
  responsive: { width: '100%', height: '100%', label: 'Responsive' },
};

export function WebPreview({ initialUrl = '', className, onClose }: WebPreviewProps) {
  const [url, setUrl] = useState(initialUrl);
  const [inputUrl, setInputUrl] = useState(initialUrl);
  const [viewportSize, setViewportSize] = useState<ViewportSize>('responsive');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Handle URL navigation
  const navigateToUrl = () => {
    let targetUrl = inputUrl.trim();

    // Add protocol if missing
    if (targetUrl && !targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = `http://${targetUrl}`;
    }

    setUrl(targetUrl);
    setHasError(false);
    setIsLoading(true);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      navigateToUrl();
    }
  };

  const handleRefresh = () => {
    if (iframeRef.current) {
      setIsLoading(true);
      setHasError(false);
      // Force reload by resetting src
      const currentSrc = iframeRef.current.src;
      iframeRef.current.src = '';
      setTimeout(() => {
        if (iframeRef.current) {
          iframeRef.current.src = currentSrc;
        }
      }, 50);
    }
  };

  const handleIframeLoad = () => {
    setIsLoading(false);
  };

  const handleIframeError = () => {
    setIsLoading(false);
    setHasError(true);
  };

  const openInNewTab = () => {
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement && containerRef.current) {
      containerRef.current.requestFullscreen();
      setIsFullscreen(true);
    } else if (document.fullscreenElement) {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  // Listen for fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const viewport = VIEWPORT_SIZES[viewportSize];

  return (
    <div
      ref={containerRef}
      className={cn(
        'flex flex-col h-full bg-card border rounded-lg overflow-hidden',
        isFullscreen && 'fixed inset-0 z-50 rounded-none border-0',
        className
      )}
    >
      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-2 p-2 border-b bg-muted/30">
        {/* Navigation controls */}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={handleRefresh}
          disabled={!url}
          title="Refresh"
        >
          <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
        </Button>

        {/* URL bar */}
        <div className="flex-1 flex items-center gap-1 px-2 py-1 rounded-md bg-background border">
          <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <Input
            type="text"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Enter URL (e.g., localhost:3000)"
            className="h-7 border-0 shadow-none focus-visible:ring-0 text-sm"
          />
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2"
            onClick={navigateToUrl}
          >
            Go
          </Button>
        </div>

        {/* Viewport controls */}
        <div className="flex items-center gap-1 border rounded-md p-0.5">
          <Button
            variant={viewportSize === 'mobile' ? 'secondary' : 'ghost'}
            size="icon"
            className="h-7 w-7"
            onClick={() => setViewportSize('mobile')}
            title="Mobile view"
          >
            <Smartphone className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant={viewportSize === 'tablet' ? 'secondary' : 'ghost'}
            size="icon"
            className="h-7 w-7"
            onClick={() => setViewportSize('tablet')}
            title="Tablet view"
          >
            <Tablet className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant={viewportSize === 'desktop' || viewportSize === 'responsive' ? 'secondary' : 'ghost'}
            size="icon"
            className="h-7 w-7"
            onClick={() => setViewportSize('responsive')}
            title="Desktop view"
          >
            <Monitor className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Actions */}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={openInNewTab}
          disabled={!url}
          title="Open in new tab"
        >
          <ExternalLink className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={toggleFullscreen}
          title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        >
          {isFullscreen ? (
            <Minimize2 className="h-4 w-4" />
          ) : (
            <Maximize2 className="h-4 w-4" />
          )}
        </Button>
        {onClose && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onClose}
            title="Close preview"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Viewport info */}
      {viewportSize !== 'responsive' && viewportSize !== 'desktop' && (
        <div className="shrink-0 px-3 py-1 text-xs text-muted-foreground bg-muted/20 border-b">
          {viewport.label}
        </div>
      )}

      {/* Preview area */}
      <div className="flex-1 min-h-0 flex items-center justify-center bg-muted/50 overflow-auto">
        {!url ? (
          <div className="text-center p-8">
            <Link className="h-12 w-12 text-muted-foreground/50 mx-auto mb-4" />
            <h3 className="font-medium mb-2">Web Preview</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Enter a URL above to preview a web application
            </p>
            <div className="flex flex-wrap justify-center gap-2 text-xs text-muted-foreground">
              <button
                onClick={() => {
                  setInputUrl('http://localhost:3000');
                  setUrl('http://localhost:3000');
                }}
                className="px-2 py-1 rounded bg-muted hover:bg-muted/80 transition-colors"
              >
                localhost:3000
              </button>
              <button
                onClick={() => {
                  setInputUrl('http://localhost:5173');
                  setUrl('http://localhost:5173');
                }}
                className="px-2 py-1 rounded bg-muted hover:bg-muted/80 transition-colors"
              >
                localhost:5173
              </button>
              <button
                onClick={() => {
                  setInputUrl('http://localhost:8080');
                  setUrl('http://localhost:8080');
                }}
                className="px-2 py-1 rounded bg-muted hover:bg-muted/80 transition-colors"
              >
                localhost:8080
              </button>
            </div>
          </div>
        ) : hasError ? (
          <div className="text-center p-8">
            <AlertCircle className="h-12 w-12 text-destructive/50 mx-auto mb-4" />
            <h3 className="font-medium mb-2">Failed to load preview</h3>
            <p className="text-sm text-muted-foreground mb-4">
              The page could not be loaded. This might be due to:
            </p>
            <ul className="text-sm text-muted-foreground text-left list-disc pl-6 space-y-1 mb-4">
              <li>The server is not running</li>
              <li>Cross-origin restrictions</li>
              <li>The page blocked iframe embedding</li>
            </ul>
            <div className="flex justify-center gap-2">
              <Button variant="outline" size="sm" onClick={handleRefresh}>
                <RefreshCw className="h-4 w-4 mr-1" />
                Retry
              </Button>
              <Button variant="outline" size="sm" onClick={openInNewTab}>
                <ExternalLink className="h-4 w-4 mr-1" />
                Open in Tab
              </Button>
            </div>
          </div>
        ) : (
          <div
            className={cn(
              'relative bg-white',
              viewportSize !== 'responsive' && viewportSize !== 'desktop' && 'shadow-lg rounded-lg overflow-hidden border'
            )}
            style={{
              width: viewport.width,
              height: viewport.height,
              maxWidth: '100%',
              maxHeight: '100%',
            }}
          >
            {isLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
                <RefreshCw className="h-6 w-6 animate-spin text-primary" />
              </div>
            )}
            <iframe
              ref={iframeRef}
              src={url}
              className="w-full h-full border-0"
              onLoad={handleIframeLoad}
              onError={handleIframeError}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
              title="Web Preview"
            />
          </div>
        )}
      </div>

      {/* Status bar */}
      {url && (
        <div className="shrink-0 px-3 py-1 text-xs text-muted-foreground bg-muted/20 border-t flex items-center justify-between">
          <span className="truncate">{url}</span>
          {isLoading && <span className="shrink-0 ml-2">Loading...</span>}
        </div>
      )}
    </div>
  );
}

export default WebPreview;
