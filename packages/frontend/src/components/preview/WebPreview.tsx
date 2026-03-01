import { useState, useEffect } from 'react';
import {
  ExternalLink,
  Plus,
  Trash2,
  Globe,
  Server,
  Zap,
  Database,
  Settings,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface WebPreviewProps {
  className?: string;
}

interface SavedUrl {
  url: string;
  name: string;
  icon: 'globe' | 'server' | 'zap' | 'database' | 'settings';
}

const DEFAULT_URLS: SavedUrl[] = [
  { url: 'http://localhost:3000', name: 'Dev Server (3000)', icon: 'server' },
  { url: 'http://localhost:5173', name: 'Vite (5173)', icon: 'zap' },
  { url: 'http://localhost:8080', name: 'App (8080)', icon: 'globe' },
  { url: 'http://localhost:4000', name: 'API (4000)', icon: 'database' },
];

const ICON_MAP = {
  globe: Globe,
  server: Server,
  zap: Zap,
  database: Database,
  settings: Settings,
};

function getStoredUrls(): SavedUrl[] {
  try {
    const stored = localStorage.getItem('webpreview_urls');
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // Ignore parsing errors
  }
  return DEFAULT_URLS;
}

function saveUrls(urls: SavedUrl[]): void {
  localStorage.setItem('webpreview_urls', JSON.stringify(urls));
}

export function WebPreview({ className }: WebPreviewProps) {
  const [urls, setUrls] = useState<SavedUrl[]>(getStoredUrls);
  const [newUrl, setNewUrl] = useState('');
  const [newName, setNewName] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  // Save to localStorage when URLs change
  useEffect(() => {
    saveUrls(urls);
  }, [urls]);

  const openUrl = (url: string) => {
    // Ensure URL has protocol
    let targetUrl = url;
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = `http://${targetUrl}`;
    }
    window.open(targetUrl, '_blank', 'noopener,noreferrer');
  };

  const addUrl = () => {
    if (!newUrl.trim()) return;

    const url = newUrl.trim().startsWith('http') ? newUrl.trim() : `http://${newUrl.trim()}`;
    const name = newName.trim() || new URL(url).host;

    setUrls([...urls, { url, name, icon: 'globe' }]);
    setNewUrl('');
    setNewName('');
    setIsAdding(false);
  };

  const removeUrl = (index: number) => {
    setUrls(urls.filter((_, i) => i !== index));
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      addUrl();
    }
    if (e.key === 'Escape') {
      setIsAdding(false);
      setNewUrl('');
      setNewName('');
    }
  };

  return (
    <div className={cn('flex flex-col h-full bg-card border rounded-lg overflow-hidden', className)}>
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between p-3 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          <Globe className="h-5 w-5 text-muted-foreground" />
          <h3 className="font-medium">Quick Links</h3>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsAdding(!isAdding)}
          className="gap-1"
        >
          <Plus className="h-4 w-4" />
          Add URL
        </Button>
      </div>

      {/* Add URL form */}
      {isAdding && (
        <div className="shrink-0 p-3 border-b bg-muted/20 space-y-2">
          <Input
            type="text"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder="URL (e.g., localhost:3000)"
            className="h-9"
            autoFocus
          />
          <div className="flex gap-2">
            <Input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={handleKeyPress}
              placeholder="Name (optional)"
              className="h-9 flex-1"
            />
            <Button size="sm" onClick={addUrl} disabled={!newUrl.trim()}>
              Add
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setIsAdding(false);
                setNewUrl('');
                setNewName('');
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* URL list */}
      <div className="flex-1 min-h-0 overflow-auto p-3">
        {urls.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Globe className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p className="text-sm">No saved URLs</p>
            <p className="text-xs mt-1">Click "Add URL" to save quick links</p>
          </div>
        ) : (
          <div className="grid gap-2">
            {urls.map((item, index) => {
              const IconComponent = ICON_MAP[item.icon];
              return (
                <div
                  key={`${item.url}-${index}`}
                  className="group flex items-center gap-3 p-3 rounded-lg border bg-background hover:bg-muted/50 transition-colors"
                >
                  <div className="p-2 rounded-md bg-primary/10 shrink-0">
                    <IconComponent className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{item.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{item.url}</p>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => removeUrl(index)}
                      title="Remove"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => openUrl(item.url)}
                    className="gap-1.5 shrink-0"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Open
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Quick open */}
      <div className="shrink-0 p-3 border-t bg-muted/20">
        <div className="flex gap-2">
          <div className="flex-1 flex items-center gap-1 px-3 py-2 rounded-md bg-background border">
            <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
            <Input
              type="text"
              placeholder="Enter URL and press Enter to open..."
              className="h-7 border-0 shadow-none focus-visible:ring-0 text-sm"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const input = e.currentTarget.value.trim();
                  if (input) {
                    openUrl(input);
                    e.currentTarget.value = '';
                  }
                }
              }}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-2 text-center">
          URLs open in a new browser tab
        </p>
      </div>
    </div>
  );
}

export default WebPreview;
