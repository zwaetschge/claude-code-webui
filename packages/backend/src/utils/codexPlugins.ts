import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { CLI_PROVIDERS } from '../services/cli-providers.js';
import { safeJsonParse } from './json.js';
import { syncCodexConfig } from './codexConfigSync.js';

const execFileAsync = promisify(execFile);
const DEFAULT_MARKETPLACE = 'openai-curated';
const MANAGED_BLOCK_START = '# >>> webui-managed defaults >>>';

interface CodexMarketplaceFile {
  name?: string;
  interface?: {
    displayName?: string;
  };
  plugins?: Array<{
    name: string;
    category?: string;
    source?: {
      source?: string;
      path?: string;
    };
    policy?: {
      installation?: string;
      authentication?: string;
    };
  }>;
}

interface CodexPluginManifest {
  name?: string;
  version?: string;
  description?: string;
  author?: string | { name?: string };
  interface?: {
    displayName?: string;
    shortDescription?: string;
    longDescription?: string;
    category?: string;
    capabilities?: string[];
    brandColor?: string;
    logo?: string;
    composerIcon?: string;
  };
}

export interface CodexPluginInfo {
  id: string;
  name: string;
  marketplace: string;
  displayName: string;
  description: string;
  version: string;
  author?: string;
  category?: string;
  enabled: boolean;
  installed: boolean;
  installPolicy?: string;
  authPolicy?: string;
  capabilities?: string[];
  sourcePath?: string;
  cachePath?: string;
  connectors?: string[];
}

export interface CodexMarketplaceInfo {
  id: string;
  name: string;
  source: { source: 'git' | 'local'; url?: string };
  installLocation: string;
  lastUpdated: string;
  plugins: Array<{
    name: string;
    description: string;
    version: string;
    author?: { name: string };
    category?: string;
  }>;
}

const FALLBACK_OFFICIAL_PLUGINS: Array<{
  name: string;
  displayName: string;
  description: string;
  category: string;
}> = [
  {
    name: 'github',
    displayName: 'GitHub',
    description: 'Inspect repositories, pull requests, issues, and CI checks.',
    category: 'Coding',
  },
  {
    name: 'gmail',
    displayName: 'Gmail',
    description: 'Work with Gmail through the configured app connector.',
    category: 'Productivity',
  },
  {
    name: 'google-calendar',
    displayName: 'Google Calendar',
    description: 'Manage calendar schedules, availability, events, and daily briefs.',
    category: 'Productivity',
  },
  {
    name: 'google-drive',
    displayName: 'Google Drive',
    description: 'Work across Drive, Docs, Sheets, and Slides.',
    category: 'Productivity',
  },
  {
    name: 'figma',
    displayName: 'Figma',
    description: 'Use Figma workflows for design implementation and Code Connect.',
    category: 'Design',
  },
  {
    name: 'notion',
    displayName: 'Notion',
    description: 'Use Notion for specs, research synthesis, and knowledge capture.',
    category: 'Productivity',
  },
  {
    name: 'linear',
    displayName: 'Linear',
    description: 'Find and reference Linear issues and projects.',
    category: 'Productivity',
  },
  {
    name: 'slack',
    displayName: 'Slack',
    description: 'Work with Slack channels, messages, and threads.',
    category: 'Productivity',
  },
  {
    name: 'canva',
    displayName: 'Canva',
    description: 'Search, create, and edit Canva designs.',
    category: 'Design',
  },
];

function codexHome(): string {
  return CLI_PROVIDERS.codex.credentialsPath.replace('~', os.homedir());
}

function configPath(home = codexHome()): string {
  return path.join(home, 'config.toml');
}

function officialMarketplaceRepoDir(home = codexHome()): string {
  return path.join(home, '.tmp', 'plugins');
}

function officialMarketplacePath(home = codexHome()): string {
  return path.join(officialMarketplaceRepoDir(home), '.agents', 'plugins', 'marketplace.json');
}

function splitPluginId(pluginId: string): { name: string; marketplace: string } {
  const [name, marketplace = DEFAULT_MARKETPLACE] = pluginId.split('@');
  if (!name || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) {
    throw new Error('Invalid Codex plugin name');
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(marketplace)) {
    throw new Error('Invalid Codex plugin marketplace');
  }
  return { name, marketplace };
}

function toPluginId(name: string, marketplace = DEFAULT_MARKETPLACE): string {
  return `${name}@${marketplace}`;
}

