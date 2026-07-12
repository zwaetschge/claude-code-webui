# Z.AI Vision MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add policy-controlled Z.AI Vision MCP registration for OpenCode sessions.

**Architecture:** Extend the existing OpenCode config sync in `providerLinks.ts`. Keep API keys in environment only, not persisted config. Cover behavior with provider regression tests.

**Tech Stack:** TypeScript, OpenCode `opencode.json`, Docker Compose env, pnpm backend tests.

## Global Constraints

- Managed MCP name: `zai-vision`.
- Managed marker: `webuiManaged: "zai-vision-v1"`.
- Policy env: `OPENCODE_ZAI_VISION_MCP=auto|always|off`, default `auto`.
- MCP command: `["npx", "-y", "@z_ai/mcp-server@latest"]`.
- MCP environment: `{"Z_AI_MODE":"ZAI"}` only; do not persist API keys.

---

### Task 1: Regression Tests

**Files:**
- Modify: `packages/backend/scripts/provider-regression-tests.ts`

**Interfaces:**
- Consumes: `applyWebuiOpenCodeProviderConfig`, new `applyZaiVisionMcpConfig`
- Produces: failing tests for managed MCP policy behavior

- [ ] Add tests for `auto`, `always`, `off`, key omission, and user-owned preservation.
- [ ] Run `./node_modules/.bin/pnpm --filter @plum-code-webui/backend run test:providers`.
- [ ] Confirm the new test fails before implementation.

### Task 2: Config Helper Implementation

**Files:**
- Modify: `packages/backend/src/utils/providerLinks.ts`

**Interfaces:**
- Produces: `resolveZaiVisionMcpPolicy(value?: string): "auto" | "always" | "off"`
- Produces: `applyZaiVisionMcpConfig(config, opts)`

- [ ] Implement policy parsing.
- [ ] Add managed MCP entry generation.
- [ ] Preserve user-owned entries without `webuiManaged: "zai-vision-v1"`.
- [ ] Remove managed entry when inactive.
- [ ] Call the helper from `syncOpenCodeConfig`.

### Task 3: Runtime Env And Docs

**Files:**
- Modify: `docker-compose.yml`
- Modify: `AGENTS.md`

**Interfaces:**
- Produces: deployment-visible `OPENCODE_ZAI_VISION_MCP`

- [ ] Add compose env default `OPENCODE_ZAI_VISION_MCP=${OPENCODE_ZAI_VISION_MCP:-auto}`.
- [ ] Document policy and Z.AI Vision MCP behavior in `AGENTS.md`.

### Task 4: Verification And Deployment

**Files:**
- Runtime verification only

**Interfaces:**
- Consumes: backend package scripts and repair-bot script

- [ ] Run focused provider regression.
- [ ] Run backend `typecheck` and `build`.
- [ ] Run `git diff --check`.
- [ ] Redeploy through `bash scripts/plum-rebuild.sh`.
- [ ] Verify container health and generated OpenCode config shape without printing secrets.
