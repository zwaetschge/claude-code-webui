// Generic API Response Types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// File System Types
export interface FileInfo {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number;
  modifiedAt: string;
  extension?: string;
}

export interface DirectoryContents {
  path: string;
  files: FileInfo[];
}

// Git Types
export interface GitStatus {
  branch: string;
  isClean: boolean;
  staged: string[];
  unstaged: string[];
  untracked: string[];
}

export interface GitBranch {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
}

export interface GitCommit {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
}

export interface GitFileDiff {
  file: string;
  diff: string;
  additions: number;
  deletions: number;
  staged: boolean;
}

export interface GitCommitResult {
  hash: string;
  summary: {
    changes: number;
    insertions: number;
    deletions: number;
  };
}

// Discovered Project Types
export interface DiscoveredProject {
  id: string;
  name: string;
  path: string;
  claudeProjectPath: string;
  hasSession: boolean;
  lastModified: string;
  sessionFiles: string[];
}
