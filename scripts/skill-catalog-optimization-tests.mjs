import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const optimiserPath = path.join(repoRoot, 'scripts', 'optimize-skill-workflows.mjs');
const validatorPath = path.join(repoRoot, 'scripts', 'validate-skill-catalog.mjs');

const activeSkills = [
  'api-design',
  'capability-catalog',
  'debugging-playbook',
  'devops-deploy',
  'documentation-writer',
  'frontend-design',
  'performance-tuning',
  'refactor-guide',
  'security-review',
  'testing-playbook',
];

async function writeSkill(root, name, body = `# ${name}\n`) {
  const directory = path.join(root, name);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(
    path.join(directory, 'SKILL.md'),
    `---\nname: ${name}\ndescription: "Fixture for ${name}"\n---\n\n${body}`,
    'utf8'
  );
}

async function treeHash(root) {
  const records = [];
  async function visit(directory) {
    for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name)
    )) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else records.push(`${path.relative(root, absolute)}\0${await fs.readFile(absolute, 'utf8')}`);
    }
  }
  await visit(root);
  return crypto.createHash('sha256').update(records.join('\0')).digest('hex');
}

const configHome = await fs.mkdtemp(path.join(os.tmpdir(), 'plum-skill-optimisation-'));
try {
  for (const name of activeSkills) await writeSkill(path.join(configHome, 'skills'), name);
  for (const name of [
    'prompt-expander',
    'idea-forge',
    'decensor-engine',
    'session-handover',
    'production-ui-review',
    'tutorial-architect',
  ]) {
    await writeSkill(path.join(configHome, 'skill-catalog'), name);
  }
  await fs.mkdir(path.join(configHome, 'agents'), { recursive: true });
  await fs.writeFile(
    path.join(configHome, 'agents', 'fixture.md'),
    `---\nname: fixture\ndescription: Fixture agent\nskills:\n  - prompt-expander\n  - tutorial-architect\n---\n`,
    'utf8'
  );

  await execFileAsync(process.execPath, [optimiserPath, configHome]);
  const firstHash = await treeHash(configHome);
  await execFileAsync(process.execPath, [optimiserPath, configHome]);
  assert.equal(await treeHash(configHome), firstHash, 'workflow optimisation must be idempotent');

  const validation = await execFileAsync(process.execPath, [validatorPath, configHome]);
  const summary = JSON.parse(validation.stdout);
  assert.equal(summary.activeSkills, 10);
  assert.equal(summary.errors.length, 0);
  assert.equal(
    await fs
      .access(path.join(configHome, 'skill-catalog', 'decensor-engine'))
      .then(() => true)
      .catch(() => false),
    false
  );

  const aliasFile = JSON.parse(
    await fs.readFile(path.join(configHome, 'skill-aliases.json'), 'utf8')
  );
  assert.equal(aliasFile.aliases['prompt-expander'], 'prompt-engineering');
  assert.equal(aliasFile.aliases['tutorial-architect'], 'documentation-writer');
  assert.ok(aliasFile.retired.includes('decensor-engine'));
  assert.ok(aliasFile.retired.includes('session-handover'));
  aliasFile.retired.push('retired-zip');
  await fs.writeFile(
    path.join(configHome, 'skill-aliases.json'),
    `${JSON.stringify(aliasFile, null, 2)}\n`,
    'utf8'
  );
  const agent = await fs.readFile(path.join(configHome, 'agents', 'fixture.md'), 'utf8');
  assert.match(agent, /  - prompt-engineering/);
  assert.match(agent, /  - documentation-writer/);
  assert.doesNotMatch(agent, /prompt-expander|tutorial-architect/);

  const shown = await execFileAsync(
    process.execPath,
    [path.join(repoRoot, 'scripts', 'capability-catalog.mjs'), 'show', 'prompt-expander'],
    { env: { ...process.env, WEBUI_CONFIG_HOME: configHome } }
  );
  assert.match(shown.stdout, /^---\nname: prompt-engineering/m);

  const importSource = path.join(configHome, 'import-fixtures');
  await fs.mkdir(importSource, { recursive: true });
  for (const name of ['prompt-expander', 'decensor-engine', 'fresh-skill']) {
    await fs.writeFile(
      path.join(importSource, `${name}.md`),
      `---\nname: ${name}\ndescription: Import fixture\n---\n\n# ${name}\n`,
      'utf8'
    );
  }
  await writeSkill(path.join(configHome, 'skill-catalog'), 'duplicate-skill', '# ORIGINAL\n');
  await fs.writeFile(
    path.join(importSource, 'duplicate-skill.md'),
    '---\nname: duplicate-skill\ndescription: Upload copy\n---\n\n# UPLOAD\n',
    'utf8'
  );
  await fs.writeFile(
    path.join(importSource, 'allowed-name.skill.zip'),
    Buffer.from(
      'UEsDBBQAAAAAAI267Vx1mH6zSgAAAEoAAAAUAAAAcmV0aXJlZC16aXAvU0tJTEwubWQtLS0KbmFtZTogcmV0aXJlZC16aXAKZGVzY3JpcHRpb246IHJldGlyZWQgemlwIGZpeHR1cmUKLS0tCgojIHJldGlyZWQgemlwClBLAQIUAxQAAAAAAI267Vx1mH6zSgAAAEoAAAAUAAAAAAAAAAAAAACAAQAAAAByZXRpcmVkLXppcC9TS0lMTC5tZFBLBQYAAAAAAQABAEIAAAB8AAAAAAA=',
      'base64'
    )
  );
  const imported = await execFileAsync(process.execPath, [
    path.join(repoRoot, 'scripts', 'import-skills-from-dir.mjs'),
    importSource,
    '--config-home',
    configHome,
  ]);
  assert.match(imported.stdout, /imported: 1/);
  assert.match(imported.stdout, /prompt-expander \(consolidated_as:prompt-engineering\)/);
  assert.match(imported.stdout, /decensor-engine \(retired_name\)/);
  assert.match(imported.stdout, /retired-zip \(retired_name\)/);
  assert.match(imported.stdout, /duplicate-skill \(already_exists\)/);
  assert.equal(
    await fs
      .access(path.join(configHome, 'skills', 'fresh-skill', 'SKILL.md'))
      .then(() => true)
      .catch(() => false),
    true
  );
  assert.equal(
    await fs
      .access(path.join(configHome, 'skills', 'prompt-expander'))
      .then(() => true)
      .catch(() => false),
    false
  );
  assert.equal(
    await fs
      .access(path.join(configHome, 'skills', 'decensor-engine'))
      .then(() => true)
      .catch(() => false),
    false
  );
  assert.equal(
    await fs
      .access(path.join(configHome, 'skills', 'duplicate-skill'))
      .then(() => true)
      .catch(() => false),
    false
  );
  assert.match(
    await fs.readFile(
      path.join(configHome, 'skill-catalog', 'duplicate-skill', 'SKILL.md'),
      'utf8'
    ),
    /ORIGINAL/
  );
} finally {
  await fs.rm(configHome, { recursive: true, force: true });
}

console.log('skill catalog optimization tests passed');
