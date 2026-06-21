import fs from 'fs/promises';
import path from 'path';
import type { SkillLibraryItem, SkillLibraryKind, WritingStyleType } from '@plum-code-webui/shared';
import { syncExternalSkills } from './skillSync.js';

interface ParsedSkill extends SkillLibraryItem {
  content: string;
}

interface ListSkillLibraryOptions {
  kind?: SkillLibraryKind;
  enabledOnly?: boolean;
  syncExternal?: boolean;
}

const DESIGN_STYLE_NAMES = new Set([
  'dragonball-z-design',
  'material-3-design',
  'windows95-design',
]);

const WRITING_STYLE_NAMES = new Set([
  '20min-satirist',
  'absurdist-lens',
  'bender',
  'caveman',
  'claptrap',
  'deep-thought',
  'dr-perry-cox',
  'dr-zoidberg',
  'drunk-texter',
  'dschungel-george',
  'eliza',
  'funnybot',
  'graf-zitronenbaum',
  'heisenberg',
  'human-voice',
  'karen',
  'kevingpt',
  'michael-scott-boss-mode',
  'michael-scott-roleplay',
  'nikola-tesla',
  'prison-mike',
  'ricks-ship',
  'roman-prosa-engine',
  'schlaubi-schlumpf',
  'severus-snape',
  'shadowheart',
  'sleep-mystery',
  'spock',
  'succubus-persona',
  'swiss-business-email',
  'swiss-writing-conventions',
  'thaddaeus-gewerkschaftsfuehrer',
  'towelie',
  'truman-burbank',
  'vale-persona',
  'vale-proxy',
]);

const AUTHOR_WRITING_STYLE_NAMES = new Set([
  'author-style-stephen-king',
  'author-style-hemingway',
  'author-style-jane-austen',
  'author-style-george-orwell',
  'author-style-ursula-k-le-guin',
]);

const PROSE_WRITING_STYLE_NAMES = new Set([
  'human-voice',
  'roman-prosa-engine',
  'sleep-mystery',
  'swiss-business-email',
  'swiss-writing-conventions',
]);

export function parseMarkdownFrontmatter(content: string): {
  frontmatter: Record<string, string>;
  body: string;
} {
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
          frontmatter[key] = value.replace(/^["']|["']$/g, '').trim();
        }
      });
    }
  }

  return { frontmatter, body };
}

function splitCsv(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const values = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return values.length > 0 ? values : undefined;
}

function compactDescription(description: string | undefined, body: string): string {
  const source = description || body;
  return source.replace(/\s+/g, ' ').trim().slice(0, 240);
}

export function classifySkillLibraryKind(
  baseName: string,
  name: string,
  description: string,
  body: string
): SkillLibraryKind {
  const normalizedBase = baseName.toLowerCase();
  const normalizedName = name.toLowerCase();
  const haystack = `${normalizedBase} ${normalizedName} ${description} ${body.slice(0, 500)}`
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');

  if (normalizedBase.startsWith('design-') || DESIGN_STYLE_NAMES.has(normalizedBase)) {
    return 'design';
  }

  if (
    WRITING_STYLE_NAMES.has(normalizedBase) ||
    AUTHOR_WRITING_STYLE_NAMES.has(normalizedBase) ||
    normalizedBase.startsWith('author-style-') ||
    haystack.includes('persona') ||
    haystack.includes('roleplay') ||
    haystack.includes('embody') ||
    haystack.includes('verkorpere') ||
    haystack.includes('verkorper') ||
    haystack.includes('in-character') ||
    haystack.includes('ich-form') ||
    haystack.includes('human voice') ||
    haystack.includes('business email') ||
    haystack.includes('geschaftsemail')
  ) {
    return 'writing';
  }

  return 'skill';
}

