import fs from 'fs/promises';
import path from 'path';
import { safeJsonParse } from './json.js';
import { getActiveSkillNames, getSkillCatalogDir } from './leanSkillCatalog.js';

const MANAGED_MARKER = '.plum-managed-skill.json';
const MANAGED_SOURCE = 'plum-code-webui';

interface ManagedSkillDefinition {
  name: string;
  content: string;
  retired?: boolean;
}

interface ManagedSkillMarker {
  source: typeof MANAGED_SOURCE;
  name: string;
  version: number;
}

export interface ManagedPlumSkillsSyncResult {
  installed: number;
  updated: number;
  skipped: string[];
}

const PRODUCTION_UI_REVIEW_SKILL = [
  '---',
  'name: production-ui-review',
  'description: "Production UI quality gate for frontend, product UI, onboarding, dashboard, form, checkout, pricing, landing page, and AI feature work. Use after frontend design or when improving UI UX; produces evidence-based review, scorecard, fixes, and verification checklist."',
  '---',
  '',
  '# Production UI Review',
  '',
  'This skill reviews and improves user-facing product surfaces. Use it after a frontend/design implementation skill, or when the user asks to improve a UI, UX flow, landing page, dashboard, form, checkout, onboarding, pricing, or AI feature surface.',
  '',
  '## Philosophy',
  '',
  'The useful production pattern is not "make it prettier." The useful pattern is: identify the surface, inspect real evidence, choose the right quality lenses, score honestly, fix the highest-impact misses, and verify again.',
  '',
  'Core laws:',
  '',
  '1. Evidence over taste. Prefer screenshots, DOM inspection, keyboard checks, responsive checks, accessibility checks, and runnable tests over aesthetic claims.',
  '2. Surface before checklist. A dashboard, checkout, onboarding flow, and marketing page do not fail in the same ways.',
  '3. Preserve the local design system. Improve hierarchy, spacing, states, and copy without restyling the product into a different brand.',
  '4. Scores need caps. A score is only useful when blockers cap it, even if the rest looks polished.',
  '',
  '## Workflow',
  '',
  '1. Classify the surface: app shell, dashboard, form, onboarding, checkout, pricing, public page, AI feature, content/editor tool, or other product UI.',
  '2. Inspect evidence: read the relevant code, run the app when practical, capture or inspect screenshots, check mobile and desktop, and exercise the primary path.',
  '3. Select lenses: usability, information architecture, visual hierarchy, interaction states, empty/error/loading states, accessibility, trust/safety, copy, performance, analytics, and QA coverage.',
  '4. Score against the rubric below. Apply caps before giving the final score.',
  '5. If implementation is in scope, fix the highest-leverage issues first. Prefer concrete UI/code changes over review prose.',
  '6. Re-check the changed surface and report remaining risks instead of inflating the score.',
  '',
  '## Scorecard',
  '',
  'Score 0-100, with 85 as the minimum production bar for normal user-facing UI.',
  '',
  '| Area | Question |',
  '| --- | --- |',
  '| Primary path | Can a target user complete the main job without confusion or dead ends? |',
  '| Hierarchy | Is the next action visually obvious without a wall of equal-weight cards? |',
  '| Surface fit | Does the UI fit its domain: dense tools stay efficient, marketing pages stay persuasive, flows stay focused? |',
  '| States | Are loading, empty, error, disabled, success, hover, focus, and long-content states handled? |',
  '| Accessibility | Does keyboard access, visible focus, semantic structure, contrast, reduced motion, and text scaling hold up? |',
  '| Responsive behavior | Does the surface work on mobile and desktop without overlap, clipping, or layout jumps? |',
  '| Trust and copy | Are labels, promises, destructive actions, pricing, privacy, and AI uncertainty honest and clear? |',
  '| Performance | Is the surface reasonably fast and free of avoidable rendering or asset weight problems? |',
  '| Verification | Is there evidence: tests, screenshots, lint/typecheck, browser checks, or documented manual checks? |',
  '',
  '## Score Caps',
  '',
  '- No screenshot, DOM, or browser evidence for a visual UI: cap at 80.',
  '- No mobile or narrow-width check for a responsive surface: cap at 82.',
  '- Missing keyboard focus path on an interactive surface: cap at 78.',
  '- Accessibility blocker such as unreadable contrast, unlabeled controls, or keyboard trap: cap at 75.',
  '- Broken primary path: cap at 60.',
  '- Missing loading/error/empty states for data-dependent UI: cap at 76.',
  '- Ignoring an existing design system or replacing it with an unrelated aesthetic: cap at 78.',
  '- Invented metrics or unverified claims: cap at 70.',
  '',
  '## Anti-Patterns',
  '',
  '- Global restyle: changing the whole visual language when the task needs a focused production pass.',
  '- Pretty card pile: adding decorative cards instead of clarifying the workflow.',
  '- Score laundering: giving 90+ while listing blockers that should cap the score.',
  '- Checklist dumping: producing a long review without making the obvious fixes when implementation is requested.',
  '- Desktop-only confidence: declaring success without checking small screens for real overlap and clipping.',
  '- Accessibility theater: mentioning WCAG without checking keyboard, focus, semantics, and contrast.',
  '',
  '## Output Shape',
  '',
  'When reviewing only, lead with the highest-risk findings and include score, caps, evidence, and recommended fixes.',
  '',
  'When implementing, make the changes first, then report: changed files, verification evidence, final score or remaining cap, and residual risks.',
  '',
  '## Quality Checklist',
  '',
  'Before finishing, verify:',
  '',
  '- The chosen surface classification is explicit.',
  '- The score obeys every applicable cap.',
  '- At least one concrete evidence source is named.',
  '- Primary path, responsive behavior, states, accessibility, and copy/trust were considered.',
  '- Any claimed fix was actually implemented or clearly marked as a recommendation.',
  '- Remaining risks are specific enough for the next agent or human to act on.',
  '',
].join('\n');

