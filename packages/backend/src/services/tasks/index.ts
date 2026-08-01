import { TaskManager } from './TaskManager.js';

export { TaskManager } from './TaskManager.js';
export type { TaskRunner, TaskContext } from './TaskManager.js';

let taskManager: TaskManager | null = null;

export function getTaskManager(): TaskManager {
  if (!taskManager) {
    throw new Error('TaskManager not initialized. Call initTaskManager() first.');
  }
  return taskManager;
}

export function initTaskManager(): TaskManager {
  if (taskManager) return taskManager;

  taskManager = new TaskManager();
  taskManager.start();

  console.log('[tasks] TaskManager initialized');
  return taskManager;
}
