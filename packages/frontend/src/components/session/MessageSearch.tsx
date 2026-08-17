import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { ArrowDown, ArrowUp, Loader2, Search, X } from 'lucide-react';
import { api } from '@/services/api';
import { cn } from '@/lib/utils';
import { useDebounce } from '@/hooks/useDebounce';

export interface MessageSearchResult {
  id: string;
  sessionId: string;
  chatId?: string | null;
  role: string;
  content: string;
  snippet?: string;
  createdAt: string;
  sessionName?: string;
  jump?: {
    sessionId: string;
    chatId: string | null;
    messageId: string;
  };
}

interface ApiSearchResponse {
  success: boolean;
  data?: MessageSearchResult[];
}

interface MessageSearchProps {
  sessionId?: string;
  onResultClick?: (result: MessageSearchResult) => void;
  className?: string;
  presentation?: 'popover' | 'panel';
  autoFocus?: boolean;
  placeholder?: string;
}

const SEARCH_LIMIT = 40;
const FTS_MARKER_PATTERN = /(?:\u0001|\u0002|<\/?b>|<\/?mark>)/gi;

function cleanSnippet(value: string): string {
  return value.replace(FTS_MARKER_PATTERN, '').replace(/\s+/g, ' ').trim();
}

function getContextSnippet(result: MessageSearchResult, query: string, maxLength = 190): string {
  const source = cleanSnippet(result.snippet || result.content || '');
  if (source.length <= maxLength) return source;

  const matchAt = source.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  if (matchAt < 0) return `${source.slice(0, maxLength).trimEnd()}…`;

  const before = Math.floor((maxLength - query.length) * 0.42);
  const start = Math.max(0, matchAt - before);
  const end = Math.min(source.length, start + maxLength);
  return `${start > 0 ? '…' : ''}${source.slice(start, end).trim()}${end < source.length ? '…' : ''}`;
}

