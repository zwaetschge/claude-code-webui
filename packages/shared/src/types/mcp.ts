export type McpServerType = 'subprocess' | 'sse';

export interface McpServer {
  id: string;
  userId: string;
  name: string;
  type: McpServerType;
  command: string | null;
  args: string[];
  url: string | null;
  env: Record<string, string>;
  enabled: boolean;
  createdAt: string;
}

export interface CreateMcpServerInput {
  name: string;
  type: McpServerType;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  enabled?: boolean;
}

export interface UpdateMcpServerInput {
  name?: string;
  type?: McpServerType;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  enabled?: boolean;
}
