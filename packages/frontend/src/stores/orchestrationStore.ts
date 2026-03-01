import { create } from 'zustand';
import type {
  OrchestrationConfig,
  OrchestrationState,
  OrchestrationTask,
  OrchestrationPhase,
  WorkerState,
  TaskResult,
  CLIProvider,
} from '@claude-code-webui/shared';

// Worker output buffer entry
export interface WorkerOutputEntry {
  workerId: string;
  provider: CLIProvider;
  content: string;
  timestamp: number;
  isError?: boolean;
}

// Default orchestration config
const defaultConfig: OrchestrationConfig = {
  master: 'claude',
  workers: [
    { provider: 'codex', maxConcurrent: 1, specialization: 'reasoning', enabled: true },
    { provider: 'gemini', maxConcurrent: 1, specialization: 'frontend', enabled: true },
    { provider: 'glm', maxConcurrent: 1, specialization: 'quick', enabled: false },
  ],
  taskRouting: 'auto',
  parallelExecution: true,
  maxParallelTasks: 3,
};

interface OrchestrationStore {
  // State per session
  states: Record<string, OrchestrationState>;
  configs: Record<string, OrchestrationConfig>;

  // Worker outputs per session (workerId -> outputs)
  workerOutputs: Record<string, WorkerOutputEntry[]>;

  // Task results per session
  taskResults: Record<string, Record<string, TaskResult>>;

  // UI state
  panelOpen: Record<string, boolean>;
  selectedWorkerId: Record<string, string | null>;

  // Actions
  setOrchestrationState: (sessionId: string, state: OrchestrationState) => void;
  setOrchestrationConfig: (sessionId: string, config: OrchestrationConfig) => void;

  updateWorkerStatus: (sessionId: string, worker: WorkerState) => void;
  updatePhase: (sessionId: string, phase: OrchestrationPhase, message?: string) => void;

  addTask: (sessionId: string, task: OrchestrationTask) => void;
  updateTask: (sessionId: string, task: OrchestrationTask) => void;
  addTaskResult: (sessionId: string, taskId: string, result: TaskResult) => void;

  addWorkerOutput: (
    sessionId: string,
    workerId: string,
    provider: CLIProvider,
    content: string,
    isError?: boolean
  ) => void;
  clearWorkerOutputs: (sessionId: string, workerId?: string) => void;

  // UI actions
  togglePanel: (sessionId: string) => void;
  setPanelOpen: (sessionId: string, open: boolean) => void;
  setSelectedWorker: (sessionId: string, workerId: string | null) => void;

  // Get helpers
  getState: (sessionId: string) => OrchestrationState | null;
  getConfig: (sessionId: string) => OrchestrationConfig;
  getWorkers: (sessionId: string) => WorkerState[];
  getTasks: (sessionId: string) => OrchestrationTask[];
  getWorkerOutputs: (sessionId: string, workerId?: string) => WorkerOutputEntry[];
  isOrchestrating: (sessionId: string) => boolean;

  // Cleanup
  clearSession: (sessionId: string) => void;
}

