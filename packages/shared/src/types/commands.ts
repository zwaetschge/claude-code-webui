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
  action?:
    | 'clear'
    | 'model_change'
    | 'send_message'
    | 'forward_to_cli'
    | 'rename_session'
    | 'copy_response'
    | 'export_conversation'
    | 'new_session'
    | 'resume_session'
    | 'open_settings'
    | 'open_permissions'
    | 'open_diff'
    | 'open_feedback'
    | 'show_doctor'
    | 'toggle_fast';
  data?: Record<string, unknown>;
}

// Built-in command names (native WebUI handlers)
export const BUILTIN_COMMANDS = [
  'help',
  'clear',
  'reset',
  'new',
  'model',
  'status',
  'cost',
  'compact',
  'rename',
  'copy',
  'export',
  'resume',
  'continue',
  'theme',
  'permissions',
  'diff',
  'feedback',
  'bug',
  'doctor',
  'fast',
] as const;

export type BuiltinCommandName = typeof BUILTIN_COMMANDS[number];

// Commands forwarded to Claude Code CLI (stream-json) as raw text
// so Claude's own slash-command machinery handles them.
export const CLI_FORWARDED_COMMANDS = [
  'btw',
  'context',
  'memory',
  'mcp',
  'hooks',
  'skills',
  'debug',
  'effort',
  'plan',
  'init',
  'review',
  'recap',
  'security-review',
  'add-dir',
  'claude-api',
  'simplify',
  'batch',
  'loop',
  'proactive',
  'less-permission-prompts',
  'usage',
  'insights',
  'stats',
  'schedule',
  'routines',
  'agents',
] as const;

export type CliForwardedCommandName = typeof CLI_FORWARDED_COMMANDS[number];
