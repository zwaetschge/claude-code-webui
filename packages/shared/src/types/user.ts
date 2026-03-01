export interface User {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  provider: 'github' | 'google' | 'claude' | 'codex' | 'zai' | 'dev' | 'cli';
  providerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuthUser extends User {
  accessToken: string;
}
