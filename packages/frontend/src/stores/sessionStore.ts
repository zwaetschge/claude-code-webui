import { create } from 'zustand';
import type {
  Session,
  Message,
  SessionStatus,
  UsageData,
  ToolExecution,
  PermissionDenial,
  PendingPermission,
  PendingQuestion,
  SessionQueueData,
  SubagentRun,
  SubagentRunStatus,
} from '@plum-code-webui/shared';

// --- Streaming content buffer ---
// Accumulates CLI deltas and flushes to Zustand at a bounded cadence. Rendering
// the whole streaming markdown tree on every browser frame is expensive enough
// to drag the chat below 60fps on long answers, so text updates are capped while
// the browser still gets free animation frames between React commits.
const STREAMING_FLUSH_INTERVAL_MS = 50;
// Most recent generated images kept per session (base64 payloads are heavy).
const MAX_GENERATED_IMAGES_PER_SESSION = 24;
const streamingBuffer: Record<string, string> = {};
let rafId: number | null = null;
let flushTimerId: number | null = null;
let lastStreamingFlushAt = 0;

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function scheduleStreamingFlush() {
  if (rafId !== null || flushTimerId !== null) return;

  const elapsed = nowMs() - lastStreamingFlushAt;
  const delay = Math.max(0, STREAMING_FLUSH_INTERVAL_MS - elapsed);

  flushTimerId = window.setTimeout(() => {
    flushTimerId = null;
    rafId = requestAnimationFrame(flushStreamingBuffer);
  }, delay);
}

function flushStreamingBuffer() {
  rafId = null;
  lastStreamingFlushAt = nowMs();
  const entries = Object.entries(streamingBuffer);
  if (entries.length === 0) return;

  // Drain the buffer
  const toFlush: Record<string, string> = {};
  for (const [sid, chunk] of entries) {
    toFlush[sid] = chunk;
    delete streamingBuffer[sid];
  }

  // Single Zustand update for all sessions
  useSessionStore.setState((state) => {
    const newContent = { ...state.streamingContent };
    const newTimestamp = { ...state.lastMessageTimestamp };
    const now = Date.now();
    for (const [sid, chunk] of Object.entries(toFlush)) {
      newContent[sid] = (newContent[sid] || '') + chunk;
      newTimestamp[sid] = now;
    }
    return { streamingContent: newContent, lastMessageTimestamp: newTimestamp };
  });
}

function bufferStreamingContent(sessionId: string, content: string) {
  streamingBuffer[sessionId] = (streamingBuffer[sessionId] || '') + content;
  scheduleStreamingFlush();
}

function dropPendingStreamingChunks(sessionId: string) {
  delete streamingBuffer[sessionId];
}

function sortAgentRuns(runs: SubagentRun[]): SubagentRun[] {
  return [...runs].sort((a, b) => {
    if (a.status === 'started' && b.status !== 'started') return -1;
    if (a.status !== 'started' && b.status === 'started') return 1;
    return (b.completedAt ?? b.startedAt) - (a.completedAt ?? a.startedAt);
  });
}

function mergeAgentRuns(existing: SubagentRun[], incoming: SubagentRun[]): SubagentRun[] {
  const byId = new Map<string, SubagentRun>();
  for (const run of existing) {
    byId.set(run.id, run);
  }
  for (const run of incoming) {
    const prior = byId.get(run.id);
    byId.set(run.id, {
      ...prior,
      ...run,
      startedAt: prior?.startedAt ?? run.startedAt,
      description: run.description || prior?.description,
      result: run.result || prior?.result,
      error: run.error || prior?.error,
      toolId: run.toolId || prior?.toolId,
      externalAgentId: run.externalAgentId || prior?.externalAgentId,
    });
  }
  const sorted = sortAgentRuns(Array.from(byId.values()));
  const active = sorted.filter((run) => run.status === 'started');
  const recent = sorted.filter((run) => run.status !== 'started').slice(0, 30);
  return [...active, ...recent];
}

function getActiveAgentFromRuns(runs: SubagentRun[]): AgentState | null {
  const active = sortAgentRuns(runs).find((run) => run.status === 'started');
  return active
    ? {
        agentType: active.agentType,
        description: active.description,
        status: active.status,
        startedAt: active.startedAt,
      }
    : null;
}

// Activity state for showing what Claude is doing
export interface ActivityState {
  type: 'idle' | 'thinking' | 'tool';
  toolName?: string;
  toolStatus?: 'started' | 'completed' | 'error';
  message?: string;
  startedAt?: number;
  messageStartedAt?: number;
}

