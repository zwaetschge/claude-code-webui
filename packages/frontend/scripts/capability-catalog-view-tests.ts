import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  filterAgents,
  filterSkills,
  getSkillCatalogCounts,
  type AgentInfo,
  type SkillInfo,
} from '../src/components/settings/capabilityCatalog.js';

const agents: AgentInfo[] = [
  {
    id: 'security',
    name: 'Security Reviewer',
    description: 'Audits trust boundaries',
    tools: ['Read', 'Bash'],
    model: 'sonnet',
    filePath: '/agents/security.md',
    source: 'user',
    enabled: true,
  },
  {
    id: 'designer',
    name: 'Interface Designer',
    description: 'Improves responsive layouts',
    filePath: '/agents/designer.md',
    source: 'user',
    enabled: false,
  },
];

const skills: SkillInfo[] = [
  {
    id: 'security-review',
    baseName: 'security-review',
    name: 'Security Review',
    description: 'Review authentication and authorization boundaries',
    dirPath: '/skills/security-review',
    source: 'user',
    enabled: true,
    libraryKind: 'skill',
    entryType: 'skill',
    aliases: ['pentest-analyst'],
  },
  {
    id: 'paper-style',
    baseName: 'paper-style',
    name: 'Paper',
    description: 'High-contrast editorial surfaces',
    dirPath: '/styles/paper',
    source: 'user',
    enabled: false,
    libraryKind: 'design',
    entryType: 'style',
  },
  {
    id: 'android-build',
    baseName: 'android-build',
    name: 'Android Build',
    description: 'Build and test Android apps',
    allowedTools: ['android-builder'],
    dirPath: '/catalog/android-build',
    source: 'user',
    enabled: false,
    libraryKind: 'skill',
    entryType: 'skill',
  },
];

assert.deepEqual(
  filterAgents(agents, 'bash').map((agent) => agent.id),
  ['security'],
  'agent tool names remain searchable'
);
assert.deepEqual(
  filterAgents(agents, 'SONNET').map((agent) => agent.id),
  ['security'],
  'agent model search is case-insensitive'
);
assert.deepEqual(
  filterSkills(skills, 'pentest-analyst', 'all').map((skill) => skill.id),
  ['security-review'],
  'legacy aliases remain searchable'
);
assert.deepEqual(
  filterSkills(skills, '', 'on-demand').map((skill) => skill.id),
  ['paper-style', 'android-build'],
  'on-demand filtering keeps disabled skills and style presets'
);
assert.deepEqual(getSkillCatalogCounts(skills), {
  activeSkillCount: 1,
  skillPackageCount: 2,
  stylePresetCount: 1,
});

const catalogComponent = fs.readFileSync(
  new URL('../src/components/settings/CapabilityCatalogSections.tsx', import.meta.url),
  'utf8'
);
const catalogStyles = fs.readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');

assert.doesNotMatch(
  catalogComponent,
  /sm:opacity-0\s+sm:group-hover:opacity-100/,
  'card actions must not be hidden based on viewport width'
);
assert.equal(
  catalogComponent.match(/className="capability-card-actions/g)?.length,
  2,
  'agent and skill actions share the pointer-aware visibility behavior'
);
assert.match(
  catalogComponent,
  /aria-label={`\$\{agent\.enabled \? 'Disable' : 'Enable'\} \$\{agent\.name\}`}/,
  'agent toggles expose a contextual accessible name'
);
assert.match(
  catalogComponent,
  /aria-label={`Edit \$\{skill\.name\}`}/,
  'skill edit actions expose a contextual accessible name'
);
assert.match(
  catalogStyles,
  /\.capability-card-actions\s*{\s*opacity:\s*1;/,
  'actions are visible by default for touch and unknown pointer types'
);
assert.match(
  catalogStyles,
  /@media \(hover: hover\) and \(pointer: fine\)[\s\S]*?\.capability-card:focus-within \.capability-card-actions[\s\S]*?opacity:\s*1;/,
  'hover-capable pointers retain compact cards while keyboard focus reveals actions'
);
assert.match(
  catalogStyles,
  /@media \(pointer: coarse\)[\s\S]*?\.capability-card-actions > button[\s\S]*?min-width:\s*2\.25rem;[\s\S]*?min-height:\s*2\.25rem;/,
  'coarse pointers receive larger action targets'
);

console.log('Capability catalog view regression tests passed.');