function parseConfiguredPlugins(toml: string): Map<string, boolean> {
  const result = new Map<string, boolean>();
  let currentPlugin: string | null = null;

  for (const line of toml.split(/\r?\n/)) {
    const sectionMatch = line.match(/^\s*\[plugins\."([^"]+)"\]\s*$/);
    if (sectionMatch?.[1]) {
      currentPlugin = sectionMatch[1];
      result.set(currentPlugin, true);
      continue;
    }

    if (/^\s*\[[^\]]+\]\s*$/.test(line)) {
      currentPlugin = null;
      continue;
    }

    if (!currentPlugin) continue;
    const enabledMatch = line.match(/^\s*enabled\s*=\s*(true|false)\s*(?:#.*)?$/);
    if (enabledMatch?.[1]) {
      result.set(currentPlugin, enabledMatch[1] === 'true');
    }
  }

  return result;
}

function upsertPluginConfig(toml: string, pluginId: string, enabled: boolean): string {
  const lines = toml.split(/\r?\n/);
  const sectionHeader = `[plugins."${pluginId}"]`;
  const sectionRegex = new RegExp(
    `^\\s*\\[plugins\\."${pluginId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\]\\s*$`
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
      section[enabledIndex] = `enabled = ${enabled ? 'true' : 'false'}`;
    } else {
      section.splice(1, 0, `enabled = ${enabled ? 'true' : 'false'}`);
    }

    return [...lines.slice(0, start), ...section, ...lines.slice(end)].join('\n');
  }

  const block = [sectionHeader, `enabled = ${enabled ? 'true' : 'false'}`];
  const managedStart = lines.findIndex((line) => line.trim() === MANAGED_BLOCK_START);
  if (managedStart >= 0) {
    const before = lines.slice(0, managedStart).join('\n').trimEnd();
    const after = lines.slice(managedStart).join('\n').trimStart();
    return `${before ? `${before}\n\n` : ''}${block.join('\n')}\n\n${after}`;
  }

  const existing = toml.trimEnd();
  return `${existing ? `${existing}\n\n` : ''}${block.join('\n')}\n`;
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return safeJsonParse<T>(raw, {} as T);
  } catch {
    return null;
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function getOfficialPluginsRepoCommit(repoDir: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--short=8', 'HEAD'], {
      cwd: repoDir,
      timeout: 5_000,
    });
    return stdout.trim() || 'local';
  } catch {
    return 'local';
  }
}

async function getOfficialPluginsRepoUpdatedAt(repoDir: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('git', ['log', '-1', '--format=%cI'], {
      cwd: repoDir,
      timeout: 5_000,
    });
    const timestamp = stdout.trim();
    return timestamp || undefined;
  } catch {
    return undefined;
  }
}

async function getOfficialPluginsRepoRemote(repoDir: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], {
      cwd: repoDir,
      timeout: 5_000,
    });
    const remote = stdout.trim();
    return remote || undefined;
  } catch {
    return undefined;
  }
}

async function getCachedPluginPath(
  home: string,
  marketplace: string,
  pluginName: string
): Promise<string | undefined> {
  const pluginCacheDir = path.join(home, 'plugins', 'cache', marketplace, pluginName);
  try {
    const entries = await fs.readdir(pluginCacheDir, { withFileTypes: true });
    const dirs = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse();
    if (dirs[0]) {
      return path.join(pluginCacheDir, dirs[0]);
    }
  } catch {
    // Not cached yet
  }
  return undefined;
}

async function readConnectors(pluginDir?: string): Promise<string[] | undefined> {
  if (!pluginDir) return undefined;
  const appJson = await readJsonFile<{ apps?: Record<string, unknown> }>(
    path.join(pluginDir, '.app.json')
  );
  const connectors = appJson?.apps ? Object.keys(appJson.apps) : [];
  return connectors.length > 0 ? connectors : undefined;
}

function authorName(author?: CodexPluginManifest['author']): string | undefined {
  if (!author) return undefined;
  if (typeof author === 'string') return author;
  return author.name;
}

