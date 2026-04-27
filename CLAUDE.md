# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository

Web UI for Claude Code CLI (with multi-provider support for Codex and OpenCode). pnpm monorepo deployed as a single Docker container on Unraid.

## Commands

```bash
pnpm install                # install workspace deps
pnpm dev                    # run backend + frontend in parallel (tsx watch + vite)
pnpm build                  # build all packages (tsc for backend/shared, vite for frontend)
pnpm typecheck              # tsc --noEmit across workspace
pnpm lint                   # eslint
pnpm format                 # prettier --write
pnpm format:check           # prettier --check (CI)

./scripts/install.sh        # interactive installer (prereq check, .env gen, build, up, claude /login). Re-runnable; --reset wipes .env, --skip-login skips OAuth bootstrap, --non-interactive uses defaults.
./scripts/start-webui.sh    # dev helper: generates ephemeral SESSION_SECRET/JWT_SECRET, kills stale PIDs, logs to .logs/, writes PIDs to .pids/

# Backend-specific (run from packages/backend)
pnpm db:migrate             # apply SQLite migrations (better-sqlite3)
pnpm db:seed                # seed dev data
```

Dev ports: backend `3006`, frontend `5173`. Docker maps `4545:3001` (container listens on 3001).

Node `>=20`, pnpm `>=9` (packageManager pinned to `pnpm@9.15.0`).

## Architecture

### Packages

| Package | Purpose |
|---------|---------|
| `packages/backend` | Express + Socket.IO server, SQLite via better-sqlite3, spawns Claude/Codex/OpenCode CLIs as child processes |
| `packages/frontend` | React 18 + Vite SPA, Radix UI, Tailwind, Zustand, Socket.IO client |
| `packages/shared` | TypeScript types shared between backend and frontend |
| `packages/desktop` | Desktop shell wrapper |
| `packages/android` | Android client |

### Backend

Entry: `packages/backend/src/index.ts`. Routes live in `src/routes/` (~30 modules — sessions, auth, providers, files, git, github, mcp, etc.). Services in `src/services/` — the critical one is `src/services/claude/ClaudeProcessManager.ts`, which owns all CLI lifecycle.

**CLI process model** (`ClaudeProcessManager`):
- Spawns Claude CLI with `--print --verbose --output-format stream-json --input-format stream-json --include-partial-messages --dangerously-skip-permissions`.
- Also manages Codex (with per-turn respawn after `turn.completed`) and OpenCode processes.
- Parses stream-json events and forwards them over Socket.IO.
- Message queue accepts input while the CLI is working; interrupts via SIGINT.

**Key Socket.IO events** (server → client):
- `session:output` — streaming text deltas
- `session:message` — persisted messages
- `session:thinking` — thinking indicator (boolean)
- `session:tool_use` — tool lifecycle (started/completed/error)
- `session:agent` — subagent (Task tool) activity
- `session:status` — session state changes

**Auth**: Express session + JWT, Passport strategies for GitHub and Google OAuth, plus a Basic Auth guard stored in SQLite (`app_config` table).

**Security middleware** (`src/index.ts`): strict Helmet CSP (no `unsafe-inline` scripts), `trust proxy` configurable via `TRUST_PROXY`, per-bucket rate limiters in `src/middleware/rateLimiter.ts` (key = `userId` or `req.ip`, never raw `X-Forwarded-For`). CORS origins from `FRONTEND_URL` + `CORS_ALLOWED_ORIGINS`.

### Frontend

Entry: `packages/frontend/src/main.tsx`. Main chat view: `src/pages/SessionPage.tsx`. Tool rendering: `src/components/chat/ToolExecutionCard.tsx` — detects `Task`/`Agent` tools as subagents and renders them with a distinct border-left accent, tinted background, and "SUBAGENT" badge. Subagent icon mapping lives in the same file (`agentTypeMap`).

Store: `src/stores/useSessionStore.ts` (Zustand) holds per-session `toolExecutions`, `activity`, and `activeAgent` state.

WebSocket client: `src/services/socket.ts`.

## Deployment

