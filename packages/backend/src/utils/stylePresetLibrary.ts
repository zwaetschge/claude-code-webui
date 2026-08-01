import fs from 'fs/promises';
import path from 'path';

export type StylePresetKind = 'design' | 'writing';

const DESIGN_STYLE_NAMES = new Set([
  'dragonball-z-design',
  'material-3-design',
  'windows95-design',
]);

const WRITING_STYLE_NAMES = new Set([
  '20min-satirist',
  'bender',
  'caveman',
  'claptrap',
  'deep-thought',
  'dr-perry-cox',
  'dr-zoidberg',
  'drunk-texter',
  'dschungel-george',
  'eliza',
  'funnybot',
  'graf-zitronenbaum',
  'heisenberg',
  'human-voice',
  'karen',
  'kevingpt',
  'michael-scott-boss-mode',
  'michael-scott-roleplay',
  'nikola-tesla',
  'prison-mike',
  'ricks-ship',
  'schlaubi-schlumpf',
  'severus-snape',
  'shadowheart',
  'spock',
  'succubus-persona',
  'thaddaeus-gewerkschaftsfuehrer',
  'towelie',
  'truman-burbank',
]);

export interface StylePresetLocation {
  baseName: string;
  dirPath: string;
  kind: StylePresetKind;
}

export interface StylePresetMigrationResult {
  moved: StylePresetLocation[];
  conflicts: string[];
}

function safeBaseName(value: string): string | null {
  const normalized = value.replace(/\.disabled$/, '').trim();
  return /^[a-zA-Z0-9_-]{1,100}$/.test(normalized) ? normalized : null;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function moveDirectory(source: string, destination: string): Promise<void> {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  try {
    await fs.rename(source, destination);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    await fs.cp(source, destination, { recursive: true });
    await fs.rm(source, { recursive: true, force: true });
  }
}

export function getStylePresetDir(configHome: string, kind: StylePresetKind): string {
  return path.join(configHome, 'style-library', kind);
}

export async function readStylePresetPolicy(
  configHome: string,
  kind: StylePresetKind
): Promise<string> {
  return fs
    .readFile(path.join(getStylePresetDir(configHome, kind), 'POLICY.md'), 'utf-8')
    .catch(() => '');
}

export function classifyStylePresetName(baseName: string): StylePresetKind | null {
  const normalized = baseName.replace(/\.disabled$/, '').toLowerCase();
  if (normalized.startsWith('design-') || DESIGN_STYLE_NAMES.has(normalized)) return 'design';
  if (normalized.startsWith('author-style-') || WRITING_STYLE_NAMES.has(normalized)) {
    return 'writing';
  }
  return null;
}

export async function findStylePresetDirectory(
  configHome: string,
  baseName: string
): Promise<StylePresetLocation | null> {
  const safeName = safeBaseName(baseName);
  if (!safeName) return null;
  for (const kind of ['design', 'writing'] as const) {
    const dirPath = path.join(getStylePresetDir(configHome, kind), safeName);
    if (await pathExists(path.join(dirPath, 'SKILL.md'))) {
      return { baseName: safeName, dirPath, kind };
    }
  }
  return null;
}

export async function listStylePresetDirectories(
  configHome: string,
  requestedKind?: StylePresetKind
): Promise<StylePresetLocation[]> {
  const kinds = requestedKind ? [requestedKind] : (['design', 'writing'] as const);
  const results: StylePresetLocation[] = [];
  for (const kind of kinds) {
    const root = getStylePresetDir(configHome, kind);
    let entries: import('fs').Dirent[] = [];
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const baseName = safeBaseName(entry.name);
      if (!entry.isDirectory() || !baseName) continue;
      const dirPath = path.join(root, entry.name);
      if (await pathExists(path.join(dirPath, 'SKILL.md'))) {
        results.push({ baseName, dirPath, kind });
      }
    }
  }
  return results.sort((a, b) => a.baseName.localeCompare(b.baseName));
}

export async function ensureStylePresetLibrary(
  configHome: string
): Promise<StylePresetMigrationResult> {
  const roots = [path.join(configHome, 'skills'), path.join(configHome, 'skill-catalog')];
  await Promise.all([
    fs.mkdir(getStylePresetDir(configHome, 'design'), { recursive: true }),
    fs.mkdir(getStylePresetDir(configHome, 'writing'), { recursive: true }),
  ]);

  const moved: StylePresetLocation[] = [];
  const conflicts: string[] = [];
  for (const root of roots) {
    let entries: import('fs').Dirent[] = [];
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const baseName = safeBaseName(entry.name);
      if (!baseName) continue;
      const kind = classifyStylePresetName(baseName);
      if (!kind) continue;
      const source = path.join(root, entry.name);
      if (!(await pathExists(path.join(source, 'SKILL.md')))) continue;
      const destination = path.join(getStylePresetDir(configHome, kind), baseName);
      if (await pathExists(destination)) {
        conflicts.push(baseName);
        // The style library is the canonical location. A same-name copy can be
        // recreated by a legacy/external pack after the initial migration; keep
        // the curated preset and remove only that redundant runtime/catalog copy.
        await fs.rm(source, { recursive: true, force: true });
        continue;
      }
      await moveDirectory(source, destination);
      moved.push({ baseName, dirPath: destination, kind });
    }
  }

  return { moved, conflicts };
}
