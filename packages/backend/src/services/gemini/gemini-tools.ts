/**
 * Gemini Tool Definitions & Implementations
 *
 * Provides tool declarations (functionDeclarations) for the Code Assist API
 * and local implementations that execute tool calls from the model.
 *
 * These match the Gemini CLI's built-in tools so the model can read/write files,
 * run shell commands, and search the codebase.
 */

import fs from 'fs/promises';
import path from 'path';
import { execSync, spawn } from 'child_process';

// ── Types ────────────────────────────────────────────────────────────────────

export interface FunctionDeclaration {
  name: string;
  description: string;
  parametersJsonSchema: Record<string, unknown>;
}

export interface FunctionCall {
  name: string;
  args: Record<string, unknown>;
}

export interface FunctionResponse {
  name: string;
  response: Record<string, unknown>;
}

export interface ToolResult {
  name: string;
  response: Record<string, unknown>;
  success: boolean;
}

// ── Tool Declarations (sent to Code Assist API) ─────────────────────────────

const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'read_file',
    description:
      "Reads and returns the content of a specified file. If the file is large, the content will be truncated. Use 'offset' and 'limit' parameters to read specific line ranges.",
    parametersJsonSchema: {
      type: 'object',
      properties: {
        file_path: {
          description: 'The absolute path to the file to read.',
          type: 'string',
        },
        offset: {
          description:
            'Optional: 0-based line number to start reading from. Use with limit for large files.',
          type: 'number',
        },
        limit: {
          description: 'Optional: Maximum number of lines to read.',
          type: 'number',
        },
      },
      required: ['file_path'],
    },
  },
  {
    name: 'read_many_files',
    description: 'Read the contents of multiple files at once. More efficient than reading one at a time.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        file_paths: {
          description: 'Array of absolute file paths to read.',
          type: 'array',
          items: { type: 'string' },
        },
      },
      required: ['file_paths'],
    },
  },
  {
    name: 'write_file',
    description: 'Writes content to a specified file. Creates the file and parent directories if they do not exist.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        file_path: {
          description: 'The absolute path to the file to write to.',
          type: 'string',
        },
        content: {
          description: 'The content to write to the file.',
          type: 'string',
        },
      },
      required: ['file_path', 'content'],
    },
  },
  {
    name: 'replace',
    description:
      'Replace exact string occurrences in a file. Use for editing existing files. The old_string must match exactly (including whitespace and indentation).',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        file_path: {
          description: 'The absolute path to the file to edit.',
          type: 'string',
        },
        old_string: {
          description: 'The exact string to find and replace. Must match the file content exactly.',
          type: 'string',
        },
        new_string: {
          description: 'The string to replace old_string with.',
          type: 'string',
        },
        replace_all: {
          description: 'If true, replace all occurrences. Default: false (replace first occurrence only).',
          type: 'boolean',
        },
      },
      required: ['file_path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'run_shell_command',
    description:
      'Executes a shell command as `bash -c <command>`. Returns stdout, stderr, and exit code. Use for running build tools, tests, git operations, etc.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The bash command to execute.',
        },
        description: {
          type: 'string',
          description: 'Brief description of what the command does.',
        },
        dir_path: {
          type: 'string',
          description: 'Optional: Directory to run the command in. Defaults to the project root.',
        },
        timeout: {
          type: 'number',
          description: 'Optional: Timeout in milliseconds. Default: 120000 (2 minutes).',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'glob',
    description: 'Find files matching a glob pattern. Returns matching file paths. Useful for locating files by name or extension.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        pattern: {
          description: 'The glob pattern to match (e.g. "**/*.ts", "src/**/*.tsx").',
          type: 'string',
        },
        dir_path: {
          description: 'Optional: Directory to search in. Defaults to current working directory.',
          type: 'string',
        },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'grep_search',
    description:
      'Search for a regular expression pattern within file contents. Returns matching lines with file paths and line numbers. Max 100 matches.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        pattern: {
          description: 'The regex pattern to search for (e.g. "function\\s+myFunction", "import.*from").',
          type: 'string',
        },
        dir_path: {
          description: 'Optional: Directory to search in. Defaults to current working directory.',
          type: 'string',
        },
        include: {
          description: 'Optional: Glob pattern to filter which files are searched (e.g. "*.ts", "*.{ts,tsx}").',
          type: 'string',
        },
        names_only: {
          description: 'Optional: If true, only return file paths without line content.',
          type: 'boolean',
        },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'list_directory',
    description: 'Lists files and directories in a specified path. Returns names with type indicators (file/directory).',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        dir_path: {
          description: 'The absolute path to the directory to list.',
          type: 'string',
        },
      },
      required: ['dir_path'],
    },
  },
];

