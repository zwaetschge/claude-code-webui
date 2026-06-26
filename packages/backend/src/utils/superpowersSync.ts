import { execFile } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import type { CLIProvider } from '../services/cli-providers.js';
import { resolveConfigHome } from './configPaths.js';
import { safeJsonParse } from './json.js';

const execFileAsync = promisify(execFile);

const SUPERPOWERS_REPO_URL = 'https://github.com/obra/Superpowers.git';
const SUPERPOWERS_REF = 'main';
const MANAGED_SOURCE = 'obra/Superpowers';
const MANAGED_MARKER = '.plum-superpowers.json';
const CODEX_MANAGED_MARKETPLACE = 'plum-managed';
const CODEX_MANAGED_PLUGIN_NAME = 'superpowers';
const CODEX_MANAGED_PLUGIN_ID = `${CODEX_MANAGED_PLUGIN_NAME}@${CODEX_MANAGED_MARKETPLACE}`;
const DEFAULT_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_GIT_TIMEOUT_MS = 45_000;

const lastSyncMap = new Map<string, number>();

interface SuperpowersManifest {
  version?: string;
}

interface SuperpowersMarker {
  source: typeof MANAGED_SOURCE;
  repoUrl: string;
  ref: string;
  commit: string | null;
  version: string | null;
  installedAt: string;
}

export interface SuperpowersSyncResult {
  enabled: boolean;
  sourceDir?: string;
  skillsDir?: string;
  version?: string | null;
  commit?: string | null;
  installed: number;
  updated: number;
  skipped: string[];
  removed: number;
}

function isSuperpowersEnabled(): boolean {
  const raw = process.env.SUPERPOWERS_ENABLED;
  if (!raw) return true;
  const normalized = raw.trim().toLowerCase();
  return !(normalized === '0' || normalized === 'false' || normalized === 'off');
}

function syncIntervalMs(): number {
  const raw = Number(process.env.SUPERPOWERS_SYNC_INTERVAL_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_SYNC_INTERVAL_MS;
}

function gitTimeoutMs(): number {
  const raw = Number(process.env.SUPERPOWERS_GIT_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_GIT_TIMEOUT_MS;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function expandHome(input: string): string {
  if (input === '~') return os.homedir();
  if (input.startsWith('~/')) return path.join(os.homedir(), input.slice(2));
  return input;
}

async function execGit(args: string[], cwd?: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    timeout: gitTimeoutMs(),
    maxBuffer: 5 * 1024 * 1024,
  });
  return stdout.trim();
}

async function readTextFile(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return '';
  }
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return safeJsonParse<T>(await fs.readFile(filePath, 'utf-8'), {} as T);
  } catch {
    return null;
  }
}

async function readVersion(sourceDir: string): Promise<string | null> {
  const manifest =
    (await readJsonFile<SuperpowersManifest>(
      path.join(sourceDir, '.codex-plugin', 'plugin.json')
    )) || (await readJsonFile<SuperpowersManifest>(path.join(sourceDir, 'package.json')));
  return manifest?.version || null;
}

async function readCommit(sourceDir: string): Promise<string | null> {
  try {
    return await execGit(['rev-parse', 'HEAD'], sourceDir);
  } catch {
    return null;
  }
}

function codexHome(): string {
  const configured =
    process.env.CODEX_HOME?.trim() || process.env.CLI_PROVIDER_CODEX_CREDENTIALS_PATH?.trim();
  return path.resolve(expandHome(configured || path.join(os.homedir(), '.codex')));
}

function opencodeConfigPath(): string {
  const configured = process.env.OPENCODE_CONFIG_DIR?.trim();
  const configDir = configured
    ? expandHome(configured)
    : path.join(os.homedir(), '.config', 'opencode');
  return path.join(path.resolve(configDir), 'opencode.json');
}

function sourceDirFor(configHome: string): string {
  const override = process.env.SUPERPOWERS_CACHE_DIR?.trim();
  if (override) return path.resolve(override);
  return path.join(configHome, 'integrations', 'superpowers');
}