const CAPABILITY_CATALOG_SKILL = [
  '---',
  'name: capability-catalog',
  "description: Search Plum Code's on-demand skills, style presets, and agents without loading the full catalog into every prompt. Use when a task needs a specialised capability that is not already active.",
  '---',
  '',
  '# Capability Catalog',
  '',
  'Plum keeps uncommon workflows and style presets outside the automatic model context. Search them only when the current task needs a specialised capability.',
  '',
  '## Search',
  '',
  '```bash',
  'node /app/scripts/capability-catalog.mjs search "<task or capability>"',
  '```',
  '',
  'The result includes the canonical name, aliases, description, skill/style type, active/on-demand state, and source path. Retired names resolve to their consolidated replacement when an alias exists.',
  '',
  '## Load one result',
  '',
  '```bash',
  'node /app/scripts/capability-catalog.mjs show <name>',
  '```',
  '',
  'Follow the selected instructions for the current task only. A style preset changes presentation; it is not an implementation workflow or approval gate. Do not load multiple overlapping workflows or styles unless the user explicitly requests that combination.',
  '',
  'For native agent delegation or skill authoring, read the matching file in `references/` only when that work is requested.',
  '',
  'Use `list` only when the user explicitly asks to browse the complete catalog.',
  '',
].join('\n');

const ORACLE_SKILL = [
  '---',
  'name: oracle',
  'description: Use Oracle as an explicit second-model review workflow for difficult debugging, refactoring, and design checks.',
  '---',
  '',
  '# Oracle',
  '',
  'Use this capability only when the user asks for a second opinion or the task explicitly requires independent model review.',
  '',
  '## Workflow',
  '',
  '1. Select the smallest relevant file set and exclude secrets, credentials, auth files, and tokens.',
  '2. Keep the prompt specific: exact issue, constraints, and expected output.',
  '3. Prefer reattaching to an existing Oracle session over repeating the same review.',
  '4. Verify Oracle advice against local code, tests, and repository state before applying it.',
  '',
  'Do not invoke Oracle as a routine approval gate. Normal implementation, debugging, and UI verification stay local unless a second model materially improves the requested outcome.',
  '',
].join('\n');

