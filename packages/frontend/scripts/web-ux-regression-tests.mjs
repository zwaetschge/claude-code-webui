import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), 'utf8');
const search = read('../src/components/session/MessageSearch.tsx');
const globalSearch = read('../src/components/search/GlobalMessageSearchDialog.tsx');
const session = read('../src/pages/SessionPage.tsx');
const dashboard = read('../src/pages/DashboardPage.tsx');
const layout = read('../src/components/layout/Layout.tsx');
const sidebar = read('../src/components/layout/Sidebar.tsx');
const socket = read('../src/services/socket.ts');
const composer = read('../src/components/chat/ChatInput.tsx');
const styles = read('../src/index.css');

assert.match(search, /messages\/search\?\$\{params\}/);
assert.match(search, /getContextSnippet[\s\S]*?<HighlightedSnippet/);
assert.match(search, /role="listbox"[\s\S]*?role="option"/);
assert.match(globalSearch, /event\.shiftKey[\s\S]*?setOpen\(true\)/);
assert.match(
  globalSearch,
  /navigate\(`\/session\/\$\{target\.sessionId\}\?\$\{params\.toString\(\)\}`\)/
);
assert.match(session, /MESSAGE_JUMP_WINDOW_SIZE = 160/);
assert.match(session, /around: target\.messageId/);
assert.match(session, /chat-message-\$\{messageId\}/);

assert.match(sidebar, /const isCollapsed = mobile \? false : navigationOnly \? true : collapsed/);
assert.match(layout, /<header className="md:hidden flex h-14/);
assert.match(session, /className={cn\('session-right-dock hidden md:flex'/);

assert.match(dashboard, /isComposerExpanded && 'is-composer-expanded'/);
assert.match(dashboard, /group\.sessions\.map\(\(session\) =>/);
assert.match(dashboard, /dashboard-session-card cursor-pointer[\s\S]*?role="link"/);

assert.match(
  composer,
  /composer-bubble-button is-followup[\s\S]*?activeFollowupMode === 'steer'[\s\S]*?'Steering' : 'Follow-up'/
);
assert.match(composer, /const showActiveFollowupButton = !!isActive && !!activeFollowupMode/);
assert.match(composer, /queued-locally/);
assert.match(composer, /uploadAbortRef\.current\?\.abort\(\)/);
assert.match(composer, /chat-attachment-progress[\s\S]*?role="progressbar"/);
assert.match(socket, /OUTBOX_STORAGE_KEY = 'plum\.chat\.outbox\.v1'/);
assert.match(socket, /uploadIds/);
assert.match(socket, /Content-Range/);
assert.match(socket, /X-Chunk-SHA256/);
assert.match(socket, /for \(let attempt = 1; attempt <= 3; attempt \+= 1\)/);
assert.match(socket, /currentUpload\.missingChunks/);
assert.match(socket, /title: 'Queued message was not sent'/);
assert.match(socket, /title: 'Message is still waiting to send'/);
assert.match(socket, /lastSequence/);

assert.match(
  styles,
  /@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation-duration: 0\.01ms !important/
);
assert.match(styles, /:where\(a, button, input, textarea, select/);
assert.match(styles, /\.is-search-highlighted/);
assert.match(styles, /\.dashboard-session-unread,[\s\S]*?\.sidebar-session-unread/);

console.log('Web UX regression tests passed.');
