#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const configHome = path.resolve(
  process.argv[2] ||
    process.env.WEBUI_CONFIG_HOME ||
    process.env.CLAUDE_CONFIG_HOME ||
    path.join(os.homedir(), '.claude')
);

const expectedActiveSkills = new Set([
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
]);

const roots = [
  { root: path.join(configHome, 'skills'), type: 'skill', state: 'active' },
  { root: path.join(configHome, 'skill-catalog'), type: 'skill', state: 'on-demand' },
  { root: path.join(configHome, 'style-library', 'design'), type: 'style', state: 'on-demand' },
  { root: path.join(configHome, 'style-library', 'writing'), type: 'style', state: 'on-demand' },
];

const forbiddenContent = [
  ['LoRA Tester', /LoRA Tester/i],
  ['obsolete LoRA Tester port', /(?:localhost|192\.168\.\d+\.\d+):8850/i],
  ['removed Unreal MCP tool', /\bunreal_(?:status|bridge_call)\b/i],
  ['removed artifact path', /\/mnt\/user-data\b|\bpresent_files\b/],
  ['duplicate Codex skill tree', /~\/\.codex\/skills\b/],
];

const errors = [];
const warnings = [];

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function directoryNames(root) {
  try {
    return (await fs.readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && entry.name !== '.system')
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function parseFrontmatter(content, filePath) {
  const lines = content.split(/\r?\n/);
  if (lines[0] !== '---') {
    errors.push(`${filePath}: missing YAML frontmatter`);
    return { name: '', description: '', lines };
  }
  const end = lines.indexOf('---', 1);
  if (end < 0) {
    errors.push(`${filePath}: unclosed YAML frontmatter`);
    return { name: '', description: '', lines };
  }
  const metadata = {};
  for (const line of lines.slice(1, end)) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    metadata[match[1]] = match[2].replace(/^(?:"|')|(?:"|')$/g, '').trim();
  }
  const extraKeys = Object.keys(metadata).filter((key) => key !== 'name' && key !== 'description');
  if (extraKeys.length > 0) {
    errors.push(`${filePath}: unsupported frontmatter keys: ${extraKeys.join(', ')}`);
  }
  if (!metadata.name || !metadata.description) {
    errors.push(`${filePath}: frontmatter requires name and description`);
  }
  return { ...metadata, lines };
}

function referencedFiles(content) {
  const refs = new Set();
  const patterns = [
    /\]\(((?:references|scripts|assets)\/[^)#?\s]+)(?:#[^)]+)?\)/g,
    /`((?:references|scripts|assets)\/[A-Za-z0-9_./-]+)`/g,
  ];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) refs.add(match[1]);
  }
  return [...refs];
}

function resolveAlias(name, aliases) {
  let current = name;
  const visited = new Set();
  while (aliases[current]) {
    if (visited.has(current)) return null;
    visited.add(current);
    current = aliases[current];
  }
  return current;
}

const entries = [];
const names = new Map();
for (const rootInfo of roots) {
  for (const directoryName of await directoryNames(rootInfo.root)) {
    const directory = path.join(rootInfo.root, directoryName);
    const filePath = path.join(directory, 'SKILL.md');
    let content;
    try {
      content = await fs.readFile(filePath, 'utf8');
    } catch {
      errors.push(`${directory}: missing SKILL.md`);
      continue;
    }
    const metadata = parseFrontmatter(content, filePath);
    if (metadata.name !== directoryName) {
      errors.push(
        `${filePath}: frontmatter name ${JSON.stringify(metadata.name)} does not match directory ${directoryName}`
      );
    }
    if (metadata.lines.length > 500) {
      errors.push(`${filePath}: ${metadata.lines.length} lines exceeds the 500-line skill limit`);
    }
    for (const relativeReference of referencedFiles(content)) {
      try {
        await fs.access(path.join(directory, relativeReference));
      } catch {
        errors.push(`${filePath}: missing referenced file ${relativeReference}`);
      }
    }
    for (const [label, pattern] of forbiddenContent) {
      if (pattern.test(content)) errors.push(`${filePath}: contains ${label}`);
    }
    if (names.has(directoryName)) {
      errors.push(
        `${directoryName}: duplicate entry in ${names.get(directoryName)} and ${directory}`
      );
    } else {
      names.set(directoryName, directory);
    }
    entries.push({
      name: directoryName,
      type: rootInfo.type,
      state: rootInfo.state,
      filePath,
      hash: crypto.createHash('sha256').update(content).digest('hex'),
    });
  }
}

const activeNames = new Set(
  entries.filter((entry) => entry.state === 'active').map((entry) => entry.name)
);
for (const expected of expectedActiveSkills) {
  if (!activeNames.has(expected)) errors.push(`active core is missing ${expected}`);
}
for (const actual of activeNames) {
  if (!expectedActiveSkills.has(actual)) errors.push(`unexpected globally active skill ${actual}`);
}

const duplicateHashes = new Map();
for (const entry of entries.filter((candidate) => candidate.type === 'skill')) {
  const previous = duplicateHashes.get(entry.hash);
  if (previous) errors.push(`${entry.filePath}: byte-identical to ${previous}`);
  else duplicateHashes.set(entry.hash, entry.filePath);
}

const rawAliasFile = await readJson(path.join(configHome, 'skill-aliases.json'), {});
const aliases =
  rawAliasFile?.aliases && typeof rawAliasFile.aliases === 'object'
    ? rawAliasFile.aliases
    : rawAliasFile;
const retired = new Set(Array.isArray(rawAliasFile?.retired) ? rawAliasFile.retired : []);
for (const [alias, target] of Object.entries(aliases)) {
  if (alias === target) errors.push(`alias ${alias} points to itself`);
  if (names.has(alias)) errors.push(`alias ${alias} shadows a canonical catalog entry`);
  const canonical = resolveAlias(alias, aliases);
  if (!canonical) errors.push(`alias ${alias} is part of a cycle`);
  else if (!names.has(canonical))
    errors.push(`alias ${alias} resolves to missing target ${canonical}`);
}
for (const retiredName of retired) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(retiredName)) {
    errors.push(`invalid retired skill name ${JSON.stringify(retiredName)}`);
  }
  if (names.has(retiredName)) errors.push(`retired skill ${retiredName} is present in the catalog`);
  if (aliases[retiredName])
    errors.push(`retired skill ${retiredName} is also configured as an alias`);
}