async function copyPluginPackage(sourceDir: string, targetDir: string): Promise<void> {
  await fs.rm(targetDir, { recursive: true, force: true });
  await fs.mkdir(path.dirname(targetDir), { recursive: true });
  await fs.cp(sourceDir, targetDir, {
    recursive: true,
    filter: (source) => {
      const relative = path.relative(sourceDir, source);
      const first = relative.split(path.sep)[0];
      return first !== '.git' && first !== 'node_modules';
    },
  });
}

function upsertCodexPluginConfig(toml: string): string {
  const lines = toml.split(/\r?\n/);
  const sectionHeader = `[plugins."${CODEX_MANAGED_PLUGIN_ID}"]`;
  const sectionRegex = new RegExp(
    `^\\s*\\[plugins\\."${CODEX_MANAGED_PLUGIN_ID.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\]\\s*$`
  );
  const start = lines.findIndex((line) => sectionRegex.test(line));

  if (start >= 0) {
    let end = lines.length;
    for (let index = start + 1; index < lines.length; index += 1) {
      if (/^\s*\[[^\]]+\]\s*$/.test(lines[index] || '')) {
        end = index;
        break;
      }
    }

    const section = lines.slice(start, end);
    const enabledIndex = section.findIndex((line) => /^\s*enabled\s*=/.test(line));
    if (enabledIndex >= 0) {
      section[enabledIndex] = 'enabled = true';
    } else {
      section.splice(1, 0, 'enabled = true');
    }
    return [...lines.slice(0, start), ...section, ...lines.slice(end)].join('\n').trimEnd();
  }

  const block = `${sectionHeader}\nenabled = true`;
  const existing = toml.trimEnd();
  return existing ? `${existing}\n\n${block}` : block;
}

async function syncCodexSuperpowersPlugin(
  sourceDir: string,
  marker: SuperpowersMarker
): Promise<void> {
  const home = codexHome();
  const cacheKey = marker.commit || marker.version || 'local';
  const cacheDir = path.join(
    home,
    'plugins',
    'cache',
    CODEX_MANAGED_MARKETPLACE,
    CODEX_MANAGED_PLUGIN_NAME,
    cacheKey
  );
  const markerPath = path.join(cacheDir, MANAGED_MARKER);
  const currentMarker = await readJsonFile<SuperpowersMarker>(markerPath);

  if (
    !currentMarker ||
    currentMarker.commit !== marker.commit ||
    currentMarker.version !== marker.version ||
    currentMarker.repoUrl !== marker.repoUrl ||
    currentMarker.ref !== marker.ref
  ) {
    await copyPluginPackage(sourceDir, cacheDir);
    await fs.writeFile(markerPath, `${JSON.stringify(marker, null, 2)}\n`, 'utf-8');
  }

  const configFile = path.join(home, 'config.toml');
  const current = await readTextFile(configFile);
  const next = `${upsertCodexPluginConfig(current)}\n`;
  await fs.mkdir(path.dirname(configFile), { recursive: true });
  if (current !== next) await fs.writeFile(configFile, next, 'utf-8');
}

function hasSuperpowersOpenCodePlugin(entry: string, sourceDir: string): boolean {
  const normalized = entry.trim().toLowerCase();
  if (!normalized) return false;
  if (path.resolve(expandHome(entry)) === sourceDir) return true;
  return (
    normalized.includes('github.com/obra/superpowers') ||
    normalized.includes('github.com/obra/superpowers.git')
  );
}

async function syncOpenCodeSuperpowersPlugin(sourceDir: string): Promise<void> {
  const filePath = opencodeConfigPath();
  const config = (await readJsonFile<Record<string, unknown>>(filePath)) || {};
  const existingPlugins = Array.isArray(config.plugin)
    ? config.plugin.filter((value): value is string => typeof value === 'string')
    : [];

  if (!existingPlugins.some((entry) => hasSuperpowersOpenCodePlugin(entry, sourceDir))) {
    existingPlugins.push(sourceDir);
  }
  config.plugin = existingPlugins;

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
}

