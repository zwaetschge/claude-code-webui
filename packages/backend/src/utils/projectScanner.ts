import * as fs from 'fs/promises';
import * as path from 'path';

export interface ProjectInfo {
  name: string;
  description: string;
  techStack: string[];
  packageManager: string | null;
  commands: Record<string, string>;
  keyDirectories: string[];
  framework: string | null;
  monorepo: boolean;
}

interface PackageJson {
  name?: string;
  description?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

async function readFirstLine(filePath: string): Promise<string | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const firstMeaningful = content
      .split('\n')
      .map((l) => l.replace(/^#+\s*/, '').trim())
      .find((l) => l.length > 0 && !l.startsWith('!') && !l.startsWith('['));
    return firstMeaningful || null;
  } catch {
    return null;
  }
}

async function detectKeyDirectories(projectPath: string): Promise<string[]> {
  const candidates = [
    'src',
    'lib',
    'app',
    'pages',
    'components',
    'packages',
    'tests',
    'test',
    'scripts',
    'public',
    'api',
  ];
  const found: string[] = [];
  for (const dir of candidates) {
    if (await fileExists(path.join(projectPath, dir))) {
      found.push(`${dir}/`);
    }
  }
  return found;
}

export async function scanProject(projectPath: string): Promise<ProjectInfo> {
  const info: ProjectInfo = {
    name: path.basename(projectPath),
    description: '',
    techStack: [],
    packageManager: null,
    commands: {},
    keyDirectories: [],
    framework: null,
    monorepo: false,
  };

  // Detect key directories
  info.keyDirectories = await detectKeyDirectories(projectPath);

  // Node.js / package.json based projects
  const pkg = await readJson<PackageJson>(path.join(projectPath, 'package.json'));
  if (pkg) {
    if (pkg.name) info.name = pkg.name;
    if (pkg.description) info.description = pkg.description;

    // Package manager
    if (await fileExists(path.join(projectPath, 'pnpm-lock.yaml'))) {
      info.packageManager = 'pnpm';
    } else if (await fileExists(path.join(projectPath, 'yarn.lock'))) {
      info.packageManager = 'yarn';
    } else if (await fileExists(path.join(projectPath, 'bun.lockb'))) {
      info.packageManager = 'bun';
    } else if (await fileExists(path.join(projectPath, 'package-lock.json'))) {
      info.packageManager = 'npm';
    }

    // Commands from scripts
    if (pkg.scripts) {
      const pm = info.packageManager || 'npm';
      const interesting = ['dev', 'build', 'test', 'lint', 'typecheck', 'start', 'format'];
      for (const key of interesting) {
        if (pkg.scripts[key]) {
          info.commands[key] = `${pm} ${key === 'start' ? key : 'run ' + key}`;
        }
      }
      // Shorthand for common pnpm/npm commands
      if (pkg.scripts.dev) info.commands.dev = `${pm} dev`;
      if (pkg.scripts.test) info.commands.test = `${pm} test`;
      if (pkg.scripts.start) info.commands.start = `${pm} start`;
    }

    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

    // TypeScript
    if (allDeps['typescript'] || (await fileExists(path.join(projectPath, 'tsconfig.json')))) {
      info.techStack.push('TypeScript');
    }

    // Frameworks
    if (allDeps['next']) {
      info.framework = 'Next.js';
      info.techStack.push('Next.js');
    } else if (allDeps['nuxt']) {
      info.framework = 'Nuxt';
      info.techStack.push('Nuxt');
    } else if (allDeps['react']) {
      info.techStack.push('React');
      if (allDeps['vite']) {
        info.framework = 'React + Vite';
        info.techStack.push('Vite');
      } else {
        info.framework = 'React';
      }
    } else if (allDeps['vue']) {
      info.framework = 'Vue';
      info.techStack.push('Vue');
    } else if (allDeps['svelte'] || allDeps['@sveltejs/kit']) {
      info.framework = allDeps['@sveltejs/kit'] ? 'SvelteKit' : 'Svelte';
      info.techStack.push(info.framework);
    } else if (allDeps['express']) {
      info.framework = 'Express';
      info.techStack.push('Express');
    } else if (allDeps['fastify']) {
      info.framework = 'Fastify';
      info.techStack.push('Fastify');
    }

    // UI/Styling
    if (
      allDeps['tailwindcss'] ||
      (await fileExists(path.join(projectPath, 'tailwind.config.js'))) ||
      (await fileExists(path.join(projectPath, 'tailwind.config.ts')))
    ) {
      info.techStack.push('Tailwind CSS');
    }

    // State management
    if (allDeps['zustand']) info.techStack.push('Zustand');
    else if (allDeps['redux'] || allDeps['@reduxjs/toolkit']) info.techStack.push('Redux');

    // Database
    if (allDeps['better-sqlite3'] || allDeps['sqlite3']) info.techStack.push('SQLite');
    else if (allDeps['prisma'] || allDeps['@prisma/client']) info.techStack.push('Prisma');
    else if (allDeps['pg']) info.techStack.push('PostgreSQL');
    else if (allDeps['mongoose'] || allDeps['mongodb']) info.techStack.push('MongoDB');

    // Real-time
    if (allDeps['socket.io']) info.techStack.push('Socket.IO');

    // Testing
    if (allDeps['vitest']) info.techStack.push('Vitest');
    else if (allDeps['jest']) info.techStack.push('Jest');

    // Monorepo
    if (await fileExists(path.join(projectPath, 'pnpm-workspace.yaml'))) {
      info.monorepo = true;
    } else if (
      pkg.scripts &&
      Object.values(pkg.scripts).some((s) => s.includes('lerna') || s.includes('turbo'))
    ) {
      info.monorepo = true;
    }
  }

  // Python projects
  if (await fileExists(path.join(projectPath, 'pyproject.toml'))) {
    info.techStack.push('Python');
    info.packageManager = info.packageManager || 'pip';
    try {
      const content = await fs.readFile(path.join(projectPath, 'pyproject.toml'), 'utf-8');
      const nameMatch = content.match(/^name\s*=\s*"([^"]+)"/m);
      if (nameMatch?.[1]) info.name = nameMatch[1];
      const descMatch = content.match(/^description\s*=\s*"([^"]+)"/m);
      if (descMatch?.[1] && !info.description) info.description = descMatch[1];
      if (content.includes('fastapi')) {
        info.framework = 'FastAPI';
        info.techStack.push('FastAPI');
      }
      if (content.includes('django')) {
        info.framework = 'Django';
        info.techStack.push('Django');
      }
      if (content.includes('flask')) {
        info.framework = 'Flask';
        info.techStack.push('Flask');
      }
    } catch {
      /* ignore */
    }
  } else if (await fileExists(path.join(projectPath, 'requirements.txt'))) {
    info.techStack.push('Python');
    info.packageManager = info.packageManager || 'pip';
  }

  // Rust
  if (await fileExists(path.join(projectPath, 'Cargo.toml'))) {
    info.techStack.push('Rust');
    info.packageManager = info.packageManager || 'cargo';
    info.commands.build = info.commands.build || 'cargo build';
    info.commands.test = info.commands.test || 'cargo test';
  }

  // Go
  if (await fileExists(path.join(projectPath, 'go.mod'))) {
    info.techStack.push('Go');
    info.commands.build = info.commands.build || 'go build ./...';
    info.commands.test = info.commands.test || 'go test ./...';
  }

  // Docker
  if (await fileExists(path.join(projectPath, 'Dockerfile'))) {
    info.techStack.push('Docker');
  }
  if (
    (await fileExists(path.join(projectPath, 'docker-compose.yml'))) ||
    (await fileExists(path.join(projectPath, 'docker-compose.yaml')))
  ) {
    info.techStack.push('Docker Compose');
  }

  // Fallback description from README
  if (!info.description) {
    const readme = await readFirstLine(path.join(projectPath, 'README.md'));
    if (readme) info.description = readme;
  }

  return info;
}

export function formatProjectContext(info: ProjectInfo): string {
  const lines: string[] = [];

  lines.push(`# Project: ${info.name}`);
  if (info.description) {
    lines.push('');
    lines.push(info.description);
  }

  if (info.techStack.length > 0) {
    lines.push('');
    lines.push('## Tech Stack');
    lines.push(info.techStack.join(', '));
  }

  if (info.monorepo) {
    lines.push('');
    lines.push(`**Monorepo** (${info.packageManager || 'unknown'})`);
  }

  if (Object.keys(info.commands).length > 0) {
    lines.push('');
    lines.push('## Commands');
    for (const [key, cmd] of Object.entries(info.commands)) {
      lines.push(`- \`${cmd}\` — ${key}`);
    }
  }

  if (info.keyDirectories.length > 0) {
    lines.push('');
    lines.push('## Key Directories');
    lines.push(info.keyDirectories.join(', '));
  }

  return lines.join('\n');
}