// Active agent state
export interface AgentState {
  agentType: string;
  description?: string;
  status: SubagentRunStatus;
  startedAt?: number;
}

export type { SubagentRun };

export interface AgentEvent {
  agentId?: string;
  agentType: string;
  description?: string;
  status: SubagentRunStatus;
  startedAt?: number;
  completedAt?: number;
  result?: string;
  error?: string;
  toolId?: string;
  externalAgentId?: string;
  timestamp?: number;
}

// Todo item from Claude's TodoWrite tool
export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm?: string;
}

// Generated image
export interface GeneratedImage {
  imageBase64?: string;
  mimeType: string;
  prompt: string;
  generator: 'opencode' | 'other';
  timestamp: number;
}

// Open file in code editor
export interface OpenFile {
  path: string;
  content: string;
  isDirty: boolean;
  originalContent: string;
}

// Permission request (legacy flow with denials)
export interface PermissionRequest {
  denials: PermissionDenial[];
  originalMessage: string;
}

interface SessionState {
  sessions: Session[];
  activeSessionId: string | null;
  messages: Record<string, Message[]>;
  streamingContent: Record<string, string>;
  thinking: Record<string, boolean>;
  activity: Record<string, ActivityState>;
  activeAgent: Record<string, AgentState | null>;
  agentRuns: Record<string, SubagentRun[]>;
  todos: Record<string, TodoItem[]>;
  usage: Record<string, UsageData>;
  generatedImages: Record<string, GeneratedImage[]>;
  toolExecutions: Record<string, ToolExecution[]>;
  queueState: Record<string, SessionQueueData | null>;

  // Permission request state (legacy)
  permissionRequests: Record<string, PermissionRequest | null>;

  // Pending permissions state (hooks-based)
  pendingPermissions: Record<string, PendingPermission | null>;

  // Pending OpenCode questions
  pendingQuestions: Record<string, PendingQuestion | null>;

  // File Tree state
  fileTreeOpen: Record<string, boolean>;
  selectedFile: Record<string, string | null>;

  // Code Editor state
  openFiles: Record<string, OpenFile[]>;
  activeFileTab: Record<string, string | null>;

  // Track last received message timestamp per session for reconnection
  lastMessageTimestamp: Record<string, number>;

  setSessions: (sessions: Session[]) => void;
  addSession: (session: Session) => void;
  updateSession: (id: string, updates: Partial<Session>) => void;
  removeSession: (id: string) => void;
  setActiveSession: (id: string | null) => void;

  setMessages: (sessionId: string, messages: Message[]) => void;
  addMessage: (sessionId: string, message: Message) => void;
  addMessageIfNotExists: (sessionId: string, message: Message) => void;

  appendStreamingContent: (sessionId: string, content: string) => void;
  clearStreamingContent: (sessionId: string) => void;

  updateSessionStatus: (sessionId: string, status: SessionStatus) => void;
  setThinking: (sessionId: string, isThinking: boolean) => void;
  setActivity: (sessionId: string, activity: ActivityState) => void;
  setActiveAgent: (sessionId: string, agent: AgentState | null) => void;
  recordAgentEvent: (sessionId: string, event: AgentEvent) => void;
  setAgentRuns: (sessionId: string, runs: SubagentRun[]) => void;
  setTodos: (sessionId: string, todos: TodoItem[]) => void;
  setUsage: (sessionId: string, usage: UsageData) => void;
  addGeneratedImage: (sessionId: string, image: Omit<GeneratedImage, 'timestamp'>) => void;
  addToolExecution: (sessionId: string, execution: ToolExecution) => void;
  updateToolExecution: (sessionId: string, toolId: string, update: Partial<ToolExecution>) => void;
  clearToolExecutions: (sessionId: string) => void;
  setQueueState: (sessionId: string, queue: SessionQueueData | null) => void;

  // Permission request actions (legacy)
  setPermissionRequest: (sessionId: string, request: PermissionRequest | null) => void;
  clearPermissionRequest: (sessionId: string) => void;

  // Pending permission actions (hooks-based)
  setPendingPermission: (sessionId: string, permission: PendingPermission | null) => void;

  setPendingQuestion: (sessionId: string, question: PendingQuestion | null) => void;

  // File Tree actions
  setFileTreeOpen: (sessionId: string, open: boolean) => void;
  setSelectedFile: (sessionId: string, path: string | null) => void;

  // Code Editor actions
  openFile: (sessionId: string, path: string, content: string) => void;
  closeFile: (sessionId: string, path: string) => void;
  updateFileContent: (sessionId: string, path: string, content: string) => void;
  markFileSaved: (sessionId: string, path: string) => void;
  setActiveTab: (sessionId: string, path: string) => void;

