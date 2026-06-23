import { ChildProcess, spawn as cpSpawn } from 'child_process';
import { EventEmitter } from 'events';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { URL } from 'url';
import type { SessionMode } from '@plum-code-webui/shared';
import { buildOpenCodePermissionRules, CLI_PROVIDERS } from '../cli-providers.js';
import { config } from '../../config.js';
import { buildIntegrationEnv } from '../../utils/integrationEnv.js';
import { buildOpenCodeCommandEnv } from '../../utils/opencodeCatalog.js';
import {
  buildOpenCodeProviderCredentialEnv,
  getOpenCodeProviderCredentialFingerprint,
} from '../../utils/opencodeProviderKeys.js';
import { syncOpenCodeConfig } from '../../utils/providerLinks.js';
import { buildOpenCodePromptText, getOpenCodePrimaryAgent } from './sessionContext.js';

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

type OpenCodeMessageSnapshot = {
  info?: Record<string, unknown>;
  parts?: Array<Record<string, unknown>>;
};

export function collectOpenCodePollCursor(data: OpenCodeMessageSnapshot[]): {
  textLens: Map<string, number>;
  toolStatus: Map<string, string>;
  finishedMessages: Set<string>;
} {
  const textLens = new Map<string, number>();
  const toolStatus = new Map<string, string>();
  const finishedMessages = new Set<string>();

  for (const msg of data) {
    const info = msg.info as Record<string, unknown> | undefined;
    if (!info || info.role !== 'assistant') continue;
    const messageId = typeof info.id === 'string' ? info.id : undefined;

    for (const part of msg.parts || []) {
      const partId = typeof part.id === 'string' ? part.id : undefined;
      const partType = typeof part.type === 'string' ? part.type : undefined;
      if (!partId || !partType) continue;

      if (partType === 'text' || partType === 'reasoning') {
        const text = typeof part.text === 'string' ? part.text : '';
        textLens.set(partId, text.length);
        continue;
      }

      if (partType === 'tool') {
        const stateField = part.state as { status?: string } | undefined;
        toolStatus.set(partId, stateField?.status ?? '');
        continue;
      }

      if (partType === 'step-start' || partType === 'step-finish') {
        textLens.set(partId, 1);
      }
    }

    if (messageId && isTerminalOpenCodeAssistantMessage(msg)) {
      finishedMessages.add(messageId);
    }
  }

  return { textLens, toolStatus, finishedMessages };
}

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
  /** WebUI user id, used to bind the singleton server to the right provider keys. */
  userId?: string;
}

type OpenCodeRunOptions = Omit<PromptOptions, 'text'>;

interface CommandOptions extends OpenCodeRunOptions {
  command: string;
  arguments?: string;
}

interface CreateSessionOptions {
  model?: string | null;
  agent?: string | null;
  mode?: SessionMode;
  variant?: string | null;
  allowedDirectories?: string[];
  userId?: string;
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
  private credentialOwnerUserId: string | null = null;
  private credentialFingerprint: string | null = null;

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
      observedChange: boolean;
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
  async ensureStarted(userId?: string): Promise<string> {
    const configSync = userId ? syncOpenCodeConfig({ quiet: true, userId }) : null;
    if (this.baseUrl && this.proc && !this.proc.killed) {
      if (configSync?.updated && userId) {
        await this.restart(userId);
        if (this.baseUrl) return this.baseUrl;
      }
      if (userId) {
        const nextFingerprint = getOpenCodeProviderCredentialFingerprint(userId);
        if (
          this.credentialOwnerUserId !== userId ||
          this.credentialFingerprint !== nextFingerprint
        ) {
          await this.restart(userId);
          if (this.baseUrl) return this.baseUrl;
        }
      }
      return this.baseUrl;
    }
    if (this.startPromise) return this.startPromise;

    this.startPromise = this.startInternal(userId).catch((err) => {
      this.startPromise = null;
      throw err;
    });
    return this.startPromise;
  }

