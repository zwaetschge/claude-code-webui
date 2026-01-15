export type SessionStatus = 'running' | 'stopped' | 'error';

export interface Session {
  id: string;
  userId: string;
  name: string;
  workingDirectory: string;
  provider: 'claude' | 'zai' | 'codex';
  claudeSessionId: string | null;
  status: SessionStatus;
  lastMessage: string | null;
  starred: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSessionInput {
  name: string;
  workingDirectory: string;
  provider?: 'claude' | 'zai' | 'codex';
}

export interface UpdateSessionInput {
  name?: string;
  workingDirectory?: string;
}
