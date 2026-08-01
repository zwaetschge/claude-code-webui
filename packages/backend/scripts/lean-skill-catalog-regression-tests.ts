import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { ensureLeanSkillCatalog, setSkillRuntimeEnabled } from '../src/utils/leanSkillCatalog.js';
import { importSkillIntoCatalog } from '../src/utils/skillImport.js';
import { listSkillLibrary, readSkillLibraryItem } from '../src/utils/skillLibrary.js';
import { syncExternalSkills } from '../src/utils/skillSync.js';

const execFileAsync = promisify(execFile);

async function writeSkill(root: string, name: string, description: string): Promise<void> {
  const dir = path.join(root, name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`,
    'utf-8'
  );
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plum-lean-skills-'));
  const configHome = path.join(root, 'claude');
  const codexHome = path.join(root, 'codex');
  const externalSkills = path.join(root, 'external-skills');
  const previousCodexHome = process.env.CODEX_HOME;
  const previousMigrationTest = process.env.PLUM_LEAN_SKILL_MIGRATION_TEST;
  process.env.CODEX_HOME = codexHome;
  process.env.PLUM_LEAN_SKILL_MIGRATION_TEST = '1';

  try {
    await writeSkill(path.join(configHome, 'skills'), 'api-design', 'Core API design');
    await writeSkill(
      path.join(configHome, 'skills'),
      'production-ui-review',
      'Optional production UI review'
    );
    await writeSkill(
      path.join(configHome, 'skills'),
      'design-heritage',
      'Optional heritage design style'
    );
    await writeSkill(
      path.join(configHome, 'skills'),
      'legacy-review',
      'Persisted alias source that must be pruned'
    );
    await writeSkill(
      path.join(configHome, 'skills'),
      'legacy-review.disabled',
      'Persisted disabled alias source that must be pruned'
    );
    await writeSkill(
      path.join(configHome, 'skill-catalog'),
      'retired-research',
      'Persisted retired skill that must be pruned'
    );
    await writeSkill(externalSkills, 'legacy-review', 'External alias source');
    await writeSkill(externalSkills, 'retired-research', 'External retired source');
    await fs.writeFile(
      path.join(externalSkills, 'retired-zip.skill.zip'),
      Buffer.from(
        'UEsDBBQAAAAAAI267Vx1mH6zSgAAAEoAAAAUAAAAcmV0aXJlZC16aXAvU0tJTEwubWQtLS0KbmFtZTogcmV0aXJlZC16aXAKZGVzY3JpcHRpb246IHJldGlyZWQgemlwIGZpeHR1cmUKLS0tCgojIHJldGlyZWQgemlwClBLAQIUAxQAAAAAAI267Vx1mH6zSgAAAEoAAAAUAAAAAAAAAAAAAACAAQAAAAByZXRpcmVkLXppcC9TS0lMTC5tZFBLBQYAAAAAAQABAEIAAAB8AAAAAAA=',
        'base64'
      )
    );
    await writeSkill(path.join(codexHome, 'skills'), 'api-design', 'Core API design');
    await writeSkill(
      path.join(codexHome, 'skills'),
      'legacy-specialist',
      'Legacy specialist capability'
    );
    await fs.mkdir(path.join(codexHome, 'agents'), { recursive: true });
    await fs.writeFile(
      path.join(codexHome, 'agents', 'legacy-agent.md'),
      '---\nname: legacy-agent\ndescription: Legacy agent fixture\n---\n',
      'utf-8'
    );
    await fs.mkdir(configHome, { recursive: true });
    await fs.writeFile(
      path.join(configHome, 'skill-aliases.json'),
      `${JSON.stringify({
        version: 1,
        aliases: { 'legacy-review': 'production-ui-review' },
        retired: ['retired-research', 'retired-zip'],
      })}\n`,
      'utf-8'
    );

    await syncExternalSkills(configHome, { externalDirs: [externalSkills], force: true });
    const migration = await ensureLeanSkillCatalog(configHome);
    assert.equal(migration.active, 1);
    assert.equal(migration.catalog, 3);
    assert.equal(migration.migratedLegacyCodex, 2);
    assert.equal(migration.migratedLegacyCodexAgents, 1);
    assert.equal(migration.prunedObsolete, 3);
    assert.equal(await exists(path.join(configHome, 'skills', 'legacy-review')), false);
    assert.equal(await exists(path.join(configHome, 'skills', 'legacy-review.disabled')), false);
    assert.equal(await exists(path.join(configHome, 'skill-catalog', 'retired-research')), false);
    assert.equal(await exists(path.join(configHome, 'skill-catalog', 'retired-zip')), false);
    assert.equal(await exists(path.join(externalSkills, 'legacy-review', 'SKILL.md')), true);
    assert.equal(await exists(path.join(externalSkills, 'retired-research', 'SKILL.md')), true);
    assert.equal(await exists(path.join(externalSkills, 'retired-zip.skill.zip')), true);

    await syncExternalSkills(configHome, { externalDirs: [externalSkills], force: true });
    const secondMigration = await ensureLeanSkillCatalog(configHome);
    assert.equal(secondMigration.prunedObsolete, 0);
    assert.equal(await exists(path.join(configHome, 'skills', 'legacy-review')), false);
    assert.equal(await exists(path.join(configHome, 'skill-catalog', 'legacy-review')), false);
    assert.equal(await exists(path.join(configHome, 'skills', 'retired-research')), false);
    assert.equal(await exists(path.join(configHome, 'skill-catalog', 'retired-research')), false);
    assert.equal(await exists(path.join(configHome, 'skills', 'retired-zip')), false);
    assert.equal(await exists(path.join(configHome, 'skill-catalog', 'retired-zip')), false);
    assert.equal(
      await exists(path.join(configHome, 'skills', 'production-ui-review', 'SKILL.md')),
      false
    );
    assert.equal(
      await exists(path.join(configHome, 'skill-catalog', 'production-ui-review', 'SKILL.md')),
      true
    );
    assert.equal(
      await exists(path.join(configHome, 'skill-catalog', 'legacy-specialist', 'SKILL.md')),
      true
    );
    assert.equal(await exists(path.join(codexHome, 'skills', 'api-design')), false);
    assert.equal(await exists(path.join(codexHome, 'agents', 'legacy-agent.md')), false);
    assert.equal(await exists(path.join(configHome, 'agents', 'legacy-agent.md')), true);

    const allSkills = await listSkillLibrary(configHome, { syncExternal: false });
    assert.equal(allSkills.find((skill) => skill.baseName === 'api-design')?.enabled, true);
    assert.equal(
      allSkills.find((skill) => skill.baseName === 'production-ui-review')?.enabled,
      false
    );

    const style = await readSkillLibraryItem(configHome, 'design-heritage', {
      syncExternal: false,
    });
    assert.equal(style?.libraryKind, 'design');
    assert.equal(style?.entryType, 'style');
    assert.equal(style?.enabled, false);
    assert.match(style?.dirPath || '', /style-library/);
    assert.equal(await setSkillRuntimeEnabled(configHome, 'design-heritage', true), false);

    assert.equal(await setSkillRuntimeEnabled(configHome, 'legacy-review', true), true);
    assert.equal(
      await exists(path.join(configHome, 'skills', 'production-ui-review', 'SKILL.md')),
      true
    );
    assert.equal(await setSkillRuntimeEnabled(configHome, 'production-ui-review', false), true);
    assert.equal(
      await exists(path.join(configHome, 'skill-catalog', 'production-ui-review', 'SKILL.md')),
      true
    );

    const scriptPath = path.resolve(process.cwd(), '../../scripts/capability-catalog.mjs');
    const { stdout } = await execFileAsync(process.execPath, [scriptPath, 'search', 'heritage'], {
      env: { ...process.env, WEBUI_CONFIG_HOME: configHome },
    });
    const results = JSON.parse(stdout) as Array<{
      baseName: string;
      enabled: boolean;
      path: string;
      entryType: string;
    }>;
    assert.equal(results[0]?.baseName, 'design-heritage');
    assert.equal(results[0]?.enabled, false);
    assert.equal(results[0]?.entryType, 'style');
    assert.match(results[0]?.path || '', /style-library/);

    for (let index = 0; index < 90; index += 1) {
      await writeSkill(
        path.join(configHome, 'skill-catalog'),
        `large-catalog-${index}`,
        `Large catalog regression ${index} ${'discoverable '.repeat(90)}`
      );
    }
    const listed = await execFileAsync(process.execPath, [scriptPath, 'list'], {
      env: { ...process.env, WEBUI_CONFIG_HOME: configHome },
      maxBuffer: 4 * 1024 * 1024,
    });
    assert.ok(listed.stdout.length > 64 * 1024, 'catalog fixture should exceed one pipe buffer');
    assert.ok(
      JSON.parse(listed.stdout).length > 90,
      'large catalog output should remain valid JSON'
    );

    const shown = await execFileAsync(process.execPath, [scriptPath, 'show', 'legacy-review'], {
      env: { ...process.env, WEBUI_CONFIG_HOME: configHome },
    });
    assert.match(shown.stdout, /^---\nname: production-ui-review/m);

    const safetyHome = path.join(root, 'safety-claude');
    const safetyExternal = path.join(root, 'safety-external');
    await writeSkill(path.join(safetyHome, 'skill-catalog'), 'canonical-skill', 'Canonical');
    await writeSkill(path.join(safetyHome, 'skills'), 'legacy-active', 'Legacy active alias');
    await writeSkill(path.join(safetyHome, 'skills'), 'orphan-alias', 'Recoverable alias source');
    await writeSkill(path.join(safetyHome, 'skills'), 'custom-local', 'LOCAL-EDIT');
    await writeSkill(safetyExternal, 'custom-local', 'EXTERNAL-COPY');
    await writeSkill(safetyExternal, 'fresh-external', 'Fresh external skill');
    await writeSkill(path.join(codexHome, 'skills'), 'old-retired', 'Retired Codex copy');
    await fs.mkdir(path.join(safetyHome, 'integrations'), { recursive: true });
    await fs.writeFile(
      path.join(safetyHome, 'integrations', 'skill-catalog-state.json'),
      `${JSON.stringify({
        version: 1,
        activeSkills: ['legacy-active', 'orphan-alias'],
      })}\n`,
      'utf-8'
    );
    await fs.writeFile(
      path.join(safetyHome, 'skill-aliases.json'),
      `${JSON.stringify({
        version: 1,
        aliases: {
          'legacy-active': 'canonical-skill',
          'orphan-alias': 'missing-canonical',
          'recoverable-upload': 'missing-upload-target',
        },
        retired: ['old-retired', 'retired-zip'],
      })}\n`,
      'utf-8'
    );
    await fs.writeFile(
      path.join(safetyExternal, 'allowed-name.skill.zip'),
      Buffer.from(
        'UEsDBBQAAAAAAI267Vx1mH6zSgAAAEoAAAAUAAAAcmV0aXJlZC16aXAvU0tJTEwubWQtLS0KbmFtZTogcmV0aXJlZC16aXAKZGVzY3JpcHRpb246IHJldGlyZWQgemlwIGZpeHR1cmUKLS0tCgojIHJldGlyZWQgemlwClBLAQIUAxQAAAAAAI267Vx1mH6zSgAAAEoAAAAUAAAAAAAAAAAAAACAAQAAAAByZXRpcmVkLXppcC9TS0lMTC5tZFBLBQYAAAAAAQABAEIAAAB8AAAAAAA=',
        'base64'
      )
    );

    const retiredUpload = await importSkillIntoCatalog(
      Buffer.from(
        'UEsDBBQAAAAAAI267Vx1mH6zSgAAAEoAAAAUAAAAcmV0aXJlZC16aXAvU0tJTEwubWQtLS0KbmFtZTogcmV0aXJlZC16aXAKZGVzY3JpcHRpb246IHJldGlyZWQgemlwIGZpeHR1cmUKLS0tCgojIHJldGlyZWQgemlwClBLAQIUAxQAAAAAAI267Vx1mH6zSgAAAEoAAAAUAAAAAAAAAAAAAACAAQAAAAByZXRpcmVkLXppcC9TS0lMTC5tZFBLBQYAAAAAAQABAEIAAAB8AAAAAAA=',
        'base64'
      ),
      'allowed-name.skill.zip',
      safetyHome,
      { conflict: 'skip' }
    );
    assert.equal(retiredUpload.status, 'skipped');
    if (retiredUpload.status === 'skipped') assert.equal(retiredUpload.reason, 'retired_name');

    const consolidatedUpload = await importSkillIntoCatalog(
      Buffer.from('---\nname: legacy-active\ndescription: Legacy upload\n---\n\n# Legacy upload\n'),
      'legacy-active.md',
      safetyHome,
      { conflict: 'skip' }
    );
    assert.equal(consolidatedUpload.status, 'skipped');
    if (consolidatedUpload.status === 'skipped') {
      assert.equal(consolidatedUpload.reason, 'consolidated_as:canonical-skill');
    }

    const recoverableUpload = await importSkillIntoCatalog(
      Buffer.from(
        '---\nname: recoverable-upload\ndescription: Alias recovery upload\n---\n\n# Recoverable\n'
      ),
      'recoverable-upload.md',
      safetyHome,
      { conflict: 'skip' }
    );
    assert.equal(recoverableUpload.status, 'imported');

    await writeSkill(
      path.join(safetyHome, 'skill-catalog'),
      'duplicate-skill',
      'ON-DEMAND-ORIGINAL'
    );
    const duplicateUpload = await importSkillIntoCatalog(
      Buffer.from('---\nname: duplicate-skill\ndescription: UPLOAD-COPY\n---\n\n# Duplicate\n'),
      'duplicate-skill.md',
      safetyHome,
      { conflict: 'skip' }
    );
    assert.equal(duplicateUpload.status, 'skipped');
    if (duplicateUpload.status === 'skipped') {
      assert.equal(duplicateUpload.reason, 'already_exists');
    }
    assert.equal(await exists(path.join(safetyHome, 'skills', 'duplicate-skill')), false);
    assert.match(
      await fs.readFile(
        path.join(safetyHome, 'skill-catalog', 'duplicate-skill', 'SKILL.md'),
        'utf-8'
      ),
      /ON-DEMAND-ORIGINAL/
    );

    await syncExternalSkills(safetyHome, {
      externalDirs: [safetyExternal],
      force: true,
    });
    const safetyMigration = await ensureLeanSkillCatalog(safetyHome);
    assert.ok(safetyMigration.prunedObsolete >= 2);
    assert.equal(await exists(path.join(safetyHome, 'skills', 'legacy-active')), false);
    assert.equal(
      await exists(path.join(safetyHome, 'skills', 'canonical-skill', 'SKILL.md')),
      true
    );
    assert.equal(await exists(path.join(safetyHome, 'skills', 'orphan-alias', 'SKILL.md')), true);
    assert.equal(await exists(path.join(safetyHome, 'skill-catalog', 'old-retired')), false);
    assert.equal(await exists(path.join(codexHome, 'skills', 'old-retired')), false);
    assert.equal(await exists(path.join(safetyHome, 'skill-catalog', 'retired-zip')), false);
    assert.equal(
      await exists(path.join(safetyHome, 'skill-catalog', 'fresh-external', 'SKILL.md')),
      true
    );
    assert.match(
      await fs.readFile(
        path.join(safetyHome, 'skill-catalog', 'custom-local', 'SKILL.md'),
        'utf-8'
      ),
      /LOCAL-EDIT/
    );
    assert.doesNotMatch(
      await fs.readFile(
        path.join(safetyHome, 'skill-catalog', 'custom-local', 'SKILL.md'),
        'utf-8'
      ),
      /EXTERNAL-COPY/
    );
    const safetyState = JSON.parse(
      await fs.readFile(path.join(safetyHome, 'integrations', 'skill-catalog-state.json'), 'utf-8')
    ) as { activeSkills: string[] };
    assert.deepEqual(safetyState.activeSkills, [
      'canonical-skill',
      'orphan-alias',
      'recoverable-upload',
    ]);
    const recoveredAlias = await readSkillLibraryItem(safetyHome, 'orphan-alias', {
      syncExternal: false,
    });
    assert.equal(recoveredAlias?.baseName, 'orphan-alias');
    const recoveredShow = await execFileAsync(
      process.execPath,
      [scriptPath, 'show', 'orphan-alias'],
      { env: { ...process.env, WEBUI_CONFIG_HOME: safetyHome } }
    );
    assert.match(recoveredShow.stdout, /^---\nname: orphan-alias/m);

    const collisionHome = path.join(root, 'collision-claude');
    await writeSkill(path.join(collisionHome, 'skills'), 'collision-skill', 'LOCAL-VERSION');
    await writeSkill(
      path.join(collisionHome, 'skill-catalog'),
      'collision-skill',
      'CATALOG-VERSION'
    );
    await fs.mkdir(path.join(collisionHome, 'integrations'), { recursive: true });
    await fs.writeFile(
      path.join(collisionHome, 'integrations', 'skill-catalog-state.json'),
      `${JSON.stringify({ version: 1, activeSkills: [] })}\n`,
      'utf-8'
    );
    await ensureLeanSkillCatalog(collisionHome);
    assert.match(
      await fs.readFile(path.join(collisionHome, 'skills', 'collision-skill', 'SKILL.md'), 'utf-8'),
      /LOCAL-VERSION/
    );
    assert.match(
      await fs.readFile(
        path.join(collisionHome, 'skill-catalog', 'collision-skill', 'SKILL.md'),
        'utf-8'
      ),
      /CATALOG-VERSION/
    );
  } finally {
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
    if (previousMigrationTest === undefined) delete process.env.PLUM_LEAN_SKILL_MIGRATION_TEST;
    else process.env.PLUM_LEAN_SKILL_MIGRATION_TEST = previousMigrationTest;
    await fs.rm(root, { recursive: true, force: true });
  }

  console.log('lean skill catalog regression tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