function HighlightedSnippet({ text, query }: { text: string; query: string }) {
  const normalizedQuery = query.trim();
  const parts = useMemo(() => {
    if (!normalizedQuery) return [text];
    const escaped = normalizedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return text.split(new RegExp(`(${escaped})`, 'gi'));
  }, [normalizedQuery, text]);

  return (
    <>
      {parts.map((part, index) =>
        part.localeCompare(normalizedQuery, undefined, { sensitivity: 'accent' }) === 0 ? (
          <mark key={`${part}-${index}`} className="message-search-highlight">
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </>
  );
}

export function getMessageSearchTarget(result: MessageSearchResult) {
  return {
    sessionId: result.jump?.sessionId || result.sessionId,
    chatId: result.jump?.chatId ?? result.chatId ?? null,
    messageId: result.jump?.messageId || result.id,
  };
}

export function MessageSearch({
  sessionId,
  onResultClick,
  className,
  presentation = 'popover',
  autoFocus = false,
  placeholder,
}: MessageSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MessageSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isOpen, setIsOpen] = useState(presentation === 'panel');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const requestVersionRef = useRef(0);
  const listboxId = useId();
  const statusId = useId();
  const debouncedQuery = useDebounce(query.trim(), 220);

  const search = useCallback(
    async (searchQuery: string) => {
      if (searchQuery.length < 2) {
        setResults([]);
        setError('');
        setLoading(false);
        return;
      }

      const requestVersion = ++requestVersionRef.current;
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({ q: searchQuery, limit: String(SEARCH_LIMIT) });
        const endpoint = sessionId
          ? `/api/sessions/${sessionId}/messages/search?${params}`
          : `/api/sessions/messages/search?${params}`;
        const response = await api.get<ApiSearchResponse>(endpoint);
        if (requestVersion !== requestVersionRef.current) return;
        setResults(response.data.success && response.data.data ? response.data.data : []);
        setSelectedIndex(0);
      } catch (searchError) {
        if (requestVersion !== requestVersionRef.current) return;
        setResults([]);
        setError(searchError instanceof Error ? searchError.message : 'Search could not be loaded.');
      } finally {
        if (requestVersion === requestVersionRef.current) setLoading(false);
      }
    },
    [sessionId]
  );

  useEffect(() => {
    void search(debouncedQuery);
  }, [debouncedQuery, search]);

  useEffect(() => {
    if (!autoFocus) return;
    window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 0);
  }, [autoFocus]);

  useEffect(() => {
    if (presentation === 'panel') return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [presentation]);

  const chooseResult = useCallback(
    (result: MessageSearchResult) => {
      onResultClick?.(result);
      setIsOpen(presentation === 'panel');
      setQuery('');
      setResults([]);
    },
    [onResultClick, presentation]
  );

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (query) {
        setQuery('');
        setResults([]);
      } else if (presentation === 'popover') {
        setIsOpen(false);
        inputRef.current?.blur();
      }
      return;
    }

    if (!isOpen || results.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedIndex((current) => Math.min(current + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndex((current) => Math.max(current - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const result = results[selectedIndex];
      if (result) chooseResult(result);
    }
  };

  const hasSearch = query.trim().length >= 2;
  const showResults = presentation === 'panel' || (isOpen && hasSearch);
  const statusText = loading
    ? 'Searching messages'
    : error
      ? error
      : hasSearch
        ? `${results.length} ${results.length === 1 ? 'result' : 'results'}`
        : 'Type at least two characters';

  return (
    <div
      ref={rootRef}
      className={cn('message-search', `is-${presentation}`, className)}
      data-session-search={sessionId ? 'session' : 'global'}
    >
      <div className="message-search-field">
        <Search aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder || (sessionId ? 'Search this chat' : 'Search all messages')}
          aria-label={sessionId ? 'Search this chat' : 'Search all messages'}
          aria-controls={listboxId}
          aria-expanded={showResults && hasSearch}
          aria-activedescendant={
            results[selectedIndex] ? `${listboxId}-option-${selectedIndex}` : undefined
          }
          aria-describedby={statusId}
          autoComplete="off"
        />
        {loading ? (
          <Loader2 className="message-search-spinner animate-spin" aria-hidden="true" />
        ) : query ? (
          <button
            type="button"
            className="message-search-clear"
            onClick={() => {
              setQuery('');
              setResults([]);
              inputRef.current?.focus({ preventScroll: true });
            }}
            aria-label="Clear message search"
          >
            <X aria-hidden="true" />
          </button>
        ) : (
          <kbd>/</kbd>
        )}
      </div>

      <span id={statusId} className="sr-only" role="status" aria-live="polite">
        {statusText}
      </span>

      {showResults && (
        <div className="message-search-results-shell">
          {!hasSearch ? (
            <div className="message-search-guidance">
              <Search aria-hidden="true" />
              <strong>Find decisions, code, and earlier instructions</strong>
              <span>Searches complete message history, not only the currently loaded window.</span>
            </div>
          ) : error ? (
            <div className="message-search-empty" role="alert">
              <strong>Search unavailable</strong>
              <span>{error}</span>
              <button type="button" onClick={() => void search(query.trim())}>
                Try again
              </button>
            </div>
          ) : results.length === 0 && !loading ? (
            <div className="message-search-empty" role="status">
              <strong>No matching messages</strong>
              <span>Try another phrase or fewer words.</span>
            </div>
          ) : (
            <div id={listboxId} className="message-search-results" role="listbox">
              {results.map((result, index) => {
                const snippet = getContextSnippet(result, query);
                return (
                  <button
                    key={`${result.sessionId}-${result.id}`}
                    id={`${listboxId}-option-${index}`}
                    type="button"
                    role="option"
                    aria-selected={selectedIndex === index}
                    className={cn(
                      'message-search-result',
                      selectedIndex === index && 'is-selected'
                    )}
                    onClick={() => chooseResult(result)}
                    onPointerMove={() => setSelectedIndex(index)}
                  >
                    <span className="message-search-result-topline">
                      <span className={cn('message-search-role', `is-${result.role}`)}>
                        {result.role === 'user' ? 'You' : result.role}
                      </span>
                      {result.sessionName && (
                        <strong title={result.sessionName}>{result.sessionName}</strong>
                      )}
                      <time dateTime={result.createdAt}>
                        {new Date(result.createdAt).toLocaleString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </time>
                    </span>
                    <span className="message-search-snippet">
                      <HighlightedSnippet text={snippet} query={query} />
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {results.length > 0 && (
            <div className="message-search-hints" aria-hidden="true">
              <span>
                <ArrowUp />
                <ArrowDown /> navigate
              </span>
              <span>Enter jump</span>
              <span>Esc clear</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default MessageSearch;
