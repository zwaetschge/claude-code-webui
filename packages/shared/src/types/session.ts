export type SessionStatus = 'running' | 'stopped' | 'error';

export type CLIProvider = 'claude' | 'codex' | 'gemini' | 'glm' | 'kimi' | 'multi';

export interface Session {
  id: string;
  userId: string;
  name: string;
  workingDirectory: string;
  claudeSessionId: string | null;
  status: SessionStatus;
  lastMessage: string | null;
  starred: boolean;
  cliProvider: CLIProvider;
  category: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSessionInput {
  name: string;
  workingDirectory?: string;
  cliProvider?: CLIProvider;
}

export interface UpdateSessionInput {
  name?: string;
  workingDirectory?: string;
}
