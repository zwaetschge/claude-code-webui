import fs from 'fs/promises';
import path from 'path';
import type { SkillLibraryItem, SkillLibraryKind, WritingStyleType } from '@plum-code-webui/shared';
import { readDesignMdFromSkillDir, toDesignMdSummary, type DesignMdDocument } from './designMd.js';
import { syncManagedPlumSkills } from './managedPlumSkills.js';
import { syncExternalSkills } from './skillSync.js';
import { aliasesByTarget } from './skillAliases.js';
import {
  ensureLeanSkillCatalog,
  findSkillDirectory,
  getSkillCatalogDir,
  unregisterSkills,
} from './leanSkillCatalog.js';
import {
  classifyStylePresetName,
  ensureStylePresetLibrary,
  listStylePresetDirectories,
  readStylePresetPolicy,
  type StylePresetKind,
} from './stylePresetLibrary.js';

interface ParsedSkill extends Omit<SkillLibraryItem, 'designMd'> {
  content: string;
  designMd?: DesignMdDocument;
}

interface ListSkillLibraryOptions {
  kind?: SkillLibraryKind;
  enabledOnly?: boolean;
  syncExternal?: boolean;
}

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

  const presetKind = classifyStylePresetName(normalizedBase);
  if (presetKind) return presetKind;

  if (
    normalizedBase.startsWith('author-style-') ||
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
  source: 'user' | 'project',
  runtimeEnabled?: boolean,
  overrides: { kind?: SkillLibraryKind; entryType?: 'skill' | 'style' } = {}
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
    const designMd = (await readDesignMdFromSkillDir(skillDir)) ?? undefined;
    const libraryKind =
      overrides.kind ||
      (designMd ? 'design' : classifySkillLibraryKind(baseName, name, description, body));
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
      enabled: runtimeEnabled ?? !isDisabled,
      libraryKind,
      writingStyleType,
      designMd,
      content: body,
      entryType: overrides.entryType || 'skill',
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
  await syncManagedPlumSkills(configHome);
  await ensureLeanSkillCatalog(configHome);
  const styleMigration = await ensureStylePresetLibrary(configHome);
  await unregisterSkills(
    configHome,
    styleMigration.moved.map((preset) => preset.baseName)
  );

  const skills: SkillLibraryItem[] = [];
  const aliasIndex = await aliasesByTarget(configHome);
  const roots = [
    { dirPath: path.join(configHome, 'skills'), enabled: true },
    { dirPath: getSkillCatalogDir(configHome), enabled: false },
  ];
  const seen = new Set<string>();

  for (const root of roots) {
    let entries: import('fs').Dirent[];
    try {
      entries = await fs.readdir(root.dirPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const parsed = await readSkillFromDir(root.dirPath, entry.name, 'user', root.enabled);
      if (!parsed || seen.has(parsed.baseName)) continue;
      seen.add(parsed.baseName);
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
        designMd: parsed.designMd ? toDesignMdSummary(parsed.designMd) : undefined,
        entryType: parsed.entryType,
        aliases: aliasIndex.get(parsed.baseName),
      });
    }
  }

  if (!options.kind || options.kind === 'design' || options.kind === 'writing') {
    const requestedKind =
      options.kind === 'design' || options.kind === 'writing'
        ? (options.kind as StylePresetKind)
        : undefined;
    for (const preset of await listStylePresetDirectories(configHome, requestedKind)) {
      const parsed = await readSkillFromDir(
        path.dirname(preset.dirPath),
        path.basename(preset.dirPath),
        'user',
        false,
        { kind: preset.kind, entryType: 'style' }
      );
      if (!parsed || seen.has(parsed.baseName)) continue;
      seen.add(parsed.baseName);
      if (options.enabledOnly) continue;
      skills.push({
        id: `style-${parsed.baseName}`,
        baseName: parsed.baseName,
        name: parsed.name,
        description: parsed.description,
        allowedTools: parsed.allowedTools,
        model: parsed.model,
        dirPath: parsed.dirPath,
        source: parsed.source,
        enabled: false,
        libraryKind: preset.kind,
        writingStyleType: parsed.writingStyleType,
        designMd: parsed.designMd ? toDesignMdSummary(parsed.designMd) : undefined,
        entryType: 'style',
        aliases: aliasIndex.get(parsed.baseName),
      });
    }
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

export async function readSkillLibraryItem(
  configHome: string,
  baseName: string,
  options: { includeDisabled?: boolean; syncExternal?: boolean } = {}
): Promise<ParsedSkill | null> {
  const requestedName = safeSkillBaseName(baseName);
  if (!requestedName) return null;

  if (options.syncExternal !== false) {
    await syncExternalSkills(configHome);
  }
  await syncManagedPlumSkills(configHome);
  await ensureLeanSkillCatalog(configHome);
  const styleMigration = await ensureStylePresetLibrary(configHome);
  await unregisterSkills(
    configHome,
    styleMigration.moved.map((preset) => preset.baseName)
  );

  const location = await findSkillDirectory(configHome, requestedName);
  if (!location) return null;
  if (!location.enabled && options.includeDisabled === false) return null;
  const parsed = await readSkillFromDir(
    path.dirname(location.dirPath),
    path.basename(location.dirPath),
    'user',
    location.enabled,
    location.runtimeConfigurable
      ? { entryType: 'skill' }
      : {
          kind: location.dirPath.includes(`${path.sep}design${path.sep}`) ? 'design' : 'writing',
          entryType: 'style',
        }
  );
  if (parsed?.entryType === 'style') {
    const policy = await readStylePresetPolicy(configHome, parsed.libraryKind as StylePresetKind);
    if (policy.trim()) parsed.content = `${policy.trim()}\n\n${parsed.content}`;
  }
  return parsed;
}
