# Plum Code WebUI Full Audit and Fix Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Audit the complete `plum-code-webui` repository and its persisted project instructions for reproducible defects, then repair every safely actionable finding with regression coverage and production verification.

**Architecture:** Work in evidence-driven waves across the monorepo boundaries: shared contracts, backend/provider processes, frontend/UI, desktop, and deployment. Preserve the confirmed dirty worktree, isolate each new finding with a minimal reproduction, and use red-green TDD for production behavior changes. Persist project-wide instructions in `AGENTS.md`; treat `CLAUDE.md` as legacy compatibility only.

**Tech Stack:** TypeScript, React, Express, SQLite, Electron, pnpm workspaces, Docker Compose, Chromium.

## Global Constraints

- Preserve all pre-existing tracked and untracked user changes.
- Do not commit, reset, stash, or rewrite history unless the user explicitly requests it.
- Use real German umlauts in user-visible prose; keep stable technical identifiers ASCII.
- Do not call Docker Compose directly for a redeploy; use `bash scripts/plum-rebuild.sh`.
- Do not expose tokens, cookies, credentials, or private session contents in logs or reports.
- Each production fix requires a failing regression first unless it is only documentation or persistent instruction data.

---

### Task 1: Establish the repository baseline

**Files:**
- Inspect: `package.json`
- Inspect: `packages/backend/package.json`
- Inspect: `packages/frontend/package.json`
- Inspect: `packages/shared/package.json`
- Inspect: `packages/desktop/package.json`
- Modify if a gap is proven: `package.json`

**Interfaces:**
- Consumes: pnpm workspace scripts and existing regression runners.
- Produces: a deterministic list of passing and failing gates, plus a single documented aggregate entry point if one is missing.

- [x] Record branch, upstream divergence, dirty files, and recent local commits.
- [x] Run `./node_modules/.bin/pnpm run typecheck` and capture the exact exit result.
- [x] Run `./node_modules/.bin/pnpm run lint` and classify every error or warning.
- [x] Run `./node_modules/.bin/pnpm run format:check` and record every mismatching file without formatting unrelated work.
- [x] Run every existing backend/frontend regression script individually so one early failure cannot hide later suites.
- [x] If the root lacks a complete aggregate test command, add a failing package-script regression or equivalent deterministic check, then add the minimal aggregate command.

### Task 2: Repair persistent German umlaut guidance

**Files:**
- Modify: `AGENTS.md`
- Modify: `/home/node/.claude/projects/-mnt-user-appdata-claude-code-webui/memory/MEMORY.md`
- Create: `/home/node/.claude/projects/-mnt-user-appdata-claude-code-webui/memory/feedback_umlauts.md`
- Verify: `packages/backend/src/routes/memories.ts`
- Verify: `packages/backend/scripts/project-instructions-regression-tests.ts`

**Interfaces:**
- Consumes: project instruction injection from `AGENTS.md` and Claude-compatible project memory discovery.
- Produces: one canonical, project-local rule requiring `ä`, `ö`, and `ü` in visible German prose while preserving ASCII technical identifiers.

- [x] Confirm no current project memory or `AGENTS.md` rule supplies the preference.
- [x] Confirm the memory API reads and writes UTF-8 without transliteration.
- [x] Add the rule outside the managed `AGENTS.md` block.
- [x] Add a project-local feedback memory and index it from `MEMORY.md`.
- [x] Replace the stale memory statement that assigns persistent project documentation to `CLAUDE.md` with the current `AGENTS.md` policy.
- [x] Run the project-instructions regression test and a focused UTF-8 content check.

### Task 3: Audit and repair backend/provider behavior

**Files:**
- Inspect and modify only when a finding is reproduced: `packages/backend/src/routes/`
- Inspect and modify only when a finding is reproduced: `packages/backend/src/services/`
- Add regressions beside existing runners: `packages/backend/scripts/`

**Interfaces:**
- Consumes: CLI provider events, session state, SQLite usage data, filesystem requests, and authenticated HTTP requests.
- Produces: stable provider switching, streaming/resume, analytics, auth, file, command, and session behavior.