  // Timestamp tracking for reconnection
  updateLastMessageTimestamp: (sessionId: string, timestamp: number) => void;
  getLastMessageTimestamp: (sessionId: string) => number | undefined;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  messages: {},
  streamingContent: {},
  thinking: {},
  activity: {},
  activeAgent: {},
  agentRuns: {},
  todos: {},
  usage: {},
  generatedImages: {},
  toolExecutions: {},
  queueState: {},
  permissionRequests: {},
  pendingPermissions: {},
  pendingQuestions: {},
  fileTreeOpen: {},
  selectedFile: {},
  openFiles: {},
  activeFileTab: {},
  lastMessageTimestamp: {},

  setSessions: (sessions) =>
    set((state) => {
      const agentRuns = { ...state.agentRuns };
      const activeAgent = { ...state.activeAgent };
      for (const session of sessions) {
        if (!session.runtime?.subagents?.length) continue;
        const merged = mergeAgentRuns(agentRuns[session.id] || [], session.runtime.subagents);
        agentRuns[session.id] = merged;
        activeAgent[session.id] = getActiveAgentFromRuns(merged);
      }
      return { sessions, agentRuns, activeAgent };
    }),

  addSession: (session) =>
    set((state) => ({
      sessions: [session, ...state.sessions],
    })),

  updateSession: (id, updates) =>
    set((state) => {
      const nextState: Partial<SessionState> = {
        sessions: state.sessions.map((s) => (s.id === id ? { ...s, ...updates } : s)),
      };
      if (updates.runtime?.subagents?.length) {
        const merged = mergeAgentRuns(state.agentRuns[id] || [], updates.runtime.subagents);
        nextState.agentRuns = { ...state.agentRuns, [id]: merged };
        nextState.activeAgent = {
          ...state.activeAgent,
          [id]: getActiveAgentFromRuns(merged),
        };
      }
      return nextState;
    }),

  removeSession: (id) => {
    // Drop buffered (not yet flushed) streaming chunks so the flush cannot
    // recreate the deleted session's streamingContent entry.
    dropPendingStreamingChunks(id);
    set((state) => {
      // Drop every per-session slice: messages, tool logs, base64 images and
      // open editor files of a deleted session otherwise stay resident until
      // a hard reload.
      const omit = <T>(record: Record<string, T>): Record<string, T> => {
        if (!(id in record)) return record;
        const { [id]: _removed, ...rest } = record;
        return rest;
      };
      return {
        sessions: state.sessions.filter((s) => s.id !== id),
        activeSessionId: state.activeSessionId === id ? null : state.activeSessionId,
        messages: omit(state.messages),
        toolExecutions: omit(state.toolExecutions),
        streamingContent: omit(state.streamingContent),
        generatedImages: omit(state.generatedImages),
        agentRuns: omit(state.agentRuns),
        usage: omit(state.usage),
        todos: omit(state.todos),
        activity: omit(state.activity),
        queueState: omit(state.queueState),
        thinking: omit(state.thinking),
        activeAgent: omit(state.activeAgent),
        permissionRequests: omit(state.permissionRequests),
        pendingPermissions: omit(state.pendingPermissions),
        pendingQuestions: omit(state.pendingQuestions),
        fileTreeOpen: omit(state.fileTreeOpen),
        selectedFile: omit(state.selectedFile),
        openFiles: omit(state.openFiles),
        activeFileTab: omit(state.activeFileTab),
        lastMessageTimestamp: omit(state.lastMessageTimestamp),
      };
    });
  },

  setActiveSession: (id) => set({ activeSessionId: id }),

  setMessages: (sessionId, messages) =>
    set((state) => ({
      messages: { ...state.messages, [sessionId]: messages },
    })),

  addMessage: (sessionId, message) =>
    set((state) => {
      const timestamp = Date.now();
      return {
        messages: {
          ...state.messages,
          [sessionId]: [...(state.messages[sessionId] || []), message],
        },
        lastMessageTimestamp: {
          ...state.lastMessageTimestamp,
          [sessionId]: timestamp,
        },
      };
    }),

  // Add message only if it doesn't already exist (for deduplication during reconnection)
  addMessageIfNotExists: (sessionId, message) =>
    set((state) => {
      const existingMessages = state.messages[sessionId] || [];
      // Check if message with same ID already exists
      if (existingMessages.some((m) => m.id === message.id)) {
        return state; // Don't add duplicate
      }
      const timestamp = Date.now();
      return {
        messages: {
          ...state.messages,
          [sessionId]: [...existingMessages, message],
        },
        lastMessageTimestamp: {
          ...state.lastMessageTimestamp,
          [sessionId]: timestamp,
        },
      };
    }),

