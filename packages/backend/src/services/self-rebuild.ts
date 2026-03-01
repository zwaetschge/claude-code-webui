import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import type { Server } from 'socket.io';
import type { SelfRebuildStatus, SelfRebuildStatusType, ServerToClientEvents, ClientToServerEvents, InterServerEvents, SocketData } from '@claude-code-webui/shared';

const execAsync = promisify(exec);

// Source directory where docker-compose.yml is located
const SOURCE_DIR = '/mnt/user/appdata/claude-code-webui';

// Status file for persistence across container restarts
const STATUS_FILE = path.join(SOURCE_DIR, 'data', 'rebuild-status.json');

// Human/CLI readable status file
const READABLE_STATUS_FILE = path.join(SOURCE_DIR, 'LAST_REBUILD.md');

// Rebuild Robot files
const ROBOT_TRIGGER_FILE = path.join(SOURCE_DIR, 'data', 'rebuild-trigger.json');
const ROBOT_STATUS_FILE = path.join(SOURCE_DIR, 'data', 'rebuild-robot-status.json');
const ROBOT_REPORT_FILE = path.join(SOURCE_DIR, 'REBUILD_ROBOT_REPORT.md');

// Container names to check for the rebuild robot (new: repair-bot, legacy: rebuild-robot)
const ROBOT_CONTAINER_NAMES = ['repair-bot', 'rebuild-robot'];

// Minimum interval between rebuilds (60 seconds)
const MIN_REBUILD_INTERVAL_MS = 60 * 1000;

let currentStatus: SelfRebuildStatus = { status: 'idle' };
let lastRebuildTime: number | null = null;
let rebuildInProgress: Promise<void> | null = null;

// Socket.IO instance for broadcasting events
let io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData> | null = null;

export interface PersistedStatus {
  status: SelfRebuildStatusType;
  progress?: string;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  triggeredAt?: string;
  buildOutput?: string;
}

/**
 * Set the Socket.IO instance for broadcasting events
 */
export function setSocketIO(socketIO: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>): void {
  io = socketIO;
}

/**
 * Broadcast rebuild status to all connected clients
 */
function broadcastStatus(status: SelfRebuildStatus & { completedAt?: string }): void {
  if (io) {
    console.log(`[self-rebuild] Broadcasting status: ${status.status}`);
    io.emit('self-rebuild:status', status);
  }
}

async function loadPersistedStatus(): Promise<PersistedStatus | null> {
  try {
    const content = await fs.readFile(STATUS_FILE, 'utf-8');
    return JSON.parse(content) as PersistedStatus;
  } catch {
    return null;
  }
}

async function savePersistedStatus(status: PersistedStatus): Promise<void> {
  try {
    await fs.mkdir(path.dirname(STATUS_FILE), { recursive: true });
    await fs.writeFile(STATUS_FILE, JSON.stringify(status, null, 2), 'utf-8');
  } catch (error) {
    console.error('[self-rebuild] Failed to save status:', error);
  }
}

async function clearPersistedStatus(): Promise<void> {
  try {
    await fs.unlink(STATUS_FILE);
  } catch {
    // File doesn't exist, that's fine
  }
}

/**
 * Write a human/CLI readable status file that Claude Code can read
 */