/** Get tool declarations for the Code Assist API request */
export function getToolDeclarations(): FunctionDeclaration[] {
  return TOOL_DECLARATIONS;
}

// ── Tool Implementations ─────────────────────────────────────────────────────

const MAX_FILE_SIZE = 512 * 1024; // 512KB max per file read
const MAX_LINES = 2000;

async function toolReadFile(args: Record<string, unknown>): Promise<ToolResult> {
  const filePath = args.file_path as string;
  const offset = (args.offset as number) || 0;
  const limit = (args.limit as number) || MAX_LINES;

  try {
    const stat = await fs.stat(filePath);
    if (stat.size > MAX_FILE_SIZE) {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');
      const sliced = lines.slice(offset, offset + limit);
      const numbered = sliced.map((line, i) => `${offset + i + 1}: ${line}`).join('\n');
      return {
        name: 'read_file',
        success: true,
        response: {
          content: numbered,
          truncated: true,
          total_lines: lines.length,
          lines_shown: sliced.length,
          offset,
        },
      };
    }

    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    if (offset > 0 || limit < lines.length) {
      const sliced = lines.slice(offset, offset + limit);
      const numbered = sliced.map((line, i) => `${offset + i + 1}: ${line}`).join('\n');
      return {
        name: 'read_file',
        success: true,
        response: {
          content: numbered,
          truncated: sliced.length < lines.length,
          total_lines: lines.length,
          lines_shown: sliced.length,
          offset,
        },
      };
    }

    return {
      name: 'read_file',
      success: true,
      response: { content, total_lines: lines.length },
    };
  } catch (err) {
    return {
      name: 'read_file',
      success: false,
      response: { error: `Failed to read file: ${err instanceof Error ? err.message : String(err)}` },
    };
  }
}

async function toolReadManyFiles(args: Record<string, unknown>): Promise<ToolResult> {
  const filePaths = args.file_paths as string[];
  const results: Record<string, string | { error: string }> = {};

  for (const fp of filePaths.slice(0, 20)) {
    try {
      const stat = await fs.stat(fp);
      if (stat.size > MAX_FILE_SIZE) {
        const content = await fs.readFile(fp, 'utf-8');
        results[fp] = content.substring(0, MAX_FILE_SIZE) + '\n[...truncated]';
      } else {
        results[fp] = await fs.readFile(fp, 'utf-8');
      }
    } catch (err) {
      results[fp] = { error: err instanceof Error ? err.message : String(err) };
    }
  }

  return { name: 'read_many_files', success: true, response: { files: results } };
}

async function toolWriteFile(args: Record<string, unknown>): Promise<ToolResult> {
  const filePath = args.file_path as string;
  const content = args.content as string;

  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf-8');
    return {
      name: 'write_file',
      success: true,
      response: { message: `Successfully wrote ${content.length} bytes to ${filePath}` },
    };
  } catch (err) {
    return {
      name: 'write_file',
      success: false,
      response: { error: `Failed to write file: ${err instanceof Error ? err.message : String(err)}` },
    };
  }
}

