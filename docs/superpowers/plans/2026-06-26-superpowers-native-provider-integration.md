# Superpowers Native Provider Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add native provider registration around the managed Superpowers sync.

**Architecture:** Keep `superpowersSync.ts` as the owner for upstream fetch/copy/marker/bootstrap behavior and add focused helpers for provider config artifacts. Cover the behavior with a regression script that runs through `tsx`.

**Tech Stack:** TypeScript, Node fs/promises, existing backend scripts, no new runtime dependencies.

## Global Constraints

- Keep the sync idempotent.
- Preserve user-owned skills and provider config.
- Keep `SUPERPOWERS_ENABLED=0` as a full opt-out.
- Use the repair-bot rebuild path for redeploys.

---

### Task 1: Regression Script

**Files:**

- Create: `packages/backend/scripts/superpowers-regression-tests.ts`
- Modify: `packages/backend/package.json`

**Interfaces:**

- Consumes: `syncSuperpowers()`, `buildSuperpowersBootstrapContext()`.
- Produces: `pnpm --filter @plum-code-webui/backend run test:superpowers`.

- [ ] Write a failing regression script that creates a temporary upstream checkout, runs `syncSuperpowers()`, and asserts skills/markers/bootstrap/provider config artifacts.
- [ ] Add `test:superpowers` to the backend package scripts.
- [ ] Run the script and confirm it fails before provider artifacts exist.

### Task 2: Native Provider Artifacts

**Files:**

- Modify: `packages/backend/src/utils/superpowersSync.ts`

**Interfaces:**

- Consumes: synced Superpowers source directory and `configHome`.
- Produces: Codex/OpenCode registration metadata inside the matching provider homes.

- [ ] Add path/env helpers for Codex and OpenCode homes.
- [ ] Add Codex cache/config writer for a managed local `superpowers@plum-managed` plugin.
- [ ] Add OpenCode config writer for a managed local plugin path.
- [ ] Keep all writes idempotent and disabled by `SUPERPOWERS_ENABLED=0`.
- [ ] Run the regression script until it passes.

### Task 3: Docs And Verification

**Files:**

- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`

**Interfaces:**

- Consumes: implemented provider registration behavior.
- Produces: accurate user/operator documentation.

- [ ] Update docs to describe native Codex/OpenCode registration plus existing fallbacks.
- [ ] Run backend typecheck, Superpowers regression script, formatting check, and full build.
- [ ] Redeploy through `scripts/plum-rebuild.sh`.
