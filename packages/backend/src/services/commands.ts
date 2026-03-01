import { readdir, readFile, stat } from 'fs/promises';
import { join, basename } from 'path';
import { homedir } from 'os';
import type { Command, ParsedCommand, CommandExecutionResult, BuiltinCommandName } from '@claude-code-webui/shared';

// Built-in command definitions
const BUILTIN_COMMAND_DEFS: Record<BuiltinCommandName, Omit<Command, 'name' | 'scope'>> = {
  help: {
    description: 'Show available commands',
    arguments: [],
  },
  clear: {
    description: 'Clear chat history (UI only)',
    arguments: [],
  },
  model: {
    description: 'Show or change the current model',
    arguments: ['model_name'],
  },
  status: {
    description: 'Show session status',
    arguments: [],
  },
  cost: {
    description: 'Show current token usage and cost',
    arguments: [],
  },
  compact: {
    description: 'Toggle compact mode',
    arguments: [],
  },
};

export class CommandService {
  private userCommandsDir: string;

  constructor() {
    this.userCommandsDir = join(homedir(), '.claude', 'commands');
  }

  // Parse command string into name and arguments
  parseCommand(input: string): ParsedCommand | null {
    const trimmed = input.trim();
    if (!trimmed.startsWith('/')) return null;

    const parts = trimmed.slice(1).split(/\s+/);
    const name = parts[0]?.toLowerCase();
    if (!name) return null;

    return {
      name,
      args: parts.slice(1),
      rawArgs: parts.slice(1).join(' '),
    };
  }

  // Get all available commands (builtin + user + project)
  async getAvailableCommands(projectPath?: string): Promise<Command[]> {
    const commands: Command[] = [];

    // Add built-in commands
    for (const [name, def] of Object.entries(BUILTIN_COMMAND_DEFS)) {
      commands.push({
        name,
        scope: 'builtin',
        ...def,
      });
    }

    // Add user commands
    const userCommands = await this.loadCommandsFromDir(this.userCommandsDir, 'user');
    commands.push(...userCommands);

    // Add project commands if projectPath provided
    if (projectPath) {
      const projectCommandsDir = join(projectPath, '.claude', 'commands');
      const projectCommands = await this.loadCommandsFromDir(projectCommandsDir, 'project', projectPath);
      commands.push(...projectCommands);
    }

    return commands;
  }

  // Load commands from a directory
  private async loadCommandsFromDir(
    dir: string,
    scope: 'user' | 'project',
    projectPath?: string
  ): Promise<Command[]> {
    const commands: Command[] = [];

    try {
      const stats = await stat(dir);
      if (!stats.isDirectory()) return commands;

      const files = await readdir(dir);
      const mdFiles = files.filter(f => f.endsWith('.md'));

      for (const file of mdFiles) {
        const content = await readFile(join(dir, file), 'utf-8');
        const command = this.parseCommandFile(file, content, scope, projectPath);
        if (command) {
          commands.push(command);
        }
      }
    } catch {
      // Directory doesn't exist or can't be read
    }

    return commands;
  }

  // Parse a command file with YAML frontmatter
  private parseCommandFile(
    filename: string,
    content: string,
    scope: 'user' | 'project',
    projectPath?: string
  ): Command | null {
    const name = basename(filename, '.md');

    // Parse YAML frontmatter
    const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);

    if (frontmatterMatch && frontmatterMatch[1] && frontmatterMatch[2]) {
      const yamlContent = frontmatterMatch[1];
      const templateContent = frontmatterMatch[2].trim();

      // Simple YAML parsing for our use case
      const description = this.extractYamlValue(yamlContent, 'description') ?? `Custom command: ${name}`;
      const argsStr = this.extractYamlValue(yamlContent, 'arguments');
      const args = argsStr ? this.parseYamlArray(argsStr) : [];

      return {
        name,
        description,
        arguments: args,
        scope,
        content: templateContent,
        projectPath,
      };
    }

