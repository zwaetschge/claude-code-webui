import fs from 'fs/promises';
import path from 'path';
import { safeJsonParse } from './json.js';

export type SkillAliasMap = Record<string, string>;

function safeName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return /^[a-zA-Z0-9_-]{1,100}$/.test(normalized) ? normalized : null;
}

export function getSkillAliasesPath(configHome: string): string {
  return path.join(configHome, 'skill-aliases.json');
}

export async function readSkillAliases(configHome: string): Promise<SkillAliasMap> {
  try {
    const parsed = safeJsonParse<unknown>(
      await fs.readFile(getSkillAliasesPath(configHome), 'utf-8'),
      {}
    );
    const source =
      parsed && typeof parsed === 'object' && 'aliases' in parsed
        ? (parsed as { aliases?: unknown }).aliases
        : parsed;
    if (!source || typeof source !== 'object' || Array.isArray(source)) return {};
    const aliases: SkillAliasMap = {};
    for (const [rawAlias, rawTarget] of Object.entries(source)) {
      const alias = safeName(rawAlias);
      const target = safeName(rawTarget);
      if (alias && target && alias !== target) aliases[alias] = target;
    }
    return aliases;
  } catch {
    return {};
  }
}

export async function readRetiredSkillNames(configHome: string): Promise<Set<string>> {
  try {
    const parsed = safeJsonParse<unknown>(
      await fs.readFile(getSkillAliasesPath(configHome), 'utf-8'),
      {}
    );
    const retired =
      parsed && typeof parsed === 'object' && 'retired' in parsed
        ? (parsed as { retired?: unknown }).retired
        : [];
    if (!Array.isArray(retired)) return new Set();
    return new Set(retired.map(safeName).filter((name): name is string => !!name));
  } catch {
    return new Set();
  }
}

export async function resolveSkillAlias(
  configHome: string,
  requestedName: string
): Promise<string> {
  const aliases = await readSkillAliases(configHome);
  let current = safeName(requestedName) || requestedName;
  const seen = new Set<string>();
  for (let depth = 0; depth < 8; depth += 1) {
    const target = aliases[current];
    if (!target || seen.has(target)) break;
    seen.add(current);
    current = target;
  }
  return current;
}

export async function aliasesByTarget(configHome: string): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  for (const alias of Object.keys(await readSkillAliases(configHome))) {
    const target = await resolveSkillAlias(configHome, alias);
    const current = result.get(target) || [];
    current.push(alias);
    result.set(target, current);
  }
  for (const aliases of result.values()) aliases.sort();
  return result;
}