  private startInternal(userId?: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      this.shuttingDown = false;
      this.sseConnected = false;
      this.sseReconnectDelayMs = 500;
      this.credentialOwnerUserId = userId || null;
      this.credentialFingerprint = getOpenCodeProviderCredentialFingerprint(userId);

      const env = {
        ...buildOpenCodeCommandEnv(),
        ...buildIntegrationEnv(),
        ...buildOpenCodeProviderCredentialEnv(userId),
        WEBUI_BACKEND_URL: `http://localhost:${config.port}`,
        WEBUI_HOOK_SECRET: config.hookSecret,
        WEBUI_SESSION_CONTEXT_FILE,
      };

      const proc = cpSpawn(
        CLI_PROVIDERS.opencode.command,
        ['serve', '--port', '0', '--hostname', '127.0.0.1'],
        {
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      );

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
    await this.ensureStarted(opts.userId);
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
    const agent = opts.agent || getOpenCodePrimaryAgent();
    if (agent) body.agent = agent;
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
    await this.ensureStarted(opts.userId);
    // SSE events emitted while the stream is disconnected are not buffered
    // or replayed by opencode — they're just dropped. Block here until the
    // stream is open so the model's output doesn't land in a dead window.
    await this.waitForSseReady();
    await this.primePollingState(opencodeSessionId);
    this.writeWebuiSessionContext(opencodeSessionId, opts);
    const body: Record<string, unknown> = {
      parts: [
        {
          type: 'text',
          text: buildOpenCodePromptText(opts.text, {
            webuiSessionId: opts.webuiSessionId,
            mode: opts.mode,
            reasoningLevel: opts.variant,
          }),
        },
      ],
    };
    if (opts.model) {
      const model = splitModel(opts.model);
      if (model) body.model = model;
    }
    const agent = opts.agent || getOpenCodePrimaryAgent();
    if (agent) body.agent = agent;
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

  /**
   * Execute an OpenCode-native slash command through the server command API.
   * This preserves command semantics for /init, /review, /security-review, etc.
   * instead of sending the slash command as plain chat text.
   */
  async sendCommand(opencodeSessionId: string, opts: CommandOptions): Promise<void> {
    await this.ensureStarted(opts.userId);
    await this.waitForSseReady();
    await this.primePollingState(opencodeSessionId);
    this.writeWebuiSessionContext(opencodeSessionId, opts);

    const body: Record<string, unknown> = {
      command: opts.command,
      arguments: opts.arguments ?? '',
    };
    if (opts.model) body.model = opts.model;
    const agent = opts.agent || getOpenCodePrimaryAgent();
    if (agent) body.agent = agent;
    if (opts.variant) body.variant = normalizeVariant(opts.variant);

    const qs = opts.directory ? `?directory=${encodeURIComponent(opts.directory)}` : '';
    const url = `${this.baseUrl}/session/${encodeURIComponent(opencodeSessionId)}/command${qs}`;
    ocDbg(
      `[OC-COMMAND] sid=${opencodeSessionId} command=${opts.command} args=${JSON.stringify(opts.arguments ?? '').slice(0, 120)}`
    );
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    ocDbg(`[OC-COMMAND] response status=${res.status}`);
    if (!res.ok) {
      throw new Error(`sendCommand failed: ${res.status} ${await res.text()}`);
    }
    this.startPolling(opencodeSessionId);
  }

  async compactSession(opencodeSessionId: string, opts: OpenCodeRunOptions = {}): Promise<boolean> {
    await this.ensureStarted(opts.userId);
    await this.waitForSseReady();
    const url = `${this.baseUrl}/api/session/${encodeURIComponent(opencodeSessionId)}/compact`;
    const res = await fetch(url, { method: 'POST' });
    if (res.status === 404) return false;
    if (!res.ok) {
      throw new Error(`compactSession failed: ${res.status} ${await res.text()}`);
    }
    return true;
  }

  async replyQuestion(
    requestId: string,
    answers: unknown,
    opencodeSessionId?: string
  ): Promise<boolean> {
    await this.ensureStarted();
    if (opencodeSessionId) {
      const sessionUrl = `${this.baseUrl}/api/session/${encodeURIComponent(
        opencodeSessionId
      )}/question/request/${encodeURIComponent(requestId)}/reply`;
      const sessionRes = await fetch(sessionUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers }),
      });
      if (sessionRes.ok) return true;
      if (sessionRes.status !== 404) {
        throw new Error(
          `question v2 reply failed: ${sessionRes.status} ${await sessionRes.text()}`
        );
      }
    }

