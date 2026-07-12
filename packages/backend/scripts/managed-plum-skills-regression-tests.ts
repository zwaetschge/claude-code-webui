import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { listSkillLibrary } from '../src/utils/skillLibrary.js';
import { syncManagedPlumSkills } from '../src/utils/managedPlumSkills.js';

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function write(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

async function withTempConfig(
  testName: string,
  fn: (configHome: string) => Promise<void>
): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `plum-managed-skills-${testName}-`));
  await fn(path.join(root, 'config'));
}

async function testInstallsProductionUiReviewSkill(): Promise<void> {
  await withTempConfig('install', async (configHome) => {
    const result = await syncManagedPlumSkills(configHome);
    const skillDir = path.join(configHome, 'skills', 'production-ui-review');
    const skillPath = path.join(skillDir, 'SKILL.md');
    const markerPath = path.join(skillDir, '.plum-managed-skill.json');

    assert.equal(result.installed, 1);
    assert.equal(await pathExists(skillPath), true);
    assert.equal(await pathExists(markerPath), true);

    const content = await fs.readFile(skillPath, 'utf8');
    assert.match(content, /^name: production-ui-review/m);
    assert.match(content, /evidence over taste/i);
    assert.match(content, /Score caps/i);
    assert.match(content, /frontend, product UI, onboarding, dashboard, form, checkout/i);
  });
}

async function testDoesNotOverwriteUserOwnedSkill(): Promise<void> {
  await withTempConfig('user-owned', async (configHome) => {
    const skillPath = path.join(configHome, 'skills', 'production-ui-review', 'SKILL.md');
    const userContent = [
      '---',
      'name: production-ui-review',
      'description: User-owned skill',
      '---',
      '',
      '# User Skill',
      '',
    ].join('\n');
    await write(skillPath, userContent);

    const result = await syncManagedPlumSkills(configHome);
    assert.equal(result.installed, 0);
    assert.deepEqual(result.skipped, ['production-ui-review']);
    assert.equal(await fs.readFile(skillPath, 'utf8'), userContent);
  });
}

async function testDoesNotRecreateDisabledSkill(): Promise<void> {
  await withTempConfig('disabled', async (configHome) => {
    const disabledPath = path.join(
      configHome,
      'skills',
      'production-ui-review.disabled',
      'SKILL.md'
    );
    await write(
      disabledPath,
      [
        '---',
        'name: production-ui-review',
        'description: Disabled by user',
        '---',
        '',
        '# Disabled',
        '',
      ].join('\n')
    );

    const result = await syncManagedPlumSkills(configHome);
    assert.equal(result.installed, 0);
    assert.deepEqual(result.skipped, ['production-ui-review.disabled']);
    assert.equal(await pathExists(path.join(configHome, 'skills', 'production-ui-review')), false);
  });
}

async function testSkillLibraryListsManagedSkillAsNormalSkill(): Promise<void> {
  await withTempConfig('library', async (configHome) => {
    const skills = await listSkillLibrary(configHome, { kind: 'skill', enabledOnly: true });
    const productionReview = skills.find((skill) => skill.baseName === 'production-ui-review');

    assert.ok(productionReview);
    assert.equal(productionReview.name, 'production-ui-review');
    assert.equal(productionReview.libraryKind, 'skill');
    assert.match(productionReview.description, /Production UI quality gate/);
  });
}

await testInstallsProductionUiReviewSkill();
await testDoesNotOverwriteUserOwnedSkill();
await testDoesNotRecreateDisabledSkill();
await testSkillLibraryListsManagedSkillAsNormalSkill();

console.log('managed Plum skills regression tests passed');
