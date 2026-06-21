export type UserRole = 'user' | 'admin';
export type UserStatus = 'active' | 'suspended';

export interface User {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  provider: 'github' | 'google' | 'claude' | 'codex' | 'zai' | 'dev' | 'cli' | 'proxy';
  providerId: string;
  role?: UserRole;
  status?: UserStatus;
  lastLoginAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthUser extends User {
  accessToken: string;
}

export interface AuditLogEntry {
  id: number;
  actorUserId: string | null;
  actorEmail?: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  ip: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}
