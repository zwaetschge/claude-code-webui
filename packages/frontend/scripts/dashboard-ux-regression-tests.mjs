import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(scriptDir, '..');
const dashboardSource = fs.readFileSync(
  path.join(frontendDir, 'src/pages/DashboardPage.tsx'),
  'utf8'
);
const layoutSource = fs.readFileSync(
  path.join(frontendDir, 'src/components/layout/Layout.tsx'),
  'utf8'
);
const styles = fs.readFileSync(path.join(frontendDir, 'src/index.css'), 'utf8');

assert.match(
  dashboardSource,
  /dashboard-start-composer dashboard-chatbar glass-chrome relative[\s\S]*?isComposerExpanded && 'is-composer-expanded'/,
  'the mobile dashboard should restore the compact launcher while preserving expanded drafts'
);
assert.match(
  styles,
  /@media \(max-width: 640px\)[\s\S]*?\.dashboard-composer-mobile-toggle\s*{\s*display: flex;/,
  'the previous compact mobile composer launcher should remain visible'
);
assert.match(
  layoutSource,
  /navigationOnly={location\.pathname === '\/'}/,
  'the wide dashboard should use the sidebar as a navigation rail instead of duplicating sessions'
);
assert.match(
  dashboardSource,
  /const isShowingCachedSessions = sessions\.length > 0 && \(!isOnline \|\| sessionsQuery\.isError\)/,
  'failed refreshes should keep and identify cached sessions'
);
assert.match(
  dashboardSource,
  /dashboard-session-card cursor-pointer[\s\S]*?role="link"[\s\S]*?aria-label={`Open session \$\{session\.name\}`}/,
  'session cards should retain the previous compact whole-card navigation'
);
assert.match(
  dashboardSource,
  /role="link"[\s\S]*?tabIndex={0}/,
  'whole-card navigation should remain keyboard accessible'
);
assert.match(
  dashboardSource,
  /group\.sessions\.map\(\(session\) =>/,
  'session groups should use the previous complete card grid'
);
assert.match(
  dashboardSource,
  /dashboard-session-unread[\s\S]*?unread.*message/,
  'session cards should expose the server-provided unread count'
);
assert.match(
  styles,
  /\.session-chat-layered > \.chat-scroll-shell\s*{[\s\S]*?bottom: calc\(var\(--chat-input-h, 112px\) \+ 8px\);/,
  'the chat viewport should reserve the measured composer height'
);
assert.match(
  styles,
  /\.chat-jump-latest\s*{[\s\S]*?bottom: 12px;/,
  'the jump-to-latest action should sit inside the reserved viewport above the composer'
);

console.log('Dashboard UX regression tests passed.');
