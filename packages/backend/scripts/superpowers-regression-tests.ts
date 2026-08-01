import assert from 'assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

async function write(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf-8');
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function makeUpstream(root: string): Promise<string> {
  const source = path.join(root, 'upstream');
  await write(
    path.join(source, '.codex-plugin', 'plugin.json'),
    `${JSON.stringify(
      {
        name: 'superpowers',
        version: '9.9.9-test',
        description: 'Test Superpowers package',
        author: { name: 'Test Author' },
        skills: './skills/',
        hooks: './hooks/hooks-codex.json',
      },
      null,
      2
    )}\n`
  );
  await write(
    path.join(source, 'package.json'),
    `${JSON.stringify({ name: 'superpowers', version: '9.9.9-test', main: '.opencode/plugins/superpowers.js' }, null, 2)}\n`
  );
  await write(
    path.join(source, 'hooks', 'hooks-codex.json'),
    `${JSON.stringify({ hooks: { SessionStart: [] } }, null, 2)}\n`
  );
  await write(
    path.join(source, '.opencode', 'plugins', 'superpowers.js'),
    'export const SuperpowersPlugin = async () => ({});\n'
  );
  await write(
    path.join(source, 'skills', 'using-superpowers', 'SKILL.md'),
    [
      '---',
      'name: using-superpowers',
      'description: Use when starting any conversation',
      '---',
      '',
      '# Using Superpowers',
      '',
      'Invoke relevant skills before responding.',
      'If there is even a 1% chance a skill applies, you MUST invoke it.',
      'Before entering plan mode, invoke brainstorming and create a checklist.',
      '',
    ].join('\n')
  );
  await write(
    path.join(source, 'skills', 'brainstorming', 'SKILL.md'),
    [
      '---',
      'name: brainstorming',
      'description: Use before creative work',
      '---',
      '',
      '# Brainstorming',
      '',
    ].join('\n')
  );
  await write(
    path.join(source, 'skills', 'writing-plans', 'SKILL.md'),
    [
      '---',
      'name: writing-plans',
      'description: Use before implementation',
      '---',
      '',
      '# Writing Plans',
      '',
    ].join('\n')
  );
  return source;
}

async function main(): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plum-superpowers-regression-'));
  const source = await makeUpstream(root);
  const claudeHome = path.join(root, 'claude');
  const codexHome = path.join(root, 'codex');
  const opencodeConfigDir = path.join(root, 'opencode-config');

  process.env.SUPERPOWERS_SOURCE_DIR = source;
  process.env.SUPERPOWERS_ENABLED = '1';
  process.env.WEBUI_CONFIG_HOME = claudeHome;
  process.env.CLI_PROVIDER_CODEX_CREDENTIALS_PATH = codexHome;
  process.env.CODEX_HOME = codexHome;
  process.env.OPENCODE_CONFIG_DIR = opencodeConfigDir;

  await write(
    path.join(claudeHome, 'skills', 'brainstorming', 'SKILL.md'),
    [
      '---',
      'name: brainstorming',
      'description: User-owned brainstorming skill',
      '---',
      '',
      '# User Brainstorming',
      '',
    ].join('\n')
  );
  await write(
    path.join(claudeHome, 'skills', 'writing-plans.disabled', 'SKILL.md'),
    [
      '---',
      'name: writing-plans',
      'description: Disabled user skill',
      '---',
      '',
      '# Disabled',
      '',
    ].join('\n')
  );
  await write(
    path.join(opencodeConfigDir, 'opencode.json'),
    `${JSON.stringify(
      {
        plugin: ['user-plugin', source, 'https://github.com/obra/Superpowers.git'],
        skills: { paths: ['/custom/skills'] },
      },
      null,
      2
    )}\n`
  );

  const { syncSuperpowers, buildSuperpowersBootstrapContext } =
    await import('../src/utils/superpowersSync.ts');

  const result = await syncSuperpowers(claudeHome, { quiet: true });
  assert.equal(result.enabled, true);
  assert.equal(result.installed, 1, 'only using-superpowers should be newly installed');
  assert.deepEqual(
    result.skipped.sort(),
    ['brainstorming', 'writing-plans.disabled'].sort(),
    'user-owned and disabled skills should be skipped'
  );

  const markerPath = path.join(claudeHome, 'skills', 'using-superpowers', '.plum-superpowers.json');
  assert.equal(await exists(markerPath), true, 'using-superpowers marker should be written');
  const marker = JSON.parse(await fs.readFile(markerPath, 'utf-8')) as { version?: string };
  assert.equal(marker.version, '9.9.9-test');

  const userSkill = await fs.readFile(
    path.join(claudeHome, 'skills', 'brainstorming', 'SKILL.md'),
    'utf-8'
  );
  assert.match(userSkill, /User Brainstorming/, 'user-owned skill should not be overwritten');

  const codexConfig = await fs.readFile(path.join(codexHome, 'config.toml'), 'utf-8');
  assert.match(
    codexConfig,
    /\[plugins\."superpowers@plum-managed"\]/,
    'Codex managed plugin should be enabled'
  );
  assert.match(codexConfig, /enabled = true/);
  assert.equal(
    await exists(
      path.join(codexHome, 'plugins', 'cache', 'plum-managed', 'superpowers', '9.9.9-test')
    ),
    true,
    'Codex plugin cache should contain managed Superpowers package'
  );

  const opencodeConfig = JSON.parse(
    await fs.readFile(path.join(opencodeConfigDir, 'opencode.json'), 'utf-8')
  ) as { plugin?: string[]; skills?: { paths?: string[] } };
  assert.deepEqual(
    opencodeConfig.plugin,
    ['user-plugin'],
    'OpenCode must discover the skills without the upstream plugin that injects blanket workflow mandates'
  );
  assert.deepEqual(opencodeConfig.skills?.paths, ['/custom/skills']);

  const opencodeBootstrap = await buildSuperpowersBootstrapContext('opencode', claudeHome);
  assert.ok(opencodeBootstrap?.includes('todowrite'), 'OpenCode bootstrap should map todos');

  const codexBootstrap = await buildSuperpowersBootstrapContext('codex', claudeHome);
  assert.ok(codexBootstrap?.includes('~/.agents/skills'), 'Codex bootstrap should mention alias');
  assert.match(
    codexBootstrap || '',
    /Skills are optional accelerators/i,
    'bootstrap should prevent blanket skill/workflow stacking'
  );
  assert.match(
    codexBootstrap || '',
    /product goal/i,
    'bootstrap should preserve product-first execution'
  );
  assert.match(
    codexBootstrap || '',
    /Vale decision proxy/i,
    'bootstrap should tell agents to resolve routine choices internally'
  );
  assert.doesNotMatch(
    codexBootstrap || '',
    /1% chance|MUST invoke|Before entering plan mode/i,
    'bootstrap must not re-inject upstream blanket workflow mandates'
  );

  await syncSuperpowers(claudeHome, { quiet: true });
  const codexConfigAfterSecondSync = await fs.readFile(
    path.join(codexHome, 'config.toml'),
    'utf-8'
  );
  assert.equal(
    (codexConfigAfterSecondSync.match(/\[plugins\."superpowers@plum-managed"\]/g) || []).length,
    1,
    'Codex managed plugin should not be duplicated'
  );

  const opencodeConfigAfterSecondSync = JSON.parse(
    await fs.readFile(path.join(opencodeConfigDir, 'opencode.json'), 'utf-8')
  ) as { plugin?: string[] };
  assert.deepEqual(
    opencodeConfigAfterSecondSync.plugin,
    ['user-plugin'],
    'OpenCode upstream bootstrap plugin should stay removed'
  );

  process.env.SUPERPOWERS_ENABLED = 'false';
  const disabledResult = await syncSuperpowers(claudeHome, { quiet: true });
  assert.equal(disabledResult.enabled, false);
  assert.equal(disabledResult.removed, 1, 'only Plum-managed skills should be removed');
  assert.equal(await exists(markerPath), false, 'managed Superpowers skill should be removed');
  assert.equal(
    await exists(path.join(claudeHome, 'skills', 'brainstorming', 'SKILL.md')),
    true,
    'user-owned skills must remain installed'
  );
  assert.match(
    await fs.readFile(path.join(codexHome, 'config.toml'), 'utf-8'),
    /\[plugins\."superpowers@plum-managed"\]\s+enabled = false/,
    'Codex managed plugin should be disabled'
  );
  assert.equal(
    await exists(path.join(codexHome, 'plugins', 'cache', 'plum-managed', 'superpowers')),
    false,
    'disabled Superpowers should remove its managed Codex plugin cache'
  );
  assert.equal(
    await buildSuperpowersBootstrapContext('codex', claudeHome),
    null,
    'disabled Superpowers must not inject bootstrap context'
  );

  process.env.SUPERPOWERS_ENABLED = '1';
  await syncSuperpowers(claudeHome, { quiet: true });
  assert.equal(await exists(markerPath), true, 'managed skills should return after re-enabling');
  assert.match(
    await fs.readFile(path.join(codexHome, 'config.toml'), 'utf-8'),
    /\[plugins\."superpowers@plum-managed"\]\s+enabled = true/,
    'Codex managed plugin should return after re-enabling'
  );

  delete process.env.SUPERPOWERS_ENABLED;
  const defaultResult = await syncSuperpowers(claudeHome, { quiet: true });
  assert.equal(defaultResult.enabled, false, 'Superpowers should default to instance-wide off');
  assert.equal(await exists(markerPath), false, 'default-off should remove managed skills');
  assert.equal(
    await buildSuperpowersBootstrapContext('claude', claudeHome),
    null,
    'default-off must not inject bootstrap context'
  );
  assert.match(
    await fs.readFile(path.join(codexHome, 'config.toml'), 'utf-8'),
    /\[plugins\."superpowers@plum-managed"\]\s+enabled = false/,
    'default-off should disable the Codex managed plugin'
  );

  console.log('superpowers regression tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
