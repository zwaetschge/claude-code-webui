import assert from 'node:assert/strict';
import fs from 'node:fs';

const groupingSource = fs.readFileSync(
  new URL('../src/lib/sessionGrouping.ts', import.meta.url),
  'utf8'
);
const dashboardSource = fs.readFileSync(
  new URL('../src/pages/DashboardPage.tsx', import.meta.url),
  'utf8'
);
const sidebarSource = fs.readFileSync(
  new URL('../src/components/layout/Sidebar.tsx', import.meta.url),
  'utf8'
);

assert.match(
  groupingSource,
  /export const RECENT_SESSIONS_LIMIT = 10;/,
  'Recent Sessions should show ten entries'
);

for (const [name, source] of [
  ['dashboard', dashboardSource],
  ['sidebar', sidebarSource],
]) {
  assert.match(
    source,
    /import \{ RECENT_SESSIONS_LIMIT \} from '@\/lib\/sessionGrouping';/,
    `${name} should use the shared Recent Sessions limit`
  );
  assert.match(
    source,
    /\.slice\(0, RECENT_SESSIONS_LIMIT\)/,
    `${name} should apply the shared Recent Sessions limit`
  );
}

assert.match(
  dashboardSource,
  /for \(const session of filteredSessions\) \{\s*if \(usedSessionIds\.has\(session\.id\)\) continue;/,
  'dashboard priority groups must not duplicate sessions in category groups'
);

console.log('Recent Sessions limit regression tests passed.');