async function toolReplace(args: Record<string, unknown>): Promise<ToolResult> {
  const filePath = args.file_path as string;
  const oldString = args.old_string as string;
  const newString = args.new_string as string;
  const replaceAll = (args.replace_all as boolean) || false;

  try {
    let content = await fs.readFile(filePath, 'utf-8');

    if (!content.includes(oldString)) {
      return {
        name: 'replace',
        success: false,
        response: { error: `old_string not found in ${filePath}. Make sure it matches exactly.` },
      };
    }

    if (replaceAll) {
      content = content.split(oldString).join(newString);
    } else {
      const idx = content.indexOf(oldString);
      content = content.substring(0, idx) + newString + content.substring(idx + oldString.length);
    }

    await fs.writeFile(filePath, content, 'utf-8');
    return {
      name: 'replace',
      success: true,
      response: { message: `Successfully replaced in ${filePath}` },
    };
  } catch (err) {
    return {
      name: 'replace',
      success: false,
      response: { error: `Failed to edit file: ${err instanceof Error ? err.message : String(err)}` },
    };
  }
}

async function toolRunShellCommand(args: Record<string, unknown>): Promise<ToolResult> {
  const command = args.command as string;
  const dirPath = (args.dir_path as string) || process.cwd();
  const timeout = (args.timeout as number) || 120_000;

  return new Promise((resolve) => {
    const proc = spawn('bash', ['-c', command], {
      cwd: dirPath,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout,
      env: { ...process.env, TERM: 'dumb', CI: '1' },
    });

    let stdout = '';
    let stderr = '';
    const maxOutput = 256 * 1024; // 256KB max

    proc.stdout.on('data', (data: Buffer) => {
      if (stdout.length < maxOutput) stdout += data.toString();
    });
    proc.stderr.on('data', (data: Buffer) => {
      if (stderr.length < maxOutput) stderr += data.toString();
    });

    proc.on('error', (err) => {
      resolve({
        name: 'run_shell_command',
        success: false,
        response: { error: `Command failed to start: ${err.message}`, command },
      });
    });

    proc.on('close', (code) => {
      const truncatedStdout = stdout.length >= maxOutput ? stdout + '\n[...truncated]' : stdout;
      const truncatedStderr = stderr.length >= maxOutput ? stderr + '\n[...truncated]' : stderr;

      resolve({
        name: 'run_shell_command',
        success: code === 0,
        response: {
          exit_code: code ?? -1,
          stdout: truncatedStdout,
          stderr: truncatedStderr,
          command,
        },
      });
    });

    // Safety: kill if it doesn't respond
    setTimeout(() => {
      if (!proc.killed) {
        proc.kill('SIGTERM');
        setTimeout(() => {
          if (!proc.killed) proc.kill('SIGKILL');
        }, 5000);
      }
    }, timeout);
  });
}

async function toolGlob(args: Record<string, unknown>): Promise<ToolResult> {
  const pattern = args.pattern as string;
  const dirPath = (args.dir_path as string) || process.cwd();

  try {
    // Use find + shell globbing as fallback since the 'glob' npm package may not be available
    // Convert glob pattern to find-compatible args
    const findArgs = [dirPath, '-maxdepth', '10'];

    // Exclude common noise directories
    findArgs.push(
      '(', '-path', '*/node_modules', '-o', '-path', '*/.git', '-o', '-path', '*/dist', ')',
      '-prune', '-o'
    );

    // Convert glob pattern to -name or -path
    if (pattern.includes('/') || pattern.includes('**')) {
      // Complex pattern — use -path with wildcard translation
      const findPattern = pattern.replace(/\*\*/g, '*');
      findArgs.push('-path', `*/${findPattern}`, '-print');
    } else {
      findArgs.push('-name', pattern, '-print');
    }

    const result = execSync(
      `find ${findArgs.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(' ')} 2>/dev/null | head -200`,
      { encoding: 'utf-8', timeout: 15_000, maxBuffer: 256 * 1024, cwd: dirPath }
    ).trim();

    const matches = result ? result.split('\n').filter(Boolean) : [];
    return {
      name: 'glob',
      success: true,
      response: {
        matches,
        total: matches.length,
        truncated: matches.length >= 200,
      },
    };
  } catch (err) {
    return {
      name: 'glob',
      success: false,
      response: { error: `Glob failed: ${err instanceof Error ? err.message : String(err)}` },
    };
  }
}

