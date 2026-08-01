#!/usr/bin/env node
/**
 * Bulk-import skill files (.md or .skill/.zip archives) from a source dir
 * into ~/.claude/skills/. Self-contained (no external deps) — uses Node fs
 * + the `unzip` system binary.
 *
 * Usage:
 *   node scripts/import-skills-from-dir.mjs <source-dir> [--config-home <path>] [--overwrite]
 *
 * Notes:
 *   - Skips skills that already exist (unless --overwrite).
 *   - Deduplicates within source by frontmatter name; prefers .skill over
 *     loose .md if both reference the same skill, then prefers the larger
 *     file.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_ACTIVE_SKILLS = [
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
];

function parseFrontmatter(content) {
  const frontmatter = {};
  let body = content;
  if (content.startsWith('---')) {
    const end = content.indexOf('---', 3);
    if (end !== -1) {
      const yaml = content.substring(3, end).trim();
      body = content.substring(end + 3).trim();
      for (const line of yaml.split('\n')) {
        const idx = line.indexOf(':');
        if (idx > 0) {
          const key = line.substring(0, idx).trim();
          const value = line.substring(idx + 1).trim();
          frontmatter[key] = value;
        }
      }
    }
  }
  return { frontmatter, body };
}

function sanitizeName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 80);
}

function deriveFromFilename(name) {
  return name
    .replace(/\.(md|skill|zip)$/i, '')
    .replace(/[-_ ]?SKILL.*$/i, '')
    .replace(/\(\d+\)$/, '')
    .trim();
}

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readCatalogPolicy(configHome) {
  try {
    const parsed = JSON.parse(
      await fs.readFile(path.join(configHome, 'skill-aliases.json'), 'utf-8')
    );
    const source = parsed && typeof parsed === 'object' && parsed.aliases ? parsed.aliases : parsed;
    const aliases = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
    const retired = new Set(Array.isArray(parsed?.retired) ? parsed.retired.map(sanitizeName) : []);
    return { aliases, retired };
  } catch {
    return { aliases: {}, retired: new Set() };
  }
}

function resolveAlias(aliases, requestedName) {
  let current = requestedName;
  const seen = new Set();
  for (let depth = 0; depth < 8; depth += 1) {
    const target = typeof aliases[current] === 'string' ? sanitizeName(aliases[current]) : '';
    if (!target || seen.has(target)) break;
    seen.add(current);
    current = target;
  }
  return current;
}

async function findSkillRoot(start) {
  const roots = [];
  if (await pathExists(path.join(start, 'SKILL.md'))) roots.push(start);
  const entries = await fs.readdir(start, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const sub = path.join(start, e.name);
    if (await pathExists(path.join(sub, 'SKILL.md'))) roots.push(sub);
  }
  if (roots.length === 0) throw new Error('Archive missing SKILL.md');
  if (roots.length > 1) throw new Error('Archive must contain exactly one skill root');
  return roots[0];
}

async function validateArchiveEntries(zipPath) {
  const { stdout } = await execFileAsync('unzip', ['-Z1', zipPath]);
  const entries = [];
  for (const rawEntry of stdout.split(/\r?\n/)) {
    if (!rawEntry) continue;
    const entry = rawEntry.replace(/\\/g, '/');
    const segments = entry.split('/').filter(Boolean);
    if (
      entry.startsWith('/') ||
      /^[a-zA-Z]:\//.test(entry) ||
      segments.some((segment) => segment === '..')
    ) {
      throw new Error(`zip-slip entry: ${rawEntry}`);
    }
    entries.push(rawEntry);
  }
  return entries;
}

async function catalogLocations(configHome, skillName) {
  const runtime = [
    path.join(configHome, 'skills', skillName),
    path.join(configHome, 'skills', `${skillName}.disabled`),
    path.join(configHome, 'skill-catalog', skillName),
  ];
  const styles = [
    path.join(configHome, 'style-library', 'design', skillName),
    path.join(configHome, 'style-library', 'writing', skillName),
  ];
  const existingRuntime = [];
  const existingStyles = [];
  for (const candidate of runtime) {
    if (await pathExists(path.join(candidate, 'SKILL.md'))) existingRuntime.push(candidate);
  }
  for (const candidate of styles) {
    if (await pathExists(path.join(candidate, 'SKILL.md'))) existingStyles.push(candidate);
  }
  return { runtime: existingRuntime, styles: existingStyles };
}

async function registerActiveSkill(configHome, skillName) {
  const statePath = path.join(configHome, 'integrations', 'skill-catalog-state.json');
  let activeSkills = [...DEFAULT_ACTIVE_SKILLS];
  try {
    const parsed = JSON.parse(await fs.readFile(statePath, 'utf-8'));
    if (parsed?.version === 1 && Array.isArray(parsed.activeSkills)) {
      activeSkills = parsed.activeSkills.map(sanitizeName).filter(Boolean);
    }
  } catch {
    // First catalog import.
  }
  activeSkills = [...new Set([...activeSkills, skillName])].sort();
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  const tempPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(
    tempPath,
    `${JSON.stringify({ version: 1, activeSkills }, null, 2)}\n`,
    'utf-8'
  );
  await fs.rename(tempPath, statePath);
}

async function importOne(filePath, configHome, conflict, catalogPolicy) {
  const originalname = path.basename(filePath);
  const lower = originalname.toLowerCase();
  const isArchive = lower.endsWith('.skill') || lower.endsWith('.zip');

  const tempBase = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-import-'));
  try {
    let stagingDir;
    if (isArchive) {
      const tempZip = path.join(tempBase, 'archive.zip');
      await fs.copyFile(filePath, tempZip);
      await validateArchiveEntries(tempZip);
      const extractDir = path.join(tempBase, 'extracted');
      await fs.mkdir(extractDir);
      await execFileAsync('unzip', ['-q', tempZip, '-d', extractDir]);
      stagingDir = await findSkillRoot(extractDir);

      const resolvedStaging = path.resolve(stagingDir);
      const entries = await fs.readdir(resolvedStaging, { recursive: true });
      for (const entry of entries) {
        const resolved = path.resolve(resolvedStaging, String(entry));
        if (!resolved.startsWith(resolvedStaging + path.sep) && resolved !== resolvedStaging) {
          throw new Error(`zip-slip entry: ${entry}`);
        }
      }
    } else {
      const synthetic = path.join(tempBase, 'synthetic');
      await fs.mkdir(synthetic);
      await fs.copyFile(filePath, path.join(synthetic, 'SKILL.md'));
      stagingDir = synthetic;
    }

    const skillMd = path.join(stagingDir, 'SKILL.md');
    const content = await fs.readFile(skillMd, 'utf-8');
    const { frontmatter } = parseFrontmatter(content);
    const rawName =
      (frontmatter.name && frontmatter.name.trim()) || deriveFromFilename(originalname);
    if (!rawName) return { status: 'skipped', reason: 'no_name' };
    const skillName = sanitizeName(rawName);
    if (!skillName)
      return { status: 'skipped', reason: 'empty_after_sanitize', skillName: rawName };

    if (catalogPolicy.retired.has(skillName)) {
      return { status: 'skipped', reason: 'retired_name', skillName };
    }
    const canonicalName = resolveAlias(catalogPolicy.aliases, skillName);
    if (canonicalName !== skillName) {
      const canonicalLocations = await catalogLocations(configHome, canonicalName);
      if (canonicalLocations.runtime.length > 0 || canonicalLocations.styles.length > 0) {
        return {
          status: 'skipped',
          reason: `consolidated_as:${canonicalName}`,
          skillName,
        };
      }
    }

    const existing = await catalogLocations(configHome, skillName);
    if (existing.styles.length > 0) {
      return { status: 'skipped', reason: 'style_preset_conflict', skillName };
    }
    if (existing.runtime.length > 0 && conflict === 'skip') {
      return { status: 'skipped', reason: 'already_exists', skillName };
    }
    for (const candidate of existing.runtime) {
      await fs.rm(candidate, { recursive: true, force: true });
    }

    const skillsDir = path.join(configHome, 'skills');
    const destDir = path.join(skillsDir, skillName);
    await fs.mkdir(skillsDir, { recursive: true });
    await fs.cp(stagingDir, destDir, {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
    await registerActiveSkill(configHome, skillName);
    return { status: 'imported', skillName, name: frontmatter.name || skillName };
  } finally {
    await fs.rm(tempBase, { recursive: true, force: true }).catch(() => {});
  }
}

async function peekName(filePath) {
  const originalname = path.basename(filePath);
  const lower = originalname.toLowerCase();
  if (lower.endsWith('.md')) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
      if (match) {
        for (const line of match[1].split('\n')) {
          if (line.startsWith('name:')) {
            const v = line.slice('name:'.length).trim();
            if (v) return v;
          }
        }
      }
    } catch {
      /* fall through */
    }
  }
  if (lower.endsWith('.skill') || lower.endsWith('.zip')) {
    try {
      const entries = await validateArchiveEntries(filePath);
      const skillRoots = entries.filter((entry) => {
        const segments = entry.replace(/\\/g, '/').split('/').filter(Boolean);
        return (
          segments.length >= 1 &&
          segments.length <= 2 &&
          segments[segments.length - 1] === 'SKILL.md'
        );
      });
      if (skillRoots.length !== 1) return deriveFromFilename(originalname);
      const { stdout } = await execFileAsync('unzip', ['-p', filePath, skillRoots[0]]);
      const { frontmatter } = parseFrontmatter(stdout);
      if (frontmatter.name?.trim()) return frontmatter.name.trim();
    } catch {
      /* importOne will report the detailed archive error */
    }
  }
  return deriveFromFilename(originalname);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1 || args[0].startsWith('-')) {
    console.error(
      'Usage: node scripts/import-skills-from-dir.mjs <source-dir> [--config-home <path>] [--overwrite]'
    );
    process.exit(2);
  }
  const sourceDir = path.resolve(args[0]);
  const cfgIdx = args.indexOf('--config-home');
  const configHome =
    cfgIdx >= 0
      ? path.resolve(args[cfgIdx + 1])
      : path.join(process.env.HOME ?? '/home/node', '.claude');
  const conflict = args.includes('--overwrite') ? 'overwrite' : 'skip';
  const catalogPolicy = await readCatalogPolicy(configHome);

  const skillsDir = path.join(configHome, 'skills');
  console.log(`[import] source=${sourceDir}`);
  console.log(`[import] target=${skillsDir}`);
  console.log(`[import] conflict=${conflict}`);

  const dirEntries = await fs.readdir(sourceDir, { withFileTypes: true });
  const files = [];
  for (const e of dirEntries) {
    if (!e.isFile()) continue;
    const lower = e.name.toLowerCase();
    if (!(lower.endsWith('.md') || lower.endsWith('.skill') || lower.endsWith('.zip'))) continue;
    const fp = path.join(sourceDir, e.name);
    const s = await fs.stat(fp);
    files.push({
      filePath: fp,
      originalname: e.name,
      size: s.size,
      isArchive: !lower.endsWith('.md'),
    });
  }
  console.log(`[import] found ${files.length} candidate files`);

  const byName = new Map();
  for (const f of files) {
    const peeked = await peekName(f.filePath);
    if (!peeked) continue;
    const key = sanitizeName(peeked);
    if (!key) continue;
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, f);
      continue;
    }
    if (existing.isArchive !== f.isArchive) {
      if (f.isArchive) byName.set(key, f);
      continue;
    }
    if (f.size > existing.size) byName.set(key, f);
  }
  console.log(`[import] ${byName.size} unique skills after dedupe`);

  const imported = [];
  const skipped = [];
  const errors = [];
  for (const f of byName.values()) {
    try {
      const r = await importOne(f.filePath, configHome, conflict, catalogPolicy);
      if (r.status === 'imported') imported.push(r.name);
      else skipped.push({ name: r.skillName ?? f.originalname, reason: r.reason });
    } catch (err) {
      errors.push({ name: f.originalname, error: err?.message ?? String(err) });
    }
  }

  console.log(`\n=== Result ===`);
  console.log(`imported: ${imported.length}`);
  for (const n of imported) console.log(`  + ${n}`);
  console.log(`\nskipped: ${skipped.length}`);
  for (const s of skipped) console.log(`  - ${s.name} (${s.reason})`);
  if (errors.length) {
    console.log(`\nerrors: ${errors.length}`);
    for (const e of errors) console.log(`  ! ${e.name}: ${e.error}`);
  }
}

main().catch((err) => {
  console.error('[import] fatal:', err);
  process.exit(1);
});
