/**
 * Multi-CLI Orchestration Module
 *
 * Provides orchestration capabilities where Claude Code acts as the master
 * orchestrator, delegating tasks to specialized worker CLIs (Codex, Gemini, GLM).
 */

export {
  OrchestrationManager,
  orchestrationManager,
} from './OrchestrationManager.js';

export {
  WorkerProcessManager,
  workerProcessManager,
  type WorkerProcess,
  type WorkerOutput,
  type WorkerEvents,
} from './WorkerProcessManager.js';

export {
  TaskRouter,
  defaultTaskRouter,
  type TaskAnalysis,
} from './TaskRouter.js';
