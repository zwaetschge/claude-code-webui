// GitHub API Types

export interface GitHubUser {
  login: string;
  id: number;
  avatar_url: string;
  name: string | null;
  email: string | null;
  public_repos: number;
}

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  description: string | null;
  clone_url: string;
  ssh_url: string;
  default_branch: string;
  created_at: string;
  updated_at: string;
  pushed_at: string;
  size: number;
  stargazers_count: number;
  language: string | null;
}

export interface CreateRepoRequest {
  name: string;
  description?: string;
  private?: boolean;
  auto_init?: boolean;
}

export interface CloneRepoRequest {
  url: string;
  targetDir: string;
  branch?: string;
}

export interface PushToGitHubRequest {
  workingDirectory: string;
  remote?: string;
  branch?: string;
  force?: boolean;
}

export interface GitHubTokenStatus {
  hasToken: boolean;
  tokenPreview: string | null;
  username?: string;
  scopes?: string[];
}