const agentsDir = path.join(configHome, 'agents');
let agentCount = 0;
for (const fileName of (await fs.readdir(agentsDir).catch(() => [])).filter((name) =>
  name.endsWith('.md')
)) {
  agentCount += 1;
  const filePath = path.join(agentsDir, fileName);
  const lines = (await fs.readFile(filePath, 'utf8')).split(/\r?\n/);
  const frontmatterEnd = lines.indexOf('---', 1);
  const skillsStart = lines.findIndex(
    (line, index) => index < frontmatterEnd && /^skills:\s*$/.test(line)
  );
  if (skillsStart < 0) continue;
  for (const line of lines.slice(skillsStart + 1, frontmatterEnd)) {
    const match = /^\s+-\s+([A-Za-z0-9_-]+)\s*$/.exec(line);
    if (!match) {
      if (/^[A-Za-z0-9_-]+:/.test(line)) break;
      continue;
    }
    const canonical = resolveAlias(match[1], aliases);
    if (!canonical || !names.has(canonical)) {
      errors.push(`${filePath}: skill reference ${match[1]} does not resolve`);
    }
  }
}

const summary = {
  configHome,
  activeSkills: entries.filter((entry) => entry.type === 'skill' && entry.state === 'active')
    .length,
  onDemandSkills: entries.filter((entry) => entry.type === 'skill' && entry.state === 'on-demand')
    .length,
  designStyles: entries.filter(
    (entry) => entry.type === 'style' && entry.filePath.includes(`${path.sep}design${path.sep}`)
  ).length,
  writingStyles: entries.filter(
    (entry) => entry.type === 'style' && entry.filePath.includes(`${path.sep}writing${path.sep}`)
  ).length,
  aliases: Object.keys(aliases).length,
  retired: retired.size,
  agents: agentCount,
  warnings,
  errors,
};

console.log(JSON.stringify(summary, null, 2));
if (errors.length > 0) process.exitCode = 1;
