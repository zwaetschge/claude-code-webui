/**
 * GeminiApiAdapter — Direct REST API adapter for Gemini via Code Assist API.
 *
 * Bypasses the Gemini CLI (which hangs in Docker as an Ink/React TUI)
 * and talks directly to the Google Code Assist API using OAuth credentials.
 * This is the same API endpoint the Gemini CLI uses internally:
 *   https://cloudcode-pa.googleapis.com/v1internal
 *
 * Creates a fake ChildProcess-like object whose stdout emits NDJSON lines
 * compatible with ClaudeProcessManager's handleJsonOutput().
 *
 * Supports tool use: the adapter sends tool declarations to the API,
 * detects functionCall parts in responses, executes tools locally,
 * and sends results back for multi-turn tool interactions.
 */

import { Readable, Writable } from 'stream';
import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { getToolDeclarations, executeTool } from './gemini-tools.js';
import type { FunctionCall } from './gemini-tools.js';

// OAuth credentials — uses Gemini CLI's public installed-app credentials by default.
// Override via GEMINI_OAUTH_CLIENT_ID / GEMINI_OAUTH_CLIENT_SECRET env vars.
const CLIENT_ID = process.env.GEMINI_OAUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GEMINI_OAUTH_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || '';
const CREDS_PATH = path.join(os.homedir(), '.gemini', 'oauth_creds.json');

// Code Assist API endpoint (same as Gemini CLI uses)
const CODE_ASSIST_BASE = 'https://cloudcode-pa.googleapis.com/v1internal';

// Max tool-call rounds to prevent infinite loops
const MAX_TOOL_ROUNDS = 25;

interface GeminiCredentials {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
  token_type?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GeminiPart = Record<string, any>;

interface GeminiMessage {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

interface CodeAssistCandidate {
  content?: {
    role: string;
    parts: GeminiPart[];
  };
  finishReason?: string;
}

interface CodeAssistSSEChunk {
  response?: {
    candidates?: CodeAssistCandidate[];
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
      thoughtsTokenCount?: number;
    };
    modelVersion?: string;
  };
  traceId?: string;
}

/**
 * FakeChildProcess mimics node ChildProcess for the ProcessManager.
 * stdout is a Readable that we push NDJSON lines to.
 * stdin is a Writable that receives messages from the ProcessManager.
 */
export class FakeChildProcess extends EventEmitter {
  public readonly stdin: Writable;
  public readonly stdout: Readable;
  public readonly stderr: Readable;
  public readonly pid = -1;
  public killed = false;

  private _onStdinWrite: (data: string) => void;

  constructor(onStdinWrite: (data: string) => void) {
    super();
    this._onStdinWrite = onStdinWrite;

    this.stdout = new Readable({ read() {} });
    this.stderr = new Readable({ read() {} });

    this.stdin = new Writable({
      write: (chunk, _encoding, callback) => {
        try {
          this._onStdinWrite(chunk.toString());
        } catch (err) {
          console.error('[GeminiApi] stdin write error:', err);
        }
        callback();
      },
    });
  }

  /** Push a line to stdout (ProcessManager reads this) */
  pushStdout(line: string): void {
    this.stdout.push(line + '\n');
  }

  /** Emit exit event to signal session end */
  kill(_signal?: string): boolean {
    if (this.killed) return false;
    this.killed = true;
    this.stdout.push(null); // End stream
    this.emit('exit', 0);
    return true;
  }
}

export class GeminiApiAdapter {
  private credentials: GeminiCredentials | null = null;
  private conversationHistory: GeminiMessage[] = [];
  private model: string;
  private fakeProcess: FakeChildProcess;
  private currentAbortController: AbortController | null = null;
  private sessionId: string;
  private initialized = false;
  private projectId: string | null = null;
  private workingDirectory: string;
  private pendingMessages: string[] = []; // Queue messages received before init

