import {
  spawn as spawnChildProcess,
  type ChildProcess,
  type SpawnOptions,
} from 'node:child_process';

const managedProcessGroups = new WeakSet<ChildProcess>();

/** Spawn a CLI in its own process group so tools and MCP grandchildren stop with it. */
export function spawnManagedProcess(
  command: string,
  args: readonly string[],
  options: SpawnOptions
): ChildProcess {
  const detached = process.platform !== 'win32';
  const child = spawnChildProcess(command, [...args], { ...options, detached });
  if (detached) managedProcessGroups.add(child);
  // A write to a child that just died surfaces EPIPE as a stream 'error' event;
  // without a listener that becomes an uncaughtException and takes the whole
  // backend down. Log it instead — the child's own exit/error handlers already
  // clean up the session.
  child.stdin?.on('error', (err: NodeJS.ErrnoException) => {
    console.warn(
      `[PROCESS] stdin error on managed child ${child.pid ?? '?'} (${command}): ${err.code ?? ''} ${err.message}`
    );
  });
  return child;
}

/** Signal a managed process group, falling back to its direct child. */
export function signalManagedProcess(child: ChildProcess, signal: NodeJS.Signals): boolean {
  if (managedProcessGroups.has(child) && child.pid && process.platform !== 'win32') {
    try {
      process.kill(-child.pid, signal);
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ESRCH') return false;
      console.warn(`[PROCESS] Failed to signal process group ${child.pid} with ${signal}:`, error);
    }
  }

  try {
    return child.kill(signal);
  } catch {
    return false;
  }
}

/** Request graceful termination, then force-stop the complete group after the grace period. */
export function terminateManagedProcess(child: ChildProcess, graceMs = 5000): void {
  signalManagedProcess(child, 'SIGTERM');
  const forceKill = setTimeout(() => {
    // Keep targeting the group even if its leader exited; a stubborn tool or
    // MCP grandchild can otherwise survive after the direct CLI process ends.
    signalManagedProcess(child, 'SIGKILL');
  }, graceMs);
  forceKill.unref();
}