export const useOrchestrationStore = create<OrchestrationStore>((set, get) => ({
  states: {},
  configs: {},
  workerOutputs: {},
  taskResults: {},
  panelOpen: {},
  selectedWorkerId: {},

  setOrchestrationState: (sessionId, state) => {
    set((s) => ({
      states: { ...s.states, [sessionId]: state },
      configs: { ...s.configs, [sessionId]: state.config },
    }));
  },

  setOrchestrationConfig: (sessionId, config) => {
    set((s) => ({
      configs: { ...s.configs, [sessionId]: config },
      states: s.states[sessionId]
        ? { ...s.states, [sessionId]: { ...s.states[sessionId], config } }
        : s.states,
    }));
  },

  updateWorkerStatus: (sessionId, worker) => {
    set((s) => {
      const currentState = s.states[sessionId];
      if (!currentState) return s;

      const workers = currentState.workers.map((w) =>
        w.id === worker.id ? worker : w
      );

      return {
        states: {
          ...s.states,
          [sessionId]: { ...currentState, workers },
        },
      };
    });
  },

  updatePhase: (sessionId, phase, message) => {
    set((s) => {
      const currentState = s.states[sessionId];
      if (!currentState) return s;

      return {
        states: {
          ...s.states,
          [sessionId]: { ...currentState, currentPhase: phase, phaseMessage: message },
        },
      };
    });
  },

  addTask: (sessionId, task) => {
    set((s) => {
      const currentState = s.states[sessionId];
      if (!currentState) return s;

      const tasks = [...currentState.tasks, task];
      return {
        states: {
          ...s.states,
          [sessionId]: { ...currentState, tasks },
        },
      };
    });
  },

  updateTask: (sessionId, task) => {
    set((s) => {
      const currentState = s.states[sessionId];
      if (!currentState) return s;

      const tasks = currentState.tasks.map((t) =>
        t.id === task.id ? task : t
      );

      return {
        states: {
          ...s.states,
          [sessionId]: { ...currentState, tasks },
        },
      };
    });
  },

  addTaskResult: (sessionId, taskId, result) => {
    set((s) => ({
      taskResults: {
        ...s.taskResults,
        [sessionId]: {
          ...(s.taskResults[sessionId] || {}),
          [taskId]: result,
        },
      },
    }));
  },

  addWorkerOutput: (sessionId, workerId, provider, content, isError) => {
    set((s) => {
      const currentOutputs = s.workerOutputs[sessionId] || [];
      const newEntry: WorkerOutputEntry = {
        workerId,
        provider,
        content,
        timestamp: Date.now(),
        isError,
      };

      // Keep only last 1000 entries per session
      const updatedOutputs = [...currentOutputs, newEntry].slice(-1000);

      return {
        workerOutputs: {
          ...s.workerOutputs,
          [sessionId]: updatedOutputs,
        },
      };
    });
  },

  clearWorkerOutputs: (sessionId, workerId) => {
    set((s) => {
      if (workerId) {
        // Clear outputs for specific worker
        const currentOutputs = s.workerOutputs[sessionId] || [];
        const filtered = currentOutputs.filter((o) => o.workerId !== workerId);
        return {
          workerOutputs: {
            ...s.workerOutputs,
            [sessionId]: filtered,
          },
        };
      } else {
        // Clear all outputs for session
        const { [sessionId]: _, ...rest } = s.workerOutputs;
        return { workerOutputs: rest };
      }
    });
  },

  togglePanel: (sessionId) => {
    set((s) => ({
      panelOpen: {
        ...s.panelOpen,
        [sessionId]: !s.panelOpen[sessionId],
      },
    }));
  },

  setPanelOpen: (sessionId, open) => {
    set((s) => ({
      panelOpen: {
        ...s.panelOpen,
        [sessionId]: open,
      },
    }));
  },

  setSelectedWorker: (sessionId, workerId) => {
    set((s) => ({
      selectedWorkerId: {
        ...s.selectedWorkerId,
        [sessionId]: workerId,
      },
    }));
  },

  getState: (sessionId) => {
    return get().states[sessionId] || null;
  },

  getConfig: (sessionId) => {
    return get().configs[sessionId] || defaultConfig;
  },

  getWorkers: (sessionId) => {
    return get().states[sessionId]?.workers || [];
  },

  getTasks: (sessionId) => {
    return get().states[sessionId]?.tasks || [];
  },

  getWorkerOutputs: (sessionId, workerId) => {
    const outputs = get().workerOutputs[sessionId] || [];
    if (workerId) {
      return outputs.filter((o) => o.workerId === workerId);
    }
    return outputs;
  },

  isOrchestrating: (sessionId) => {
    return get().states[sessionId]?.isOrchestrating || false;
  },

  clearSession: (sessionId) => {
    set((s) => {
      const { [sessionId]: _state, ...restStates } = s.states;
      const { [sessionId]: _config, ...restConfigs } = s.configs;
      const { [sessionId]: _outputs, ...restOutputs } = s.workerOutputs;
      const { [sessionId]: _results, ...restResults } = s.taskResults;
      const { [sessionId]: _panel, ...restPanel } = s.panelOpen;
      const { [sessionId]: _worker, ...restWorker } = s.selectedWorkerId;

      return {
        states: restStates,
        configs: restConfigs,
        workerOutputs: restOutputs,
        taskResults: restResults,
        panelOpen: restPanel,
        selectedWorkerId: restWorker,
      };
    });
  },
}));