  constructor(sessionId: string, model?: string, workingDirectory?: string) {
    this.sessionId = sessionId;
    this.model = model || 'gemini-2.5-flash';
    this.workingDirectory = workingDirectory || process.cwd();

    this.fakeProcess = new FakeChildProcess((data: string) => {
      this.handleStdinMessage(data);
    });
  }

  /** Returns the fake ChildProcess for the ProcessManager */
  getProcess(): FakeChildProcess {
    return this.fakeProcess;
  }

  /** Set the working directory for tool execution */
  setWorkingDirectory(dir: string): void {
    this.workingDirectory = dir;
  }

  /** Initialize: load credentials, get project ID, emit init message */
  async init(): Promise<void> {
    try {
      await this.loadCredentials();
      await this.loadProjectId();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[GeminiApi] Init failed: ${errMsg}`);
      this.emitJson({
        type: 'error',
        message: `Gemini API authentication failed: ${errMsg}. Please log in via 'gemini' CLI.`,
      });
      // Don't kill immediately — let the user see the error
      setTimeout(() => this.fakeProcess.kill(), 500);
      return;
    }

    this.initialized = true;

    // Emit init message (ProcessManager expects this to capture session_id + model)
    this.emitJson({
      type: 'system',
      subtype: 'init',
      session_id: `gemini-api-${this.sessionId}`,
      model: this.model,
    });

    // Process any messages that arrived before initialization completed
    if (this.pendingMessages.length > 0) {
      console.log(`[GeminiApi] Processing ${this.pendingMessages.length} queued message(s)`);
      const queued = this.pendingMessages.splice(0);
      for (const msg of queued) {
        this.handleStdinMessage(msg);
      }
    }
  }

  /** Handle an interrupt (SIGINT equivalent) */
  interrupt(): void {
    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
    }
  }

  // ── Private methods ──────────────────────────────────────────────────

  private async loadCredentials(): Promise<void> {
    let raw: string;
    try {
      raw = await fs.readFile(CREDS_PATH, 'utf-8');
    } catch {
      throw new Error(
        `No Gemini credentials found at ${CREDS_PATH}. Please run 'gemini' CLI to authenticate.`
      );
    }

    this.credentials = JSON.parse(raw) as GeminiCredentials;

    if (!this.credentials.refresh_token) {
      throw new Error('Gemini credentials missing refresh_token. Please re-authenticate via gemini CLI.');
    }

    // Refresh if expired or about to expire (1 min buffer)
    if (Date.now() >= (this.credentials.expiry_date || 0) - 60_000) {
      await this.refreshAccessToken();
    }
  }

  /** Call loadCodeAssist to get the project ID for the user's subscription */
  private async loadProjectId(): Promise<void> {
    const token = await this.ensureValidToken();

    const resp = await fetch(`${CODE_ASSIST_BASE}:loadCodeAssist`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        metadata: {
          ideType: 'IDE_UNSPECIFIED',
          platform: 'PLATFORM_UNSPECIFIED',
          pluginType: 'GEMINI',
        },
      }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Code Assist loadCodeAssist failed (${resp.status}): ${text.substring(0, 300)}`);
    }

    const data = (await resp.json()) as {
      cloudaicompanionProject?: string;
      currentTier?: { id?: string; name?: string };
    };
    this.projectId = data.cloudaicompanionProject || null;

    const tierName = data.currentTier?.name || 'unknown';
    console.log(`[GeminiApi] Authenticated. Project: ${this.projectId}, Tier: ${tierName}`);
  }

