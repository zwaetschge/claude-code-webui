import fs from 'fs/promises';
import path from 'path';
import type { DesignMdScalar, DesignMdSummary, DesignMdTokens } from '@plum-code-webui/shared';
import { sanitizeSkillName } from './skillImport.js';
import { findSkillDirectory } from './leanSkillCatalog.js';

export interface DesignMdFinding {
  code: string;
  message: string;
  path?: string;
}

export interface DesignMdSection {
  title: string;
  content: string;
}

export interface DesignMdDocument extends Omit<DesignMdSummary, 'sections'> {
  frontmatter: Record<string, unknown>;
  markdown: string;
  raw: string;
  sections: DesignMdSection[];
}

export interface ImportedDesignMdPreset {
  baseName: string;
  name: string;
  description: string;
  dirPath: string;
}

export interface ImportDesignMdOptions {
  conflict: 'skip' | 'overwrite';
}

const DESIGN_MD_SCHEMA_KEYS = new Set([
  'version',
  'name',
  'description',
  'colors',
  'typography',
  'rounded',
  'spacing',
  'components',
]);

const SECTION_ORDER = [
  'overview',
  'colors',
  'typography',
  'layout',
  'elevation & depth',
  'shapes',
  'components',
  "do's and don'ts",
];

function normalizeNewline(content: string): string {
  return content.replace(/\r\n/g, '\n');
}

function parseFrontmatter(content: string): {
  yaml: string;
  body: string;
  hasFrontmatter: boolean;
} {
  const normalized = normalizeNewline(content).trimEnd();
  const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/);
  if (!match) {
    return { yaml: '', body: normalized, hasFrontmatter: false };
  }

  return {
    yaml: match[1] ?? '',
    body: (match[2] ?? '').trim(),
    hasFrontmatter: true,
  };
}

function stripInlineComment(value: string): string {
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if ((char === '"' || char === "'") && value[index - 1] !== '\\') {
      quote = quote === char ? null : (quote ?? char);
    }
    if (char === '#' && !quote && /\s/.test(value[index - 1] ?? ' ')) {
      return value.slice(0, index).trimEnd();
    }
  }
  return value;
}

function parseScalar(value: string): DesignMdScalar {
  const trimmed = stripInlineComment(value.trim());
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

function parseSimpleYaml(yaml: string, warnings: DesignMdFinding[]): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  const stack: Array<{ indent: number; object: Record<string, unknown>; path: string[] }> = [
    { indent: -1, object: root, path: [] },
  ];

  const lines = normalizeNewline(yaml).split('\n');
  for (const rawLine of lines) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith('#')) continue;
    if (rawLine.trimStart().startsWith('- ')) {
      warnings.push({
        code: 'unsupported-yaml-list',
        message:
          'YAML lists are preserved as raw DESIGN.md text but not exposed as preview tokens.',
      });
      continue;
    }

    const indent = rawLine.match(/^ */)?.[0].length ?? 0;
    const line = rawLine.trim();
    const separator = line.indexOf(':');
    if (separator <= 0) {
      warnings.push({
        code: 'unsupported-yaml-line',
        message: `Could not parse YAML line: ${line}`,
      });
      continue;
    }

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();

    while (stack.length > 1 && indent <= stack[stack.length - 1]!.indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1]!;
    if (value === '') {
      const object: Record<string, unknown> = {};
      parent.object[key] = object;
      stack.push({ indent, object, path: [...parent.path, key] });
    } else {
      parent.object[key] = parseScalar(value);
    }
  }

  return root;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asScalarRecord(value: unknown): Record<string, DesignMdScalar> {
  const record = asRecord(value);
  const output: Record<string, DesignMdScalar> = {};
  for (const [key, item] of Object.entries(record)) {
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
      output[key] = item;
    }
  }
  return output;
}

function asNestedScalarRecord(value: unknown): Record<string, Record<string, DesignMdScalar>> {
  const record = asRecord(value);
  const output: Record<string, Record<string, DesignMdScalar>> = {};
  for (const [key, item] of Object.entries(record)) {
    const nested = asScalarRecord(item);
    if (Object.keys(nested).length > 0) {
      output[key] = nested;
    }
  }
  return output;
}