  appendStreamingContent: (sessionId, content) => {
    // Buffer content and flush via RAF at no more than 20fps instead of per-character updates
    bufferStreamingContent(sessionId, content);
  },

  clearStreamingContent: (sessionId) => {
    dropPendingStreamingChunks(sessionId);
    set((state) => ({
      streamingContent: {
        ...state.streamingContent,
        [sessionId]: '',
      },
    }));
  },

  updateSessionStatus: (sessionId, status) =>
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === sessionId ? { ...s, status } : s)),
    })),

  setThinking: (sessionId, isThinking) =>
    set((state) => ({
      thinking: { ...state.thinking, [sessionId]: isThinking },
    })),

  setActivity: (sessionId, activity) =>
    set((state) => ({
      activity: { ...state.activity, [sessionId]: activity },
    })),

  setActiveAgent: (sessionId, agent) =>
    set((state) => ({
      activeAgent: { ...state.activeAgent, [sessionId]: agent },
    })),

  recordAgentEvent: (sessionId, event) =>
    set((state) => {
      const now = event.timestamp ?? Date.now();
      const existing = state.agentRuns[sessionId] || [];
      const matching =
        event.agentId || event.toolId || event.externalAgentId
          ? existing.find(
              (run) =>
                run.id === event.agentId ||
                (!!event.toolId && run.toolId === event.toolId) ||
                (!!event.externalAgentId && run.externalAgentId === event.externalAgentId)
            )
          : event.status === 'started'
            ? undefined
            : [...existing]
                .reverse()
                .find(
                  (run) =>
                    run.status === 'started' &&
                    (!event.agentType || run.agentType === event.agentType)
                );
      const id =
        matching?.id ||
        event.agentId ||
        event.toolId ||
        event.externalAgentId ||
        `${event.agentType}-${now}-${Math.random().toString(36).slice(2, 8)}`;
      const run: SubagentRun = {
        ...matching,
        id,
        agentType: event.agentType || matching?.agentType || 'subagent',
        description: event.description || matching?.description,
        status: event.status,
        startedAt: matching?.startedAt ?? event.startedAt ?? now,
        completedAt:
          event.status === 'started'
            ? matching?.completedAt
            : (event.completedAt ?? matching?.completedAt ?? now),
        result: event.result || matching?.result,
        error: event.error || matching?.error,
        toolId: event.toolId || matching?.toolId,
        externalAgentId: event.externalAgentId || matching?.externalAgentId,
        provider: matching?.provider,
      };
      const merged = mergeAgentRuns(
        existing.filter((item) => item.id !== run.id),
        [run]
      );
      return {
        agentRuns: { ...state.agentRuns, [sessionId]: merged },
        activeAgent: {
          ...state.activeAgent,
          [sessionId]: getActiveAgentFromRuns(merged),
        },
      };
    }),

  setAgentRuns: (sessionId, runs) =>
    set((state) => {
      const merged = mergeAgentRuns(state.agentRuns[sessionId] || [], runs);
      return {
        agentRuns: { ...state.agentRuns, [sessionId]: merged },
        activeAgent: {
          ...state.activeAgent,
          [sessionId]: getActiveAgentFromRuns(merged),
        },
      };
    }),

  setTodos: (sessionId, todos) =>
    set((state) => ({
      todos: { ...state.todos, [sessionId]: todos },
    })),

  setUsage: (sessionId, usage) =>
    set((state) => ({
      usage: { ...state.usage, [sessionId]: usage },
    })),

  addGeneratedImage: (sessionId, image) =>
    set((state) => ({
      generatedImages: {
        ...state.generatedImages,
        // Cap retained images per session: each entry can hold a full base64
        // payload, so an unbounded list dominates heap on long sessions
        // (mirrors the agentRuns cap in mergeAgentRuns).
        [sessionId]: [
          ...(state.generatedImages[sessionId] || []),
          { ...image, timestamp: Date.now() },
        ].slice(-MAX_GENERATED_IMAGES_PER_SESSION),
      },
    })),

  addToolExecution: (sessionId, execution) =>
    set((state) => {
      const existing = state.toolExecutions[sessionId] || [];
      if (existing.some((t) => t.toolId === execution.toolId)) {
        return state;
      }
      return {
        toolExecutions: {
          ...state.toolExecutions,
          [sessionId]: [...existing, execution],
        },
      };
    }),

  updateToolExecution: (sessionId, toolId, update) =>
    set((state) => {
      const existing = state.toolExecutions[sessionId];
      if (!existing) return state;
      const index = existing.findIndex((exec) => exec.toolId === toolId);
      // Unknown tool: return the same state object so nothing downstream
      // (timeline memo, turn segments, markers) recomputes for a no-op.
      if (index === -1) return state;
      const next = existing.slice();
      next[index] = { ...next[index]!, ...update };
      return {
        toolExecutions: {
          ...state.toolExecutions,
          [sessionId]: next,
        },
      };
    }),

  clearToolExecutions: (sessionId) =>
    set((state) => ({
      toolExecutions: {
        ...state.toolExecutions,
        [sessionId]: [],
      },
    })),

  setQueueState: (sessionId, queue) =>
    set((state) => ({
      queueState: {
        ...state.queueState,
        [sessionId]: queue,
      },
    })),

  // Permission request actions (legacy)
  setPermissionRequest: (sessionId, request) =>
    set((state) => ({
      permissionRequests: {
        ...state.permissionRequests,
        [sessionId]: request,
      },
    })),

  clearPermissionRequest: (sessionId) =>
    set((state) => ({
      permissionRequests: {
        ...state.permissionRequests,
        [sessionId]: null,
      },
    })),

  // Pending permission actions (hooks-based)
  setPendingPermission: (sessionId, permission) =>
    set((state) => ({
      pendingPermissions: {
        ...state.pendingPermissions,
        [sessionId]: permission,
      },
    })),

  setPendingQuestion: (sessionId, question) =>
    set((state) => ({
      pendingQuestions: {
        ...state.pendingQuestions,
        [sessionId]: question,
      },
    })),

  // File Tree actions
  setFileTreeOpen: (sessionId, open) =>
    set((state) => ({
      fileTreeOpen: { ...state.fileTreeOpen, [sessionId]: open },
    })),

  setSelectedFile: (sessionId, path) =>
    set((state) => ({
      selectedFile: { ...state.selectedFile, [sessionId]: path },
    })),

  // Code Editor actions
  openFile: (sessionId, path, content) =>
    set((state) => {
      const files = state.openFiles[sessionId] || [];
      const existing = files.find((f) => f.path === path);
      if (existing) {
        // File already open, just switch to it
        return {
          activeFileTab: { ...state.activeFileTab, [sessionId]: path },
        };
      }
      return {
        openFiles: {
          ...state.openFiles,
          [sessionId]: [...files, { path, content, isDirty: false, originalContent: content }],
        },
        activeFileTab: { ...state.activeFileTab, [sessionId]: path },
      };
    }),

  closeFile: (sessionId, path) =>
    set((state) => {
      const files = state.openFiles[sessionId] || [];
      const newFiles = files.filter((f) => f.path !== path);
      const currentTab = state.activeFileTab[sessionId] ?? null;
      let newActiveTab: string | null = currentTab;

      // If closing the active tab, switch to another
      if (currentTab === path) {
        const closedIndex = files.findIndex((f) => f.path === path);
        if (newFiles.length > 0) {
          const newIndex = Math.min(closedIndex, newFiles.length - 1);
          newActiveTab = newFiles[newIndex]?.path ?? null;
        } else {
          newActiveTab = null;
        }
      }

      const newActiveFileTab: Record<string, string | null> = { ...state.activeFileTab };
      newActiveFileTab[sessionId] = newActiveTab;

      return {
        openFiles: { ...state.openFiles, [sessionId]: newFiles },
        activeFileTab: newActiveFileTab,
      };
    }),

  updateFileContent: (sessionId, path, content) =>
    set((state) => {
      const files = state.openFiles[sessionId] || [];
      return {
        openFiles: {
          ...state.openFiles,
          [sessionId]: files.map((f) =>
            f.path === path ? { ...f, content, isDirty: content !== f.originalContent } : f
          ),
        },
      };
    }),

  markFileSaved: (sessionId, path) =>
    set((state) => {
      const files = state.openFiles[sessionId] || [];
      return {
        openFiles: {
          ...state.openFiles,
          [sessionId]: files.map((f) =>
            f.path === path ? { ...f, isDirty: false, originalContent: f.content } : f
          ),
        },
      };
    }),

  setActiveTab: (sessionId, path) =>
    set((state) => ({
      activeFileTab: { ...state.activeFileTab, [sessionId]: path },
    })),

  // Timestamp tracking for reconnection
  updateLastMessageTimestamp: (sessionId, timestamp) =>
    set((state) => ({
      lastMessageTimestamp: {
        ...state.lastMessageTimestamp,
        [sessionId]: timestamp,
      },
    })),

  getLastMessageTimestamp: (sessionId) => get().lastMessageTimestamp[sessionId],
}));