export function classifyWritingStyleType(
  baseName: string,
  name: string,
  description: string,
  body: string
): WritingStyleType | undefined {
  const normalizedBase = baseName.toLowerCase();
  const haystack = `${normalizedBase} ${name} ${description} ${body.slice(0, 700)}`
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');

  if (
    normalizedBase.startsWith('author-style-') ||
    AUTHOR_WRITING_STYLE_NAMES.has(normalizedBase) ||
    haystack.includes('style-type: author') ||
    haystack.includes('author style') ||
    haystack.includes('authorial') ||
    haystack.includes('literary style')
  ) {
    return 'author';
  }

  if (
    PROSE_WRITING_STYLE_NAMES.has(normalizedBase) ||
    haystack.includes('style-type: prose') ||
    haystack.includes('business email') ||
    haystack.includes('writing convention') ||
    haystack.includes('writing conventions') ||
    haystack.includes('prose style') ||
    haystack.includes('copy style')
  ) {
    return 'prose';
  }

  return 'persona';
}

function safeSkillBaseName(name: string): string | null {
  const trimmed = name.trim();
  return /^[a-zA-Z0-9_-]{1,100}$/.test(trimmed) ? trimmed : null;
}

async function readSkillFromDir(
  skillsDir: string,
  entryName: string,
  source: 'user' | 'project'
): Promise<ParsedSkill | null> {
  const isDisabled = entryName.endsWith('.disabled');
  const baseName = entryName.replace(/\.disabled$/, '');
  const skillDir = path.join(skillsDir, entryName);
  const skillFile = path.join(skillDir, 'SKILL.md');

  try {
    const content = await fs.readFile(skillFile, 'utf-8');
    const { frontmatter, body } = parseMarkdownFrontmatter(content);
    const name = frontmatter.name || baseName;
    const description = compactDescription(frontmatter.description, body);
    const libraryKind = classifySkillLibraryKind(baseName, name, description, body);
    const writingStyleType =
      libraryKind === 'writing'
        ? classifyWritingStyleType(baseName, name, description, content)
        : undefined;

    return {
      id: `${source}-${baseName}`,
      baseName,
      name,
      description,
      allowedTools: splitCsv(frontmatter['allowed-tools']),
      model: frontmatter.model || undefined,
      dirPath: skillDir,
      source,
      enabled: !isDisabled,
      libraryKind,
      writingStyleType,
      content: body,
    };
  } catch {
    return null;
  }
}

export async function listSkillLibrary(
  configHome: string,
  options: ListSkillLibraryOptions = {}
): Promise<SkillLibraryItem[]> {
  if (options.syncExternal !== false) {
    await syncExternalSkills(configHome);
  }

  const skillsDir = path.join(configHome, 'skills');
  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(skillsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const skills: SkillLibraryItem[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const parsed = await readSkillFromDir(skillsDir, entry.name, 'user');
    if (!parsed) continue;
    if (options.enabledOnly && !parsed.enabled) continue;
    if (options.kind && parsed.libraryKind !== options.kind) continue;
    skills.push({
      id: parsed.id,
      baseName: parsed.baseName,
      name: parsed.name,
      description: parsed.description,
      allowedTools: parsed.allowedTools,
      model: parsed.model,
      dirPath: parsed.dirPath,
      source: parsed.source,
      enabled: parsed.enabled,
      libraryKind: parsed.libraryKind,
      writingStyleType: parsed.writingStyleType,
    });
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

export async function readSkillLibraryItem(
  configHome: string,
  baseName: string,
  options: { includeDisabled?: boolean; syncExternal?: boolean } = {}
): Promise<ParsedSkill | null> {
  const safeName = safeSkillBaseName(baseName);
  if (!safeName) return null;

  if (options.syncExternal) {
    await syncExternalSkills(configHome);
  }

  const skillsDir = path.join(configHome, 'skills');
  const enabled = await readSkillFromDir(skillsDir, safeName, 'user');
  if (enabled) return enabled;

  if (options.includeDisabled) {
    return readSkillFromDir(skillsDir, `${safeName}.disabled`, 'user');
  }

  return null;
}