    // No frontmatter, use entire content as template
    return {
      name,
      description: `Custom command: ${name}`,
      scope,
      content: content.trim(),
      projectPath,
    };
  }

  // Extract a value from YAML
  private extractYamlValue(yaml: string, key: string): string | null {
    const regex = new RegExp(`^${key}:\\s*(.+)$`, 'm');
    const match = yaml.match(regex);
    return match && match[1] ? match[1].trim().replace(/^["']|["']$/g, '') : null;
  }

  // Parse a YAML array (simple format: ["a", "b"])
  private parseYamlArray(str: string): string[] {
    const match = str.match(/^\[(.+)\]$/);
    if (!match || !match[1]) return [];
    return match[1].split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
  }

  // Execute a command
  async executeCommand(
    parsed: ParsedCommand,
    context: {
      projectPath?: string;
      sessionId?: string;
      currentModel?: string;
      usage?: { inputTokens: number; outputTokens: number; cost: number };
    }
  ): Promise<CommandExecutionResult> {
    // Check built-in commands first
    if (parsed.name in BUILTIN_COMMAND_DEFS) {
      return this.executeBuiltinCommand(parsed.name as BuiltinCommandName, parsed, context);
    }

    // Load available commands
    const commands = await this.getAvailableCommands(context.projectPath);
    const command = commands.find(c => c.name === parsed.name && c.scope !== 'builtin');

    if (!command || !command.content) {
      return {
        success: false,
        error: `Unknown command: /${parsed.name}. Type /help for available commands.`,
      };
    }

    // Process command template
    const processedContent = this.processTemplate(command.content, parsed.args, parsed.rawArgs);

    return {
      success: true,
      action: 'send_message',
      response: processedContent,
    };
  }

  // Execute a built-in command
  private async executeBuiltinCommand(
    name: BuiltinCommandName,
    parsed: ParsedCommand,
    context: {
      projectPath?: string;
      sessionId?: string;
      currentModel?: string;
      usage?: { inputTokens: number; outputTokens: number; cost: number };
    }
  ): Promise<CommandExecutionResult> {
    switch (name) {
      case 'help': {
        const commands = await this.getAvailableCommands(context.projectPath);
        const helpText = commands
          .map(c => `/${c.name} - ${c.description}${c.scope !== 'builtin' ? ` [${c.scope}]` : ''}`)
          .join('\n');
        return {
          success: true,
          response: `Available commands:\n\n${helpText}`,
        };
      }

      case 'clear':
        return {
          success: true,
          action: 'clear',
          response: 'Chat history cleared.',
        };

      case 'model':
        if (parsed.args.length === 0) {
          return {
            success: true,
            response: `Current model: ${context.currentModel || 'claude-sonnet-4-20250514'}`,
          };
        }
        return {
          success: true,
          action: 'model_change',
          response: `Model changed to: ${parsed.args[0]}`,
          data: { model: parsed.args[0] },
        };

      case 'status':
        return {
          success: true,
          response: [
            `Session: ${context.sessionId || 'N/A'}`,
            `Model: ${context.currentModel || 'claude-sonnet-4-20250514'}`,
            `Project: ${context.projectPath || 'None'}`,
          ].join('\n'),
        };

      case 'cost':
        if (context.usage) {
          return {
            success: true,
            response: [
              'Token Usage:',
              `  Input: ${context.usage.inputTokens.toLocaleString()} tokens`,
              `  Output: ${context.usage.outputTokens.toLocaleString()} tokens`,
              `  Cost: $${context.usage.cost.toFixed(4)}`,
            ].join('\n'),
          };
        }
        return {
          success: true,
          response: 'No usage data available for this session.',
        };

      case 'compact':
        return {
          success: true,
          action: 'clear',
          data: { toggleCompact: true },
          response: 'Compact mode toggled.',
        };

      default:
        return {
          success: false,
          error: `Unknown built-in command: /${name}`,
        };
    }
  }

  // Process command template with arguments
  private processTemplate(template: string, args: string[], rawArgs: string): string {
    let result = template;

    // Replace $ARGUMENTS with full args string
    result = result.replace(/\$ARGUMENTS/g, rawArgs);

    // Replace $1, $2, etc. with individual args
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg !== undefined) {
        result = result.replace(new RegExp(`\\$${i + 1}`, 'g'), arg);
      }
    }

    // Clean up any remaining placeholders
    result = result.replace(/\$\d+/g, '');

    return result.trim();
  }

  // Process @filename references in text (reads file content)
  async processFileReferences(text: string, workingDirectory: string): Promise<string> {
    const fileRefRegex = /@([\w./\-_]+)/g;
    let result = text;
    let match;

    while ((match = fileRefRegex.exec(text)) !== null) {
      const fileName = match[1];
      if (!fileName) continue;
      const filePath = join(workingDirectory, fileName);
      try {
        const content = await readFile(filePath, 'utf-8');
        result = result.replace(match[0], `\n\`\`\`\n${content}\n\`\`\`\n`);
      } catch {
        // File doesn't exist or can't be read, leave reference as-is
      }
    }

    return result;
  }
}

export const commandService = new CommandService();
