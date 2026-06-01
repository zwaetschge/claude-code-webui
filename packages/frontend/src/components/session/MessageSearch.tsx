import { useState, useCallback, useRef, useEffect } from 'react';
import { Search, X, ArrowUp, ArrowDown, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { api } from '@/services/api';
import { cn } from '@/lib/utils';
import { useDebounce } from '@/hooks/useDebounce';

interface SearchResult {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  createdAt: string;
  sessionName?: string;
}

interface ApiSearchResponse {
  success: boolean;
  data?: SearchResult[];
}

interface MessageSearchProps {
  sessionId?: string;
  onResultClick?: (messageId: string) => void;
  className?: string;
}

export function MessageSearch({ sessionId, onResultClick, className }: MessageSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const debouncedQuery = useDebounce(query, 300);

  const search = useCallback(
    async (searchQuery: string) => {
      if (searchQuery.length < 2) {
        setResults([]);
        return;
      }

      setLoading(true);
      try {
        const params = new URLSearchParams({ q: searchQuery, limit: '20' });
        const endpoint = sessionId
          ? `/api/sessions/${sessionId}/messages/search?${params}`
          : `/api/sessions/messages/search?${params}`;

        const response = await api.get<ApiSearchResponse>(endpoint);

        if (response.data.success && response.data.data) {
          setResults(response.data.data);
          setSelectedIndex(0);
        }
      } catch (error) {
        console.error('Search failed:', error);
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [sessionId]
  );

  useEffect(() => {
    search(debouncedQuery);
  }, [debouncedQuery, search]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (results[selectedIndex]) {
          handleResultClick(results[selectedIndex]);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        setQuery('');
        break;
    }
  };

  const handleResultClick = (result: SearchResult) => {
    onResultClick?.(result.id);
    setIsOpen(false);
    setQuery('');
  };

  const highlightMatch = (text: string, searchQuery: string) => {
    if (!searchQuery) return text;

    const parts = text.split(new RegExp(`(${searchQuery})`, 'gi'));
    return parts.map((part, i) =>
      part.toLowerCase() === searchQuery.toLowerCase() ? (
        <mark key={i} className="bg-yellow-200 dark:bg-yellow-800 rounded px-0.5">
          {part}
        </mark>
      ) : (
        part
      )
    );
  };

  const truncateContent = (content: string, maxLength = 150) => {
    if (content.length <= maxLength) return content;

    // Try to find the query in the content and show context around it
    const queryIndex = content.toLowerCase().indexOf(query.toLowerCase());
    if (queryIndex >= 0) {
      const start = Math.max(0, queryIndex - 50);
      const end = Math.min(content.length, queryIndex + query.length + 100);
      return (
        (start > 0 ? '...' : '') + content.slice(start, end) + (end < content.length ? '...' : '')
      );
    }

    return content.slice(0, maxLength) + '...';
  };

  return (
    <div className={cn('relative', className)}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search messages..."
          className="pl-9 pr-8"
        />
        {(query || loading) && (
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
            {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            {query && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => {
                  setQuery('');
                  setResults([]);
                  inputRef.current?.focus();
                }}
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Results dropdown */}
      {isOpen && query.length >= 2 && (
        <div
          ref={resultsRef}
          className="absolute z-50 w-full mt-1 bg-popover border rounded-lg shadow-lg overflow-hidden"
        >
          {results.length === 0 && !loading ? (
            <div className="p-4 text-center text-muted-foreground text-sm">
              No results found for "{query}"
            </div>
          ) : (
            <ScrollArea className="max-h-80">
              <div className="p-1">
                {results.map((result, index) => (
                  <button
                    key={result.id}
                    className={cn(
                      'w-full text-left p-3 rounded-md transition-colors',
                      selectedIndex === index ? 'bg-accent' : 'hover:bg-muted'
                    )}
                    onClick={() => handleResultClick(result)}
                    onMouseEnter={() => setSelectedIndex(index)}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span
                        className={cn(
                          'text-xs font-medium px-1.5 py-0.5 rounded',
                          result.role === 'user'
                            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                            : 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300'
                        )}
                      >
                        {result.role}
                      </span>
                      {result.sessionName && (
                        <span className="text-xs text-muted-foreground">{result.sessionName}</span>
                      )}
                    </div>
                    <p className="text-sm line-clamp-2">
                      {highlightMatch(truncateContent(result.content), query)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {new Date(result.createdAt).toLocaleString()}
                    </p>
                  </button>
                ))}
              </div>
            </ScrollArea>
          )}

          {/* Keyboard hints */}
          {results.length > 0 && (
            <div className="px-3 py-2 border-t bg-muted/50 flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <ArrowUp className="h-3 w-3" />
                <ArrowDown className="h-3 w-3" />
                Navigate
              </span>
              <span>Enter to select</span>
              <span>Esc to close</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default MessageSearch;