async function syncNativeProviderArtifacts(
  sourceDir: string,
  marker: SuperpowersMarker
): Promise<void> {
  await syncCodexSuperpowersPlugin(sourceDir, marker);
  await syncOpenCodeSuperpowersPlugin(sourceDir);
}

async function cloneManagedSource(sourceDir: string, repoUrl: string, ref: string): Promise<void> {
  const parent = path.dirname(sourceDir);
  const tmpDir = path.join(parent, `.superpowers-${process.pid}-${Date.now()}`);
  await fs.mkdir(parent, { recursive: true });
  await fs.rm(tmpDir, { recursive: true, force: true });
  try {
    await execGit(['clone', '--depth=1', repoUrl, tmpDir]);
    await execGit(['fetch', '--depth=1', 'origin', ref], tmpDir);
    await execGit(['checkout', '--force', 'FETCH_HEAD'], tmpDir);
    await fs.rm(sourceDir, { recursive: true, force: true });
    await fs.rename(tmpDir, sourceDir);
  } catch (err) {
    await fs.rm(tmpDir, { recursive: true, force: true });
    throw err;
  }
}

async function updateManagedSource(sourceDir: string, repoUrl: string, ref: string): Promise<void> {
  try {
    await execGit(['remote', 'set-url', 'origin', repoUrl], sourceDir);
    await execGit(['fetch', '--depth=1', 'origin', ref], sourceDir);
    await execGit(['checkout', '--force', 'FETCH_HEAD'], sourceDir);
  } catch (err) {
    if (await pathExists(path.join(sourceDir, 'skills', 'using-superpowers', 'SKILL.md'))) {
      console.warn(`[superpowers] update failed; using cached checkout: ${String(err)}`);
      return;
    }
    throw err;
  }
}

async function ensureSource(configHome: string): Promise<string> {
  const localSource = process.env.SUPERPOWERS_SOURCE_DIR?.trim();
  if (localSource) {
    const resolved = path.resolve(localSource);
    if (!(await pathExists(path.join(resolved, 'skills', 'using-superpowers', 'SKILL.md')))) {
      throw new Error(`SUPERPOWERS_SOURCE_DIR is not a Superpowers checkout: ${resolved}`);
    }
    return resolved;
  }

  const sourceDir = sourceDirFor(configHome);
  const repoUrl = process.env.SUPERPOWERS_REPO_URL?.trim() || SUPERPOWERS_REPO_URL;
  const ref = process.env.SUPERPOWERS_REF?.trim() || SUPERPOWERS_REF;
  const now = Date.now();
  const lastSync = lastSyncMap.get(configHome) || 0;
  const sourceLooksValid = await pathExists(
    path.join(sourceDir, 'skills', 'using-superpowers', 'SKILL.md')
  );

  if (!sourceLooksValid) {
    await cloneManagedSource(sourceDir, repoUrl, ref);
    lastSyncMap.set(configHome, now);
    return sourceDir;
  }

  if (now - lastSync >= syncIntervalMs()) {
    await updateManagedSource(sourceDir, repoUrl, ref);
    lastSyncMap.set(configHome, now);
  }

  return sourceDir;
}

async function readMarker(skillDir: string): Promise<SuperpowersMarker | null> {
  const marker = await readJsonFile<SuperpowersMarker>(path.join(skillDir, MANAGED_MARKER));
  return marker?.source === MANAGED_SOURCE ? marker : null;
}

