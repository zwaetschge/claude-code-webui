import { TaskManager } from "./TaskManager";
import { GeminiOAuthRunner } from "./runners/GeminiOAuthRunner";

export { TaskManager } from "./TaskManager";
export type { TaskRunner, TaskContext } from "./TaskManager";

let taskManager: TaskManager | null = null;

export function getTaskManager(): TaskManager {
  if (!taskManager) {
    throw new Error("TaskManager not initialized. Call initTaskManager() first.");
  }
  return taskManager;
}

export function initTaskManager(): TaskManager {
  if (taskManager) return taskManager;

  taskManager = new TaskManager();
  taskManager.registerRunner(new GeminiOAuthRunner());
  taskManager.start();

  console.log("[tasks] TaskManager initialized with runners: gemini-oauth");
  return taskManager;
}
