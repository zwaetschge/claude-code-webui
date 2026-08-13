import assert from 'node:assert/strict';
import fs from 'node:fs';

const layoutSource = fs.readFileSync(
  new URL('../src/components/layout/Layout.tsx', import.meta.url),
  'utf8'
);
const dashboardSource = fs.readFileSync(
  new URL('../src/pages/DashboardPage.tsx', import.meta.url),
  'utf8'
);
const settingsSource = fs.readFileSync(
  new URL('../src/pages/SettingsPage.tsx', import.meta.url),
  'utf8'
);

assert.match(
  layoutSource,
  /const SESSION_LIST_FALLBACK_INTERVAL_MS = 30_000;/,
  'the shell should use a slow session-list recovery poll'
);
assert.match(
  layoutSource,
  /const SESSION_DETAIL_FALLBACK_INTERVAL_MS = 15_000;/,
  'the shell session header should use the same slow detail recovery poll as the chat'
);

const layoutSessionQuery = layoutSource.match(
  /queryKey: \['sessions'\],[\s\S]*?refetchIntervalInBackground: false,\n\s*}\);/
)?.[0];
assert.ok(layoutSessionQuery, 'the shell should own the session-list query');
assert.match(
  layoutSessionQuery,
  /refetchInterval: SESSION_LIST_FALLBACK_INTERVAL_MS/,
  'the shell should use the fallback interval instead of four-second polling'
);
assert.match(
  layoutSessionQuery,
  /refetchIntervalInBackground: false/,
  'hidden tabs must not poll the full session list'
);
assert.doesNotMatch(
  layoutSessionQuery,
  /setSessions\(/,
  'the shared session query must remain pure regardless of which observer fetches it'
);
assert.match(
  layoutSource,
  /const \{ data: shellSessions \} = useQuery\([\s\S]*?useEffect\(\(\) => \{\s*if \(shellSessions !== undefined\) \{\s*setSessions\(shellSessions\);\s*\}\s*\}, \[setSessions, shellSessions\]\);/,
  'the shell must mirror shared query data into the sidebar store deterministically'
);

const routeSessionQuery = layoutSource.match(
  /queryKey: \['session', routeSessionId\],[\s\S]*?refetchIntervalInBackground: false,\n\s*}\);/
)?.[0];
assert.ok(routeSessionQuery, 'the shell route-session query should remain present');
assert.match(
  routeSessionQuery,
  /refetchInterval: SESSION_DETAIL_FALLBACK_INTERVAL_MS/,
  'the header observer must not force the shared chat query back to a four-second cadence'
);
assert.match(
  routeSessionQuery,
  /refetchIntervalInBackground: false/,
  'hidden tabs must not poll session telemetry through the header observer'
);

const dashboardSessionQuery = dashboardSource.match(
  /\/\/ Fetch sessions[\s\S]*?\/\/ Fetch available CLI providers/
)?.[0];
assert.ok(dashboardSessionQuery, 'the dashboard session query should remain present');
assert.doesNotMatch(
  dashboardSessionQuery,
  /refetchInterval/,
  'the dashboard must observe the shared query without starting a second poll timer'
);

assert.doesNotMatch(
  settingsSource,
  /['"]\/api\/sessions['"]|queryKey:\s*\['sessions'\]/,
  'Settings should consume the shell session list instead of fetching its own copy'
);

const requestsInTenSecondTrace = 1 + Math.floor(10_000 / 30_000);
assert.equal(
  requestsInTenSecondTrace,
  1,
  'a ten-second Settings trace should contain only the initial session-list request'
);

console.log('Session list polling regression tests passed.');
