import { ChildProcess, spawn as cpSpawn } from 'child_process';
import { EventEmitter } from 'events';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { URL } from 'url';
import type { SessionMode } from '@claude-code-webui/shared';
import { buildOpenCodePermissionRules } from '../cli-providers.js';
import { config } from '../../config.js';
import { buildIntegrationEnv } from '../../utils/integrationEnv.js';

const DEBUG_LOG = '/app/packages/backend/data/oc-debug.log';
function ocDbg(line: string): void {
  try {
    fs.appendFileSync(DEBUG_LOG, new Date().toISOString() + ' ' + line + '\n');
  } catch (e) {
    console.error('[OC-DBG-ERR]', e);
  }
}

// The OpenCode SSE `GET /event` stream delivers every event for every session
// on one connection. We spawn a single `opencode serve` process, hold one
// long-lived SSE subscription, and demultiplex events back to per-session
// handlers keyed by the opencode sessionID.
//
// Why singleton (not per-session): `opencode serve` already multiplexes
// sessions internally. Spawning one process per webui session would burn
// resources and fragment the TUI-visible session list in opencode's own
// storage.

export type OpencodeEvent = Record<string, unknown> & {
  type: string;
  properties?: Record<string, unknown>;
};

type Handler = (event: OpencodeEvent) => void;

interface PromptOptions {
  text: string;
  /** `providerID/modelID` slash-form, as stored in cli-providers. */
  model?: string | null;
  agent?: string | null;
  mode?: SessionMode;
  variant?: string | null;
  /** Session working directory, used to sandbox tools. */
  directory?: string;
  /** Plum WebUI session id for MCP bridge attribution. */
  webuiSessionId?: string;
}

interface CreateSessionOptions {
  model?: string | null;
  agent?: string | null;
  mode?: SessionMode;
  variant?: string | null;
  allowedDirectories?: string[];
}

const READY_LINE_RE = /opencode server listening on (http:\/\/[^\s]+)/i;
const WEBUI_SESSION_CONTEXT_FILE = path.join(os.tmpdir(), 'plum-opencode-webui-session.json');

class OpencodeServer {
  private proc: ChildProcess | null = null;
  private baseUrl: string | null = null;
  private startPromise: Promise<string> | null = null;
  private sseController: AbortController | null = null;
  private sseReconnectDelayMs = 500;
  private sseLoopRunning = false;
  private shuttingDown = false;

  // SSE liveness: set true once the /event stream is actually open and
  // streaming. Toggled false on disconnect so sendPrompt can wait for
  // reconnect rather than fire prompts into a silent window (events
  // emitted while disconnected are lost — opencode SSE isn't replayable).
  private sseConnected = false;
  private sseReadyWaiters: Array<() => void> = [];

  // sessionID (opencode's, not webui's) → handler
  private handlers = new Map<string, Handler>();
  // Fallback handler for events that arrive before we know the sessionID
  // mapping (e.g. provider errors at connect time). Rarely used.
  private globalHandlers = new Set<Handler>();

  // Per-session polling fallback. opencode 1.4.x/1.14.x publishes events to
  // its internal bus but the /event SSE stream only forwards heartbeats —
  // verified across versions 1.4.17, 1.14.17, 1.14.22 on Alpine/musl. We
  // compensate by polling /session/{id}/message after each prompt and
  // synthesising the events the dispatcher would have seen.
  private pollTimers = new Map<string, NodeJS.Timeout>();
  private pollState = new Map<
    string,
    {
      // partID → length of text/output already surfaced, so we only re-emit growth
      textLens: Map<string, number>;
      // partID → last observed tool state.status, so we don't re-emit unchanged states
      toolStatus: Map<string, string>;
      // messageIDs we've already flushed as finished
      finishedMessages: Set<string>;
      // idle flag: once we emit session.idle we stop polling
      idled: boolean;
      // Timestamp when the last assistant message landed in a terminal state
      // (finish=stop). We wait 2s of no further activity before firing idle —
      // opencode's multi-step loop creates a fresh assistant message per step
      // with finish=tool-calls/length between steps, so we can only be sure
      // the run is over when finish=stop stays put.
      idleCandidateAt: number | null;
      // When polling started — safety cap so a stuck session doesn't poll forever.
      startedAt: number;
    }
  >();

  private events = new EventEmitter();