async function writeReadableStatus(status: 'success' | 'error' | 'building', details: {
  startedAt?: string;
  completedAt?: string;
  error?: string;
}): Promise<void> {
  const now = new Date().toISOString();
  let content: string;

  if (status === 'success') {
    content = `# Self-Rebuild Status: SUCCESS

Der Container wurde erfolgreich neu gebaut und gestartet.

| Feld | Wert |
|------|------|
| Status | ✅ Erfolgreich |
| Gestartet | ${details.startedAt || 'unbekannt'} |
| Abgeschlossen | ${details.completedAt || now} |

Die Änderungen am Quellcode sind jetzt aktiv.
`;
  } else if (status === 'error') {
    content = `# Self-Rebuild Status: FEHLER

Der Rebuild ist fehlgeschlagen.

| Feld | Wert |
|------|------|
| Status | ❌ Fehler |
| Gestartet | ${details.startedAt || 'unbekannt'} |
| Fehler | ${details.error || 'Unbekannter Fehler'} |

Bitte prüfe die Docker-Logs für weitere Details.
`;
  } else {
    content = `# Self-Rebuild Status: IN BEARBEITUNG

Ein Rebuild läuft gerade...

| Feld | Wert |
|------|------|
| Status | 🔄 Building |
| Gestartet | ${details.startedAt || now} |

Warte auf Abschluss...
`;
  }

  try {
    await fs.writeFile(READABLE_STATUS_FILE, content, 'utf-8');
  } catch (error) {
    console.error('[self-rebuild] Failed to write readable status:', error);
  }
}

/**
 * Initialize the self-rebuild service.
 * Called at server startup to check if we just completed a rebuild.
 */
export async function initSelfRebuild(): Promise<void> {
  if (process.env.DISABLE_SELF_REBUILD === 'true') {
    console.log('[self-rebuild] Self-rebuild disabled on this instance (repair bot mode)');
    return;
  }

  // First, check for Robot status file
  const robotStatus = await getRobotStatus();

  // Check if robot status indicates success directly
  let robotRebuiltSuccessfully = robotStatus?.status === 'success';

  // Also check Robot Report for recent success (handles race condition where
  // robot overwrites "success" with "watching" before container reads it)
  if (!robotRebuiltSuccessfully) {
    try {
      const report = await fs.readFile(ROBOT_REPORT_FILE, 'utf-8');
      const reportStat = await fs.stat(ROBOT_REPORT_FILE);
      const reportAgeMinutes = (Date.now() - reportStat.mtimeMs) / 1000 / 60;

      // If report was written in the last 5 minutes and shows success
      if (reportAgeMinutes < 5 && report.includes('ERFOLGREICH')) {
        console.log('[self-rebuild] Robot report shows recent success (report age: ' + Math.round(reportAgeMinutes * 10) / 10 + ' min)');
        robotRebuiltSuccessfully = true;
      }
    } catch {
      // Report file doesn't exist, that's fine
    }
  }

  if (robotRebuiltSuccessfully) {
    console.log('[self-rebuild] ========================================');
    console.log('[self-rebuild] 🤖 REBUILD ROBOT: ERFOLGREICH');
    console.log('[self-rebuild] Robot hat den Rebuild sauber durchgeführt');
    console.log('[self-rebuild] ========================================');

    const completedAt = robotStatus?.timestamp || new Date().toISOString();
    currentStatus = {
      status: 'idle',
      progress: 'Rebuild completed by Robot',
    };

    // Save persisted status so /api/self-rebuild/last-result returns it
    await savePersistedStatus({
      status: 'idle',
      progress: 'Rebuild completed by Robot',
      completedAt,
      startedAt: completedAt,
    });

    await writeReadableStatus('success', { completedAt });

    // Broadcast completion status after a short delay
    setTimeout(() => {
      broadcastStatus({
        ...currentStatus,
        completedAt,
      });
    }, 2000);

    // Clear trigger file if it exists
    try { await fs.unlink(ROBOT_TRIGGER_FILE); } catch { /* ignore */ }

    // Clear status after 5 minutes
    setTimeout(async () => {
      await clearPersistedStatus();
      currentStatus = { status: 'idle' };
    }, 5 * 60 * 1000);

    return;
  }

  const persisted = await loadPersistedStatus();

  if (persisted && persisted.status === 'restarting') {
    // We just came back from a rebuild - mark as completed
    console.log('[self-rebuild] ========================================');
    console.log('[self-rebuild] REBUILD ERFOLGREICH ABGESCHLOSSEN');
    console.log('[self-rebuild] Container wurde neu gebaut und gestartet');
    console.log('[self-rebuild] ========================================');

    const completedAt = new Date().toISOString();
    const completedStatus: PersistedStatus = {
      ...persisted,
      status: 'idle',
      progress: 'Rebuild completed successfully',
      completedAt,
    };

    await savePersistedStatus(completedStatus);
    await writeReadableStatus('success', {
      startedAt: persisted.startedAt,
      completedAt,
    });

    currentStatus = {
      status: 'idle',
      progress: 'Rebuild completed successfully',
      startedAt: persisted.startedAt,
    };

    // Broadcast completion status after a short delay (wait for clients to connect)
    setTimeout(() => {
      broadcastStatus({
        ...currentStatus,
        completedAt,
      });
    }, 2000);

    // Clear status after 5 minutes
    setTimeout(async () => {
      await clearPersistedStatus();
      currentStatus = { status: 'idle' };
    }, 5 * 60 * 1000);
  } else if (persisted && persisted.status === 'building') {
    // Build was in progress but container restarted unexpectedly
    console.log('[self-rebuild] ========================================');
    console.log('[self-rebuild] REBUILD FEHLGESCHLAGEN');
    console.log('[self-rebuild] Container wurde während des Builds unerwartet neu gestartet');
    console.log('[self-rebuild] ========================================');

    const errorMsg = 'Build was interrupted by unexpected container restart';
    currentStatus = {
      status: 'error',
      error: errorMsg,
      startedAt: persisted.startedAt,
    };

    await writeReadableStatus('error', {
      startedAt: persisted.startedAt,
      error: errorMsg,
    });
    await clearPersistedStatus();

    // Broadcast error status after a short delay
    setTimeout(() => {
      broadcastStatus(currentStatus);
    }, 2000);
  }
}

