# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository

Web UI for Codex, OpenCode, Mistral Vibe, and Claude Code CLIs. **Codex is the default provider** — Anthropic is restricting `claude -p` / moving to a credit system, so Codex took over as the primary CLI. Claude is still available as a legacy option. pnpm monorepo deployed as a single Docker container on Unraid.

## Commands

```bash
pnpm install                # install workspace deps
pnpm dev                    # run backend + frontend in parallel (tsx watch + vite)
pnpm build                  # build all packages (tsc for backend/shared, vite for frontend)
pnpm typecheck              # tsc --noEmit across workspace
pnpm lint                   # eslint
pnpm format                 # prettier --write
pnpm format:check           # prettier --check (CI)

./scripts/install.sh        # interactive installer (prereq check, .env gen, build, up, codex login). Re-runnable; --reset wipes .env, --skip-login skips OAuth bootstrap, --non-interactive uses defaults.
./scripts/start-webui.sh    # dev helper: generates ephemeral SESSION_SECRET/JWT_SECRET, kills stale PIDs, logs to .logs/, writes PIDs to .pids/

# Backend-specific (run from packages/backend)
pnpm db:migrate             # apply SQLite migrations (better-sqlite3)
pnpm db:seed                # seed dev data
```

Dev ports: backend `3006`, frontend `5173`. Docker maps `4545:3001` (container listens on 3001).

Node `>=20`, pnpm `>=9` (packageManager pinned to `pnpm@9.15.0`).

## Architecture

### Packages

| Package             | Purpose                                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `packages/backend`  | Express + Socket.IO server, SQLite via better-sqlite3, spawns Codex/OpenCode/Vibe/Claude CLIs as child processes |
| `packages/frontend` | React 18 + Vite SPA, Radix UI, Tailwind, Zustand, Socket.IO client                                               |
| `packages/shared`   | TypeScript types shared between backend and frontend                                                             |
| `packages/desktop`  | Desktop shell wrapper                                                                                            |
| `packages/android`  | Android client                                                                                                   |

### Backend

Entry: `packages/backend/src/index.ts`. Routes live in `src/routes/` (~30 modules — sessions, auth, providers, files, git, github, mcp, etc.). Services in `src/services/` — the critical one is `src/services/claude/ClaudeProcessManager.ts`, which owns all CLI lifecycle.

**CLI process model** (`ClaudeProcessManager` — owns all four providers despite the name):

- **Codex** (default): `codex exec --json` per-turn; manager respawns on `turn.completed` / process exit. Streaming via `item.delta` / `agent_message.delta` / `text.delta` events (Codex 0.130+). Resume via transcript replay — `buildCodexContextPrefix()` reads prior turns from SQLite and prepends them to stdin on respawn.
- **OpenCode**: server-backed (HTTP/SSE), full stream-json, native resume.
- **Mistral Vibe**: argv-based prompt (`-p TEXT`), per-turn spawn; isolated `VIBE_HOME` per WebUI session; `--continue` flag for resume.
- **Claude** (legacy): `claude --print --verbose --output-format stream-json --input-format stream-json --include-partial-messages --dangerously-skip-permissions`.
- Parses stream-json events and forwards them over Socket.IO. Message queue accepts input while the CLI is working; interrupts via SIGINT.

**Key Socket.IO events** (server → client):

- `session:output` — streaming text deltas
- `session:message` — persisted messages
- `session:thinking` — thinking indicator (boolean)
- `session:tool_use` — tool lifecycle (started/completed/error)
- `session:agent` — subagent (Task tool) activity
- `session:status` — session state changes

**Auth**: Express session + JWT, Passport strategies for GitHub and Google OAuth, plus a Basic Auth guard stored in SQLite (`app_config` table). Per-provider CLI login routes: `/auth/codex`, `/auth/opencode`, `/auth/vibe`, `/auth/claude` (Claude flagged as legacy in the UI). `/auth/providers` advertises which providers are usable based on `isProviderAvailable()` checks.

