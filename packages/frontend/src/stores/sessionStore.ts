import { create } from 'zustand';
import type { Session, Message, SessionStatus, UsageData, ToolExecution } from '@claude-code-webui/shared';

// Activity state for showing what Claude is doing
export interface ActivityState {
  type: 'idle' | 'thinking' | 'tool';
  toolName?: string;
  toolStatus?: 'started' | 'completed' | 'error';
}

// Active agent state
export interface AgentState {
  agentType: string;
  description?: string;
  status: 'started' | 'completed' | 'error';
}

// Todo item from Claude's TodoWrite tool
export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm?: string;
}

// Generated image from Gemini
export interface GeneratedImage {
  imageBase64?: string;
  mimeType: string;
  prompt: string;
  generator: 'gemini' | 'other';
  timestamp: number;
}

// Open file in code editor
export interface OpenFile {
  path: string;
  content: string;
  isDirty: boolean;
  originalContent: string;
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

  // File Tree state
  fileTreeOpen: Record<string, boolean>;
  selectedFile: Record<string, string | null>;

  // Code Editor state
  openFiles: Record<string, OpenFile[]>;
  activeFileTab: Record<string, string | null>;

  setSessions: (sessions: Session[]) => void;
  addSession: (session: Session) => void;
  updateSession: (id: string, updates: Partial<Session>) => void;
  removeSession: (id: string) => void;
  setActiveSession: (id: string | null) => void;

  setMessages: (sessionId: string, messages: Message[]) => void;
  addMessage: (sessionId: string, message: Message) => void;

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

  // File Tree actions
  setFileTreeOpen: (sessionId: string, open: boolean) => void;
  setSelectedFile: (sessionId: string, path: string | null) => void;

  // Code Editor actions
  openFile: (sessionId: string, path: string, content: string) => void;
  closeFile: (sessionId: string, path: string) => void;
  updateFileContent: (sessionId: string, path: string, content: string) => void;
  markFileSaved: (sessionId: string, path: string) => void;
  setActiveTab: (sessionId: string, path: string) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
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
  fileTreeOpen: {},
  selectedFile: {},
  openFiles: {},
  activeFileTab: {},

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
    set((state) => ({
      messages: {
        ...state.messages,
        [sessionId]: [...(state.messages[sessionId] || []), message],
      },
    })),

  appendStreamingContent: (sessionId, content) =>
    set((state) => ({
      streamingContent: {
        ...state.streamingContent,
        [sessionId]: (state.streamingContent[sessionId] || '') + content,
      },
    })),

  clearStreamingContent: (sessionId) =>
    set((state) => ({
      streamingContent: {
        ...state.streamingContent,
        [sessionId]: '',
      },
    })),

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
    set((state) => ({
      toolExecutions: {
        ...state.toolExecutions,
        [sessionId]: [...(state.toolExecutions[sessionId] || []), execution],
      },
    })),

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
          [sessionId]: [
            ...files,
            { path, content, isDirty: false, originalContent: content },
          ],
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
            f.path === path
              ? { ...f, content, isDirty: content !== f.originalContent }
              : f
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
            f.path === path
              ? { ...f, isDirty: false, originalContent: f.content }
              : f
          ),
        },
      };
    }),

  setActiveTab: (sessionId, path) =>
    set((state) => ({
      activeFileTab: { ...state.activeFileTab, [sessionId]: path },
    })),
}));
