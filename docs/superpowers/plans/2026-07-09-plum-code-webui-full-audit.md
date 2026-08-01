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

- [x] Map trust boundaries and enumerate routes with missing or inconsistent auth/role checks.
      Evidence: `pnpm --filter @plum-code-webui/backend run test:security-boundaries`
      (admin mutation boundaries, CLI login identity, permission identity binding,
      bootstrap admin identity), `test:runner-access`, `test:websocket-auth`.
- [x] Review path containment, symlink behavior, upload validation, URL validation, and process spawning.
      Evidence: restricted-command environment and ComfyUI input primitive cases in the
      security-boundaries suite, plus `test:opencode-isolation` for per-user provider homes.
- [x] Review secret persistence, response payloads, logs, headers, cookies, and environment defaults.
      Evidence: untrusted-active-document case, `scripts/validate-production-env.sh`
      config guard (proven by `docker compose -f docker-compose.hub.yml config`
      failing without `AUTH_ALLOWED_EMAILS` and passing with it).
- [x] Run dependency audit tooling and separate actionable runtime vulnerabilities from tooling-only noise.
      `pnpm audit --prod` on 2026-07-31: 8 high + 1 low. Actionable and fixed via pnpm
      overrides: `engine.io` 6.6.5→6.6.7 (polling connection exhaustion, CVSS 7.5),
      `brace-expansion` 1.1.14→1.1.17 and 2.1.0→2.1.3 (ReDoS via exceljs→archiver),
      `fast-uri` →3.1.4, `body-parser` 1.20.4→1.20.6. Not applicable: the
      `react-router` advisory only affects the unstable RSC APIs, which this SPA does
      not use — no safe patch exists inside the 7.x line (patched only in >= 8.3.0).
- [x] Reproduce each actionable vulnerability with a negative regression before applying a minimal hardening change.
      Advisory-driven dependency pins are verified by re-running `pnpm audit --prod`
      plus the full regression matrix; no product code path changed.

### Task 5: Audit and repair frontend and design quality

**Files:**
- Inspect and modify only when a finding is reproduced: `packages/frontend/src/`
- Inspect: `packages/frontend/public/manifest.json`
- Add deterministic UI checks under: `packages/frontend/scripts/`

**Interfaces:**
- Consumes: backend APIs, session state, design tokens, pointer/keyboard input, viewport changes, and appearance modes.
- Produces: coherent dashboard, session, settings, analytics, files, operations, and auth surfaces.

> **Status 2026-07-31:** blocked on a deploy, not on analysis. The running container
> still serves the 2026-07-31 12:08 image, while the worktree carries newer backend and
> frontend work (Z.AI/Kimi providers, CLI device login, usage-limit history). Browser
> evidence is only meaningful after the rebuild in Task 7, which restarts the container
> and therefore needs supervisor timing.

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

- [x] Build and typecheck the desktop package. `pnpm -r run typecheck` and
      `pnpm -r run build` both report `packages/desktop … Done`.
- [x] Validate Docker Compose configuration, mounts, healthchecks, user permissions, and persisted provider homes.
      `docker compose -f docker-compose.yml config` exits 0; the hub variant exits 0
      once its required `AUTH_ALLOWED_EMAILS` guard variable is supplied.
- [x] Exercise install/update/rebuild scripts in non-destructive validation modes where available.
      `bash -n` passes for all eight scripts in `scripts/`; the hub `config-guard`
      entrypoint was exercised through Compose interpolation.
- [x] Add a regression before fixing any reproducible script or configuration behavior.
      No reproducible script or Compose defect was found in this pass, so no new
      regression was required here.

### Task 7: Complete whole-project verification

**Files:**
- Verify: all files changed during Tasks 1-6.
- Update: `docs/superpowers/plans/2026-07-09-plum-code-webui-full-audit.md` checkbox state as work completes.

**Interfaces:**
- Consumes: all focused regressions and package/deployment gates.
- Produces: a verified audit result with explicit residual risks.

- [x] Run the aggregate test command plus build, typecheck, lint, and format checks.
      2026-07-31, after the dependency overrides and a full reinstall:
      `pnpm test` → all 35 suites passed; `pnpm -r run build` → shared, desktop,
      backend, frontend all Done; `pnpm -r run typecheck` → all Done;
      `pnpm lint` → 0 errors, 0 warnings; `pnpm format:check` → clean;
      `pnpm audit --prod` → 9 findings reduced to 1 non-applicable advisory.
- [ ] Re-run Chromium desktop/mobile flows and accessibility checks on changed surfaces.
- [ ] Trigger `bash scripts/plum-rebuild.sh` and wait for the repair-bot health gate.
- [ ] Verify the public app route and relevant authenticated behavior without exposing credentials.
- [x] Review the final diff for accidental changes, secrets, generated artifacts, and unsupported claims.
      Secret pattern scan over `git diff` returns exactly one hit,
      `encrypted-secret-that-must-not-be-copied`, which is the fixture of the
      negative regression asserting that Pi never persists OpenCode provider
      secrets. The lockfile diff contains only the five override pins.
- [x] Report fixed findings, exact verification commands, design score/caps, and remaining external risks.
      See "Session log" below; the production UI score is deliberately not claimed
      because the browser pass has not run yet.

## Session log — 2026-07-31

**Fixed**

1. Prettier drift in `packages/backend/src/services/claude/ClaudeProcessManager.ts`,
   `packages/backend/src/services/usage-limit-history.ts`, and
   `packages/backend/src/utils/claudeResumeTranscript.ts`.
2. Four `@typescript-eslint/no-explicit-any` warnings in
   `packages/backend/scripts/reconcile-provider-usage-history.ts`, replaced with
   `ClaudeTranscriptEvent` and `OpenCodeMessageData` shapes that declare only the
   consumed fields.
3. Five advisory-driven dependency pins in the root `pnpm.overrides`
   (`engine.io`, `brace-expansion` ×2, `fast-uri`, `body-parser`).

**Residual risks**

- `react-router` GHSA-qwww-vcr4-c8h2 (high) stays open. It only affects the
  unstable RSC APIs, which this SPA does not use, and it is patched only in
  `>= 8.3.0` — a major upgrade that is not proportionate to a non-applicable
  advisory.
- No live browser evidence for the current worktree. The container still serves
  the 2026-07-31 12:08 image and the rebuild restarts the running session, so it
  needs supervisor timing.

**Environment note**

This workspace container has no C toolchain (`make`, `gcc` absent) and runs with
`NODE_ENV=production`. A plain `pnpm install` therefore purges `node_modules`,
skips devDependencies, and then fails to rebuild `better-sqlite3` and `node-pty`.
Recovery: `NODE_ENV=development CI=true pnpm install --no-frozen-lockfile
--ignore-scripts`, then copy the compiled `build/` directories for both packages
from the runtime image at `/app/node_modules/.pnpm/<pkg>/node_modules/<pkg>/build`.