**Admin / helper LLM** (`packages/backend/src/utils/adminLLM.ts`): one-shot text completion for internal features (commit message generation, etc.). Prefers Codex → OpenCode → Vibe → Claude; override via `ADMIN_LLM_PROVIDER`. Used by `routes/git.ts` `/generate-commit-message` — no longer hardcoded to `claude --print -p`.

**Usage / analytics** (cross-provider): every turn's tokens land in `usage_history` via `saveUsageToDatabase` in `ClaudeProcessManager`. For Codex, `translateCodexMessage` captures `turn.completed.usage` (`input_tokens` + `cached_input_tokens` + `output_tokens` + `reasoning_output_tokens`) and writes them directly to `proc.turnInputTokens` etc — without this hook Codex turns silently skipped the DB write because the cumulative `result`-handler only touches `totalInputTokens`. Per-provider cost uses the shared rate-card in `packages/shared/src/types/llm-pricing.ts`; startup migrations reprice `usage_history.cost_usd` when `LLM_PRICING_RATE_CARD_VERSION` changes. Unknown model prices stay unpriced rather than inheriting a fallback. Live usage limits surfaced via `/api/usage/limits?provider=codex` from ChatGPT's `backend-api/codex/usage` endpoint (needs `Authorization: Bearer` + `chatgpt-account-id` header — see `routes/usage.ts`).

**Security middleware** (`src/index.ts`): strict Helmet CSP (no `unsafe-inline` scripts), `trust proxy` configurable via `TRUST_PROXY`, per-bucket rate limiters in `src/middleware/rateLimiter.ts` (key = `userId` or `req.ip`, never raw `X-Forwarded-For`). CORS origins from `FRONTEND_URL` + `CORS_ALLOWED_ORIGINS`.

### Frontend

Entry: `packages/frontend/src/main.tsx`. Main chat view: `src/pages/SessionPage.tsx`. Tool rendering: `src/components/chat/ToolExecutionCard.tsx` — detects `Task`/`Agent` tools as subagents and renders them with a distinct border-left accent, tinted background, and "SUBAGENT" badge. Subagent icon mapping lives in the same file (`agentTypeMap`).

Store: `src/stores/useSessionStore.ts` (Zustand) holds per-session `toolExecutions`, `activity`, and `activeAgent` state.

WebSocket client: `src/services/socket.ts`.

## Deployment

Compose is split into two files:

- **`docker-compose.yml`** — portable, in git. Single legacy `claude-code-webui` service key on `${WEBUI_PORT:-4545}:3001`, building the `plum-code-webui:latest` image. Volumes use env-var-driven defaults (`${DATA_DIR:-./data}`, `${CONFIG_DIR:-./config}`, `${WORKSPACE_DIR:-./workspace}`). Safe to publish.
- **`docker-compose.override.yml`** — site-specific, **gitignored**. Holds Traefik labels for `code.zwaetschge-webui.ch`/`preview.code.zwaetschge-webui.ch`, the `group_add: 281` Unraid docker GID, absolute `/mnt/cache/appdata/plum-code-webui/...` host paths, the Rebuild Robot sidecar, the docker.sock mount, and the external `brian_traefik-public` network. Compose merges both automatically — `docker compose up -d --build` Just Works.

A template for other operators lives at `docker-compose.override.yml.example`.

```bash
./scripts/install.sh                # interactive: collects env, builds, starts, runs codex login (other providers from UI)
docker compose up -d --build        # if you already have .env + an override
```

**docker.sock mount lives in the override file**, not the portable compose. Mounting it grants the in-container CLI full host Docker access — required for the opt-in Rebuild Robot self-rebuild flow but not safe to ship as a default.

**Rebuild Robot sidecar** (`scripts/rebuild-robot-sidecar.sh`): POSIX sh watcher intended to run as a Compose sidecar (defined in the override file). Watches `data/rebuild-trigger.json`, then runs build/restart of the main service and writes `REBUILD_ROBOT_REPORT.md` + `data/rebuild-robot-status.json`. This is the only remaining self-rebuild path — the older self-rebuild HTTP API and handover protocol have been removed.

### Unraid persistence

The override file pins these to absolute paths so state survives container rebuilds:

