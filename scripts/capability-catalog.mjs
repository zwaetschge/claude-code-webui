#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const configHome = path.resolve(
  process.env.WEBUI_CONFIG_HOME ||
    process.env.CLAUDE_CONFIG_HOME ||
    path.join(os.homedir(), '.claude')
);

function readAliases() {
  const filePath = path.join(configHome, 'skill-aliases.json');
  if (!fs.existsSync(filePath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed?.aliases && typeof parsed.aliases === 'object' ? parsed.aliases : parsed;
  } catch {
    return {};
  }
}

function resolveAlias(name, aliases) {
  let current = name;
  const seen = new Set();
  for (let depth = 0; depth < 8; depth += 1) {
    const target = aliases[current];
    if (typeof target !== 'string' || seen.has(target)) break;
    seen.add(current);
    current = target;
  }
  return current;
}

function parseFrontmatter(content) {
  const values = {};
  if (!content.startsWith('---')) return values;
  const end = content.indexOf('\n---', 3);
  if (end < 0) return values;
  for (const line of content.slice(3, end).trim().split('\n')) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    values[line.slice(0, colon).trim()] = line
      .slice(colon + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
  }
  return values;
}

function classifySkill(name, frontmatter, content) {
  const haystack =
    `${name} ${frontmatter.name || ''} ${frontmatter.description || ''} ${content.slice(0, 500)}`.toLowerCase();
  if (name.startsWith('design-') || haystack.includes('design system')) return 'design';
  if (
    name.startsWith('author-style-') ||
    /persona|roleplay|in-character|writing style|prose style|business email/.test(haystack)
  ) {
    return 'writing';
  }
  return 'skill';
}

function readSkills(root, enabled) {
  if (!fs.existsSync(root)) return [];
  const items = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === '.system') continue;
    const baseName = entry.name.replace(/\.disabled$/, '');
    const filePath = path.join(root, entry.name, 'SKILL.md');
    if (!fs.existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, 'utf8');
    const frontmatter = parseFrontmatter(content);
    items.push({
      type: 'skill',
      kind: classifySkill(baseName, frontmatter, content),
      name: frontmatter.name || baseName,
      baseName,
      description: frontmatter.description || '',
      enabled,
      path: filePath,
      entryType: 'skill',
    });
  }
  return items;
}

function readStylePresets() {
  const items = [];
  for (const kind of ['design', 'writing']) {
    const root = path.join(configHome, 'style-library', kind);
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const filePath = path.join(root, entry.name, 'SKILL.md');
      if (!fs.existsSync(filePath)) continue;
      const content = fs.readFileSync(filePath, 'utf8');
      const frontmatter = parseFrontmatter(content);
      items.push({
        type: 'style',
        kind,
        name: frontmatter.name || entry.name,
        baseName: entry.name,
        description: frontmatter.description || '',
        enabled: false,
        path: filePath,
        entryType: 'style',
      });
    }
  }
  return items;
}

function readAgents() {
  const root = path.join(configHome, 'agents');
  if (!fs.existsSync(root)) return [];
  const items = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile() || (!entry.name.endsWith('.md') && !entry.name.endsWith('.md.disabled'))) {
      continue;
    }
    const filePath = path.join(root, entry.name);
    const content = fs.readFileSync(filePath, 'utf8');
    const frontmatter = parseFrontmatter(content);
    const baseName = entry.name.replace(/\.md(?:\.disabled)?$/, '');
    items.push({
      type: 'agent',
      kind: 'agent',
      name: frontmatter.name || baseName,
      baseName,
      description: frontmatter.description || '',
      enabled: entry.name.endsWith('.md'),
      path: filePath,
    });
  }
  return items;
}

function catalog() {
  const aliases = readAliases();
  const byKey = new Map();
  for (const item of [
    ...readSkills(path.join(configHome, 'skills'), true),
    ...readSkills(path.join(configHome, 'skill-catalog'), false),
    ...readStylePresets(),
    ...readAgents(),
  ]) {
    const key = `${item.type}:${item.baseName}`;
    const previous = byKey.get(key);
    if (!previous || item.enabled) byKey.set(key, item);
  }
  const items = [...byKey.values()];
  for (const item of items) {
    item.aliases = Object.keys(aliases).filter(
      (alias) => resolveAlias(alias, aliases) === item.baseName
    );
  }
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

function score(item, terms) {
  const name = `${item.name} ${item.baseName} ${(item.aliases || []).join(' ')}`.toLowerCase();
  const description = item.description.toLowerCase();
  let value = 0;
  for (const term of terms) {
    if (name === term) value += 20;
    else if (name.includes(term)) value += 8;
    if (description.includes(term)) value += 3;
    if (item.kind.includes(term) || item.type.includes(term)) value += 2;
  }
  return value;
}

async function output(items) {
  const payload = `${JSON.stringify(items, null, 2)}\n`;
  await new Promise((resolve, reject) => {
    process.stdout.write(payload, (err) => (err ? reject(err) : resolve()));
  });
}

const [command = 'search', ...args] = process.argv.slice(2);
const items = catalog();

if (command === 'list') {
  await output(items);
  process.exit(0);
}

if (command === 'show') {
  const aliases = readAliases();
  const requested = args.join(' ').trim().toLowerCase();
  const resolved = resolveAlias(requested, aliases).toLowerCase();
  let item = items.find(
    (entry) => entry.name.toLowerCase() === resolved || entry.baseName.toLowerCase() === resolved
  );
  if (!item && resolved !== requested) {
    item = items.find(
      (entry) =>
        entry.name.toLowerCase() === requested || entry.baseName.toLowerCase() === requested
    );
  }
  if (!item) {
    process.stderr.write(`Capability not found: ${args.join(' ')}\n`);
    process.exit(2);
  }
  process.stdout.write(fs.readFileSync(item.path, 'utf8'));
  process.exit(0);
}

const query = (command === 'search' ? args : [command, ...args]).join(' ').trim().toLowerCase();
if (!query) {
  process.stderr.write('Usage: capability-catalog.mjs search <query> | list | show <name>\n');
  process.exit(2);
}

const terms = query.split(/\s+/).filter(Boolean);
await output(
  items
    .map((item) => ({ item, score: score(item, terms) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name))
    .slice(0, 15)
    .map((entry) => entry.item)
);