  private async refreshAccessToken(): Promise<void> {
    if (!this.credentials?.refresh_token) {
      throw new Error('No refresh token available');
    }

    const resp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        refresh_token: this.credentials.refresh_token,
        grant_type: 'refresh_token',
      }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => 'unknown');
      throw new Error(`Token refresh failed (${resp.status}): ${text}`);
    }

    const tokens = (await resp.json()) as { access_token: string; expires_in: number };
    this.credentials!.access_token = tokens.access_token;
    this.credentials!.expiry_date = Date.now() + tokens.expires_in * 1000;

    // Persist updated token
    try {
      await fs.writeFile(CREDS_PATH, JSON.stringify(this.credentials, null, 2), { mode: 0o600 });
    } catch {
      // Non-fatal — token is in memory
    }
  }

  private async ensureValidToken(): Promise<string> {
    if (!this.credentials) throw new Error('Not authenticated');

    if (Date.now() >= (this.credentials.expiry_date || 0) - 60_000) {
      await this.refreshAccessToken();
    }

    return this.credentials.access_token;
  }

  /**
   * Handle incoming messages from ProcessManager via stdin.
   * Gemini format: just plain text terminated by newline.
   */
  private handleStdinMessage(data: string): void {
    const text = data.trim();
    if (!text) return;

    if (!this.initialized) {
      console.warn('[GeminiApi] Received message before initialization, queuing');
      this.pendingMessages.push(text);
      return;
    }

    // ProcessManager writes plain text for Gemini provider (see formatInputMessage)
    this.sendToGemini(text).catch((err) => {
      console.error('[GeminiApi] Error sending to Gemini:', err);
      this.emitJson({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    });
  }

  /**
   * Stream a message to Code Assist API with tool-use loop.
   *
   * Flow:
   * 1. Send user message + tool declarations to API
   * 2. Stream response, collecting text and functionCall parts
   * 3. If response contains functionCall parts:
   *    a. Execute tools locally
   *    b. Emit tool_use events to WebSocket
   *    c. Send functionResponse parts back to API
   *    d. Repeat from step 2
   * 4. When no more tool calls: emit final text and finish
   */
  private async sendToGemini(userMessage: string): Promise<void> {
    // Add user message to conversation history
    this.conversationHistory.push({
      role: 'user',
      parts: [{ text: userMessage }],
    });

    const abortController = new AbortController();
    this.currentAbortController = abortController;

    // Emit message_start (triggers thinking=false, captures model)
    this.emitJson({
      type: 'stream_event',
      event: {
        type: 'message_start',
        message: {
          model: this.model,
          usage: {
            input_tokens: 0,
            output_tokens: 0,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        },
      },
    });

    let contentBlockIndex = 0;
    let totalPromptTokens = 0;
    let totalCandidateTokens = 0;
    let fullText = '';

    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        if (abortController.signal.aborted) break;

        const accessToken = await this.ensureValidToken();
        const url = `${CODE_ASSIST_BASE}:streamGenerateContent?alt=sse`;

        // Build request with tool declarations
        const requestBody: Record<string, unknown> = {
          model: this.model,
          project: this.projectId,
          user_prompt_id: `webui-${this.sessionId}-${Date.now()}`,
          request: {
            contents: this.conversationHistory,
            systemInstruction: {
              parts: [
                {
                  text: `You are a coding assistant with full access to the local filesystem and shell. Your working directory is: ${this.workingDirectory}\n\nYou have tools to read files, write files, edit files, run shell commands, search files, and list directories. USE these tools to accomplish tasks — do not ask the user to provide code, instead read the files yourself. When the user asks you to modify code, read the relevant files first, then make changes using the write_file or replace tools.`,
                },
              ],
            },
            tools: [{ functionDeclarations: getToolDeclarations() }],
            generationConfig: {
              maxOutputTokens: 65536,
            },
          },
        };

        // Fetch with retry for 429 rate limits
        let resp: Response | null = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          if (abortController.signal.aborted) break;

          resp = await fetch(url, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
            signal: abortController.signal,
          });

          if (resp.status === 429) {
            // Extract wait time from error message, default 60s
            const errText = await resp.text().catch(() => '');
            const waitMatch = errText.match(/reset after (\d+)s/);
            const waitSec = waitMatch ? parseInt(waitMatch[1], 10) : 60;
            console.log(`[GeminiApi] Rate limited, waiting ${waitSec}s (attempt ${attempt + 1}/3)`);

            // Emit a status message so the user sees what's happening
            this.emitJson({
              type: 'stream_event',
              event: {
                type: 'content_block_delta',
                index: contentBlockIndex,
                delta: { type: 'text_delta', text: `\n\n*[Rate limit reached, waiting ${waitSec}s...]*\n\n` },
              },
            });

            await new Promise((resolve) => setTimeout(resolve, waitSec * 1000));
            continue;
          }

          if (!resp.ok) {
            const errText = await resp.text().catch(() => '');
            throw new Error(`Code Assist API error ${resp.status}: ${errText.substring(0, 500)}`);
          }

          break; // Success
        }

        if (!resp || !resp.ok) {
          throw new Error('Code Assist API request failed after retries');
        }

        if (!resp.body) {
          throw new Error('No response body from Code Assist API');
        }

        // Parse SSE stream and collect parts
        const { textParts, functionCalls, modelParts, finishReason, promptTokens, candidateTokens } =
          await this.parseSSEStream(resp.body, abortController, contentBlockIndex);

        console.log(
          `[GeminiApi] Round ${round + 1}: text=${textParts.length} parts, tools=${functionCalls.length}, finish=${finishReason}`
        );

        totalPromptTokens = promptTokens;
        totalCandidateTokens += candidateTokens;

        // Collect text from this round
        const roundText = textParts.join('');
        fullText += roundText;

        // Save model response parts to conversation history
        if (modelParts.length > 0) {
          this.conversationHistory.push({
            role: 'model',
            parts: modelParts,
          });
        }

        // If no tool calls, we're done
        // Note: Code Assist API may return finishReason "STOP" even with tool calls,
        // so we check functionCalls.length as the primary signal
        if (functionCalls.length === 0) {
          break;
        }

        // Close any open text content block before tool use
        if (roundText) {
          this.emitJson({
            type: 'stream_event',
            event: { type: 'content_block_stop', index: contentBlockIndex },
          });
          contentBlockIndex++;
        }

        // Execute tools and emit events
        const toolResponseParts: GeminiPart[] = [];

        for (const call of functionCalls) {
          const toolId = `gemini-tool-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

          // Emit tool_use start event
          this.emitJson({
            type: 'stream_event',
            event: {
              type: 'content_block_start',
              index: contentBlockIndex,
              content_block: {
                type: 'tool_use',
                id: toolId,
                name: call.name,
                input: call.args,
              },
            },
          });

          // Emit tool_use delta (the input)
          this.emitJson({
            type: 'stream_event',
            event: {
              type: 'content_block_delta',
              index: contentBlockIndex,
              delta: {
                type: 'input_json_delta',
                partial_json: JSON.stringify(call.args),
              },
            },
          });

          // Execute the tool
          console.log(`[GeminiApi] Executing tool: ${call.name}`, JSON.stringify(call.args).substring(0, 200));
          const result = await executeTool(call);

          // Emit tool_use stop
          this.emitJson({
            type: 'stream_event',
            event: { type: 'content_block_stop', index: contentBlockIndex },
          });
          contentBlockIndex++;

          // Build function response for the API
          toolResponseParts.push({
            functionResponse: {
              name: call.name,
              response: result.response,
            },
          });
        }

        // Send tool results back to the API
        this.conversationHistory.push({
          role: 'user',
          parts: toolResponseParts,
        });

        // Start a new text content block for the next response
        this.emitJson({
          type: 'stream_event',
          event: {
            type: 'content_block_start',
            index: contentBlockIndex,
            content_block: { type: 'text', text: '' },
          },
        });
      }

      // Emit content_block_stop for the final text block
      this.emitJson({
        type: 'stream_event',
        event: { type: 'content_block_stop', index: contentBlockIndex },
      });

      // Emit message_delta with stop_reason and final usage
      this.emitJson({
        type: 'stream_event',
        event: {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: {
            input_tokens: totalPromptTokens,
            output_tokens: totalCandidateTokens,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        },
      });

      // Emit result message (ProcessManager uses this for cost tracking)
      this.emitJson({
        type: 'result',
        result: '',
        usage: {
          input_tokens: totalPromptTokens,
          output_tokens: totalCandidateTokens,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
        total_cost_usd: 0,
      });

      // Emit the complete assistant message (so it gets saved to DB)
      if (fullText) {
        this.emitJson({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: fullText,
          },
        });
      }
    } catch (err) {
      if (abortController.signal.aborted) {
        // User interrupted — emit stop
        this.emitJson({
          type: 'stream_event',
          event: { type: 'content_block_stop', index: contentBlockIndex },
        });
        this.emitJson({
          type: 'stream_event',
          event: {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn' },
          },
        });
      } else {
        // Real error
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[GeminiApi] API error: ${errMsg}`);
        this.emitJson({
          type: 'system',
          subtype: 'error',
          message: errMsg,
        });
      }
    } finally {
      this.currentAbortController = null;
    }
  }

  /**
   * Parse an SSE stream from the Code Assist API.
   * Returns collected text parts, function calls, and usage metadata.
   */
  private async parseSSEStream(
    body: ReadableStream<Uint8Array>,
    abortController: AbortController,
    contentBlockIndex: number
  ): Promise<{
    textParts: string[];
    functionCalls: FunctionCall[];
    modelParts: GeminiPart[];
    finishReason: string;
    promptTokens: number;
    candidateTokens: number;
  }> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let promptTokens = 0;
    let candidateTokens = 0;
    let finishReason = 'STOP';
    const textParts: string[] = [];
    const functionCalls: FunctionCall[] = [];
    const modelParts: GeminiPart[] = [];
    let textBlockStarted = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (abortController.signal.aborted) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;

        const jsonStr = line.slice(6).trim();
        if (!jsonStr) continue;

        let chunk: CodeAssistSSEChunk;
        try {
          chunk = JSON.parse(jsonStr);
        } catch {
          continue;
        }

        const response = chunk.response;
        if (!response) continue;

        const candidate = response.candidates?.[0];
        if (candidate?.finishReason) {
          finishReason = candidate.finishReason;
        }

        const parts = candidate?.content?.parts;
        if (parts) {
          for (const part of parts) {
            // Skip thought parts
            if (part.thought) continue;

            // Text part
            if (part.text) {
              // Start text content block on first text part
              if (!textBlockStarted) {
                this.emitJson({
                  type: 'stream_event',
                  event: {
                    type: 'content_block_start',
                    index: contentBlockIndex,
                    content_block: { type: 'text', text: '' },
                  },
                });
                textBlockStarted = true;
              }

              textParts.push(part.text);
              modelParts.push({ text: part.text });

              // Emit content_block_delta for streaming text
              this.emitJson({
                type: 'stream_event',
                event: {
                  type: 'content_block_delta',
                  index: contentBlockIndex,
                  delta: { type: 'text_delta', text: part.text },
                },
              });
            }

            // Function call part
            if (part.functionCall) {
              functionCalls.push({
                name: part.functionCall.name,
                args: part.functionCall.args || {},
              });
              modelParts.push({ functionCall: part.functionCall });
            }
          }
        }

        // Capture usage
        if (response.usageMetadata) {
          promptTokens = response.usageMetadata.promptTokenCount || 0;
          candidateTokens = response.usageMetadata.candidatesTokenCount || 0;
        }
      }
    }

    return { textParts, functionCalls, modelParts, finishReason, promptTokens, candidateTokens };
  }

  /** Emit a JSON line to stdout */
  private emitJson(obj: Record<string, unknown>): void {
    this.fakeProcess.pushStdout(JSON.stringify(obj));
  }
}
