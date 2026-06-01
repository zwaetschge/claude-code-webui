export type SessionStatus = 'running' | 'stopped' | 'error';

export type CLIProvider = 'claude' | 'codex' | 'opencode' | 'vibe';

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
  mode: string | null;
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

export interface Category {
  id: string;
  user_id: string;
  name: string;
  color: string;
  icon: string;
  sort_order: number;
  created_at: string;
}

export interface CreateCategoryInput {
  name: string;
  color?: string;
  icon?: string;
}

export interface UpdateCategoryInput {
  name?: string;
  color?: string;
  icon?: string;
  sort_order?: number;
}