  /**
   * Ensure the `opencode serve` process is running and the SSE subscription
   * is live. Returns the base URL once ready. Idempotent.
   */
  async ensureStarted(): Promise<string> {
    if (this.baseUrl && this.proc && !this.proc.killed) {
      return this.baseUrl;
    }
    if (this.startPromise) return this.startPromise;

    this.startPromise = this.startInternal().catch((err) => {
      this.startPromise = null;
      throw err;
    });
    return this.startPromise;
  }

  private startInternal(): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const env = {
        ...process.env,
        ...buildIntegrationEnv(),
        OPENCODE_CONFIG_DIR: path.join(os.homedir(), '.config', 'opencode'),
        OPENCODE_DATA_DIR: path.join(os.homedir(), '.local', 'share', 'opencode'),
        WEBUI_BACKEND_URL: `http://localhost:${config.port}`,
        WEBUI_HOOK_SECRET: config.hookSecret,
        WEBUI_SESSION_CONTEXT_FILE,
      };

      const proc = cpSpawn('opencode', ['serve', '--port', '0', '--hostname', '127.0.0.1'], {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      this.proc = proc;
      let ready = false;
      let buf = '';

      const onData = (chunk: Buffer) => {
        const text = chunk.toString();
        buf += text;
        // Ready line can land in either stream depending on opencode version.
        const m = buf.match(READY_LINE_RE);
        if (m && m[1] && !ready) {
          ready = true;
          this.baseUrl = m[1].replace(/\/$/, '');
          console.log(`[OPENCODE-SERVER] ready at ${this.baseUrl}`);
          // Kick off the SSE subscription loop (non-blocking).
          void this.startEventLoop();
          resolve(this.baseUrl);
        }
      };

      proc.stdout?.on('data', onData);
      proc.stderr?.on('data', onData);

      proc.on('exit', (code, signal) => {
        console.log(`[OPENCODE-SERVER] exited code=${code} signal=${signal}`);
        this.proc = null;
        this.baseUrl = null;
        this.startPromise = null;
        if (!ready) {
          reject(new Error(`opencode serve exited before ready (code=${code})`));
        }
        this.events.emit('exit', { code, signal });
      });

      proc.on('error', (err) => {
        console.error('[OPENCODE-SERVER] spawn error:', err);
        if (!ready) reject(err);
      });

      // Hard timeout: if `opencode serve` hangs, fail fast rather than lock up
      // the first session attempt forever.
      setTimeout(() => {
        if (!ready) {
          try {
            proc.kill('SIGKILL');
          } catch {
            /* noop */
          }
          reject(new Error('opencode serve did not announce readiness within 15s'));
        }
      }, 15_000);
    });
  }

  /**
   * Long-running SSE consumer. Auto-reconnects with backoff if the stream
   * drops (e.g. server restart). Exits cleanly on shutdown.
   */
  private async startEventLoop(): Promise<void> {
    if (this.sseLoopRunning) return;
    this.sseLoopRunning = true;

    while (!this.shuttingDown && this.baseUrl) {
      try {
        await this.consumeEventStream();
      } catch (err) {
        if (this.shuttingDown) break;
        console.error('[OPENCODE-SERVER] SSE loop error:', err);
      }
      if (this.shuttingDown) break;
      await sleep(this.sseReconnectDelayMs);
      this.sseReconnectDelayMs = Math.min(this.sseReconnectDelayMs * 2, 10_000);
    }

    this.sseLoopRunning = false;
  }

  private consumeEventStream(): Promise<void> {
    if (!this.baseUrl) return Promise.reject(new Error('no baseUrl'));

    // Using Node's native http.get rather than global fetch: undici's fetch
    // buffers the response body aggressively for SSE, which caused bus
    // events (message.part.delta, etc.) to never surface to our reader while
    // heartbeats did. The low-level `http` module delivers each chunk as it
    // arrives, matching what `curl -N` sees on the same socket.
    return new Promise<void>((resolve, reject) => {
      const url = new URL('/event', this.baseUrl!);
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };

      const req = http.get(
        {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname + url.search,
          headers: { Accept: 'text/event-stream' },
        },
        (res) => {
          if (res.statusCode !== 200) {
            res.resume();
            settle(() => reject(new Error(`SSE failed: ${res.statusCode}`)));
            return;
          }

          res.setEncoding('utf8');
          this.sseReconnectDelayMs = 500;
          console.log('[OPENCODE-SERVER] SSE connected');
          ocDbg('[SSE] connected baseUrl=' + this.baseUrl);
          this.sseConnected = true;
          const waiters = this.sseReadyWaiters.splice(0);
          for (const w of waiters) {
            try {
              w();
            } catch {
              /* noop */
            }
          }

          let buffer = '';
          res.on('data', (chunk: string) => {
            buffer += chunk;
            let idx;
            while ((idx = buffer.indexOf('\n\n')) >= 0) {
              const frame = buffer.slice(0, idx);
              buffer = buffer.slice(idx + 2);
              const dataLine = frame
                .split('\n')
                .filter((l) => l.startsWith('data:'))
                .map((l) => l.slice(5).trim())
                .join('\n');
              if (!dataLine) continue;
              try {
                const evt = JSON.parse(dataLine) as OpencodeEvent;
                this.dispatch(evt);
              } catch (err) {
                console.warn('[OPENCODE-SERVER] bad SSE frame:', err);
              }
            }
          });

          res.on('end', () => {
            this.sseConnected = false;
            console.log('[OPENCODE-SERVER] SSE disconnected (end)');
            settle(() => resolve());
          });

          res.on('error', (err) => {
            this.sseConnected = false;
            console.log('[OPENCODE-SERVER] SSE disconnected (error)');
            settle(() => reject(err));
          });
        }
      );

      // Wire the abort controller to destroy the request. Swap out the field
      // so shutdown()/reconnect can tear it down.
      const controller = new AbortController();
      this.sseController = controller;
      controller.signal.addEventListener(
        'abort',
        () => {
          try {
            req.destroy();
          } catch {
            /* noop */
          }
        },
        { once: true }
      );

      req.on('error', (err) => {
        this.sseConnected = false;
        settle(() => reject(err));
      });
    });
  }

  /**
   * Resolve once the SSE stream is open and streaming. If already connected
   * this returns immediately; otherwise it queues a waiter that is released
   * by the event-loop on the next successful connect. Times out after
   * `timeoutMs` so a permanently-dead opencode doesn't deadlock the caller.
   */
  private waitForSseReady(timeoutMs = 10_000): Promise<void> {
    if (this.sseConnected) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.sseReadyWaiters.indexOf(done);
        if (i >= 0) this.sseReadyWaiters.splice(i, 1);
        reject(new Error(`SSE did not reconnect within ${timeoutMs}ms`));
      }, timeoutMs);
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      this.sseReadyWaiters.push(done);
    });
  }

  private dispatch(evt: OpencodeEvent): void {
    const sid = extractSessionId(evt);
    if (evt.type !== 'server.heartbeat') {
      const routed = sid && this.handlers.has(sid);
      ocDbg(
        `[OC-DISPATCH] type=${evt.type} sid=${sid ?? 'NONE'} routed=${routed} handlers=${Array.from(
          this.handlers.keys()
        )
          .map((k) => k.slice(-10))
          .join(',')}`
      );
    }
    if (process.env.OPENCODE_DEBUG_EVENTS === '1') {
      const routed = sid && this.handlers.has(sid);
      const preview = JSON.stringify(evt).slice(0, 240);
      console.log(
        `[OPENCODE-SSE] type=${evt.type} sid=${sid ?? 'NONE'} routed=${routed} ${preview}`
      );
    }
    if (sid && this.handlers.has(sid)) {
      try {
        this.handlers.get(sid)!(evt);
      } catch (err) {
        console.error('[OPENCODE-SERVER] handler threw:', err);
      }
    }
    // Always fan out to global handlers (e.g. for logging).
    for (const h of this.globalHandlers) {
      try {
        h(evt);
      } catch {
        /* noop */
      }
    }
  }

  /**
   * Register a handler that receives every event for a given opencode session.
   */
  subscribe(opencodeSessionId: string, handler: Handler): void {
    this.handlers.set(opencodeSessionId, handler);
    ocDbg(`[SUB] register sid=${opencodeSessionId} total=${this.handlers.size}`);
  }

  unsubscribe(opencodeSessionId: string): void {
    this.handlers.delete(opencodeSessionId);
    this.stopPolling(opencodeSessionId);
    this.pollState.delete(opencodeSessionId);
  }

  /** Create a new opencode session, returns the session ID. */
  async createSession(cwd: string, opts: CreateSessionOptions = {}): Promise<string> {
    await this.ensureStarted();
    await this.waitForSseReady();
    const url = `${this.baseUrl}/session?directory=${encodeURIComponent(cwd)}`;
    const body: Record<string, unknown> = {};
    const model = opts.model ? splitModel(opts.model) : null;
    if (model) {
      body.model = {
        id: model.modelID,
        providerID: model.providerID,
        ...(opts.variant ? { variant: normalizeVariant(opts.variant) } : {}),
      };
    }
    if (opts.agent) body.agent = opts.agent;
    body.permission = buildOpenCodePermissionRules(opts.mode, {
      workingDirectory: cwd,
      allowedDirectories: opts.allowedDirectories,
    });

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`createSession failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as { id: string };
    return data.id;
  }

  /**
   * Send a prompt to a session. Returns immediately — the actual response
   * streams over SSE. Uses /prompt_async to avoid blocking the HTTP
   * connection while the model runs.
   */
  async sendPrompt(opencodeSessionId: string, opts: PromptOptions): Promise<void> {
    await this.ensureStarted();
    // SSE events emitted while the stream is disconnected are not buffered
    // or replayed by opencode — they're just dropped. Block here until the
    // stream is open so the model's output doesn't land in a dead window.
    await this.waitForSseReady();
    this.writeWebuiSessionContext(opencodeSessionId, opts);
    const body: Record<string, unknown> = {
      parts: [{ type: 'text', text: opts.text }],
    };
    if (opts.model) {
      const model = splitModel(opts.model);
      if (model) body.model = model;
    }
    if (opts.agent) body.agent = opts.agent;
    if (opts.variant) body.variant = normalizeVariant(opts.variant);

    // NOTE: Do not pass a `tools` map here. When `tools` is present in the
    // /prompt_async body, opencode silently suppresses ALL bus events
    // (message.updated, message.part.delta, etc.) while still persisting
    // the assistant response — so the UI never sees a reply. Permission
    // policy has to be configured via session/agent config instead.
    const qs = opts.directory ? `?directory=${encodeURIComponent(opts.directory)}` : '';
    const url = `${this.baseUrl}/session/${encodeURIComponent(opencodeSessionId)}/prompt_async${qs}`;
    ocDbg(
      `[OC-SEND] sid=${opencodeSessionId} subscribed=${this.handlers.has(opencodeSessionId)} handlerCount=${this.handlers.size} sseConnected=${this.sseConnected} body=${JSON.stringify(body).slice(0, 200)}`
    );
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    ocDbg(`[OC-SEND] response status=${res.status}`);
    if (!res.ok) {
      throw new Error(`sendPrompt failed: ${res.status} ${await res.text()}`);
    }
    this.startPolling(opencodeSessionId);
  }

  private writeWebuiSessionContext(opencodeSessionId: string, opts: PromptOptions): void {
    if (!opts.webuiSessionId) return;
    try {
      fs.writeFileSync(
        WEBUI_SESSION_CONTEXT_FILE,
        JSON.stringify({
          webuiSessionId: opts.webuiSessionId,
          opencodeSessionId,
          directory: opts.directory || null,
          updatedAt: Date.now(),
        })
      );
    } catch (err) {
      console.warn('[OPENCODE-SERVER] failed to write WebUI session context:', err);
    }
  }

  /**
   * Start polling /session/{id}/message for the given session. Synthesises
   * message.part.updated / session.idle events from the diffs so the existing
   * dispatcher path (→ ClaudeProcessManager.translateOpencodeServerEvent)
   * delivers streaming output to the UI.
   */
  private startPolling(opencodeSessionId: string): void {
    if (this.pollTimers.has(opencodeSessionId)) return;
    // Preserve state across turns: finishedMessages keeps prior turns' IDs so
    // we don't re-fire session.idle for them, and textLens keeps partID cursors
    // (partIDs are unique per message so this is safe and useful if opencode
    // ever re-sends old parts). Only reset the `idled` latch.
    const prior = this.pollState.get(opencodeSessionId);
    this.pollState.set(opencodeSessionId, {
      textLens: prior?.textLens ?? new Map(),
      toolStatus: prior?.toolStatus ?? new Map(),
      finishedMessages: prior?.finishedMessages ?? new Set(),
      idled: false,
      idleCandidateAt: null,
      startedAt: Date.now(),
    });
    const tick = () => {
      this.pollOnce(opencodeSessionId).catch((err) => {
        ocDbg(`[OC-POLL] error sid=${opencodeSessionId} ${String(err).slice(0, 200)}`);
      });
    };
    const timer = setInterval(tick, 500);
    this.pollTimers.set(opencodeSessionId, timer);
    ocDbg(`[OC-POLL] started sid=${opencodeSessionId}`);
    tick();
  }

  private stopPolling(opencodeSessionId: string): void {
    const t = this.pollTimers.get(opencodeSessionId);
    if (t) clearInterval(t);
    this.pollTimers.delete(opencodeSessionId);
    // Intentionally keep pollState so the next turn doesn't re-fire idle for
    // prior turns. State is cleared in unsubscribe() / shutdown().
    ocDbg(`[OC-POLL] stopped sid=${opencodeSessionId}`);
  }

  private async pollOnce(opencodeSessionId: string): Promise<void> {
    if (!this.baseUrl) return;
    const state = this.pollState.get(opencodeSessionId);
    if (!state || state.idled) return;

    // Safety cap: 30 minutes. opencode turns can run long (tool loops, large
    // generations), but something is wrong if we've been polling half an hour.
    if (Date.now() - state.startedAt > 30 * 60 * 1000) {
      ocDbg(`[OC-POLL] safety-cap sid=${opencodeSessionId}`);
      state.idled = true;
      this.dispatch({ type: 'session.idle', properties: { sessionID: opencodeSessionId } });
      this.stopPolling(opencodeSessionId);
      return;
    }

    const res = await fetch(
      `${this.baseUrl}/session/${encodeURIComponent(opencodeSessionId)}/message`
    );
    if (!res.ok) return;
    const data = (await res.json()) as Array<{
      info?: Record<string, unknown>;
      parts?: Array<Record<string, unknown>>;
    }>;

    let sawChange = false;

    for (const msg of data) {
      const info = msg.info as Record<string, unknown> | undefined;
      if (!info || info.role !== 'assistant') continue;
      const messageId = info.id as string;

      // We still iterate parts of already-finished messages in case opencode
      // back-fills anything; diffs against textLens/toolStatus make this cheap.
      for (const part of msg.parts || []) {
        const partId = part.id as string;
        const partType = part.type as string;
        if (!partId || !partType) continue;

        if (partType === 'text' || partType === 'reasoning') {
          const text = typeof part.text === 'string' ? (part.text as string) : '';
          const prev = state.textLens.get(partId) ?? 0;
          if (text.length > prev) {
            state.textLens.set(partId, text.length);
            sawChange = true;
            this.dispatch({
              type: 'message.part.updated',
              properties: {
                part: { ...part, sessionID: opencodeSessionId, messageID: messageId },
              },
            });
          }
          continue;
        }

        if (partType === 'tool') {
          const stateField = part.state as { status?: string } | undefined;
          const status = stateField?.status ?? '';
          const prev = state.toolStatus.get(partId) ?? '';
          if (status !== prev) {
            state.toolStatus.set(partId, status);
            sawChange = true;
            this.dispatch({
              type: 'message.part.updated',
              properties: {
                part: { ...part, sessionID: opencodeSessionId, messageID: messageId },
              },
            });
          }
          continue;
        }

        if (partType === 'step-start' || partType === 'step-finish') {
          // Emit once per part (use textLens as a sentinel keyed by partId).
          if (!state.textLens.has(partId)) {
            state.textLens.set(partId, 1);
            sawChange = true;
            this.dispatch({
              type: 'message.part.updated',
              properties: {
                part: { ...part, sessionID: opencodeSessionId, messageID: messageId },
              },
            });
          }
          continue;
        }
      }
    }

    // Determine run-completion from the LAST message. opencode creates a new
    // assistant message per step, so only the final one carries the terminal
    // finish reason. finish=stop (or error) = the loop exited; finish=
    // tool-calls/length = step ended, loop will continue with another message.
    const last = data[data.length - 1];
    const lastInfo = last?.info as Record<string, unknown> | undefined;
    const lastRole = lastInfo?.role;
    const lastFinish = lastInfo?.finish as string | undefined;
    const TERMINAL = new Set(['stop', 'error', 'content-filter']);
    const isTerminal = lastRole === 'assistant' && !!lastFinish && TERMINAL.has(lastFinish);

    if (sawChange) {
      // Any observable progress resets the idle grace period.
      state.idleCandidateAt = null;
    }

    if (isTerminal && !sawChange) {
      if (state.idleCandidateAt === null) {
        state.idleCandidateAt = Date.now();
      } else if (Date.now() - state.idleCandidateAt >= 2000) {
        // 2s of quiet with a terminal finish — the run really is over.
        state.idled = true;
        const lastId = lastInfo?.id as string | undefined;
        if (lastId) state.finishedMessages.add(lastId);
        this.dispatch({
          type: 'session.idle',
          properties: { sessionID: opencodeSessionId },
        });
        this.stopPolling(opencodeSessionId);
        return;
      }
    } else if (!isTerminal) {
      state.idleCandidateAt = null;
    }
  }

  async abort(opencodeSessionId: string): Promise<void> {
    if (!this.baseUrl) return;
    const url = `${this.baseUrl}/session/${encodeURIComponent(opencodeSessionId)}/abort`;
    try {
      await fetch(url, { method: 'POST' });
    } catch (err) {
      console.warn('[OPENCODE-SERVER] abort failed:', err);
    }
  }

  async replyPermission(
    requestId: string,
    reply: 'once' | 'always' | 'reject',
    message?: string
  ): Promise<boolean> {
    await this.ensureStarted();
    const url = `${this.baseUrl}/permission/${encodeURIComponent(requestId)}/reply`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reply, ...(message ? { message } : {}) }),
    });
    if (res.status === 404) return false;
    if (!res.ok) {
      throw new Error(`permission reply failed: ${res.status} ${await res.text()}`);
    }
    return true;
  }

  /** Confirm the session still exists in the server (e.g. after a server restart). */
  async sessionExists(opencodeSessionId: string): Promise<boolean> {
    if (!this.baseUrl) return false;
    try {
      const res = await fetch(`${this.baseUrl}/session/${encodeURIComponent(opencodeSessionId)}`);
      return res.ok;
    } catch {
      return false;
    }
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    this.handlers.clear();
    this.globalHandlers.clear();
    for (const t of this.pollTimers.values()) clearInterval(t);
    this.pollTimers.clear();
    this.pollState.clear();
    try {
      this.sseController?.abort();
    } catch {
      /* noop */
    }
    const proc = this.proc;
    if (proc && !proc.killed) {
      proc.kill('SIGTERM');
      await new Promise<void>((r) => {
        const t = setTimeout(() => {
          try {
            proc.kill('SIGKILL');
          } catch {
            /* noop */
          }
          r();
        }, 2000);
        proc.once('exit', () => {
          clearTimeout(t);
          r();
        });
      });
    }
    this.proc = null;
    this.baseUrl = null;
  }
}

function extractSessionId(evt: OpencodeEvent): string | null {
  const p = evt.properties as Record<string, unknown> | undefined;
  if (!p) return null;
  // Flat shape: { sessionID: "..." }
  if (typeof p.sessionID === 'string') return p.sessionID;
  // Part events: { part: { sessionID: "..." } }
  const part = p.part as Record<string, unknown> | undefined;
  if (part && typeof part.sessionID === 'string') return part.sessionID;
  // Message-updated shape: { info: { sessionID: "..." } }
  const info = p.info as Record<string, unknown> | undefined;
  if (info && typeof info.sessionID === 'string') return info.sessionID;
  if (info && typeof info.id === 'string' && evt.type === 'session.updated') {
    // `session.updated.properties.info` has `id` (the session ID itself).
    return info.id;
  }
  return null;
}

function splitModel(slashForm: string): { providerID: string; modelID: string } | null {
  const idx = slashForm.indexOf('/');
  if (idx <= 0) return null;
  return {
    providerID: slashForm.slice(0, idx),
    modelID: slashForm.slice(idx + 1),
  };
}

function normalizeVariant(variant: string): string {
  const normalized = variant
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (normalized === 'extra_high' || normalized === 'xhigh') return 'max';
  return normalized;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Singleton — import this directly rather than instantiating.
export const opencodeServer = new OpencodeServer();