- `/mnt/cache/appdata/plum-code-webui/data` → `/app/packages/backend/data` (SQLite DB, session files)
- `/mnt/cache/appdata/plum-code-webui/config/codex` → `/home/node/.codex` (primary provider)
- `/mnt/cache/appdata/plum-code-webui/config/opencode` → `/home/node/.opencode`
- `/mnt/cache/appdata/plum-code-webui/config/vibe` → `/home/node/.vibe`
- `/mnt/cache/appdata/plum-code-webui/config/claude` → `/home/node/.claude` (legacy)
- `/mnt/cache/appdata/plum-code-webui/config/npm-global` → `/home/node/.npm-global`
- `/mnt/cache/appdata/plum-code-webui/config/ssh` → `/home/node/.ssh` (ro)
- `/mnt/cache` → `/mnt/cache` (workspace access)

The portable compose's defaults (`./data`, `./config`, `./workspace`) sit alongside the project dir for fresh self-host installs.

### Basic Auth recovery

Credentials stored in SQLite at `data/claude-webui.db`, table `app_config`, keys `basic_auth_username`, `basic_auth_password` (bcrypt), `basic_auth_enabled`. Reset example:

```bash
sqlite3 /mnt/cache/appdata/plum-code-webui/data/claude-webui.db \
  "update app_config set value='NEW_USERNAME' where key='basic_auth_username'; \
   update app_config set value='BCRYPT_HASH'    where key='basic_auth_password'; \
   update app_config set value='true'           where key='basic_auth_enabled';"
```

Set `basic_auth_enabled` to `false` to disable.

## Shared Agents / Skills / Plugins

- Skills live in `~/.claude/skills/<name>/SKILL.md`
- Agents live in `~/.claude/agents/<name>.md`
- The WebUI auto-syncs external skill packs from these directories, in order:
  - `/mnt/user/AI/Skills` (primary)
  - `/mnt/unraid/AI/Skills` (fallback)
  - `WEBUI_SKILLS_DIRS` (comma-separated overrides)
- `.skill.zip` files are unpacked into `~/.claude/skills`
- The managed block in `AGENTS.md` and `CLAUDE.md` is appended/updated on each session; custom text outside the managed block is preserved.