async function copyManagedSkill(
  sourceSkillDir: string,
  targetSkillDir: string,
  marker: SuperpowersMarker
): Promise<'installed' | 'updated' | 'skipped' | 'unchanged'> {
  const exists = await pathExists(targetSkillDir);
  if (exists) {
    const currentMarker = await readMarker(targetSkillDir);
    if (!currentMarker) return 'skipped';
    if (
      marker.commit &&
      currentMarker.commit === marker.commit &&
      currentMarker.version === marker.version &&
      currentMarker.repoUrl === marker.repoUrl &&
      currentMarker.ref === marker.ref
    ) {
      return 'unchanged';
    }
    await fs.rm(targetSkillDir, { recursive: true, force: true });
  }

  await fs.cp(sourceSkillDir, targetSkillDir, { recursive: true });
  await fs.writeFile(
    path.join(targetSkillDir, MANAGED_MARKER),
    `${JSON.stringify(marker, null, 2)}\n`
  );
  return exists ? 'updated' : 'installed';
}

async function listSourceSkills(sourceSkillsDir: string): Promise<string[]> {
  const entries = await fs.readdir(sourceSkillsDir, { withFileTypes: true });
  const skillNames: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.endsWith('.disabled')) continue;
    const skillFile = path.join(sourceSkillsDir, entry.name, 'SKILL.md');
    if (await pathExists(skillFile)) skillNames.push(entry.name);
  }
  return skillNames.sort();
}

async function pruneRemovedManagedSkills(
  targetSkillsDir: string,
  sourceNames: Set<string>
): Promise<number> {
  let removed = 0;
  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(targetSkillsDir, { withFileTypes: true });
  } catch {
    return 0;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const baseName = entry.name.replace(/\.disabled$/, '');
    if (sourceNames.has(baseName)) continue;
    const target = path.join(targetSkillsDir, entry.name);
    if (!(await readMarker(target))) continue;
    await fs.rm(target, { recursive: true, force: true });
    removed += 1;
  }
  return removed;
}

export async function syncSuperpowers(
  configHome = resolveConfigHome(),
  opts: { quiet?: boolean } = {}
): Promise<SuperpowersSyncResult> {
  if (!isSuperpowersEnabled()) {
    return { enabled: false, installed: 0, updated: 0, skipped: [], removed: 0 };
  }

  const sourceDir = await ensureSource(configHome);
  const sourceSkillsDir = path.join(sourceDir, 'skills');
  const targetSkillsDir = path.join(configHome, 'skills');
  const repoUrl = process.env.SUPERPOWERS_REPO_URL?.trim() || SUPERPOWERS_REPO_URL;
  const ref = process.env.SUPERPOWERS_REF?.trim() || SUPERPOWERS_REF;
  const [version, commit] = await Promise.all([readVersion(sourceDir), readCommit(sourceDir)]);
  const marker: SuperpowersMarker = {
    source: MANAGED_SOURCE,
    repoUrl,
    ref,
    commit,
    version,
    installedAt: new Date().toISOString(),
  };

  await fs.mkdir(targetSkillsDir, { recursive: true });

  const skillNames = await listSourceSkills(sourceSkillsDir);
  const sourceNameSet = new Set(skillNames);
  let installed = 0;
  let updated = 0;
  const skipped: string[] = [];

  for (const skillName of skillNames) {
    const disabledTarget = path.join(targetSkillsDir, `${skillName}.disabled`);
    if (await pathExists(disabledTarget)) {
      skipped.push(`${skillName}.disabled`);
      continue;
    }
    const result = await copyManagedSkill(
      path.join(sourceSkillsDir, skillName),
      path.join(targetSkillsDir, skillName),
      marker
    );
    if (result === 'installed') installed += 1;
    if (result === 'updated') updated += 1;
    if (result === 'skipped') skipped.push(skillName);
  }

  const removed = await pruneRemovedManagedSkills(targetSkillsDir, sourceNameSet);
  await syncNativeProviderArtifacts(sourceDir, marker);

  if (!opts.quiet) {
    const versionLabel = version ? ` v${version}` : '';
    const commitLabel = commit ? ` (${commit.slice(0, 8)})` : '';
    const skippedLabel = skipped.length ? `, skipped existing: ${skipped.join(', ')}` : '';
    console.log(
      `[superpowers] synced${versionLabel}${commitLabel}: ${installed} installed, ${updated} updated, ${removed} removed${skippedLabel}`
    );
  }

  return {
    enabled: true,
    sourceDir,
    skillsDir: targetSkillsDir,
    version,
    commit,
    installed,
    updated,
    skipped,
    removed,
  };
}

