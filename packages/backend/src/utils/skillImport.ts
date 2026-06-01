import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface SkillImportResult {
  file: string;
  status: 'imported' | 'skipped' | 'error';
  skillName?: string;
  reason?: string;
  error?: string;
}

export interface ImportedSkill {
  name: string;
  description: string;
  allowedTools?: string[];
  model?: string;
  dirPath: string;
}

// Subset shared with the route handler. Kept loose so both .md files and
// zipped .skill archives can be parsed by the same code path.
export interface ParsedFrontmatter {
  frontmatter: Record<string, string>;
  body: string;
}

export function parseMarkdownFrontmatter(content: string): ParsedFrontmatter {
  const frontmatter: Record<string, string> = {};
  let body = content;

  if (content.startsWith('---')) {
    const endIndex = content.indexOf('---', 3);
    if (endIndex !== -1) {
      const yamlContent = content.substring(3, endIndex).trim();
      body = content.substring(endIndex + 3).trim();
      yamlContent.split('\n').forEach((line) => {
        const colonIndex = line.indexOf(':');
        if (colonIndex > 0) {
          const key = line.substring(0, colonIndex).trim();
          const value = line.substring(colonIndex + 1).trim();
          frontmatter[key] = value;
        }
      });
    }
  }

  return { frontmatter, body };
}

export function sanitizeSkillName(name: string): string {
  // Strict allowlist: only the chars Claude Code recognises in skill dir names.
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 80);
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

// Find the directory inside the staging area that contains a SKILL.md.
// Archives in the wild come in two shapes: SKILL.md at root, or one subdir
// deep (e.g. `auto-researcher/SKILL.md`). Anything deeper is a malformed
// archive and gets rejected.
async function findSkillRoot(startDir: string): Promise<string> {
  if (await pathExists(path.join(startDir, 'SKILL.md'))) {
    return startDir;
  }
  const entries = await fs.readdir(startDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sub = path.join(startDir, entry.name);
    if (await pathExists(path.join(sub, 'SKILL.md'))) {
      return sub;
    }
  }
  throw new Error('Archive does not contain SKILL.md at root or one level deep');
}

// Derive a usable skill name from the original filename when frontmatter
// doesn't have one. Strips common suffixes added by browsers / download
// duplicators: `(1)`, `-SKILL`, `.skill`, `.md`, etc.
function deriveNameFromFilename(originalname: string): string {
  return originalname
    .replace(/\.(md|skill|zip)$/i, '')
    .replace(/[-_ ]?SKILL.*$/i, '')
    .replace(/\(\d+\)$/, '')
    .trim();
}

export interface ImportOptions {
  conflict: 'skip' | 'overwrite';
}

/**
 * Import a single skill into `skillsDir` from a buffer. Handles both raw
 * markdown (.md) and zip archives (.skill / .zip). Returns a structured
 * result describing what happened — callers should aggregate results across
 * a batch rather than throwing.
 */
export async function importSkillFromBuffer(
  buffer: Buffer,
  originalname: string,
  skillsDir: string,
  options: ImportOptions
): Promise<
  | { status: 'imported'; skill: ImportedSkill }
  | { status: 'skipped'; reason: string; skillName?: string }
> {
  const lower = originalname.toLowerCase();
  const isArchive = lower.endsWith('.skill') || lower.endsWith('.zip');

  const tempBase = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-import-'));
  try {
    let stagingDir: string;

    if (isArchive) {
      const tempZip = path.join(tempBase, 'archive.zip');
      await fs.writeFile(tempZip, buffer);
      const extractDir = path.join(tempBase, 'extracted');
      await fs.mkdir(extractDir);
      // -j would flatten paths but lose subdir context; we want the natural
      // archive shape so we can detect zip-slip via path.resolve checks below.
      await execFileAsync('unzip', ['-q', tempZip, '-d', extractDir]);
      stagingDir = await findSkillRoot(extractDir);

      // Zip-slip guard: every file in the staging dir must resolve under it.
      const resolvedStaging = path.resolve(stagingDir);
      const allFiles = await fs.readdir(resolvedStaging, { recursive: true });
      for (const entry of allFiles) {
        const resolved = path.resolve(resolvedStaging, String(entry));
        if (!resolved.startsWith(resolvedStaging + path.sep) && resolved !== resolvedStaging) {
          throw new Error(`Refusing zip with escaping entry: ${entry}`);
        }
      }
    } else {
      const synthetic = path.join(tempBase, 'synthetic');
      await fs.mkdir(synthetic);
      await fs.writeFile(path.join(synthetic, 'SKILL.md'), buffer);
      stagingDir = synthetic;
    }

    const skillMdPath = path.join(stagingDir, 'SKILL.md');
    const content = await fs.readFile(skillMdPath, 'utf-8');
    const { frontmatter, body } = parseMarkdownFrontmatter(content);

    const rawName =
      (frontmatter.name && frontmatter.name.trim()) || deriveNameFromFilename(originalname);
    if (!rawName) {
      return { status: 'skipped', reason: 'missing_name' };
    }

    const skillName = sanitizeSkillName(rawName);
    if (!skillName) {
      return { status: 'skipped', reason: 'name_sanitized_to_empty', skillName: rawName };
    }

    const destDir = path.join(skillsDir, skillName);
    const destDisabled = path.join(skillsDir, `${skillName}.disabled`);
    const destExists = (await pathExists(destDir)) || (await pathExists(destDisabled));

    if (destExists && options.conflict === 'skip') {
      return { status: 'skipped', reason: 'already_exists', skillName };
    }

    if (destExists) {
      await fs.rm(destDir, { recursive: true, force: true });
      await fs.rm(destDisabled, { recursive: true, force: true });
    }

    await fs.mkdir(skillsDir, { recursive: true });
    await fs.cp(stagingDir, destDir, { recursive: true });

    return {
      status: 'imported',
      skill: {
        name: frontmatter.name || skillName,
        description: frontmatter.description || body.substring(0, 200),
        allowedTools: frontmatter['allowed-tools']
          ?.split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        model: frontmatter.model,
        dirPath: destDir,
      },
    };
  } finally {
    await fs.rm(tempBase, { recursive: true, force: true }).catch(() => {});
  }
}