Compose is split into two files:
- **`docker-compose.yml`** — portable, in git. Single `claude-code-webui` service on `${WEBUI_PORT:-4545}:3001`. Volumes use env-var-driven defaults (`${DATA_DIR:-./data}`, `${CONFIG_DIR:-./config}`, `${WORKSPACE_DIR:-./workspace}`). Safe to publish.
- **`docker-compose.override.yml`** — site-specific, **gitignored**. Holds Traefik labels for `code.zwaetschge-webui.ch`/`preview.code.zwaetschge-webui.ch`, the `group_add: 281` Unraid docker GID, absolute `/mnt/user/appdata/...` host paths, the `repair-bot` sidecar, the docker.sock mount, and the external `brian_traefik-public` network. Compose merges both automatically — `docker compose up -d --build` Just Works.

A template for other operators lives at `docker-compose.override.yml.example`.

```bash
./scripts/install.sh                # interactive: collects env, builds, starts, runs claude /login
docker compose up -d --build        # if you already have .env + an override
```

**docker.sock mount lives in the override file**, not the portable compose. Mounting it grants the in-container CLI full host Docker access — required for the repair-bot self-rebuild flow but not safe to ship as a default.

**Rebuild Robot sidecar** (`scripts/rebuild-robot-sidecar.sh`): POSIX sh watcher intended to run as a Compose sidecar (defined in the override file). Watches `data/rebuild-trigger.json`, then runs build/restart of the main service and writes `REBUILD_ROBOT_REPORT.md` + `data/rebuild-robot-status.json`. This is the only remaining self-rebuild path — the older self-rebuild HTTP API and handover protocol have been removed.

### Unraid persistence

The override file pins these to absolute paths so state survives container rebuilds:
- `/mnt/user/appdata/claude-code-webui/data` → `/app/packages/backend/data` (SQLite DB, session files)
- `/mnt/user/appdata/claude-code-webui/config/claude` → `/home/node/.claude`
- `/mnt/user/appdata/claude-code-webui/config/codex` → `/home/node/.codex`
- `/mnt/user/appdata/claude-code-webui/config/opencode` → `/home/node/.opencode`
- `/mnt/user/appdata/claude-code-webui/config/npm-global` → `/home/node/.npm-global`
- `/mnt/user/appdata/claude-code-webui/config/ssh` → `/home/node/.ssh` (ro)
- `/mnt/user` → `/mnt/user` (workspace access)

The portable compose's defaults (`./data`, `./config`, `./workspace`) sit alongside the project dir for fresh self-host installs.

### Basic Auth recovery

Credentials stored in SQLite at `data/claude-webui.db`, table `app_config`, keys `basic_auth_username`, `basic_auth_password` (bcrypt), `basic_auth_enabled`. Reset example:

```bash
sqlite3 /mnt/user/appdata/claude-code-webui/data/claude-webui.db \
  "update app_config set value='NEW_USERNAME' where key='basic_auth_username'; \
   update app_config set value='BCRYPT_HASH'    where key='basic_auth_password'; \
   update app_config set value='true'           where key='basic_auth_enabled';"
```

Set `basic_auth_enabled` to `false` to disable.

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
- `CLAUDE_OAUTH_ENABLED` (default `true`; set `false` to disable)
- `CLAUDE_USER_EMAIL` — display-only (Anthropic API is Cloudflare-gated)
- `ENCRYPTION_KEY` — for encrypted stored credentials
- `WEBUI_HOOK_SECRET` — shared secret proving a request came from the permission-prompt hook; auto-generated per process if unset
- `PREVIEW_HOSTNAME` — hostname of the preview subdomain for in-container dev servers
- `CLI_PROVIDER_CLAUDE_MODELS`, `CLI_PROVIDER_CODEX_MODELS`, `CLI_PROVIDER_OPENCODE_MODELS`, `CLI_PROVIDER_OPENCODE_DEFAULT_MODEL` — override available models per provider

## ComfyUI Image Generation (MCP)

Claude can generate images inline in chat via a built-in MCP tool backed by a ComfyUI Flux.2 Klein 9b server.

