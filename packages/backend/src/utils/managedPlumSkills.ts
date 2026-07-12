import fs from 'fs/promises';
import path from 'path';
import { safeJsonParse } from './json.js';

const MANAGED_MARKER = '.plum-managed-skill.json';
const MANAGED_SOURCE = 'plum-code-webui';

interface ManagedSkillDefinition {
  name: string;
  content: string;
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

const MANAGED_SKILLS: ManagedSkillDefinition[] = [
  {
    name: 'production-ui-review',
    content: PRODUCTION_UI_REVIEW_SKILL,
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
  const skillsDir = path.join(configHome, 'skills');
  await fs.mkdir(skillsDir, { recursive: true });

  let installed = 0;
  let updated = 0;
  const skipped: string[] = [];

  for (const skill of MANAGED_SKILLS) {
    const enabledDir = path.join(skillsDir, skill.name);
    const disabledDir = path.join(skillsDir, `${skill.name}.disabled`);

    if (await pathExists(disabledDir)) {
      skipped.push(`${skill.name}.disabled`);
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