export function getRebuildStatus(): SelfRebuildStatus {
  return { ...currentStatus };
}

export function isRebuildInProgress(): boolean {
  return currentStatus.status === 'building' || currentStatus.status === 'restarting';
}

async function setStatus(status: SelfRebuildStatusType, progress?: string, error?: string): Promise<void> {
  currentStatus = {
    status,
    progress,
    error,
    startedAt: status === 'building' ? new Date().toISOString() : currentStatus.startedAt,
  };

  // Broadcast status change
  broadcastStatus(currentStatus);

  // Persist status for restarting phase
  if (status === 'building' || status === 'restarting') {
    await savePersistedStatus({
      status,
      progress,
      error,
      startedAt: currentStatus.startedAt,
      triggeredAt: new Date().toISOString(),
    });
    await writeReadableStatus('building', { startedAt: currentStatus.startedAt });
  } else if (status === 'error') {
    await writeReadableStatus('error', { startedAt: currentStatus.startedAt, error });
    await clearPersistedStatus();
  }
}

async function runDockerCommand(command: string, description: string): Promise<{ success: boolean; output: string }> {
  await setStatus('building', description);

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: SOURCE_DIR,
      timeout: 10 * 60 * 1000, // 10 minute timeout
      maxBuffer: 50 * 1024 * 1024, // 50MB buffer for build output
    });

    const output = [stdout, stderr].filter(Boolean).join('\n');
    return { success: true, output };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    const output = [err.stdout, err.stderr, err.message].filter(Boolean).join('\n');
    return { success: false, output };
  }
}

/**
 * Check if the Rebuild Robot sidecar container is running
 */
async function isRobotAvailable(): Promise<boolean> {
  // Primary: Check if robot/repair-bot container is running via docker inspect
  for (const name of ROBOT_CONTAINER_NAMES) {
    try {
      const { stdout } = await execAsync(`docker inspect --format="{{.State.Running}}" ${name}`, { timeout: 5000 });
      if (stdout.trim() === 'true') {
        return true;
      }
    } catch {
      // Container doesn't exist
    }
  }

  // Fallback: Check heartbeat file (for compatibility with host-based robot)
  try {
    const stat = await fs.stat(ROBOT_STATUS_FILE);
    const thirtySecondsAgo = Date.now() - 30 * 1000;
    return stat.mtimeMs > thirtySecondsAgo;
  } catch {
    return false;
  }
}