const MANAGED_SKILLS: ManagedSkillDefinition[] = [
  {
    name: 'capability-catalog',
    content: CAPABILITY_CATALOG_SKILL,
  },
  {
    name: 'production-ui-review',
    content: PRODUCTION_UI_REVIEW_SKILL,
    retired: true,
  },
  {
    name: 'oracle',
    content: ORACLE_SKILL,
  },
];

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readMarker(skillDir: string): Promise<ManagedSkillMarker | null> {
  try {
    return safeJsonParse<ManagedSkillMarker | null>(
      await fs.readFile(path.join(skillDir, MANAGED_MARKER), 'utf-8'),
      null
    );
  } catch {
    return null;
  }
}

function markerFor(skill: ManagedSkillDefinition): ManagedSkillMarker {
  return {
    source: MANAGED_SOURCE,
    name: skill.name,
    version: 1,
  };
}

async function writeManagedSkill(skillDir: string, skill: ManagedSkillDefinition): Promise<void> {
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(path.join(skillDir, 'SKILL.md'), `${skill.content.trimEnd()}\n`, 'utf-8');
  await fs.writeFile(
    path.join(skillDir, MANAGED_MARKER),
    `${JSON.stringify(markerFor(skill), null, 2)}\n`,
    'utf-8'
  );
}

export async function syncManagedPlumSkills(
  configHome: string
): Promise<ManagedPlumSkillsSyncResult> {
  const activeSkills = await getActiveSkillNames(configHome);
  const activeSkillsDir = path.join(configHome, 'skills');
  const catalogSkillsDir = getSkillCatalogDir(configHome);
  await Promise.all([
    fs.mkdir(activeSkillsDir, { recursive: true }),
    fs.mkdir(catalogSkillsDir, { recursive: true }),
  ]);

  let installed = 0;
  let updated = 0;
  const skipped: string[] = [];

  for (const skill of MANAGED_SKILLS) {
    const skillsDir = activeSkills.has(skill.name) ? activeSkillsDir : catalogSkillsDir;
    const alternateSkillsDir = skillsDir === activeSkillsDir ? catalogSkillsDir : activeSkillsDir;
    const enabledDir = path.join(skillsDir, skill.name);
    const alternateDir = path.join(alternateSkillsDir, skill.name);
    const disabledDir = path.join(activeSkillsDir, `${skill.name}.disabled`);

    if (skill.retired) {
      for (const candidate of [enabledDir, alternateDir, disabledDir]) {
        const marker = await readMarker(candidate);
        if (marker?.source === MANAGED_SOURCE && marker.name === skill.name) {
          await fs.rm(candidate, { recursive: true, force: true });
          updated += 1;
        }
      }
      continue;
    }

    if (await pathExists(disabledDir)) {
      skipped.push(`${skill.name}.disabled`);
      continue;
    }

    if (!(await pathExists(enabledDir)) && (await pathExists(alternateDir))) {
      skipped.push(skill.name);
      continue;
    }

    if (!(await pathExists(enabledDir))) {
      await writeManagedSkill(enabledDir, skill);
      installed += 1;
      continue;
    }

    const marker = await readMarker(enabledDir);
    if (!marker || marker.source !== MANAGED_SOURCE || marker.name !== skill.name) {
      skipped.push(skill.name);
      continue;
    }

    const current = await fs.readFile(path.join(enabledDir, 'SKILL.md'), 'utf-8').catch(() => '');
    const next = `${skill.content.trimEnd()}\n`;
    if (current !== next || marker.version !== markerFor(skill).version) {
      await writeManagedSkill(enabledDir, skill);
      updated += 1;
    }
  }

  return { installed, updated, skipped };
}
