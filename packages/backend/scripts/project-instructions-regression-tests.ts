import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ensureProjectInstructions } from '../src/services/claude/ClaudeProcessManager.js';

async function fileExists(filePath: string): Promise<boolean> {
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

async function testProjectInstructionsPreferAgentsMd() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'plum-project-instructions-'));
  const projectDir = path.join(root, 'workspace');
  const configHome = path.join(root, 'config');
  await fs.mkdir(projectDir, { recursive: true });

  await write(
    path.join(configHome, 'skills', 'useful-skill', 'SKILL.md'),
    [
      '---',
      'name: useful-skill',
      'description: Useful test skill',
      '---',
      '',
      '# Useful Skill',
      '',
    ].join('\n')
  );
  await write(
    path.join(configHome, 'agents', 'reviewer.md'),
    ['---', 'description: Reviews test changes', '---', '', '# Reviewer', ''].join('\n')
  );

  await write(
    path.join(projectDir, 'CLAUDE.md'),
    [
      '# Human Claude Notes',
      '',
      '<!-- webui-managed: project-context:start -->',
      '# Old generated context',
      '<!-- webui-managed: project-context:end -->',
      '',
    ].join('\n')
  );
  await write(path.join(projectDir, 'AGENTS.md'), '# Human Agent Notes\n');

  await ensureProjectInstructions(projectDir, configHome, 'codex');

  const agentsMd = await fs.readFile(path.join(projectDir, 'AGENTS.md'), 'utf8');
  assert.match(agentsMd, /# Human Agent Notes/);
  assert.match(agentsMd, /<!-- webui-managed: project-context:start -->/);
  assert.match(agentsMd, /Active Core Skills:/);
  assert.match(agentsMd, /capability-catalog\.mjs search/);
  assert.doesNotMatch(agentsMd, /Available Skills:/);
  assert.doesNotMatch(agentsMd, /Available Agents:/);

  const claudeMd = await fs.readFile(path.join(projectDir, 'CLAUDE.md'), 'utf8');
  assert.match(claudeMd, /# Human Claude Notes/);
  assert.doesNotMatch(claudeMd, /webui-managed: project-context:start/);

  const freshProjectDir = path.join(root, 'fresh-workspace');
  await fs.mkdir(freshProjectDir, { recursive: true });
  await ensureProjectInstructions(freshProjectDir, configHome, 'codex');
  assert.equal(await fileExists(path.join(freshProjectDir, 'AGENTS.md')), true);
  assert.equal(await fileExists(path.join(freshProjectDir, 'CLAUDE.md')), false);
}

await testProjectInstructionsPreferAgentsMd();

console.log('project instructions regression tests passed');
