import { create } from 'zustand';
import type {
  RalphRunState,
  RalphProgress,
  RalphPlan,
  RalphIteration,
  RalphStatus,
} from '@claude-code-webui/shared';

interface RalphStore {
  // Run states keyed by runId
  runs: Record<string, RalphRunState>;

  // Map sessionId -> runId for quick lookup
  activeRunBySession: Record<string, string>;

  // Loading state
  loaded: boolean;

  // Actions
  setRunState: (run: RalphRunState) => void;
  updateProgress: (runId: string, progress: RalphProgress) => void;
  setPlan: (runId: string, plan: RalphPlan) => void;
  addIteration: (runId: string, iteration: RalphIteration) => void;
  setStatus: (runId: string, status: RalphStatus) => void;
  setError: (runId: string, error: string) => void;
  removeRun: (runId: string) => void;
  loadRuns: () => Promise<void>;

  // Getters
  getRun: (runId: string) => RalphRunState | null;
  getRunBySession: (sessionId: string) => RalphRunState | null;
  isRalphActive: (sessionId: string) => boolean;
}

export const useRalphStore = create<RalphStore>((set, get) => ({
  runs: {},
  activeRunBySession: {},
  loaded: false,

  setRunState: (run) => {
    set((s) => ({
      runs: { ...s.runs, [run.id]: run },
      activeRunBySession: { ...s.activeRunBySession, [run.sessionId]: run.id },
    }));
  },

  updateProgress: (runId, progress) => {
    set((s) => {
      const run = s.runs[runId];
      if (!run) return s;
      return {
        runs: { ...s.runs, [runId]: { ...run, progress } },
      };
    });
  },

  setPlan: (runId, plan) => {
    set((s) => {
      const run = s.runs[runId];
      if (!run) return s;
      return {
        runs: { ...s.runs, [runId]: { ...run, plan } },
      };
    });
  },

  addIteration: (runId, iteration) => {
    set((s) => {
      const run = s.runs[runId];
      if (!run) return s;
      return {
        runs: {
          ...s.runs,
          [runId]: {
            ...run,
            iterations: [...run.iterations, iteration],
          },
        },
      };
    });
  },

  setStatus: (runId, status) => {
    set((s) => {
      const run = s.runs[runId];
      if (!run) return s;
      return {
        runs: { ...s.runs, [runId]: { ...run, status } },
      };
    });
  },

  setError: (runId, error) => {
    set((s) => {
      const run = s.runs[runId];
      if (!run) return s;
      return {
        runs: { ...s.runs, [runId]: { ...run, lastError: error } },
      };
    });
  },

  removeRun: (runId) => {
    set((s) => {
      const { [runId]: removed, ...restRuns } = s.runs;
      if (!removed) return s;
      const { [removed.sessionId]: _sid, ...restSessions } = s.activeRunBySession;
      return {
        runs: restRuns,
        activeRunBySession: restSessions,
      };
    });
  },

  loadRuns: async () => {
    if (get().loaded) return;
    try {
      const res = await fetch('/api/ralph/runs');
      if (!res.ok) return;
      const runs: RalphRunState[] = await res.json();
      const runsMap: Record<string, RalphRunState> = {};
      const sessionMap: Record<string, string> = {};
      for (const run of runs) {
        runsMap[run.id] = run;
        sessionMap[run.sessionId] = run.id;
      }
      set({ runs: runsMap, activeRunBySession: sessionMap, loaded: true });
    } catch (err) {
      console.error('[RALPH] Failed to load runs:', err);
    }
  },

  getRun: (runId) => {
    return get().runs[runId] || null;
  },

  getRunBySession: (sessionId) => {
    const runId = get().activeRunBySession[sessionId];
    if (!runId) return null;
    return get().runs[runId] || null;
  },

  isRalphActive: (sessionId) => {
    const run = get().getRunBySession(sessionId);
    if (!run) return false;
    return ['planning', 'executing'].includes(run.status);
  },
}));
