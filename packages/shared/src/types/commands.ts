// Command System Types

export interface Command {
  name: string;
  description: string;
  arguments?: string[];
  scope: 'builtin' | 'user' | 'project';
  content?: string;  // Template content for custom commands
  projectPath?: string;  // For project-scoped commands
}

export interface ParsedCommand {
  name: string;
  args: string[];
  rawArgs: string;
}

export interface CommandExecutionResult {
  success: boolean;
  response?: string;
  error?: string;
  action?: 'clear' | 'model_change' | 'send_message';
  data?: Record<string, unknown>;
}

// Built-in command names
export const BUILTIN_COMMANDS = [
  'help',
  'clear',
  'model',
  'status',
  'cost',
  'compact',
] as const;

export type BuiltinCommandName = typeof BUILTIN_COMMANDS[number];