function asColorRecord(value: unknown): Record<string, string> {
  const record = asScalarRecord(value);
  const output: Record<string, string> = {};
  for (const [key, item] of Object.entries(record)) {
    output[key] = String(item);
  }
  return output;
}

function extractExtensions(frontmatter: Record<string, unknown>): Record<string, unknown> {
  const extensions: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(frontmatter)) {
    if (!DESIGN_MD_SCHEMA_KEYS.has(key)) {
      extensions[key] = value;
    }
  }
  return extensions;
}

function extractSections(markdown: string, errors: DesignMdFinding[], warnings: DesignMdFinding[]) {
  const sections: DesignMdSection[] = [];
  const seen = new Set<string>();
  const matches = [...markdown.matchAll(/^##\s+(.+)$/gm)];

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]!;
    const title = match[1]!.trim();
    const normalizedTitle = title.toLowerCase();
    const contentStart = (match.index ?? 0) + match[0].length;
    const nextStart = matches[index + 1]?.index ?? markdown.length;
    const content = markdown.slice(contentStart, nextStart).trim();

    if (seen.has(normalizedTitle)) {
      errors.push({
        code: 'duplicate-section',
        path: `sections.${title}`,
        message: `Duplicate DESIGN.md section heading: ${title}`,
      });
    }
    seen.add(normalizedTitle);
    sections.push({ title, content });
  }

  let lastKnownIndex = -1;
  for (const section of sections) {
    const normalized = section.title.toLowerCase();
    const alias =
      normalized === 'brand & style'
        ? 'overview'
        : normalized === 'layout & spacing'
          ? 'layout'
          : normalized === 'elevation'
            ? 'elevation & depth'
            : normalized;
    const orderIndex = SECTION_ORDER.indexOf(alias);
    if (orderIndex === -1) continue;
    if (orderIndex < lastKnownIndex) {
      warnings.push({
        code: 'section-order',
        path: `sections.${section.title}`,
        message: `Section "${section.title}" appears out of the canonical DESIGN.md order.`,
      });
      break;
    }
    lastKnownIndex = orderIndex;
  }

  return sections;
}

