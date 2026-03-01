import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const DEFAULT_EXTERNAL_SKILLS_DIRS = ['/mnt/user/AI/Skills', '/mnt/unraid/AI/Skills'];
const SKILLS_SYNC_INTERVAL_MS = 60_000;
const lastSyncMap = new Map<string, number>();

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
  const envDirs = parseDirList(
    process.env.WEBUI_SKILLS_DIRS || process.env.CLAUDE_SKILLS_DIRS
  );
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

async function unzipSkill(zipPath: string, targetDir: string): Promise<void> {
  try {
    await execFileAsync('unzip', ['-q', zipPath, '-d', targetDir]);
  } catch (err) {
    console.warn(`[SKILLS] Failed to unzip ${zipPath}: ${String(err)}`);
  }
}

export async function syncExternalSkills(configHome: string): Promise<void> {
  const now = Date.now();
  const lastSync = lastSyncMap.get(configHome);
  if (lastSync && now - lastSync < SKILLS_SYNC_INTERVAL_MS) {
    return;
  }
  lastSyncMap.set(configHome, now);

  const externalDirs = await getExternalSkillsDirs();
  if (!externalDirs.length) {
    return;
  }

  const targetDir = path.join(configHome, 'skills');
  try {
    await fs.mkdir(targetDir, { recursive: true });
  } catch (err) {
    console.warn(`[SKILLS] Unable to create skills dir at ${targetDir}: ${String(err)}`);
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
        const skillName = entry.name.replace(/\.skill\.zip$/i, '');
        const destination = path.join(targetDir, skillName);
        if (await pathExists(destination)) {
          continue;
        }
        await unzipSkill(entryPath, targetDir);
        continue;
      }

      if (!entry.isDirectory()) {
        continue;
      }

      if (entry.name.endsWith('.disabled')) {
        continue;
      }

      const skillFile = path.join(entryPath, 'SKILL.md');
      if (!(await pathExists(skillFile))) {
        continue;
      }

      const destination = path.join(targetDir, entry.name);
      if (await pathExists(destination)) {
        continue;
      }

      try {
        await fs.cp(entryPath, destination, { recursive: true });
      } catch (err) {
        console.warn(`[SKILLS] Failed to copy ${entryPath}: ${String(err)}`);
      }
    }
  }
}
