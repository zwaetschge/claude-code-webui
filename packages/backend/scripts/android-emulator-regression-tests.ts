import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../../..');

async function main(): Promise<void> {
  const routeSource = await fs.readFile(
    path.join(repoRoot, 'packages/backend/src/routes/android.ts'),
    'utf-8'
  );
  const panelSource = await fs.readFile(
    path.join(repoRoot, 'packages/frontend/src/components/session/AndroidDevicePanel.tsx'),
    'utf-8'
  );
  const mcpSource = await fs.readFile(
    path.join(repoRoot, 'scripts/mcp-servers/android-builder.mjs'),
    'utf-8'
  );

  assert.match(
    routeSource,
    /router\.get\(\s*['"]\/emulator\/status['"]/,
    'Plum must proxy emulator status through its authenticated Android API'
  );
  assert.match(
    routeSource,
    /['"]\/devices\/:serial\/screenshot\.png['"]/,
    'Plum must expose an authenticated live screenshot endpoint'
  );
  assert.match(
    panelSource,
    /Android emulator/i,
    'the Android panel must show a dedicated emulator section'
  );
  assert.match(
    panelSource,
    /screenshot\.png/,
    'the Android panel must render the emulator instead of trusting a relative noVNC URL'
  );
  assert.match(
    mcpSource,
    /emulator_start:\s*\(a\)\s*=>\s*http\([^\n]+\{\s*avdName:\s*a\.avd/s,
    'the MCP avd parameter must be translated to the builder avdName contract'
  );

  console.log('android emulator regression tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