- [x] Trace each failing backend/provider gate to its originating boundary.
- [x] For each finding, write one minimal regression and verify the expected red failure.
- [x] Implement only the root-cause fix and verify the focused test green.
- [x] Re-run backend build, typecheck, and all backend regression runners after every related batch.

### Task 4: Audit and harden security boundaries

**Files:**
- Inspect and modify only when a finding is reproduced: `packages/backend/src/middleware/`
- Inspect and modify only when a finding is reproduced: `packages/backend/src/routes/`
- Inspect and modify only when a finding is reproduced: `packages/backend/src/utils/`
- Inspect: `.env.example`
- Inspect: `docker-compose.yml`

**Interfaces:**
- Consumes: unauthenticated/authenticated requests, paths, uploads, URLs, shell/process arguments, OAuth material, and environment configuration.
- Produces: authenticated and authorized operations with validated inputs, contained paths, redacted output, and safe defaults.

- [ ] Map trust boundaries and enumerate routes with missing or inconsistent auth/role checks.
- [ ] Review path containment, symlink behavior, upload validation, URL validation, and process spawning.
- [ ] Review secret persistence, response payloads, logs, headers, cookies, and environment defaults.
- [ ] Run dependency audit tooling and separate actionable runtime vulnerabilities from tooling-only noise.
- [ ] Reproduce each actionable vulnerability with a negative regression before applying a minimal hardening change.

### Task 5: Audit and repair frontend and design quality

**Files:**
- Inspect and modify only when a finding is reproduced: `packages/frontend/src/`
- Inspect: `packages/frontend/public/manifest.json`
- Add deterministic UI checks under: `packages/frontend/scripts/`

**Interfaces:**
- Consumes: backend APIs, session state, design tokens, pointer/keyboard input, viewport changes, and appearance modes.
- Produces: coherent dashboard, session, settings, analytics, files, operations, and auth surfaces.

- [ ] Run the app in the system Chromium and exercise the primary paths at desktop and narrow mobile widths.
- [ ] Inspect Light, Dark, and E-Ink appearance modes for token, typography, spacing, hierarchy, and component inconsistencies.
- [ ] Verify loading, empty, error, disabled, success, hover, focus, long-content, and destructive-action states.
- [ ] Verify keyboard navigation, visible focus, semantics, labels, contrast, reduced motion, text scaling, and overflow.
- [ ] Capture reproducible evidence for each discrepancy, then write a focused regression where practical.
- [ ] Apply the smallest design-system-preserving fix and re-check both desktop and mobile.

### Task 6: Audit desktop, Docker, and deployment behavior

**Files:**
- Inspect and modify only when a finding is reproduced: `packages/desktop/`
- Inspect and modify only when a finding is reproduced: `Dockerfile`
- Inspect and modify only when a finding is reproduced: `docker-compose.yml`
- Inspect and modify only when a finding is reproduced: `scripts/`

**Interfaces:**
- Consumes: build artifacts, mounts, environment variables, health gates, desktop renderer/main boundaries, and repair-bot state.
- Produces: reproducible builds and safe container lifecycle behavior.

- [ ] Build and typecheck the desktop package.
- [ ] Validate Docker Compose configuration, mounts, healthchecks, user permissions, and persisted provider homes.
- [ ] Exercise install/update/rebuild scripts in non-destructive validation modes where available.
- [ ] Add a regression before fixing any reproducible script or configuration behavior.

### Task 7: Complete whole-project verification

**Files:**
- Verify: all files changed during Tasks 1-6.
- Update: `docs/superpowers/plans/2026-07-09-plum-code-webui-full-audit.md` checkbox state as work completes.

**Interfaces:**
- Consumes: all focused regressions and package/deployment gates.
- Produces: a verified audit result with explicit residual risks.

- [ ] Run the aggregate test command plus build, typecheck, lint, and format checks.
- [ ] Re-run Chromium desktop/mobile flows and accessibility checks on changed surfaces.
- [ ] Trigger `bash scripts/plum-rebuild.sh` and wait for the repair-bot health gate.
- [ ] Verify the public app route and relevant authenticated behavior without exposing credentials.
- [ ] Review the final diff for accidental changes, secrets, generated artifacts, and unsupported claims.
- [ ] Report fixed findings, exact verification commands, design score/caps, and remaining external risks.