async function buildPluginInfo(input: {
  name: string;
  marketplace: string;
  category?: string;
  installPolicy?: string;
  authPolicy?: string;
  sourcePath?: string;
  cachePath?: string;
  configured?: boolean;
  enabled?: boolean;
}): Promise<CodexPluginInfo> {
  const manifestPath = input.sourcePath || input.cachePath;
  const manifest = manifestPath
    ? await readJsonFile<CodexPluginManifest>(
        path.join(manifestPath, '.codex-plugin', 'plugin.json')
      )
    : null;
  const fallback = FALLBACK_OFFICIAL_PLUGINS.find((plugin) => plugin.name === input.name);
  const displayName =
    manifest?.interface?.displayName || fallback?.displayName || input.name.replace(/-/g, ' ');
  const description =
    manifest?.description ||
    manifest?.interface?.shortDescription ||
    manifest?.interface?.longDescription ||
    fallback?.description ||
    '';
  const connectorSource = input.cachePath || input.sourcePath;

  return {
    id: toPluginId(input.name, input.marketplace),
    name: input.name,
    marketplace: input.marketplace,
    displayName,
    description,
    version: manifest?.version || 'unknown',
    author: authorName(manifest?.author),
    category: input.category || manifest?.interface?.category || fallback?.category,
    enabled: input.enabled ?? false,
    installed: Boolean(input.configured || input.cachePath),
    installPolicy: input.installPolicy,
    authPolicy: input.authPolicy,
    capabilities: manifest?.interface?.capabilities,
    sourcePath: input.sourcePath,
    cachePath: input.cachePath,
    connectors: await readConnectors(connectorSource),
  };
}

async function listOfficialMarketplacePlugins(
  home: string,
  configured: Map<string, boolean>
): Promise<Map<string, CodexPluginInfo>> {
  const plugins = new Map<string, CodexPluginInfo>();
  const repoDir = officialMarketplaceRepoDir(home);
  const marketplacePath = officialMarketplacePath(home);
  const marketplace = await readJsonFile<CodexMarketplaceFile>(marketplacePath);
  const marketplaceId = marketplace?.name || DEFAULT_MARKETPLACE;

  if (!marketplace?.plugins?.length) {
    for (const fallback of FALLBACK_OFFICIAL_PLUGINS) {
      const id = toPluginId(fallback.name, DEFAULT_MARKETPLACE);
      const cachePath = await getCachedPluginPath(home, DEFAULT_MARKETPLACE, fallback.name);
      plugins.set(
        id,
        await buildPluginInfo({
          name: fallback.name,
          marketplace: DEFAULT_MARKETPLACE,
          category: fallback.category,
          cachePath,
          configured: configured.has(id),
          enabled: configured.get(id) ?? false,
        })
      );
    }
    return plugins;
  }

  for (const entry of marketplace.plugins) {
    if (!entry.name) continue;
    const id = toPluginId(entry.name, marketplaceId);
    const sourcePath =
      entry.source?.source === 'local' && entry.source.path
        ? path.resolve(repoDir, entry.source.path)
        : undefined;
    const cachePath = await getCachedPluginPath(home, marketplaceId, entry.name);
    plugins.set(
      id,
      await buildPluginInfo({
        name: entry.name,
        marketplace: marketplaceId,
        category: entry.category,
        installPolicy: entry.policy?.installation,
        authPolicy: entry.policy?.authentication,
        sourcePath: sourcePath && (await pathExists(sourcePath)) ? sourcePath : undefined,
        cachePath,
        configured: configured.has(id),
        enabled: configured.get(id) ?? false,
      })
    );
  }

  return plugins;
}

async function addCachedPlugins(
  home: string,
  configured: Map<string, boolean>,
  plugins: Map<string, CodexPluginInfo>
): Promise<void> {
  const cacheRoot = path.join(home, 'plugins', 'cache');
  let marketplaceEntries: string[] = [];
  try {
    marketplaceEntries = await fs.readdir(cacheRoot);
  } catch {
    return;
  }

  for (const marketplace of marketplaceEntries) {
    const marketplaceDir = path.join(cacheRoot, marketplace);
    let pluginEntries: string[] = [];
    try {
      pluginEntries = await fs.readdir(marketplaceDir);
    } catch {
      continue;
    }

    for (const name of pluginEntries) {
      const id = toPluginId(name, marketplace);
      if (plugins.has(id)) continue;
      const cachePath = await getCachedPluginPath(home, marketplace, name);
      plugins.set(
        id,
        await buildPluginInfo({
          name,
          marketplace,
          cachePath,
          configured: configured.has(id),
          enabled: configured.get(id) ?? false,
        })
      );
    }
  }
}

async function ensurePluginCached(home: string, name: string, marketplace: string): Promise<void> {
  if (marketplace !== DEFAULT_MARKETPLACE) return;
  const repoDir = officialMarketplaceRepoDir(home);
  const sourcePath = path.join(repoDir, 'plugins', name);
  if (!(await pathExists(sourcePath))) return;

  const commit = await getOfficialPluginsRepoCommit(repoDir);
  const destination = path.join(home, 'plugins', 'cache', marketplace, name, commit);
  if (await pathExists(destination)) return;

  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.cp(sourcePath, destination, { recursive: true });
}

