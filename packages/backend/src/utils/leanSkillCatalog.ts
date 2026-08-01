import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { resolveConfigHome } from './configPaths.js';
import { safeJsonParse } from './json.js';
import { readRetiredSkillNames, readSkillAliases, resolveSkillAlias } from './skillAliases.js';

const STATE_VERSION = 1;
const STATE_FILE = 'skill-catalog-state.json';
const reconcilePromises = new Map<string, Promise<LeanSkillCatalogResult>>();

export const DEFAULT_ACTIVE_SKILLS = [
  'api-design',
  'capability-catalog',
  'debugging-playbook',
  'devops-deploy',
  'documentation-writer',
  'frontend-design',
  'performance-tuning',
  'refactor-guide',
  'security-review',
  'testing-playbook',
] as const;

interface SkillCatalogState {
  version: number;
  activeSkills: string[];
}

export interface LeanSkillCatalogResult {
  active: number;
  catalog: number;
  movedToActive: number;
  movedToCatalog: number;
  migratedLegacyCodex: number;
  migratedLegacyCodexAgents: number;
  prunedObsolete: number;
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

export function getSkillCatalogDir(configHome: string): string {
  return path.join(configHome, 'skill-catalog');
}

function getStatePath(configHome: string): string {
  return path.join(configHome, 'integrations', STATE_FILE);
}

async function readState(configHome: string): Promise<SkillCatalogState> {
  try {
    const parsed = safeJsonParse<SkillCatalogState | null>(
      await fs.readFile(getStatePath(configHome), 'utf-8'),
      null
    );
    if (parsed?.version === STATE_VERSION && Array.isArray(parsed.activeSkills)) {
      return {
        version: STATE_VERSION,
        activeSkills: Array.from(
          new Set(parsed.activeSkills.map(safeBaseName).filter((name): name is string => !!name))
        ).sort(),
      };
    }
  } catch {
    // First lean-catalog run.
  }

  return {
    version: STATE_VERSION,
    activeSkills: [...DEFAULT_ACTIVE_SKILLS],
  };
}

async function writeState(configHome: string, state: SkillCatalogState): Promise<void> {
  const statePath = getStatePath(configHome);
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(
    statePath,
    `${JSON.stringify(
      {
        version: STATE_VERSION,
        activeSkills: Array.from(new Set(state.activeSkills)).sort(),
      },
      null,
      2
    )}\n`,
    'utf-8'
  );
}

async function pathsEquivalent(source: string, destination: string): Promise<boolean> {
  try {
    const [sourceStat, destinationStat] = await Promise.all([
      fs.lstat(source),
      fs.lstat(destination),
    ]);
    if (sourceStat.isSymbolicLink() || destinationStat.isSymbolicLink()) {
      if (!sourceStat.isSymbolicLink() || !destinationStat.isSymbolicLink()) return false;
      const [sourceTarget, destinationTarget] = await Promise.all([
        fs.readlink(source),
        fs.readlink(destination),
      ]);
      return sourceTarget === destinationTarget;
    }
    if (sourceStat.isFile() || destinationStat.isFile()) {
      if (!sourceStat.isFile() || !destinationStat.isFile()) return false;
      if (sourceStat.size !== destinationStat.size) return false;
      const [sourceContent, destinationContent] = await Promise.all([
        fs.readFile(source),
        fs.readFile(destination),
      ]);
      return sourceContent.equals(destinationContent);
    }
    if (!sourceStat.isDirectory() || !destinationStat.isDirectory()) return false;

    const [sourceEntries, destinationEntries] = await Promise.all([
      fs.readdir(source),
      fs.readdir(destination),
    ]);
    sourceEntries.sort();
    destinationEntries.sort();
    if (
      sourceEntries.length !== destinationEntries.length ||
      sourceEntries.some((entry, index) => entry !== destinationEntries[index])
    ) {
      return false;
    }
    for (const entry of sourceEntries) {
      if (!(await pathsEquivalent(path.join(source, entry), path.join(destination, entry)))) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

async function moveDirectory(source: string, destination: string): Promise<boolean> {
  if (!(await pathExists(source))) return false;
  try {
    if (await pathExists(destination)) {
      if (!(await pathsEquivalent(source, destination))) return false;
      await fs.rm(source, { recursive: true, force: true });
      return true;
    }

    await fs.mkdir(path.dirname(destination), { recursive: true });
    try {
      await fs.rename(source, destination);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
      await fs.cp(source, destination, { recursive: true });
      await fs.rm(source, { recursive: true, force: true });
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
  return true;
}

async function skillDirectoryNames(root: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const names: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === '.system') continue;
      if (await pathExists(path.join(root, entry.name, 'SKILL.md'))) names.push(entry.name);
    }
    return names.sort();
  } catch {
    return [];
  }
}

function shouldMigrateDefaultCodexHome(configHome: string): boolean {
  if (process.env.PLUM_LEAN_SKILL_MIGRATION_TEST === '1') return true;
  return path.resolve(configHome) === path.resolve(resolveConfigHome());
}

function codexSkillsDir(): string {
  const configured = process.env.CODEX_HOME?.trim();
  const home = configured
    ? path.resolve(configured.replace(/^~(?=\/|$)/, os.homedir()))
    : path.join(os.homedir(), '.codex');
  return path.join(home, 'skills');
}

function codexAgentsDir(): string {
  return path.join(path.dirname(codexSkillsDir()), 'agents');
}

async function migrateLegacyCodexAgents(configHome: string): Promise<number> {
  if (!shouldMigrateDefaultCodexHome(configHome)) return 0;
  const legacyRoot = codexAgentsDir();
  const canonicalRoot = path.join(configHome, 'agents');
  if (path.resolve(legacyRoot) === path.resolve(canonicalRoot)) return 0;

  let entries: import('fs').Dirent[] = [];
  try {
    entries = await fs.readdir(legacyRoot, { withFileTypes: true });
  } catch {
    return 0;
  }

  await fs.mkdir(canonicalRoot, { recursive: true });
  let migrated = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const source = path.join(legacyRoot, entry.name);
    const destination = path.join(canonicalRoot, entry.name);
    if (await moveDirectory(source, destination)) migrated += 1;
  }
  return migrated;
}

async function migrateLegacyCodexSkills(
  configHome: string,
  activeNames: Set<string>
): Promise<number> {
  if (!shouldMigrateDefaultCodexHome(configHome)) return 0;

  const legacyRoot = codexSkillsDir();
  const activeRoot = path.join(configHome, 'skills');
  const catalogRoot = getSkillCatalogDir(configHome);
  if (path.resolve(legacyRoot) === path.resolve(activeRoot)) return 0;

  let migrated = 0;
  for (const entryName of await skillDirectoryNames(legacyRoot)) {
    const baseName = safeBaseName(entryName);
    if (!baseName) continue;
    const destinationRoot = activeNames.has(baseName) ? activeRoot : catalogRoot;
    let destination = path.join(destinationRoot, baseName);

    if (await pathExists(destination)) {
      const legacySkill = await fs
        .readFile(path.join(legacyRoot, entryName, 'SKILL.md'), 'utf-8')
        .catch(() => '');
      const canonicalSkill = await fs
        .readFile(path.join(destination, 'SKILL.md'), 'utf-8')
        .catch(() => '');
      if (legacySkill !== canonicalSkill) {
        destination = path.join(catalogRoot, `${baseName}-codex-legacy`);
      }
    }

    if (await moveDirectory(path.join(legacyRoot, entryName), destination)) migrated += 1;
  }
  return migrated;
}

export async function getActiveSkillNames(configHome: string): Promise<Set<string>> {
  return new Set((await readState(configHome)).activeSkills);
}

function resolveAliasFromMap(aliases: Record<string, string>, requestedName: string): string {
  let current = requestedName;
  const seen = new Set<string>();
  for (let depth = 0; depth < 8; depth += 1) {
    const target = aliases[current];
    if (!target || seen.has(target)) break;
    seen.add(current);
    current = target;
  }
  return current;
}

async function pruneObsoleteSkillEntries(
  configHome: string,
  state: SkillCatalogState
): Promise<number> {
  const aliases = await readSkillAliases(configHome);
  const retired = await readRetiredSkillNames(configHome);
  const activeRoot = path.join(configHome, 'skills');
  const runtimeRoots = [activeRoot, getSkillCatalogDir(configHome)];
  const styleRoots = [
    path.join(configHome, 'style-library', 'design'),
    path.join(configHome, 'style-library', 'writing'),
  ];
  const roots = [...runtimeRoots, ...styleRoots];
  const runtimeNames = new Set<string>();
  const availableNames = new Set<string>();
  for (const root of roots) {
    for (const entryName of await skillDirectoryNames(root)) {
      const baseName = safeBaseName(entryName);
      if (!baseName) continue;
      availableNames.add(baseName);
      if (runtimeRoots.includes(root)) runtimeNames.add(baseName);
    }
  }

  const removableAliases = new Set<string>();
  for (const alias of Object.keys(aliases)) {
    const canonicalName = resolveAliasFromMap(aliases, alias);
    if (canonicalName !== alias && availableNames.has(canonicalName)) {
      removableAliases.add(alias);
    }
  }
  const obsoleteNames = new Set([...removableAliases, ...retired]);
  let pruned = 0;

  for (const name of obsoleteNames) {
    for (const root of roots) {
      const candidates = root === activeRoot ? [name, `${name}.disabled`] : [name];
      for (const candidate of candidates) {
        const candidatePath = path.join(root, candidate);
        if (!(await pathExists(candidatePath))) continue;
        await fs.rm(candidatePath, { recursive: true, force: true });
        pruned += 1;
      }
    }
  }

  const normalizedActiveNames = new Set<string>();
  for (const name of state.activeSkills) {
    if (retired.has(name)) continue;
    if (!removableAliases.has(name)) {
      normalizedActiveNames.add(name);
      continue;
    }
    const canonicalName = resolveAliasFromMap(aliases, name);
    if (runtimeNames.has(canonicalName)) normalizedActiveNames.add(canonicalName);
  }
  state.activeSkills = [...normalizedActiveNames];
  return pruned;
}

async function reconcileLeanSkillCatalog(configHome: string): Promise<LeanSkillCatalogResult> {
  const activeRoot = path.join(configHome, 'skills');
  const catalogRoot = getSkillCatalogDir(configHome);
  const state = await readState(configHome);
  await Promise.all([
    fs.mkdir(activeRoot, { recursive: true }),
    fs.mkdir(catalogRoot, { recursive: true }),
  ]);
  let prunedObsolete = await pruneObsoleteSkillEntries(configHome, state);
  const activeNames = new Set(state.activeSkills);

  let movedToCatalog = 0;
  let movedToActive = 0;

  for (const entryName of await skillDirectoryNames(activeRoot)) {
    const baseName = safeBaseName(entryName);
    if (!baseName) continue;
    if (activeNames.has(baseName) && !entryName.endsWith('.disabled')) continue;
    if (await moveDirectory(path.join(activeRoot, entryName), path.join(catalogRoot, baseName))) {
      movedToCatalog += 1;
    }
  }

  for (const entryName of await skillDirectoryNames(catalogRoot)) {
    const baseName = safeBaseName(entryName);
    if (!baseName || !activeNames.has(baseName)) continue;
    if (await moveDirectory(path.join(catalogRoot, entryName), path.join(activeRoot, baseName))) {
      movedToActive += 1;
    }
  }

  const migratedLegacyCodex = await migrateLegacyCodexSkills(configHome, activeNames);
  const migratedLegacyCodexAgents = await migrateLegacyCodexAgents(configHome);
  prunedObsolete += await pruneObsoleteSkillEntries(configHome, state);
  await writeState(configHome, state);

  return {
    active: (await skillDirectoryNames(activeRoot)).length,
    catalog: (await skillDirectoryNames(catalogRoot)).length,
    movedToActive,
    movedToCatalog,
    migratedLegacyCodex,
    migratedLegacyCodexAgents,
    prunedObsolete,
  };
}

export async function ensureLeanSkillCatalog(configHome: string): Promise<LeanSkillCatalogResult> {
  const key = path.resolve(configHome);
  const existing = reconcilePromises.get(key);
  if (existing) return existing;

  const pending = reconcileLeanSkillCatalog(configHome).finally(() => {
    reconcilePromises.delete(key);
  });
  reconcilePromises.set(key, pending);
  return pending;
}

export async function setSkillRuntimeEnabled(
  configHome: string,
  skillName: string,
  enabled: boolean
): Promise<boolean> {
  const requestedName = safeBaseName(skillName);
  if (!requestedName) return false;
  const resolvedName = safeBaseName(await resolveSkillAlias(configHome, requestedName));
  if (!resolvedName) return false;

  const activeRoot = path.join(configHome, 'skills');
  const catalogRoot = getSkillCatalogDir(configHome);
  let baseName = resolvedName;
  let activePath = path.join(activeRoot, baseName);
  let catalogPath = path.join(catalogRoot, baseName);
  if (
    !(await pathExists(activePath)) &&
    !(await pathExists(catalogPath)) &&
    requestedName !== resolvedName
  ) {
    baseName = requestedName;
    activePath = path.join(activeRoot, baseName);
    catalogPath = path.join(catalogRoot, baseName);
  }
  if (!(await pathExists(activePath)) && !(await pathExists(catalogPath))) return false;

  const state = await readState(configHome);
  const activeNames = new Set(state.activeSkills);
  if (enabled) activeNames.add(baseName);
  else activeNames.delete(baseName);
  state.activeSkills = Array.from(activeNames);
  await writeState(configHome, state);
  await ensureLeanSkillCatalog(configHome);
  return true;
}

export async function registerActiveSkill(configHome: string, skillName: string): Promise<void> {
  const baseName = safeBaseName(skillName);
  if (!baseName) return;
  const state = await readState(configHome);
  state.activeSkills = Array.from(new Set([...state.activeSkills, baseName]));
  await writeState(configHome, state);
}

export async function unregisterSkill(configHome: string, skillName: string): Promise<void> {
  const baseName = safeBaseName(skillName);
  if (!baseName) return;
  const state = await readState(configHome);
  state.activeSkills = state.activeSkills.filter((entry) => entry !== baseName);
  await writeState(configHome, state);
}

export async function unregisterSkills(configHome: string, skillNames: string[]): Promise<void> {
  const names = new Set(skillNames.map(safeBaseName).filter((name): name is string => !!name));
  if (names.size === 0) return;
  const state = await readState(configHome);
  state.activeSkills = state.activeSkills.filter((entry) => !names.has(entry));
  await writeState(configHome, state);
}

export async function findSkillDirectory(
  configHome: string,
  skillName: string
): Promise<{ dirPath: string; enabled: boolean; runtimeConfigurable: boolean } | null> {
  const requestedName = safeBaseName(skillName);
  if (!requestedName) return null;
  const resolvedName = safeBaseName(await resolveSkillAlias(configHome, requestedName));
  if (!resolvedName) return null;

  for (const baseName of new Set([resolvedName, requestedName])) {
    const candidates = [
      {
        dirPath: path.join(configHome, 'skills', baseName),
        enabled: true,
        runtimeConfigurable: true,
      },
      {
        dirPath: path.join(getSkillCatalogDir(configHome), baseName),
        enabled: false,
        runtimeConfigurable: true,
      },
      {
        dirPath: path.join(configHome, 'skills', `${baseName}.disabled`),
        enabled: false,
        runtimeConfigurable: true,
      },
      {
        dirPath: path.join(configHome, 'style-library', 'design', baseName),
        enabled: false,
        runtimeConfigurable: false,
      },
      {
        dirPath: path.join(configHome, 'style-library', 'writing', baseName),
        enabled: false,
        runtimeConfigurable: false,
      },
    ];
    for (const candidate of candidates) {
      if (await pathExists(path.join(candidate.dirPath, 'SKILL.md'))) return candidate;
    }
  }
  return null;
}