async function toolGrepSearch(args: Record<string, unknown>): Promise<ToolResult> {
  const pattern = args.pattern as string;
  const dirPath = (args.dir_path as string) || process.cwd();
  const include = args.include as string | undefined;
  const namesOnly = (args.names_only as boolean) || false;

  try {
    // Use grep (available in all containers) — escape pattern for shell
    const grepArgs = ['-r', '-n', '-E', '--max-count=10'];
    // Exclude common noise directories
    grepArgs.push('--exclude-dir=node_modules', '--exclude-dir=.git', '--exclude-dir=dist');
    if (include) grepArgs.push('--include', include);
    if (namesOnly) grepArgs.push('-l');

    const escapedPattern = pattern.replace(/'/g, "'\\''");
    const escapedDir = dirPath.replace(/'/g, "'\\''");
    const cmd = `grep ${grepArgs.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(' ')} '${escapedPattern}' '${escapedDir}' 2>/dev/null | head -100`;

    const result = execSync(cmd, {
      encoding: 'utf-8',
      timeout: 30_000,
      maxBuffer: 512 * 1024,
    }).trim();

    const lines = result ? result.split('\n').filter(Boolean) : [];
    return {
      name: 'grep_search',
      success: true,
      response: {
        matches: lines,
        total: lines.length,
        truncated: lines.length >= 100,
      },
    };
  } catch (err) {
    // grep exits with 1 when no matches found
    if (err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === 1) {
      return {
        name: 'grep_search',
        success: true,
        response: { matches: [], total: 0, truncated: false },
      };
    }
    return {
      name: 'grep_search',
      success: false,
      response: { error: `Search failed: ${err instanceof Error ? err.message : String(err)}` },
    };
  }
}

async function toolListDirectory(args: Record<string, unknown>): Promise<ToolResult> {
  const dirPath = args.dir_path as string;

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const items = entries
      .filter((e) => !e.name.startsWith('.'))
      .slice(0, 500)
      .map((e) => ({
        name: e.name,
        type: e.isDirectory() ? 'directory' : 'file',
      }));

    return {
      name: 'list_directory',
      success: true,
      response: { entries: items, total: entries.length },
    };
  } catch (err) {
    return {
      name: 'list_directory',
      success: false,
      response: { error: `Failed to list directory: ${err instanceof Error ? err.message : String(err)}` },
    };
  }
}

// ── Tool Dispatcher ──────────────────────────────────────────────────────────

const TOOL_MAP: Record<string, (args: Record<string, unknown>) => Promise<ToolResult>> = {
  read_file: toolReadFile,
  read_many_files: toolReadManyFiles,
  write_file: toolWriteFile,
  replace: toolReplace,
  run_shell_command: toolRunShellCommand,
  glob: toolGlob,
  grep_search: toolGrepSearch,
  list_directory: toolListDirectory,
};

/**
 * Execute a tool call from the model.
 * Returns a ToolResult with the function response to send back to the API.
 */
export async function executeTool(call: FunctionCall): Promise<ToolResult> {
  const handler = TOOL_MAP[call.name];
  if (!handler) {
    return {
      name: call.name,
      success: false,
      response: { error: `Unknown tool: ${call.name}` },
    };
  }

  try {
    return await handler(call.args);
  } catch (err) {
    return {
      name: call.name,
      success: false,
      response: { error: `Tool execution error: ${err instanceof Error ? err.message : String(err)}` },
    };
  }
}