function stripFrontmatter(source: string): string {
  const trimmed = source.trimStart();
  if (!trimmed.startsWith('---')) return source.trim();
  const end = trimmed.indexOf('\n---', 3);
  if (end === -1) return source.trim();
  return trimmed.slice(end + 4).trim();
}

function providerSkillInstructions(provider: CLIProvider): string {
  switch (provider) {
    case 'codex':
      return [
        'Codex sees these skills through `~/.agents/skills`, which Plum Code symlinks to `~/.claude/skills`.',
        'Load and follow applicable skills through Codex skill activation. When upstream text says `superpowers:<name>`, use the installed skill named `<name>`.',
        'Plum Code tool mapping for Codex: todos/checklists -> `update_plan`; shell commands, reads, and searches -> `exec_command` with `rg` preferred; file edits -> `apply_patch`; parallel independent tool calls -> `multi_tool_use.parallel`; URL fetches -> web access when available.',
      ].join('\n');
    case 'opencode':
      return [
        'OpenCode discovers these skills through `skills.paths` in `opencode.json`, pointing at `~/.claude/skills`.',
        "Use OpenCode's native `skill` tool to list/load skills. When upstream text says `superpowers:<name>`, use the installed skill named `<name>`.",
        'Tool mapping for OpenCode: todos -> `todowrite`; subagents -> `task` with `subagent_type: "general"`; read files -> `read`; create/edit/delete files -> `apply_patch`; shell -> `bash`; search -> `grep`/`glob`; fetch URL -> `webfetch`.',
      ].join('\n');
    case 'vibe':
      return [
        'Mistral Vibe discovers these skills through `skill_paths` in `config.toml`, pointing at `~/.claude/skills`.',
        "Use Vibe's skill mechanism when available. When upstream text says `superpowers:<name>`, use the installed skill named `<name>`.",
        'Tool mapping for Vibe: todos -> `todo`; subagents -> `task`; read files -> `read_file`; edit/write files -> `search_replace`/`write_file`; shell -> `bash`; search -> `grep`; fetch/search web -> `web_fetch`/`web_search`.',
      ].join('\n');
    case 'claude':
    default:
      return [
        'Claude Code sees these skills in `~/.claude/skills`.',
        'Use the Skill tool for applicable skills. When upstream text says `superpowers:<name>`, use the installed skill named `<name>`.',
      ].join('\n');
  }
}

export async function buildSuperpowersBootstrapContext(
  provider: CLIProvider,
  configHome = resolveConfigHome(provider)
): Promise<string | null> {
  if (!isSuperpowersEnabled()) return null;

  const skillPath = path.join(configHome, 'skills', 'using-superpowers', 'SKILL.md');
  if (!(await pathExists(skillPath))) {
    try {
      await syncSuperpowers(configHome, { quiet: true });
    } catch (err) {
      console.warn(`[superpowers] bootstrap unavailable: ${String(err)}`);
      return null;
    }
  }

  if (!(await pathExists(skillPath))) return null;
  const rawSkill = await fs.readFile(skillPath, 'utf-8');
  const skillBody = stripFrontmatter(rawSkill);
  const displayHome = configHome === path.join(os.homedir(), '.claude') ? '~/.claude' : configHome;

  return [
    '<EXTREMELY_IMPORTANT>',
    'You have Superpowers in Plum Code WebUI.',
    '',
    providerSkillInstructions(provider),
    `Shared skills home: ${displayHome}/skills`,
    '',
    '**Below is the content of the `using-superpowers` skill. It is already loaded for this session; follow it before responding or acting.**',
    '',
    skillBody,
    '</EXTREMELY_IMPORTANT>',
  ].join('\n');
}
