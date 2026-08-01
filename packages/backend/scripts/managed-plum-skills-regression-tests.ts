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
  try {
    await fn(path.join(root, 'config'));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

const userOwnedProductionReview = [
  '---',
  'name: production-ui-review',
  'description: User-owned skill',
  '---',
  '',
  '# User Skill',
  '',
].join('\n');

async function testInstallsOnlyCurrentManagedSkills(): Promise<void> {
  await withTempConfig('install', async (configHome) => {
    const result = await syncManagedPlumSkills(configHome);
    const capabilityPath = path.join(configHome, 'skills', 'capability-catalog', 'SKILL.md');
    const oraclePath = path.join(configHome, 'skill-catalog', 'oracle', 'SKILL.md');

    assert.equal(result.installed, 2);
    assert.equal(await pathExists(capabilityPath), true);
    assert.equal(await pathExists(oraclePath), true);
    assert.equal(
      await pathExists(path.join(configHome, 'skill-catalog', 'production-ui-review')),
      false
    );
    const content = await fs.readFile(capabilityPath, 'utf8');
    assert.match(content, /style presets/i);
    assert.match(content, /aliases/i);
  });
}

async function testRemovesOnlyPlumManagedRetiredCopy(): Promise<void> {
  await withTempConfig('retired', async (configHome) => {
    const retiredDir = path.join(configHome, 'skill-catalog', 'production-ui-review');
    await write(path.join(retiredDir, 'SKILL.md'), userOwnedProductionReview);
    await write(
      path.join(retiredDir, '.plum-managed-skill.json'),
      `${JSON.stringify({ source: 'plum-code-webui', name: 'production-ui-review', version: 1 })}\n`
    );

    const result = await syncManagedPlumSkills(configHome);
    assert.equal(result.installed, 2);
    assert.equal(result.updated, 1);
    assert.equal(await pathExists(retiredDir), false);
  });
}

async function testPreservesUserOwnedRetiredName(): Promise<void> {
  await withTempConfig('user-owned', async (configHome) => {
    const skillPath = path.join(configHome, 'skills', 'production-ui-review', 'SKILL.md');
    await write(skillPath, userOwnedProductionReview);

    const result = await syncManagedPlumSkills(configHome);
    assert.equal(result.installed, 2);
    assert.equal(result.updated, 0);
    assert.equal(await fs.readFile(skillPath, 'utf8'), userOwnedProductionReview);
  });
}

async function testPreservesUserOwnedDisabledCopy(): Promise<void> {
  await withTempConfig('disabled', async (configHome) => {
    const disabledPath = path.join(
      configHome,
      'skills',
      'production-ui-review.disabled',
      'SKILL.md'
    );
    await write(disabledPath, userOwnedProductionReview);

    const result = await syncManagedPlumSkills(configHome);
    assert.equal(result.installed, 2);
    assert.equal(await pathExists(disabledPath), true);
  });
}

async function testLibraryOmitsRetiredManagedSkill(): Promise<void> {
  await withTempConfig('library', async (configHome) => {
    const skills = await listSkillLibrary(configHome, {
      kind: 'skill',
      syncExternal: false,
    });

    assert.equal(
      skills.some((skill) => skill.baseName === 'production-ui-review'),
      false
    );
    assert.equal(skills.find((skill) => skill.baseName === 'capability-catalog')?.enabled, true);
    assert.equal(skills.find((skill) => skill.baseName === 'oracle')?.enabled, false);
  });
}

await testInstallsOnlyCurrentManagedSkills();
await testRemovesOnlyPlumManagedRetiredCopy();
await testPreservesUserOwnedRetiredName();
await testPreservesUserOwnedDisabledCopy();
await testLibraryOmitsRetiredManagedSkill();

console.log('managed Plum skills regression tests passed');