export async function listCodexPlugins(): Promise<CodexPluginInfo[]> {
  const home = codexHome();
  let toml = '';
  try {
    toml = await fs.readFile(configPath(home), 'utf-8');
  } catch {
    // First run; no plugins configured yet
  }

  const configured = parseConfiguredPlugins(toml);
  const plugins = await listOfficialMarketplacePlugins(home, configured);
  await addCachedPlugins(home, configured, plugins);

  for (const [pluginId, enabled] of configured) {
    if (plugins.has(pluginId)) continue;
    const { name, marketplace } = splitPluginId(pluginId);
    const cachePath = await getCachedPluginPath(home, marketplace, name);
    plugins.set(
      pluginId,
      await buildPluginInfo({
        name,
        marketplace,
        cachePath,
        configured: true,
        enabled,
      })
    );
  }

  return Array.from(plugins.values()).sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    if (a.installed !== b.installed) return a.installed ? -1 : 1;
    return a.displayName.localeCompare(b.displayName);
  });
}

export async function listCodexMarketplaces(): Promise<CodexMarketplaceInfo[]> {
  const home = codexHome();
  const repoDir = officialMarketplaceRepoDir(home);
  const marketplace = await readJsonFile<CodexMarketplaceFile>(officialMarketplacePath(home));
  const marketplaceId = marketplace?.name || DEFAULT_MARKETPLACE;
  const remoteUrl = await getOfficialPluginsRepoRemote(repoDir);
  const repoTimestamp = await getOfficialPluginsRepoUpdatedAt(repoDir);
  let lastUpdated = repoTimestamp;

  if (!lastUpdated) {
    try {
      const stat = await fs.stat(officialMarketplacePath(home));
      lastUpdated = stat.mtime.toISOString();
    } catch {
      lastUpdated = new Date(0).toISOString();
    }
  }

  const plugins = (await listCodexPlugins())
    .filter((plugin) => plugin.marketplace === marketplaceId)
    .map((plugin) => ({
      name: plugin.name,
      description: plugin.description,
      version: plugin.version,
      author: plugin.author ? { name: plugin.author } : undefined,
      category: plugin.category,
    }));

  return [
    {
      id: marketplaceId,
      name: marketplace?.interface?.displayName || marketplaceId,
      source: remoteUrl ? { source: 'git', url: remoteUrl } : { source: 'local' },
      installLocation: repoDir,
      lastUpdated,
      plugins,
    },
  ];
}

export async function refreshCodexMarketplace(
  marketplaceId: string
): Promise<CodexMarketplaceInfo> {
  const home = codexHome();
  const repoDir = officialMarketplaceRepoDir(home);
  const marketplace = await readJsonFile<CodexMarketplaceFile>(officialMarketplacePath(home));
  const currentMarketplaceId = marketplace?.name || DEFAULT_MARKETPLACE;
  if (marketplaceId !== currentMarketplaceId) {
    throw new Error('Unknown Codex marketplace');
  }

  const remoteUrl = await getOfficialPluginsRepoRemote(repoDir);
  if (remoteUrl) {
    await execFileAsync('git', ['pull', '--ff-only'], {
      cwd: repoDir,
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    });
  }

  const marketplaces = await listCodexMarketplaces();
  const refreshed = marketplaces.find((item) => item.id === marketplaceId);
  if (!refreshed) {
    throw new Error('Codex marketplace refresh failed');
  }
  return refreshed;
}

export async function installCodexPlugin(
  pluginName: string,
  marketplaceId: string
): Promise<CodexPluginInfo[]> {
  return setCodexPluginEnabled(toPluginId(pluginName, marketplaceId), true);
}

export async function setCodexPluginEnabled(
  pluginId: string,
  enabled: boolean
): Promise<CodexPluginInfo[]> {
  const home = codexHome();
  const { name, marketplace } = splitPluginId(pluginId);

  await syncCodexConfig({ codexHome: home });
  if (enabled) {
    await ensurePluginCached(home, name, marketplace);
  }

  const filePath = configPath(home);
  let toml = '';
  try {
    toml = await fs.readFile(filePath, 'utf-8');
  } catch {
    // syncCodexConfig should have created it, but keep this path safe
  }

  const updated = upsertPluginConfig(toml, toPluginId(name, marketplace), enabled);
  await fs.mkdir(home, { recursive: true });
  await fs.writeFile(filePath, updated.endsWith('\n') ? updated : `${updated}\n`, 'utf-8');

  return listCodexPlugins();
}
