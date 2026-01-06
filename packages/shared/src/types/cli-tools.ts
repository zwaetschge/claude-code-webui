// CLI Tool for orchestrating other AI CLI tools (like Codex, Aider, etc.)
export interface CliTool {
  id: string;
  userId: string;
  name: string;
  command: string;
  description: string | null;
  useSessionCwd: boolean;
  timeoutSeconds: number;
  enabled: boolean;
  createdAt: string;
}

export interface CreateCliToolInput {
  name: string;
  command: string;
  description?: string;
  useSessionCwd?: boolean;
  timeoutSeconds?: number;
  enabled?: boolean;
}

export interface UpdateCliToolInput {
  name?: string;
  command?: string;
  description?: string;
  useSessionCwd?: boolean;
  timeoutSeconds?: number;
  enabled?: boolean;
}

// Result of executing a CLI tool
export interface CliToolExecution {
  toolId: string;
  toolName: string;
  command: string;
  prompt: string;
  output: string;
  exitCode: number | null;
  startedAt: string;
  completedAt: string | null;
  status: 'running' | 'completed' | 'error' | 'timeout';
}
