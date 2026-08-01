import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { getActiveSkillNames, getSkillCatalogDir } from './leanSkillCatalog.js';
import { findStylePresetDirectory } from './stylePresetLibrary.js';
import { readRetiredSkillNames, resolveSkillAlias } from './skillAliases.js';
import {
  importSkillFromBuffer,
  parseMarkdownFrontmatter,
  sanitizeSkillName,
} from './skillImport.js';

const DEFAULT_EXTERNAL_SKILLS_DIRS = ['/mnt/user/AI/Skills', '/mnt/unraid/AI/Skills'];
const SKILLS_SYNC_INTERVAL_MS = 60_000;
const lastSyncMap = new Map<string, number>();

interface SyncExternalSkillsOptions {
  externalDirs?: string[];
  force?: boolean;
}

function parseDirList(value?: string): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

async function isDirectory(dirPath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(dirPath);
    return stats.isDirectory();
  } catch {
    return false;
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

async function getExternalSkillsDirs(): Promise<string[]> {
  const envDirs = parseDirList(process.env.WEBUI_SKILLS_DIRS || process.env.CLAUDE_SKILLS_DIRS);
  const candidates = [...envDirs, ...DEFAULT_EXTERNAL_SKILLS_DIRS];
  const unique = Array.from(new Set(candidates.map((dir) => path.resolve(dir))));

  const existing: string[] = [];
  for (const dir of unique) {
    if (await isDirectory(dir)) {
      existing.push(dir);
    }
  }
  return existing;
}

function externalSkillSyncEnabled(): boolean {
  const value = process.env.WEBUI_EXTERNAL_SKILL_SYNC?.trim().toLowerCase();
  return !value || !['0', 'false', 'no', 'off'].includes(value);
}

async function skillExistsAnywhere(
  configHome: string,
  skillName: string,
  activeTargetDir: string,
  catalogTargetDir: string
): Promise<boolean> {
  return (
    (await pathExists(path.join(activeTargetDir, skillName, 'SKILL.md'))) ||
    (await pathExists(path.join(activeTargetDir, `${skillName}.disabled`, 'SKILL.md'))) ||
    (await pathExists(path.join(catalogTargetDir, skillName, 'SKILL.md'))) ||
    !!(await findStylePresetDirectory(configHome, skillName))
  );
}

async function copySkillDirectory(source: string, destination: string): Promise<void> {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.cp(source, destination, {
    recursive: true,
    force: false,
    errorOnExist: true,
  });
}

async function readExternalDirectorySkillName(
  skillFile: string,
  fallbackName: string
): Promise<string> {
  try {
    const content = await fs.readFile(skillFile, 'utf-8');
    const { frontmatter } = parseMarkdownFrontmatter(content);
    return sanitizeSkillName(frontmatter.name || fallbackName) || fallbackName;
  } catch {
    return fallbackName;
  }
}

export async function syncExternalSkills(
  configHome: string,
  options: SyncExternalSkillsOptions = {}
): Promise<void> {
  if (!externalSkillSyncEnabled()) return;

  const now = Date.now();
  const lastSync = lastSyncMap.get(configHome);
  if (!options.force && lastSync && now - lastSync < SKILLS_SYNC_INTERVAL_MS) {
    return;
  }
  lastSyncMap.set(configHome, now);

  let externalDirs: string[];
  if (options.externalDirs) {
    externalDirs = [];
    for (const dir of new Set(options.externalDirs.map((entry) => path.resolve(entry)))) {
      if (await isDirectory(dir)) externalDirs.push(dir);
    }
  } else {
    externalDirs = await getExternalSkillsDirs();
  }
  if (!externalDirs.length) {
    return;
  }

  const activeSkills = await getActiveSkillNames(configHome);
  const retiredSkills = await readRetiredSkillNames(configHome);
  const activeTargetDir = path.join(configHome, 'skills');
  const catalogTargetDir = getSkillCatalogDir(configHome);
  try {
    await Promise.all([
      fs.mkdir(activeTargetDir, { recursive: true }),
      fs.mkdir(catalogTargetDir, { recursive: true }),
    ]);
  } catch (err) {
    console.warn(`[SKILLS] Unable to create skill catalog for ${configHome}: ${String(err)}`);
    return;
  }

  for (const externalDir of externalDirs) {
    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }> = [];
    try {
      entries = await fs.readdir(externalDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(externalDir, entry.name);

      if (entry.isFile() && entry.name.toLowerCase().endsWith('.skill.zip')) {
        const archiveName = sanitizeSkillName(entry.name.replace(/\.skill\.zip$/i, ''));
        if (!archiveName || retiredSkills.has(archiveName)) continue;

        const stagingRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'external-skill-sync-'));
        try {
          const result = await importSkillFromBuffer(
            await fs.readFile(entryPath),
            entry.name,
            stagingRoot,
            { conflict: 'skip' }
          );
          if (result.status !== 'imported') continue;
          const skillName = path.basename(result.skill.dirPath);
          if (retiredSkills.has(skillName)) continue;

          const archiveCanonicalName = await resolveSkillAlias(configHome, archiveName);
          if (
            archiveCanonicalName !== archiveName &&
            (await skillExistsAnywhere(
              configHome,
              archiveCanonicalName,
              activeTargetDir,
              catalogTargetDir
            ))
          ) {
            continue;
          }
          const canonicalName = await resolveSkillAlias(configHome, skillName);
          if (
            canonicalName !== skillName &&
            (await skillExistsAnywhere(
              configHome,
              canonicalName,
              activeTargetDir,
              catalogTargetDir
            ))
          ) {
            continue;
          }
          if (await skillExistsAnywhere(configHome, skillName, activeTargetDir, catalogTargetDir)) {
            continue;
          }

          const targetDir = activeSkills.has(skillName) ? activeTargetDir : catalogTargetDir;
          await copySkillDirectory(result.skill.dirPath, path.join(targetDir, skillName));
        } catch (err) {
          console.warn(`[SKILLS] Failed to import ${entryPath}: ${String(err)}`);
        } finally {
          await fs.rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
        }
        continue;
      }

      if (!entry.isDirectory()) {
        continue;
      }

      if (entry.name.endsWith('.disabled')) {
        continue;
      }
      if (retiredSkills.has(entry.name)) continue;

      const skillFile = path.join(entryPath, 'SKILL.md');
      if (!(await pathExists(skillFile))) {
        continue;
      }

      const skillName = await readExternalDirectorySkillName(skillFile, entry.name);
      if (retiredSkills.has(skillName)) continue;
      const entryCanonicalName = await resolveSkillAlias(configHome, entry.name);
      if (
        entryCanonicalName !== entry.name &&
        (await skillExistsAnywhere(
          configHome,
          entryCanonicalName,
          activeTargetDir,
          catalogTargetDir
        ))
      ) {
        continue;
      }
      const canonicalName = await resolveSkillAlias(configHome, skillName);
      if (
        canonicalName !== skillName &&
        (await skillExistsAnywhere(configHome, canonicalName, activeTargetDir, catalogTargetDir))
      ) {
        continue;
      }
      if (await skillExistsAnywhere(configHome, skillName, activeTargetDir, catalogTargetDir)) {
        continue;
      }

      try {
        const targetDir = activeSkills.has(skillName) ? activeTargetDir : catalogTargetDir;
        await copySkillDirectory(entryPath, path.join(targetDir, skillName));
      } catch (err) {
        console.warn(`[SKILLS] Failed to copy ${entryPath}: ${String(err)}`);
      }
    }
  }
}