    const url = `${this.baseUrl}/question/${encodeURIComponent(requestId)}/reply`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers }),
    });
    if (res.status === 404) return false;
    if (!res.ok) {
      throw new Error(`question reply failed: ${res.status} ${await res.text()}`);
    }
    return true;
  }

  async rejectQuestion(requestId: string, opencodeSessionId?: string): Promise<boolean> {
    await this.ensureStarted();
    if (opencodeSessionId) {
      const sessionUrl = `${this.baseUrl}/api/session/${encodeURIComponent(
        opencodeSessionId
      )}/question/request/${encodeURIComponent(requestId)}/reject`;
      const sessionRes = await fetch(sessionUrl, { method: 'POST' });
      if (sessionRes.ok) return true;
      if (sessionRes.status !== 404) {
        throw new Error(
          `question v2 reject failed: ${sessionRes.status} ${await sessionRes.text()}`
        );
      }
    }

    const url = `${this.baseUrl}/question/${encodeURIComponent(requestId)}/reject`;
    const res = await fetch(url, { method: 'POST' });
    if (res.status === 404) return false;
    if (!res.ok) {
      throw new Error(`question reject failed: ${res.status} ${await res.text()}`);
    }
    return true;
  }

  private async primePollingState(opencodeSessionId: string): Promise<void> {
    if (!this.baseUrl) return;
    try {
      const res = await fetch(
        `${this.baseUrl}/session/${encodeURIComponent(opencodeSessionId)}/message`
      );
      if (!res.ok) return;
      const data = (await res.json()) as OpenCodeMessageSnapshot[];
      const snapshot = collectOpenCodePollCursor(data);
      const prior = this.pollState.get(opencodeSessionId);
      const textLens = prior?.textLens ?? new Map<string, number>();
      const toolStatus = prior?.toolStatus ?? new Map<string, string>();
      const finishedMessages = prior?.finishedMessages ?? new Set<string>();

      for (const [partId, length] of snapshot.textLens) {
        textLens.set(partId, length);
      }
      for (const [partId, status] of snapshot.toolStatus) {
        toolStatus.set(partId, status);
      }
      for (const messageId of snapshot.finishedMessages) {
        finishedMessages.add(messageId);
      }

      this.pollState.set(opencodeSessionId, {
        textLens,
        toolStatus,
        finishedMessages,
        idled: false,
        observedChange: false,
        idleCandidateAt: null,
        startedAt: Date.now(),
      });
      ocDbg(
        `[OC-POLL] primed sid=${opencodeSessionId} text=${textLens.size} tools=${toolStatus.size} finished=${finishedMessages.size}`
      );
    } catch (err) {
      ocDbg(`[OC-POLL] prime failed sid=${opencodeSessionId} ${String(err).slice(0, 200)}`);
    }
  }

  private writeWebuiSessionContext(
    opencodeSessionId: string,
    opts: Pick<PromptOptions, 'webuiSessionId' | 'directory'>
  ): void {
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
      observedChange: false,
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

    if (!state.observedChange && Date.now() - state.startedAt > 120 * 1000) {
      ocDbg(`[OC-POLL] no-progress sid=${opencodeSessionId}`);
      state.idled = true;
      this.dispatch({
        type: 'session.error',
        properties: {
          sessionID: opencodeSessionId,
          error: {
            message:
              'OpenCode did not produce any output within 120s. Check that the selected provider/model is configured and present in `opencode models`.',
          },
        },
      });
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

      const assistantError = extractOpenCodeAssistantErrorMessage(msg);
      if (assistantError && messageId && !state.finishedMessages.has(messageId)) {
        state.finishedMessages.add(messageId);
        state.idled = true;
        this.dispatch({
          type: 'session.error',
          properties: {
            sessionID: opencodeSessionId,
            error: {
              message: assistantError,
            },
          },
        });
        this.dispatch({ type: 'session.idle', properties: { sessionID: opencodeSessionId } });
        this.stopPolling(opencodeSessionId);
        return;
      }

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
            state.observedChange = true;
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
            state.observedChange = true;
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
            state.observedChange = true;
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
    const isTerminal = isTerminalOpenCodeAssistantMessage(last);

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
        const lastId = last?.info?.id as string | undefined;
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
    message?: string,
    opencodeSessionId?: string
  ): Promise<boolean> {
    await this.ensureStarted();
    if (opencodeSessionId) {
      const sessionUrl = `${this.baseUrl}/api/session/${encodeURIComponent(
        opencodeSessionId
      )}/permission/request/${encodeURIComponent(requestId)}/reply`;
      const sessionRes = await fetch(sessionUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reply, ...(message ? { message } : {}) }),
      });
      if (sessionRes.ok) return true;
      if (sessionRes.status !== 404) {
        throw new Error(
          `permission v2 reply failed: ${sessionRes.status} ${await sessionRes.text()}`
        );
      }
    }

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
    this.startPromise = null;
    this.sseConnected = false;
    this.sseLoopRunning = false;
    this.sseReadyWaiters.splice(0);
    this.credentialOwnerUserId = null;
    this.credentialFingerprint = null;
  }

  async restart(userId?: string): Promise<string | null> {
    const shouldRestart = Boolean(this.proc || this.baseUrl || this.startPromise);
    await this.shutdown();
    this.shuttingDown = false;
    return shouldRestart ? this.ensureStarted(userId) : null;
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

export function isTerminalOpenCodeAssistantMessage(
  message:
    | {
        info?: Record<string, unknown>;
        parts?: Array<Record<string, unknown>>;
      }
    | undefined
): boolean {
  const info = message?.info;
  if (!info || info.role !== 'assistant') return false;

  if (extractOpenCodeAssistantErrorMessage(message)) return true;

  const finish = info.finish as string | undefined;
  if (!finish) return false;

  const TERMINAL_FINISHES = new Set(['stop', 'error', 'content-filter']);
  if (TERMINAL_FINISHES.has(finish)) return true;

  const time = info.time as Record<string, unknown> | undefined;
  const completedAt = time?.completed;
  const parts = message.parts || [];
  const hasStepFinish = parts.some((part) => part.type === 'step-finish');
  const hasToolError = parts.some((part) => {
    if (part.type !== 'tool') return false;
    const toolState = part.state as { status?: string } | undefined;
    return toolState?.status === 'error';
  });

  return (
    finish === 'unknown' && (hasToolError || (hasStepFinish && typeof completedAt === 'number'))
  );
}

export function extractOpenCodeAssistantErrorMessage(
  message:
    | {
        info?: Record<string, unknown>;
      }
    | undefined
): string | null {
  const info = message?.info;
  if (!info || info.role !== 'assistant') return null;

  const error = info.error as
    | {
        message?: unknown;
        name?: unknown;
        data?: {
          message?: unknown;
          responseBody?: unknown;
        };
      }
    | undefined;
  if (!error || typeof error !== 'object') return null;

  if (typeof error.data?.message === 'string' && error.data.message.trim()) {
    return error.data.message.trim();
  }

  if (typeof error.message === 'string' && error.message.trim()) {
    return error.message.trim();
  }

  if (typeof error.data?.responseBody === 'string' && error.data.responseBody.trim()) {
    try {
      const parsed = JSON.parse(error.data.responseBody) as {
        error?: { message?: unknown };
        message?: unknown;
      };
      const parsedMessage =
        typeof parsed.error?.message === 'string'
          ? parsed.error.message
          : typeof parsed.message === 'string'
            ? parsed.message
            : '';
      if (parsedMessage.trim()) return parsedMessage.trim();
    } catch {
      // Fall through to the generic provider error below.
    }
  }

  if (typeof error.name === 'string' && error.name.trim()) {
    return `OpenCode provider error: ${error.name.trim()}`;
  }

  return 'OpenCode provider error';
}
