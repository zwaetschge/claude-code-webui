# Production UI Review Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional managed production UI review skill inspired by the useful Layr workflow pattern.

**Architecture:** A backend utility owns Plum-managed skills and installs them into the shared skills directory while respecting user-owned and disabled copies. Existing skill-library reads invoke that utility before listing skills.

**Tech Stack:** TypeScript, Node fs/promises, existing backend script-based regression tests.

## Global Constraints

- Keep guidance optional and UI/product-specific.
- Do not copy Layr source text verbatim.
- Do not overwrite unmarked user skills.
- Do not recreate disabled skills.

---

### Task 1: Managed Skill Sync

**Files:**
- Create: `packages/backend/src/utils/managedPlumSkills.ts`
- Modify: `packages/backend/src/utils/skillLibrary.ts`
- Test: `packages/backend/scripts/managed-plum-skills-regression-tests.ts`

**Interfaces:**
- Produces: `syncManagedPlumSkills(configHome: string): Promise<ManagedPlumSkillsSyncResult>`
- Consumes: `listSkillLibrary(configHome, options)` calls the sync before reading skills.

- [ ] Write failing tests for install, skip user-owned, skip disabled, and list integration.
- [ ] Run `pnpm --filter @plum-code-webui/backend exec tsx scripts/managed-plum-skills-regression-tests.ts` and confirm failure.
- [ ] Implement the managed skill sync utility and call it from `listSkillLibrary`.
- [ ] Run the targeted regression test and confirm pass.

### Task 2: Verification

**Files:**
- Modify: `packages/backend/package.json`

**Interfaces:**
- Produces: `pnpm --filter @plum-code-webui/backend run test:managed-skills`

- [ ] Add a package script for the new regression test.
- [ ] Run `pnpm --filter @plum-code-webui/backend run test:managed-skills`.
- [ ] Run existing project-instruction and typecheck verification.
