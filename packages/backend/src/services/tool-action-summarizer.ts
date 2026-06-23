import type { ToolActionSummary } from '@plum-code-webui/shared';

function compactText(value: string, maxLength = 110): string {
  const compacted = value.replace(/\s+/g, ' ').trim();
  if (compacted.length <= maxLength) return compacted;
  return `${compacted.slice(0, maxLength - 1).trim()}...`;
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

function getObject(input: unknown): Record<string, unknown> | null {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : null;
}

function getCommand(input: unknown): string {
  const obj = getObject(input);
  if (typeof obj?.command === 'string') return obj.command;
  return typeof input === 'string' ? input : '';
}

function stripShellWrapper(command: string): string {
  const trimmed = command.trim();
  const match = trimmed.match(/^(?:\/bin\/)?(?:ba)?sh\s+-lc\s+(['"])([\s\S]*)\1$/);
  return match?.[2] ? match[2].trim() : trimmed;
}

function getFirstLikelyPath(command: string): string {
  const tokens =
    command
      .match(/(?:[^\s'"]+|'[^']*'|"[^"]*")+/g)
      ?.map((token) => token.replace(/^['"]|['"]$/g, '')) || [];
  return (
    tokens
      .slice(1)
      .find(
        (token) =>
          token &&
          !token.startsWith('-') &&
          !/^\d/.test(token) &&
          !/^[|;&]$/.test(token) &&
          !token.includes('*')
      ) || ''
  );
}

function summarizeCommand(command: string): { title: string; explanation: string } {
  const inner = stripShellWrapper(command);
  const lower = inner.toLowerCase();
  const preview = compactText(inner, 104);

  if (lower.includes('plum-rebuild.sh')) {
    return {
      title: 'Deploying WebUI',
      explanation: 'Triggers the rebuild sidecar and waits for the app health check.',
    };
  }
  if (lower.includes('rebuild-robot-status') || lower.includes('rebuild-robot.log')) {
    return {
      title: 'Checking rebuild status',
      explanation: 'Reads the sidecar status and recent deploy log.',
    };
  }
  if (
    lower.startsWith('ps ') ||
    lower.includes(' ps ') ||
    lower.startsWith('pgrep ') ||
    lower.includes(' pgrep ') ||
    lower.startsWith('lsof ') ||
    lower.includes(' lsof ')
  ) {
    return {
      title: 'Checking processes',
      explanation: 'Looks for active build or server jobs before taking the next step.',
    };
  }
  if (lower.includes('typecheck') || lower.includes('tsc --noemit')) {
    return {
      title: 'Checking TypeScript',
      explanation: 'Runs the type checker to catch compile errors.',
    };
  }
  if (lower.includes('prettier --write')) {
    return {
      title: 'Formatting code',
      explanation: 'Applies the repository formatter to touched files.',
    };
  }
  if (lower.includes('prettier --check')) {
    return {
      title: 'Checking formatting',
      explanation: 'Verifies that files match the formatter.',
    };
  }
  if (lower.startsWith('rg ') || lower.includes(' rg ')) {
    return {
      title: 'Searching codebase',
      explanation: 'Finds matching files, symbols, or CSS classes.',
    };
  }
  if (
    lower.startsWith('sed ') ||
    lower.startsWith('cat ') ||
    lower.startsWith('nl ') ||
    lower.startsWith('tail ') ||
    lower.startsWith('head ')
  ) {
    const filePath = getFirstLikelyPath(inner);
    const file = filePath ? basename(filePath) : '';
    return {
      title: file ? `Reading ${file}` : 'Reading project files',
      explanation: 'Loads source or log context needed for the current change.',
    };
  }
  if (lower.startsWith('curl ') || lower.includes(' curl ')) {
    return {
      title: 'Checking service response',
      explanation: 'Calls an endpoint to verify the app is responding.',
    };
  }
  if (lower.startsWith('git status')) {
    return {
      title: 'Checking git status',
      explanation: 'Reviews the current worktree state.',
    };
  }
  if (lower.startsWith('git diff')) {
    return {
      title: 'Reviewing changes',
      explanation: 'Reads the diff for the current edits.',
    };
  }
  if (lower.includes('pnpm') && lower.includes('build')) {
    return {
      title: lower.includes('frontend') ? 'Building frontend' : 'Building app',
      explanation: 'Compiles the app to catch build-time issues.',
    };
  }
  if (lower.includes('pnpm') && lower.includes('test')) {
    return {
      title: 'Running tests',
      explanation: 'Runs the relevant test suite.',
    };
  }

  return {
    title: 'Running command',
    explanation: preview || 'Runs a shell command.',
  };
}

function summarizeFileTool(
  toolName: string,
  input: unknown
): { title: string; explanation: string } {
  const obj = getObject(input);
  const path =
    typeof obj?.file_path === 'string'
      ? obj.file_path
      : typeof obj?.path === 'string'
        ? obj.path
        : '';
  const file = path ? basename(path) : '';
  const normalized = toolName.replace(/[_\s.-]/g, '').toLowerCase();

  if (normalized.includes('read')) {
    return {
      title: file ? `Reading ${file}` : 'Reading files',
      explanation: 'Loads source context before making changes.',
    };
  }
  if (
    normalized.includes('write') ||
    normalized.includes('edit') ||
    normalized.includes('replace')
  ) {
    return {
      title: file ? `Editing ${file}` : 'Editing files',
      explanation: 'Applies source changes in the workspace.',
    };
  }
  if (normalized.includes('grep') || normalized.includes('glob') || normalized.includes('search')) {
    const query =
      typeof obj?.pattern === 'string'
        ? obj.pattern
        : typeof obj?.query === 'string'
          ? obj.query
          : '';
    return {
      title: 'Searching project',
      explanation: query ? compactText(query, 90) : 'Finds matching files and symbols.',
    };
  }
  return {
    title: toolName || 'Running tool',
    explanation: 'Runs a tool step.',
  };
}

export function getFallbackToolActionSummary(toolName: string, input?: unknown): ToolActionSummary {
  const normalized = toolName.replace(/[_\s.-]/g, '').toLowerCase();
  const command = getCommand(input);
  const summary =
    normalized.includes('bash') || normalized.includes('shell') || normalized.includes('command')
      ? summarizeCommand(command)
      : normalized.includes('todo')
        ? {
            title: 'Updating task list',
            explanation: 'Keeps the visible checklist in sync with the run.',
          }
        : summarizeFileTool(toolName, input);

  return {
    ...summary,
    source: 'template',
    generatedAt: Date.now(),
  };
}
