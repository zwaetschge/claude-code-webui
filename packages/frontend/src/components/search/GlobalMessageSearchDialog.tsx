import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  getMessageSearchTarget,
  MessageSearch,
  type MessageSearchResult,
} from '@/components/session/MessageSearch';

export const GLOBAL_MESSAGE_SEARCH_EVENT = 'plum:open-message-search';

export function openGlobalMessageSearch() {
  window.dispatchEvent(new Event(GLOBAL_MESSAGE_SEARCH_EVENT));
}

export function GlobalMessageSearchDialog() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const openSearch = () => setOpen(true);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLocaleLowerCase() !== 'f' || !(event.metaKey || event.ctrlKey)) return;
      if (!event.shiftKey) return;
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener(GLOBAL_MESSAGE_SEARCH_EVENT, openSearch);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener(GLOBAL_MESSAGE_SEARCH_EVENT, openSearch);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const handleResultClick = (result: MessageSearchResult) => {
    const target = getMessageSearchTarget(result);
    const params = new URLSearchParams({ message: target.messageId });
    if (target.chatId) params.set('chat', target.chatId);
    setOpen(false);
    navigate(`/session/${target.sessionId}?${params.toString()}`);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="global-message-search-dialog">
        <DialogHeader className="global-message-search-header">
          <span className="global-message-search-mark" aria-hidden="true">
            <Search />
          </span>
          <span>
            <DialogTitle>Search every conversation</DialogTitle>
            <DialogDescription>
              Jump directly to decisions, instructions, code, and results across Plum.
            </DialogDescription>
          </span>
        </DialogHeader>
        <MessageSearch
          presentation="panel"
          autoFocus
          onResultClick={handleResultClick}
          placeholder="Search all message history"
        />
      </DialogContent>
    </Dialog>
  );
}
