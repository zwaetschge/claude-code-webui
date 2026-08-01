import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address()));
  });
}

function waitForResponse(child, id) {
  return new Promise((resolve, reject) => {
    let buffered = '';
    const timer = setTimeout(() => reject(new Error('MCP response timeout')), 5000);
    child.stdout.on('data', (chunk) => {
      buffered += chunk.toString();
      const lines = buffered.split('\n');
      buffered = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const message = JSON.parse(line);
        if (message.id === id) {
          clearTimeout(timer);
          resolve(message);
        }
      }
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function testSoleLiveDeviceIsUsedWithoutExplicitSerial() {
  const requests = [];
  let emulatorStartBody = null;
  const server = createServer((req, res) => {
    requests.push(req.url);
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/emulator/start' && req.method === 'POST') {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        emulatorStartBody = JSON.parse(Buffer.concat(chunks).toString() || '{}');
        res.end(JSON.stringify({ status: 'starting' }));
      });
      return;
    }
    if (req.url === '/api/devices') {
      res.end(
        JSON.stringify([
          {
            serial: 'emulator-5554',
            status: 'device',
            model: 'sdk_gphone64_x86_64',
            type: 'emulator',
          },
        ])
      );
      return;
    }
    if (req.url === '/api/devices/emulator-5554/current-activity') {
      res.end(JSON.stringify({ success: true, packageName: 'com.example.app' }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not found' }));
  });
  const address = await listen(server);
  assert.ok(address && typeof address === 'object');

  const child = spawn(process.execPath, ['scripts/mcp-servers/android-builder.mjs'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ANDROID_BUILDER_URL: `http://127.0.0.1:${address.port}`,
      WEBUI_ANDROID_DEVICE_SERIAL: '',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  try {
    const responsePromise = waitForResponse(child, 1);
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'adb_current_activity', arguments: {} },
      })}\n`
    );
    const response = await responsePromise;
    assert.equal(response.result?.isError, undefined);
    assert.match(response.result?.content?.[0]?.text || '', /com\.example\.app/);
    assert.deepEqual(requests, [
      '/api/devices',
      '/api/devices/emulator-5554/current-activity',
    ]);

    const startResponsePromise = waitForResponse(child, 2);
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'emulator_start', arguments: { avd: 'pixel_test' } },
      })}\n`
    );
    const startResponse = await startResponsePromise;
    assert.equal(startResponse.result?.isError, undefined);
    assert.deepEqual(emulatorStartBody, { avdName: 'pixel_test' });
  } finally {
    child.kill('SIGTERM');
    server.close();
  }
}

await testSoleLiveDeviceIsUsedWithoutExplicitSerial();
console.log('android builder MCP regression tests passed');