function makeTokens(frontmatter: Record<string, unknown>): DesignMdTokens {
  return {
    colors: asColorRecord(frontmatter.colors),
    typography: asNestedScalarRecord(frontmatter.typography),
    rounded: asScalarRecord(frontmatter.rounded),
    spacing: asScalarRecord(frontmatter.spacing),
    components: asNestedScalarRecord(frontmatter.components),
    extensions: extractExtensions(frontmatter),
  };
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

export function parseDesignMd(content: string): DesignMdDocument {
  const errors: DesignMdFinding[] = [];
  const warnings: DesignMdFinding[] = [];
  const raw = normalizeNewline(content).trimEnd() + '\n';
  const { yaml, body, hasFrontmatter } = parseFrontmatter(raw);

  if (!hasFrontmatter) {
    errors.push({
      code: 'missing-frontmatter',
      message: 'DESIGN.md must start with YAML front matter delimited by --- fences.',
    });
  }

  const frontmatter = parseSimpleYaml(yaml, warnings);
  const name = stringValue(frontmatter.name)?.trim() || 'Untitled Design';
  const description = stringValue(frontmatter.description)?.trim();
  const version = stringValue(frontmatter.version)?.trim();
  const sections = extractSections(body, errors, warnings);

  return {
    name,
    description,
    version,
    tokens: makeTokens(frontmatter),
    sections,
    errors,
    warnings,
    frontmatter,
    markdown: body,
    raw,
  };
}

export function toDesignMdSummary(document: DesignMdDocument): DesignMdSummary {
  return {
    name: document.name,
    description: document.description,
    version: document.version,
    tokens: document.tokens,
    sections: document.sections.map((section) => section.title),
    errors: document.errors,
    warnings: document.warnings,
  };
}

export function serializeDesignMd(document: DesignMdDocument): string {
  if (document.raw.trim()) {
    return document.raw.trimEnd() + '\n';
  }

  const lines = ['---', `name: ${document.name}`];
  if (document.description) lines.push(`description: ${document.description}`);
  if (document.version) lines.push(`version: ${document.version}`);
  lines.push('---', '');
  lines.push(document.markdown.trim() || `## Overview\n\n${document.description || document.name}`);
  return `${lines.join('\n').trimEnd()}\n`;
}

export async function readDesignMdFromSkillDir(skillDir: string): Promise<DesignMdDocument | null> {
  try {
    const content = await fs.readFile(path.join(skillDir, 'DESIGN.md'), 'utf-8');
    return parseDesignMd(content);
  } catch {
    return null;
  }
}

function compactOverview(document: DesignMdDocument): string {
  const overview =
    document.sections.find((section) => section.title.toLowerCase() === 'overview')?.content ||
    document.markdown;
  return (document.description || overview || document.name)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

function buildDesignSkillMarkdown(baseName: string, document: DesignMdDocument): string {
  const description = compactOverview(document).replace(/"/g, '\\"');
  return [
    '---',
    `name: ${baseName}`,
    `description: "${description}"`,
    '---',
    '',
    `# ${document.name} Design System`,
    '',
    'Use the accompanying `DESIGN.md` file in this skill folder as the structured source of truth for visual design tokens, rationale, and component guidance.',
    '',
    'When this preset is active in Plum Code WebUI, the session context includes both this skill instruction and the full `DESIGN.md` content.',
    '',
  ].join('\n');
}

function designSkillNameFromDocument(
  document: DesignMdDocument,
  originalname: string
): string | null {
  const source =
    document.name && document.name !== 'Untitled Design'
      ? document.name
      : originalname.replace(/\.(md|markdown)$/i, '');
  const sanitized = sanitizeSkillName(source);
  if (!sanitized) return null;
  return sanitized.startsWith('design-') ? sanitized : `design-${sanitized}`;
}

export async function importDesignMdPreset(
  buffer: Buffer,
  originalname: string,
  configHome: string,
  options: ImportDesignMdOptions
): Promise<
  | { status: 'imported'; skill: ImportedDesignMdPreset }
  | { status: 'skipped'; reason: string; skillName?: string }
> {
  const document = parseDesignMd(buffer.toString('utf-8'));
  if (document.errors.some((finding) => finding.code === 'missing-frontmatter')) {
    return { status: 'skipped', reason: 'missing_frontmatter' };
  }

  const baseName = designSkillNameFromDocument(document, originalname);
  if (!baseName) {
    return { status: 'skipped', reason: 'name_sanitized_to_empty', skillName: document.name };
  }

  const existing = await findSkillDirectory(configHome, baseName);
  const destDir = existing?.dirPath || path.join(configHome, 'style-library', 'design', baseName);
  const destExists = !!existing;

  if (destExists && options.conflict === 'skip') {
    return { status: 'skipped', reason: 'already_exists', skillName: baseName };
  }

  if (destExists) {
    await fs.rm(existing?.dirPath || destDir, { recursive: true, force: true });
  }

  await fs.mkdir(destDir, { recursive: true });
  await fs.writeFile(path.join(destDir, 'DESIGN.md'), serializeDesignMd(document), 'utf-8');
  await fs.writeFile(
    path.join(destDir, 'SKILL.md'),
    buildDesignSkillMarkdown(baseName, document),
    'utf-8'
  );

  return {
    status: 'imported',
    skill: {
      baseName,
      name: baseName,
      description: compactOverview(document),
      dirPath: destDir,
    },
  };
}

export function buildFallbackDesignMd(
  input: Pick<ImportedDesignMdPreset, 'baseName' | 'name' | 'description'> & { content?: string }
): string {
  const displayName = input.name || input.baseName;
  const overview = (input.description || input.content || displayName).trim();
  return [
    '---',
    `name: ${displayName.replace(/^design-/, '')}`,
    input.description ? `description: ${input.description.replace(/\n/g, ' ')}` : undefined,
    '---',
    '',
    '## Overview',
    '',
    overview,
    '',
  ]
    .filter((line): line is string => typeof line === 'string')
    .join('\n');
}
