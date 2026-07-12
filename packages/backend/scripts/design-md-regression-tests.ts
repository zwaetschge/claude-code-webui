import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { importDesignMdPreset, parseDesignMd, serializeDesignMd } from '../src/utils/designMd.js';
import { listSkillLibrary, readSkillLibraryItem } from '../src/utils/skillLibrary.js';

const sampleDesignMd = [
  '---',
  'name: Heritage',
  'description: Editorial controls for serious product work',
  'colors:',
  '  primary: "#1A1C1E"',
  '  secondary: "#6C7278"',
  '  tertiary: "#B8422E"',
  '  neutral: "#F7F5F2"',
  'typography:',
  '  h1:',
  '    fontFamily: Public Sans',
  '    fontSize: 3rem',
  '  body-md:',
  '    fontFamily: Public Sans',
  '    fontSize: 1rem',
  'rounded:',
  '  sm: 4px',
  '  md: 8px',
  'spacing:',
  '  sm: 8px',
  '  md: 16px',
  'components:',
  '  button-primary:',
  '    backgroundColor: "{colors.tertiary}"',
  '    textColor: "#ffffff"',
  '    rounded: "{rounded.sm}"',
  '---',
  '',
  '## Overview',
  '',
  'Architectural Minimalism meets Journalistic Gravitas.',
  '',
  '## Colors',
  '',
  'The palette is rooted in high-contrast neutrals and a single accent color.',
  '',
].join('\n');

async function write(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf-8');
}

async function withTempHome(fn: (configHome: string) => Promise<void>): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plum-design-md-'));
  try {
    await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function testParseAndSerializeDesignMd(): Promise<void> {
  const parsed = parseDesignMd(sampleDesignMd);

  assert.equal(parsed.name, 'Heritage');
  assert.equal(parsed.description, 'Editorial controls for serious product work');
  assert.equal(parsed.tokens.colors.primary, '#1A1C1E');
  assert.equal(parsed.tokens.typography.h1.fontFamily, 'Public Sans');
  assert.equal(parsed.tokens.components['button-primary'].backgroundColor, '{colors.tertiary}');
  assert.deepEqual(
    parsed.sections.map((section) => section.title),
    ['Overview', 'Colors']
  );
  assert.equal(parsed.errors.length, 0);

  const serialized = serializeDesignMd(parsed);
  assert.equal(serialized, sampleDesignMd.trimEnd() + '\n');

  const duplicate = parseDesignMd(`${sampleDesignMd}\n## Colors\nRepeated`);
  assert.ok(
    duplicate.errors.some((finding) => finding.code === 'duplicate-section'),
    'duplicate section headings should be reported'
  );
}

async function testImportListsAndExportsDesignMd(): Promise<void> {
  await withTempHome(async (configHome) => {
    const result = await importDesignMdPreset(
      Buffer.from(sampleDesignMd),
      'DESIGN.md',
      configHome,
      {
        conflict: 'skip',
      }
    );

    assert.equal(result.status, 'imported');
    assert.equal(result.skill.baseName, 'design-heritage');
    assert.equal(result.skill.name, 'design-heritage');

    const styles = await listSkillLibrary(configHome, {
      kind: 'design',
      enabledOnly: true,
      syncExternal: false,
    });
    assert.equal(styles.length, 1);
    assert.equal(styles[0]?.baseName, 'design-heritage');
    assert.equal(styles[0]?.designMd?.name, 'Heritage');
    assert.equal(styles[0]?.designMd?.tokens.colors.tertiary, '#B8422E');
    assert.equal(styles[0]?.designMd?.sections.includes('Overview'), true);

    const style = await readSkillLibraryItem(configHome, 'design-heritage', {
      syncExternal: false,
    });
    assert.equal(style?.designMd?.raw.trimEnd(), sampleDesignMd.trimEnd());
    assert.match(style?.content ?? '', /DESIGN\.md/);

    const skipped = await importDesignMdPreset(
      Buffer.from(sampleDesignMd),
      'DESIGN.md',
      configHome,
      { conflict: 'skip' }
    );
    assert.equal(skipped.status, 'skipped');
    assert.equal(skipped.reason, 'already_exists');
  });
}

async function testExistingPresetDesignMdMetadata(): Promise<void> {
  await withTempHome(async (configHome) => {
    await write(
      path.join(configHome, 'skills', 'design-codex', 'SKILL.md'),
      [
        '---',
        'name: design-codex',
        'description: Codex visual preset',
        '---',
        '',
        '# Codex',
        '',
      ].join('\n')
    );
    await write(path.join(configHome, 'skills', 'design-codex', 'DESIGN.md'), sampleDesignMd);

    const styles = await listSkillLibrary(configHome, {
      kind: 'design',
      enabledOnly: true,
      syncExternal: false,
    });

    assert.equal(styles[0]?.baseName, 'design-codex');
    assert.equal(styles[0]?.designMd?.name, 'Heritage');
    assert.equal(styles[0]?.designMd?.tokens.colors.primary, '#1A1C1E');
  });
}

async function testSessionContextIncludesDesignMd(): Promise<void> {
  await withTempHome(async (configHome) => {
    await write(
      path.join(configHome, 'skills', 'design-heritage', 'SKILL.md'),
      [
        '---',
        'name: design-heritage',
        'description: Heritage preset',
        '---',
        '',
        '# Heritage',
        '',
        'Follow the paired DESIGN.md file.',
        '',
      ].join('\n')
    );
    await write(path.join(configHome, 'skills', 'design-heritage', 'DESIGN.md'), sampleDesignMd);

    process.env.WEBUI_CONFIG_HOME = configHome;
    const managerUrl = new URL('../src/services/claude/ClaudeProcessManager.ts', import.meta.url)
      .href;
    const managerModule = await import(`${managerUrl}?designMd=${Date.now()}`);
    const buildSessionStyleContextForTest = managerModule.buildSessionStyleContextForTest as (
      selection: { designStyleSkill?: string | null; writingStyleSkill?: string | null },
      configHomeOverride: string
    ) => Promise<string | null>;

    const context = await buildSessionStyleContextForTest(
      { designStyleSkill: 'design-heritage' },
      configHome
    );

    assert.match(context ?? '', /Active DESIGN\.md/);
    assert.match(context ?? '', /colors:/);
    assert.match(context ?? '', /primary: "#1A1C1E"/);
  });
}

async function main(): Promise<void> {
  await testParseAndSerializeDesignMd();
  await testImportListsAndExportsDesignMd();
  await testExistingPresetDesignMdMetadata();
  await testSessionContextIncludesDesignMd();
  console.log('design.md regression tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