- **MCP server**: `scripts/mcp-servers/comfyui.mjs` — zero-dep Node stdio server. Exposes one tool: `generate_image`. Submits to the LoRA Tester backend, polls, downloads from ComfyUI, saves to `data/generated/<uuid>.png`, returns a `display_markdown` field (`![alt](/generated/<uuid>.png)`) that Claude pastes into its reply to render the image inline.
- **Registration**: `config/claude/settings.json` → `mcpServers.comfyui-images`. Persists via the `/home/node/.claude` mount, so fresh sessions pick it up automatically. After a rebuild, the script is available at `/app/scripts/mcp-servers/comfyui.mjs` (baked into the image via `COPY scripts ./scripts` in the Dockerfile).
- **Static serving**: `/generated/*.png` served by `packages/backend/src/index.ts`, gated by `req.isAuthenticated()` (passport session cookie). `<img>` tags don't send Bearer tokens, so session-cookie auth is required — JWT-only clients cannot load these URLs.
- **Frontend rendering**: `MemoizedMarkdown.tsx` has an `img` override that wraps generated images in a click-through `<a>` (target `_blank`) with rounded borders + lazy loading. Existing `imgSrc` CSP (`'self' data: blob: https:`) already permits same-origin image loads.
- **Targets**:
  - LoRA Tester backend: `http://192.168.1.126:8850` (API proxy)
  - ComfyUI direct: `http://192.168.1.23:8188` (download endpoint `/view`)
  - Override via MCP env vars `COMFYUI_API_URL`, `COMFYUI_BACKEND_URL`, `COMFYUI_OUTPUT_DIR`, `COMFYUI_PUBLIC_PREFIX`.
- **Caveats**: new sessions only — MCP tools are loaded at CLI spawn, so existing sessions won't see `generate_image` until you start a fresh one. Defaults: `cfg=1.0`, `sampler=euler`, `megapixels=0.5`, `steps=6`, `aspect_ratio="1:1 (Perfect Square)"`.

## Android App Creator Integration (MCP)

A second MCP server, **android-builder**, lets every webui session (Claude / Codex / OpenCode) build, install, launch, and test Android apps on real devices via the `android-app-creator` Docker container running on the host.

- **MCP server**: `scripts/mcp-servers/android-builder.mjs` — zero-dep Node stdio server, registered in `config/claude/settings.json` as `mcpServers.android-builder`. Exposes ~25 tools across project lifecycle, build, install/launch, ADB device management, emulator, and on-device testing (logcat / shell / screencap).
- **Backend target**: `http://host.docker.internal:4000` (the `android-app-creator-backend` listens on host port 4000). The compose file adds `extra_hosts: ["host.docker.internal:host-gateway"]` so this resolves from inside the webui container. Override via env `ANDROID_BUILDER_URL`.
- **Persistent device registry**: the builder backend stores known wifi pairings in `/app/data/known-devices.json`. On startup it auto-reconnects every entry with `autoReconnect=true`. **The user only pairs a phone once** — `adb_pair_wifi` + `adb_connect_wifi`, then it survives container restarts. Tools: `adb_known_devices`, `adb_forget_device`, `adb_set_friendly_name`, `adb_set_auto_reconnect`, `adb_reconnect_all`.
- **Safety**: `adb_shell` runs through a backend denylist (`rm -rf /`, `dd if=`, `mkfs`, fork bombs, `su root`). `adb_screenshot` requires an absolute `.png` path inside the builder container.
- **Skill pack**: `~/.claude/skills/android-build/SKILL.md` — invoke via the Skill tool. Documents standard workflows (cold start, build → ship → verify, new device pairing) and anti-patterns. Always go through this MCP — never call `adb` or `gradle` from `Bash`.
- **Caveats**: new sessions only — MCP tools are loaded at CLI spawn. Existing sessions won't see `android_*` / `adb_*` tools until you start a fresh chat. The android-app-creator container itself runs separately at `/mnt/user/AI/plum-code/android-app-creator/`.

## Multi-Provider Notes

Three CLI backends are wired into `ClaudeProcessManager`:
- **Claude Code** (`claude`) — primary, stream-json.
- **Codex** (`codex`) — per-turn process model; the manager detects `turn.completed` and respawns on the next input.
- **OpenCode** — used for GLM / `z-ai/glm-*` models via OpenCode's model routing.

Provider config homes (persisted via compose volumes): `~/.claude`, `~/.codex`, `~/.opencode`. See `AGENTS.md` for the broader multi-provider workflow and skill-pack sync conventions.

## Pitfalls

- **Stale doc references**: earlier versions of this file, `README.md`, and `AGENTS.md` mention Gemini image generation, an orchestration service, a Ralph worker, a watchdog, a self-rebuild API, a repair-bot sidekick container, and a handover protocol. **None of those exist anymore** — all removed from the live code. Source-of-truth order: code > this file > README/AGENTS.
- **Never run `docker compose down` or destructive container commands** while operating inside the container — it will kill the running Claude session. Build-only (`docker compose build`) is safe.

<!-- webui-managed: project-context:start -->
# Project: claude-code-webui

Web UI for Claude Code CLI

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
<!-- webui-managed: project-context:end -->