/**
 * Try to start the rebuild-robot sidecar if it exists but is stopped
 */
async function ensureRobotRunning(): Promise<boolean> {
  for (const name of ROBOT_CONTAINER_NAMES) {
    try {
      const { stdout } = await execAsync(`docker inspect --format="{{.State.Status}}" ${name}`, { timeout: 5000 });
      const state = stdout.trim();

      if (state === 'running') {
        return true;
      }

      if (state === 'exited' || state === 'created') {
        console.log(`[self-rebuild] Robot container ${name} is stopped, starting it...`);
        await execAsync(`docker start ${name}`, { timeout: 10000 });
        await new Promise(resolve => setTimeout(resolve, 3000));
        console.log(`[self-rebuild] Robot container ${name} started`);
        return true;
      }
    } catch {
      // Container doesn't exist, try next name
    }
  }
  return false;
}

/**
 * Check if the rebuild-robot container exists (running or stopped)
 */
async function isRobotContainerPresent(): Promise<boolean> {
  for (const name of ROBOT_CONTAINER_NAMES) {
    try {
      await execAsync(`docker inspect ${name}`, { timeout: 5000 });
      return true;
    } catch {
      // Try next name
    }
  }
  return false;
}

/**
 * Get the robot status
 */
export async function getRobotStatus(): Promise<{
  status: string;
  message: string;
  phase: string;
  timestamp: string;
} | null> {
  try {
    const content = await fs.readFile(ROBOT_STATUS_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Get the robot report
 */
export async function getRobotReport(): Promise<string | null> {
  try {
    return await fs.readFile(ROBOT_REPORT_FILE, 'utf-8');
  } catch {
    return null;
  }
}

export async function triggerRebuild(options: { noCache?: boolean } = {}): Promise<{ success: boolean; message: string; useRobot?: boolean }> {
  if (process.env.DISABLE_SELF_REBUILD === 'true') {
    return {
      success: false,
      message: 'Self-rebuild is disabled on this instance. Use the main WebUI to trigger rebuilds.',
    };
  }

  // Check rate limiting
  if (lastRebuildTime && Date.now() - lastRebuildTime < MIN_REBUILD_INTERVAL_MS) {
    const remainingSeconds = Math.ceil((MIN_REBUILD_INTERVAL_MS - (Date.now() - lastRebuildTime)) / 1000);
    return {
      success: false,
      message: `Rate limited. Please wait ${remainingSeconds} seconds before triggering another rebuild.`,
    };
  }

  // Check if rebuild is already in progress
  if (rebuildInProgress) {
    return {
      success: false,
      message: 'A rebuild is already in progress.',
    };
  }

  // Check if trigger file already exists (robot is processing)
  try {
    await fs.access(ROBOT_TRIGGER_FILE);
    return {
      success: false,
      message: 'A rebuild request is already pending (waiting for Rebuild Robot).',
    };
  } catch {
    // File doesn't exist, which is expected
  }

  lastRebuildTime = Date.now();
  const startedAt = new Date().toISOString();

  // Write trigger file for the Rebuild Robot
  const triggerData = {
    noCache: options.noCache || false,
    triggeredAt: startedAt,
    triggeredBy: 'webui',
  };

  try {
    await fs.mkdir(path.dirname(ROBOT_TRIGGER_FILE), { recursive: true });
    await fs.writeFile(ROBOT_TRIGGER_FILE, JSON.stringify(triggerData, null, 2), 'utf-8');
    console.log('[self-rebuild] 🤖 Trigger file written for Rebuild Robot');
  } catch (error) {
    return {
      success: false,
      message: `Failed to write trigger file: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }

  // Update status
  await setStatus('building', 'Waiting for Rebuild Robot to process request...');

  // Save persisted status
  await savePersistedStatus({
    status: 'restarting',
    progress: 'Rebuild Robot is handling the rebuild',
    startedAt,
    triggeredAt: startedAt,
  });

  await writeReadableStatus('building', { startedAt });

  // Check if robot is available, try to start it if needed
  let robotAvailable = await isRobotAvailable();

  if (!robotAvailable) {
    console.log('[self-rebuild] Robot not running, attempting to start sidecar...');
    const started = await ensureRobotRunning();
    if (started) {
      robotAvailable = true;
      console.log('[self-rebuild] 🤖 Robot sidecar started successfully');
    }
  }

  if (robotAvailable) {
    return {
      success: true,
      message: '🤖 Rebuild Robot detected! Request submitted. The robot will handle the build and restart safely from outside the container.',
      useRobot: true,
    };
  } else {
    // Robot not detected and couldn't be started - fall back to direct method (less reliable)
    console.log('[self-rebuild] ⚠️ Rebuild Robot not detected and could not be started, falling back to direct method');

    rebuildInProgress = (async () => {
      try {
        // Build
        const buildCommand = options.noCache
          ? 'docker compose build --no-cache'
          : 'docker compose build';

        const buildResult = await runDockerCommand(buildCommand, 'Building Docker image...');

        if (!buildResult.success) {
          await setStatus('error', undefined, `Build failed: ${buildResult.output}`);
          // Remove trigger file
          try { await fs.unlink(ROBOT_TRIGGER_FILE); } catch { /* ignore */ }
          return;
        }

        // Restart - this will likely cause issues but we try anyway
        await setStatus('restarting', 'Restarting container (fallback mode)...');

        execAsync(
          `docker compose -f ${SOURCE_DIR}/docker-compose.yml up -d --force-recreate --remove-orphans`,
          { cwd: SOURCE_DIR, timeout: 5 * 60 * 1000 }
        ).catch(() => { /* expected */ });

        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        await setStatus('error', undefined, message);
      } finally {
        rebuildInProgress = null;
        // Remove trigger file
        try { await fs.unlink(ROBOT_TRIGGER_FILE); } catch { /* ignore */ }
      }
    })();

    return {
      success: true,
      message: '⚠️ Rebuild Robot not detected. Using fallback method (may require manual container restart). For reliable rebuilds, start the robot: ./scripts/rebuild-robot.sh watch',
      useRobot: false,
    };
  }
}

/**
 * Get the last rebuild result (for checking after reconnect)
 */
export async function getLastRebuildResult(): Promise<PersistedStatus | null> {
  return loadPersistedStatus();
}

/**
 * Start the rebuild-robot sidecar container if it's stopped
 */
export async function startRobot(): Promise<{ success: boolean; message: string }> {
  const running = await isRobotAvailable();
  if (running) {
    return { success: true, message: 'Robot is already running' };
  }

  const present = await isRobotContainerPresent();
  if (!present) {
    return { success: false, message: 'Robot container does not exist. Run docker compose up -d to create it.' };
  }

  const started = await ensureRobotRunning();
  if (started) {
    return { success: true, message: 'Robot sidecar started successfully' };
  }
  return { success: false, message: 'Failed to start robot container' };
}

/**
 * Get detailed robot availability info
 */
export async function getRobotContainerInfo(): Promise<{
  containerExists: boolean;
  containerRunning: boolean;
  heartbeatActive: boolean;
}> {
  let containerExists = false;
  let containerRunning = false;
  let heartbeatActive = false;

  for (const name of ROBOT_CONTAINER_NAMES) {
    try {
      const { stdout } = await execAsync(`docker inspect --format="{{.State.Status}}" ${name}`, { timeout: 5000 });
      containerExists = true;
      containerRunning = stdout.trim() === 'running';
      break;
    } catch {
      // Container doesn't exist, try next name
    }
  }

  try {
    const stat = await fs.stat(ROBOT_STATUS_FILE);
    heartbeatActive = stat.mtimeMs > Date.now() - 30 * 1000;
  } catch {
    // No heartbeat file
  }

  return { containerExists, containerRunning, heartbeatActive };
}
