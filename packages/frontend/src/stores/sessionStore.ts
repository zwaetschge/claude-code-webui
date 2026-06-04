import { create } from 'zustand';
import type {
  Session,
  Message,
  SessionStatus,
  UsageData,
  ToolExecution,
  PermissionDenial,
  PendingPermission,
  SessionQueueData,
} from '@claude-code-webui/shared';

// --- Streaming content buffer ---
// Accumulates CLI deltas and flushes to Zustand at a bounded cadence. Rendering
// the whole streaming markdown tree on every browser frame is expensive enough
// to drag the chat below 60fps on long answers, so text updates are capped while
// the browser still gets free animation frames between React commits.
const STREAMING_FLUSH_INTERVAL_MS = 50;
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
  status: 'started' | 'completed' | 'error';
  startedAt?: number;
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
  todos: Record<string, TodoItem[]>;
  usage: Record<string, UsageData>;
  generatedImages: Record<string, GeneratedImage[]>;
  toolExecutions: Record<string, ToolExecution[]>;
  queueState: Record<string, SessionQueueData | null>;

  // Permission request state (legacy)
  permissionRequests: Record<string, PermissionRequest | null>;

  // Pending permissions state (hooks-based)
  pendingPermissions: Record<string, PendingPermission | null>;

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
  todos: {},
  usage: {},
  generatedImages: {},
  toolExecutions: {},
  queueState: {},
  permissionRequests: {},
  pendingPermissions: {},
  fileTreeOpen: {},
  selectedFile: {},
  openFiles: {},
  activeFileTab: {},
  lastMessageTimestamp: {},

  setSessions: (sessions) => set({ sessions }),

  addSession: (session) =>
    set((state) => ({
      sessions: [session, ...state.sessions],
    })),

  updateSession: (id, updates) =>
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === id ? { ...s, ...updates } : s)),
    })),

  removeSession: (id) =>
    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== id),
      activeSessionId: state.activeSessionId === id ? null : state.activeSessionId,
    })),

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
    // Buffer content and flush via RAF at ~30fps instead of per-character updates
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
        [sessionId]: [
          ...(state.generatedImages[sessionId] || []),
          { ...image, timestamp: Date.now() },
        ],
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
    set((state) => ({
      toolExecutions: {
        ...state.toolExecutions,
        [sessionId]: (state.toolExecutions[sessionId] || []).map((exec) =>
          exec.toolId === toolId ? { ...exec, ...update } : exec
        ),
      },
    })),

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