**Superpowers** from [obra/Superpowers](https://github.com/obra/Superpowers) are synced by the backend at startup/session start. Skills install into `~/.claude/skills`; Codex also gets a managed local `superpowers@plum-managed` plugin cache/config entry plus the `~/.agents/skills` fallback, OpenCode gets a managed local `plugin` entry plus `skills.paths`, Vibe gets `skill_paths`, and Claude uses native `~/.claude/skills`. Configure with `SUPERPOWERS_ENABLED`, `SUPERPOWERS_REPO_URL`, and `SUPERPOWERS_REF`; existing user skills are not overwritten unless they carry `.plum-superpowers.json`. Plum injects the upstream `using-superpowers` bootstrap once per WebUI session, so don't duplicate it in project instructions.

**67 design-system skills** are pre-installed under `~/.claude/skills/design-*` from [bergside/awesome-design-skills](https://github.com/bergside/awesome-design-skills) ([designmd.sh](https://designmd.sh/)). Each covers one aesthetic with concrete tokens (typography scale, color palette, spacing grid, component patterns). Coverage: brand systems (`design-shadcn`, `design-material`, `design-ant`, `design-claude`), aesthetic families (`design-brutalism`, `design-glassmorphism`, `design-neumorphism`, `design-skeumorphism`, `design-claymorphism`, `design-dithered`), moods (`design-luxury`, `design-cosmic`, `design-cafe`, `design-retro`, `design-vintage`), and pop culture (`design-sega`, `design-pacman`, `design-tetris`, `design-matrix`). All prefixed `design-` so they don't collide with generic words; reachable from Codex sessions via the `~/.agents/skills → ~/.claude/skills` symlink (set up in the Dockerfile). See `AGENTS.md` § "Design system skills" for the update workflow.

## Environment Variables

Schema: `packages/backend/src/config.ts` (zod-validated, fails fast on startup).

Required:

- `SESSION_SECRET` — min 32 chars
- `JWT_SECRET` — min 32 chars

Common:

- `PORT` (default `3001`), `HOST` (default `0.0.0.0`), `NODE_ENV`
- `FRONTEND_URL` (default `http://localhost:5173`)
- `CORS_ALLOWED_ORIGINS` — comma-separated additional origins
- `AUTH_ALLOWED_EMAILS` — comma-separated email allowlist enforced for both OAuth and basic-auth logins. Empty = no allowlist (only safe behind a private network or SSO proxy). Enforcement: `findOrCreateUser` in `src/auth/passport.ts` throws `EmailNotAllowedError` (callback redirects to `/connect?error=email_not_allowed`); `src/routes/basic-auth.ts` returns `403 EMAIL_NOT_ALLOWED`.
- `TRUST_PROXY` (default `1`) — Express `trust proxy` value; hop count, boolean, or CIDR list. Setting `true` without a guarding proxy defeats IP rate-limiting.
- `ALLOWED_BASE_PATHS` (default `/home,/Users`) — comma-separated path allowlist for workspace access
- `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET`/`GITHUB_CALLBACK_URL`
- `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_CALLBACK_URL`
- `CLAUDE_OAUTH_ENABLED` (default `true`; set `false` to disable) — Claude is legacy, still works but no longer the default
- `CLAUDE_USER_EMAIL` — display-only (Anthropic API is Cloudflare-gated)
- `ADMIN_LLM_PROVIDER` — override the admin/helper LLM choice for commit messages etc. (default order: `codex` → `opencode` → `vibe` → `claude`)
- `ENCRYPTION_KEY` — for encrypted stored credentials
- `WEBUI_HOOK_SECRET` — shared secret proving a request came from the permission-prompt hook; auto-generated per process if unset
- `PREVIEW_HOSTNAME` — hostname of the preview subdomain for in-container dev servers
- `CLI_PROVIDER_CODEX_MODELS`, `CLI_PROVIDER_OPENCODE_MODELS`, `CLI_PROVIDER_VIBE_MODELS`, `CLI_PROVIDER_CLAUDE_MODELS`, `CLI_PROVIDER_<PROVIDER>_DEFAULT_MODEL` — override available models / default model per provider
- `CLI_PROVIDER_OPENCODE_DEFAULT_AGENT` / `CLI_PROVIDER_OPENCODE_STYLE_PROMPT` — OpenCode's WebUI primary agent and Codex-like communication style override

## ComfyUI Image Generation (built-in)

The WebUI talks to a ComfyUI server **directly** — no LoRA Tester sidecar. Three workflow templates ship baked in; agents can vary prompt/steps/seed/aspect/model/LoRA per call.

- **Backend service**: `packages/backend/src/services/comfyui/` — `workflows.ts` (3 templates + param map), `client.ts` (ComfyUI HTTP wrapper: `/prompt`, `/history`, `/view`, `/upload/image`, `/system_stats`), `index.ts` (orchestrator + job map).
- **REST endpoints** (`packages/backend/src/routes/comfyui.ts`):
  - `GET /api/comfyui/workflows` — list templates + param schemas
  - `GET /api/comfyui/settings`, `PUT /api/comfyui/settings` (admin) — URL + enabled flag
  - `GET /api/comfyui/test` — `/system_stats` probe (used by the "Test" button in Settings)
  - `POST /api/comfyui/upload-image` — forwards multipart to ComfyUI's `/upload/image` for the edit workflow
  - `POST /api/comfyui/generate` — submit, returns `generationId`
  - `GET /api/comfyui/generation/:id` — poll status + final URL
  - `POST /api/comfyui/internal/generate` — hook-secret-auth synchronous variant for the MCP server
- **Workflows**:
  - `z-image-turbo` — fast T2I, ~5s, Z-Image Turbo + qwen3_4b CLIP, 9 steps `dpmpp_2m_sde`
  - `flux2-klein-t2i` — quality T2I, Flux.2 Klein 9B + Turbo LoRA + TeaCache, 8 steps `euler`, `SamplerCustomAdvanced`
  - `flux2-klein-edit` — image-edit via Flux.2 Klein + `ReferenceLatent`, 8 steps, requires `input_image` filename uploaded first
- **Configuration**: ComfyUI URL stored in `app_config.comfyui_url` (settable from Settings → Integrations). Defaults to `$COMFYUI_URL` env or `http://192.168.1.23:8188`. Per-install — not user-scoped.
- **MCP server**: `scripts/mcp-servers/comfyui.mjs` — zero-dep Node stdio bridge. Exposes 3 tools: `generate_image` (fast), `generate_image_quality` (Flux.2 T2I), `edit_image` (Flux.2 edit). Calls `POST /api/comfyui/internal/generate` with the WebUI hook secret (inherited from CLI env). Workflow definitions, the ComfyUI URL, and rate limits live in the backend so the MCP stays thin.
- **Static serving**: `/generated/*.png` served by `packages/backend/src/index.ts`, gated by passport session cookie auth. `<img>` tags don't send Bearer tokens so session-cookie auth is required.
- **Frontend rendering**: `MemoizedMarkdown.tsx` `img` override wraps generated images in a click-through `<a>` (target `_blank`) with rounded borders + lazy loading.
- **Caveats**: MCP tools load at CLI spawn — existing sessions won't see the new tools until you start a fresh one. Changing the ComfyUI URL takes effect immediately for new jobs (the orchestrator re-reads `app_config` on each call).

## Android App Creator Integration (MCP)

A second MCP server, **android-builder**, lets every webui session (Codex / OpenCode / Vibe / Claude) build, install, launch, and test Android apps on real devices via the `android-app-creator` Docker container running on the host.

- **MCP server**: `scripts/mcp-servers/android-builder.mjs` — zero-dep Node stdio server, registered in `config/claude/settings.json` as `mcpServers.android-builder`. Exposes ~25 tools across project lifecycle, build, install/launch, ADB device management, emulator, and on-device testing (logcat / shell / screencap).
- **Backend target**: `http://host.docker.internal:4000` (the `android-app-creator-backend` listens on host port 4000). The compose file adds `extra_hosts: ["host.docker.internal:host-gateway"]` so this resolves from inside the webui container. Override via env `ANDROID_BUILDER_URL`.
- **Persistent device registry**: the builder backend stores known wifi pairings in `/app/data/known-devices.json`. On startup it auto-reconnects every entry with `autoReconnect=true`. **The user only pairs a phone once** — `adb_pair_wifi` + `adb_connect_wifi`, then it survives container restarts. Tools: `adb_known_devices`, `adb_forget_device`, `adb_set_friendly_name`, `adb_set_auto_reconnect`, `adb_reconnect_all`.
- **Safety**: `adb_shell` runs through a backend denylist (`rm -rf /`, `dd if=`, `mkfs`, fork bombs, `su root`). `adb_screenshot` requires an absolute `.png` path inside the builder container.
- **Skill pack**: `~/.claude/skills/android-build/SKILL.md` — invoke via the Skill tool. Documents standard workflows (cold start, build → ship → verify, new device pairing) and anti-patterns. Always go through this MCP — never call `adb` or `gradle` from `Bash`.
- **Caveats**: new sessions only — MCP tools are loaded at CLI spawn. Existing sessions won't see `android_*` / `adb_*` tools until you start a fresh chat. The android-app-creator container itself runs separately at `/mnt/user/AI/plum-code/android-app-creator/`.

## Godot + Blender MCP

Two built-in zero-dep MCP bridges are registered in `~/.claude/settings.json`
and mirrored into Codex/OpenCode/Vibe for new sessions:

- **godot** (`scripts/mcp-servers/godot.mjs`) — tools:
  `godot_info`, `godot_create_project`, `godot_list_project`,
  `godot_validate_project`, `godot_run_gdscript`, `godot_export_project`.
  Project scaffolding and inspection work without an editor binary. Validation,
  scripted editor runs, and exports require `GODOT_BIN` or a `godot`/`godot4`
  binary on `PATH`.
- **blender** (`scripts/mcp-servers/blender.mjs`) — tools:
  `blender_info`, `blender_run_python`, `blender_create_asset`,
  `blender_inspect_file`, `blender_render_preview`. The runtime image installs
  `blender-headless` and defaults `BLENDER_BIN=blender-headless`, so sessions
  can generate procedural `.blend`, `.glb`, `.gltf`, `.obj`, `.stl`, or `.fbx`
  assets via Blender Python.

Godot games should still follow the `game-engine-godot` skill: composable
scenes, reviewable Resources/data, InputMap actions, export presets, and Android
verification through android-builder when targeting phones.

## Multi-Provider Notes

Four CLI backends are wired into `ClaudeProcessManager` (insertion order in `CLI_PROVIDERS` dictates UI list order):

- **Codex** (`codex`) — **default / primary**. Per-turn process model; the manager detects `turn.completed` and respawns on the next input. Streaming and resume are simulated:
  - **Streaming**: `translateCodexMessage` handles `item.delta` / `agent_message.delta` / `text.delta` / `response.output_text.delta` events from `codex exec --json` (Codex 0.130+) and forwards each chunk as a `session:output` delta. Falls back gracefully to whole-message emit on `item.completed` if no deltas arrive.
  - **Resume**: `buildCodexContextPrefix()` reads the last 40 messages (≤24k chars) from SQLite and prepends them as a `[Prior conversation context]` block to stdin on each respawn — codex CLI has no native `--resume` flag.
- **OpenCode** (`opencode`) — server-backed (HTTP/SSE), full stream-json, native resume via `--session`. Routes 75+ LLMs (GLM `z-ai/glm-*`, Kimi, etc.).
- **Mistral Vibe** (`vibe`) — argv-based prompt (`-p TEXT`), per-turn spawn; isolated `VIBE_HOME=~/.vibe/webui-sessions/{sessionId}` per WebUI session; `--continue` flag for resume.
- **Claude Code** (`claude`) — legacy. Persistent stream-json process. Still works but no longer surfaced as default.

Provider config homes (persisted via compose volumes): `~/.codex`, `~/.local/share/opencode`, `~/.vibe`, `~/.claude`. See `AGENTS.md` for the broader multi-provider workflow and skill-pack sync conventions.

**Default provider selection**:

- Backend: `routes/sessions.ts` schema defaults `cliProvider` to `'codex'`; `db/index.ts` migration default for `sessions.cli_provider` column is `'codex'`.
- Frontend: `packages/frontend/src/lib/providers.ts` maps the neutral `plum` UI brand to CLI `codex` (was `claude`).
- Custom agents (`custom_agents.model` default in SQL) and `/model`-command fallback both use `gpt-5.5`.

## Pitfalls

- **Stale doc references**: earlier versions of this file, `README.md`, and `AGENTS.md` mention Gemini image generation, an orchestration service, a Ralph worker, a watchdog, a self-rebuild API, a repair-bot sidekick container, and a handover protocol. **None of those exist anymore** — all removed from the live code. Source-of-truth order: code > this file > README/AGENTS.
- **Never run `docker compose down`, `docker compose up -d --force-recreate`, or any container-recreate command from inside the WebUI container** — it will kill the running CLI session and leave the container in `Created` state on the new image. For redeploys, see `AGENTS.md` § "Rebuild / redeploy protocol".

<!-- webui-managed: project-context:start -->
# Project: plum-code-webui

Web UI for Codex, OpenCode, Mistral Vibe, and Claude Code CLIs

## Tech Stack
Docker, Docker Compose

**Monorepo** (pnpm)

## Commands
- `pnpm dev` — dev
- `pnpm run build` — build
- `pnpm run lint` — lint
- `pnpm run typecheck` — typecheck
- `pnpm run format` — format

## Key Directories
packages/, scripts/

Available Skills: agent-team-orchestration, android-build, api-design, auto-researcher, book-promo-website, brainstorming, campaign-architect, codebot-prompt-rewriter, codex-prompt-rewriter, comfyui-asset-gen, data-visualization, debugging-playbook, decensor-engine, developmental-editor, devops-deploy, dispatching-parallel-agents, documentation-writer, e-ink-application-architecture, e-ink-device-qa, e-ink-rendering-performance, epub-forge, executing-plans, fallacy-finder, finishing-a-development-branch, frontend-design, game-accessibility-localization, game-ai-behavior, game-android-porting, game-animation-state-machines, game-art-direction, game-asset-pipeline, game-audio-haptics, game-automated-qa, game-backend-services, game-build-ci, game-cinematics-camera, game-controller-input, game-core-architecture, game-economy-monetization, game-engine-godot, game-engine-unity, game-engine-unreal, game-feel-motion, game-first-person, game-gameplay-combat, game-level-content, game-metroidvania, game-mobile-performance, game-mod-support, game-multiplayer-networking, game-narrative-dialogue, game-on-device-playtest, game-physics-collision, game-platform-compliance, game-platformer, game-procedural-generation, game-racing-vehicle, game-release-builds, game-roguelike, game-rpg-quest, game-save-progression, game-shader-vfx, game-steam-deck-publishing, game-survival-crafting, game-systems-design, game-tactics-strategy, game-third-person, game-tools-editor, game-top-down-action, game-touch-input, game-ui-hud-menus, game-world-streaming, idea-forge, idea-to-code-plan, literary-critique, mental-reflection, musical-architect, musical-composer, nano-banana-prompt-engineer, openai-image-gen, panel-transcription, pentest-analyst, performance-tuning, plum-discord-automation-client, plum-discord-qa-gate, plum-discord-supervisor-gateway, premium-frontend-design, prompt-architect, prompt-expander, receiving-code-review, refactor-guide, requesting-code-review, research-prompt-architect, reverse-prompt-engineer, ricardo-marketplace-discovery-liquidity, ricardo-marketplace-frontend-design, ricardo-marketplace-payments-shipping-disputes, ricardo-marketplace-product-architect, ricardo-marketplace-trust-safety, schreiner-planer-kontext, screenplay-to-novel, security-review, session-handover, skill-designer, social-navigator, storysmith-60, strudel-livecode, subagent-driven-development, suno-v5-songwriter, svg-expert, systematic-debugging, test-driven-development, testing-playbook, thinker-frameworks, tutorial-architect, unraid-array-health, unraid-backup-recovery, unraid-cache-filesystem-maintenance, unraid-docker-appdata-maintenance, unraid-security-network-maintenance, using-git-worktrees, using-superpowers, verification-before-completion, visual-prompt-architect, vocarium-audio-api, web-game-polish, writing-plans
Available Agents: agent-team-strategist, api-designer, backend-dev, comfyui-asset-gen, data-engineer, database-specialist, debugging-expert, devops-engineer, documentation-writer, Explore, frontend-developer, fullstack-dev, game-accessibility-localization-specialist, game-ai-behavior-engineer, game-android-porting-engineer, game-animation-state-engineer, game-art-asset-director, game-asset-pipeline-producer, game-audio-haptics-engineer, game-automated-qa-engineer, game-backend-services-engineer, game-build-ci-engineer, game-cinematics-camera-director, game-combat-engineer, game-controller-input-engineer, game-core-architect, game-economy-monetization-designer, game-feel-motion-engineer, game-first-person-engineer, game-godot-engineer, game-level-content-designer, game-liveops-telemetry-engineer, game-metroidvania-architect, game-mobile-performance-engineer, game-mod-support-engineer, game-multiplayer-network-engineer, game-narrative-dialogue-designer, game-on-device-playtester, game-physics-collision-engineer, game-platform-compliance-producer, game-platformer-engineer, game-procedural-generation-architect, game-racing-vehicle-engineer, game-release-build-engineer, game-roguelike-architect, game-rpg-quest-designer, game-save-progression-engineer, game-shader-vfx-engineer, game-steam-deck-release-producer, game-survival-crafting-designer, game-systems-designer, game-tactics-strategy-architect, game-third-person-engineer, game-tools-editor-engineer, game-top-down-action-engineer, game-touch-input-designer, game-ui-hud-engineer, game-unity-engineer, game-unreal-engineer, game-world-streaming-engineer, git-operations, mobile-developer, performance-optimizer, Plan, playtest-qa-engineer, release-manager, research-bot, security-auditor, system-architect, test-engineer, ui-designer, unraid-array-health, unraid-backup-recovery, unraid-cache-filesystem, unraid-docker-appdata, unraid-security-network, web-game-engineer
<!-- webui-managed: project-context:end -->
